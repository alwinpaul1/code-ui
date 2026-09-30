import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import ts from 'typescript-api'
import { parse } from '../navigation/router-seam-census.test-support'
import { placeLiveTranscript, type LiveDictationTarget } from './place-dictation-transcript'
import { eraseLiveTranscript, ptyDictationTarget } from './live-terminal-dictation'

// On-device dictation into a terminal in live-input mode types each transcript update straight onto
// the PTY line as a delta: backspaces for the words the recogniser revised, then the new tail. The
// delta was worked out against the text the last update SENT, not the text the terminal TOOK:
// placeLiveTranscript set `typed` before the send answered and never looked at the answer. A send
// that came back false (a rejected RPC, a dropped connection, a stale tab) or rejected still counted
// as typed, so the next update sent only its tail, or backspaced over characters the user had typed
// before speaking. Words vanished with nothing on screen (review, 2026-09-30). The desktop-dictation
// path had the same hole and was fixed in round 3 (desktop-dictation-live-insert-fallback.test.ts).
//
// Each terminal here holds a line, and a send changes it only when it answers true: that is the one
// answer that says the desktop wrote the bytes.

const BACKSPACE = '\u007f'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type Answer = boolean | Error

type Sent = { handle: string; bytes: string; answered: boolean; answer: (answer: Answer) => void }

function typeOnto(line: string, bytes: string): string {
  const chars = Array.from(line)
  for (const char of Array.from(bytes)) {
    if (char === BACKSPACE) {
      chars.pop()
    } else {
      chars.push(char)
    }
  }
  return chars.join('')
}

/** Terminals whose sends wait until the test answers them, oldest first. */
function terminals() {
  const lines = new Map<string, string>()
  const sent: Sent[] = []
  let inFlight = 0
  let mostInFlight = 0
  const send = (handle: string, bytes: string) =>
    new Promise<boolean>((resolve, reject) => {
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      const entry: Sent = {
        handle,
        bytes,
        answered: false,
        answer: (answer) => {
          entry.answered = true
          inFlight -= 1
          if (answer instanceof Error) {
            reject(answer)
            return
          }
          if (answer) {
            lines.set(handle, typeOnto(lines.get(handle) ?? '', bytes))
          }
          resolve(answer)
        }
      }
      sent.push(entry)
    })
  return {
    send,
    /** The bytes sent so far, to any terminal, in the order the sends started. */
    bytes: () => sent.map((entry) => entry.bytes),
    bytesTo: (handle: string) => sent.filter((entry) => entry.handle === handle).map((entry) => entry.bytes),
    line: (handle: string) => lines.get(handle) ?? '',
    /** What the user had typed on the line before speaking. */
    prefill: (handle: string, text: string) => lines.set(handle, text),
    mostInFlight: () => mostInFlight,
    /** Answers the oldest send still waiting, then lets the dictation react. */
    answer: async (answer: Answer) => {
      const next = sent.find((entry) => !entry.answered)
      if (!next) {
        throw new Error('no send is waiting for an answer')
      }
      next.answer(answer)
      await settle()
    }
  }
}

type Terminals = ReturnType<typeof terminals>

/** One transcript update from the phone recogniser, as onSpoken hands it over. */
async function speak(target: LiveDictationTarget, text: string, host: Terminals): Promise<void> {
  placeLiveTranscript(
    text,
    '',
    target,
    () => {
      throw new Error('a terminal dictation wrote the chat composer')
    },
    () => {
      throw new Error('a terminal dictation wrote the command box')
    },
    host.send
  )
  await settle()
}

function terminalTarget(handle = 'h', previous: LiveDictationTarget = { kind: 'chat' }): LiveDictationTarget {
  return ptyDictationTarget(handle, previous)
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('live dictation typed into a terminal line', () => {
  it('types every word after a send the terminal dropped, not just the new tail', async () => {
    const host = terminals()
    const target = terminalTarget()
    await speak(target, 'hello', host)
    await host.answer(false)
    await speak(target, 'hello world', host)
    await host.answer(true)
    expect(host.line('h')).toBe('hello world')
    expect(host.bytes()).toEqual(['hello', 'hello world'])
  })

  it('does not backspace over characters the terminal never received', async () => {
    const host = terminals()
    host.prefill('h', 'git commit -m ')
    const target = terminalTarget()
    await speak(target, 'hello world', host)
    await host.answer(false)
    // The recogniser revises its guess down to "hello": the terminal never took " world".
    await speak(target, 'hello', host)
    await host.answer(true)
    expect(host.line('h')).toBe('git commit -m hello')
    expect(host.bytes()[1]).not.toContain(BACKSPACE)
  })

  it('sends one delta at a time, and updates that arrive meanwhile follow in order without overlap', async () => {
    const host = terminals()
    const target = terminalTarget()
    await speak(target, 'hel', host)
    await speak(target, 'hello', host)
    await speak(target, 'hello wor', host)
    expect(host.bytes()).toEqual(['hel'])
    await host.answer(true)
    // Worked out from what the terminal took ("hel") to the newest words, the two updates as one.
    expect(host.bytes()).toEqual(['hel', 'lo wor'])
    await speak(target, 'hello world', host)
    await host.answer(true)
    await host.answer(true)
    expect(host.bytes()).toEqual(['hel', 'lo wor', 'ld'])
    expect(host.bytes().join('')).toBe('hello world')
    expect(host.line('h')).toBe('hello world')
    expect(host.mostInFlight()).toBe(1)
  })

  it('treats a send that rejects like one that came back false', async () => {
    const host = terminals()
    const target = terminalTarget()
    await speak(target, 'hello', host)
    await host.answer(new Error('the relay socket closed'))
    await speak(target, 'hello world', host)
    await host.answer(true)
    expect(host.line('h')).toBe('hello world')
  })

  it('says in one line which terminal dropped how many bytes, and never the words', async () => {
    const host = terminals()
    const target = terminalTarget('term-7')
    await speak(target, 'naïve plan', host)
    await host.answer(false)
    const warned = vi.mocked(console.warn).mock.calls
    expect(warned).toHaveLength(1)
    const line = warned[0]!.map(String).join(' ')
    expect(line).toContain('term-7')
    // UTF-8 bytes, not characters: "ï" is two.
    expect(line).toContain('11 bytes')
    expect(line).not.toContain('naïve')
    expect(line).not.toContain('plan')
  })

  it('sends nothing for an empty transcript, and backspaces a one-word line away', async () => {
    const host = terminals()
    const target = terminalTarget()
    await speak(target, '', host)
    expect(host.bytes()).toEqual([])
    await speak(target, 'a', host)
    await host.answer(true)
    await speak(target, '', host)
    await host.answer(true)
    expect(host.bytes()).toEqual(['a', BACKSPACE])
    expect(host.line('h')).toBe('')
  })

  it('does not resend in a loop while the desktop keeps refusing', async () => {
    const host = terminals()
    const target = terminalTarget()
    await speak(target, 'hello', host)
    await host.answer(false)
    await settle()
    await settle()
    expect(host.bytes()).toEqual(['hello'])
  })

  it("never types a new dictation's words into the terminal it replaced", async () => {
    const host = terminals()
    const first = terminalTarget('h1')
    await speak(first, 'hello', host)
    await speak(first, 'hello there', host)
    // The user switched tabs and spoke again: onSpoken now writes the new target only.
    const second = terminalTarget('h2', first)
    await speak(second, 'bye', host)
    await host.answer(true)
    await host.answer(true)
    await host.answer(true)
    expect(host.bytesTo('h1')).toEqual(['hello', ' there'])
    expect(host.bytesTo('h2')).toEqual(['bye'])
    expect(host.line('h1')).toBe('hello there')
    expect(host.line('h2')).toBe('bye')
  })

  it("types a dictation restarted on the same line after the last one's words have landed", async () => {
    const host = terminals()
    const first = terminalTarget('h')
    await speak(first, 'hello', host)
    await speak(first, 'hello world', host)
    const second = terminalTarget('h', first)
    await speak(second, ' again', host)
    expect(host.bytes()).toEqual(['hello'])
    await host.answer(true)
    expect(host.bytes()).toEqual(['hello', ' world'])
    await host.answer(true)
    expect(host.bytes()).toEqual(['hello', ' world', ' again'])
    await host.answer(true)
    expect(host.line('h')).toBe('hello world again')
  })

  it('on cancel erases only what the terminal took', async () => {
    const host = terminals()
    host.prefill('h', 'ls ')
    const target = terminalTarget()
    await speak(target, 'hello', host)
    await host.answer(true)
    await speak(target, 'hello world', host)
    await host.answer(false)
    if (target.kind !== 'pty') {
      throw new Error('not a terminal target')
    }
    eraseLiveTranscript(target, host.send)
    await settle()
    await host.answer(true)
    expect(host.bytes().at(-1)).toBe(BACKSPACE.repeat(5))
    expect(host.line('h')).toBe('ls ')
  })

  it('on cancel waits for the send in flight, then erases what it typed', async () => {
    const host = terminals()
    const target = terminalTarget()
    await speak(target, 'hello', host)
    if (target.kind !== 'pty') {
      throw new Error('not a terminal target')
    }
    eraseLiveTranscript(target, host.send)
    await settle()
    expect(host.bytes()).toEqual(['hello'])
    await host.answer(true)
    await host.answer(true)
    expect(host.bytes()).toEqual(['hello', BACKSPACE.repeat(5)])
    expect(host.line('h')).toBe('')
  })
})

describe('live dictation into the chat composer or the buffered command box', () => {
  it('writes the composer and the box as before, and sends nothing to a terminal', () => {
    const send = vi.fn(async () => true)
    let composer = 'draft'
    let box = 'ls'
    const writeComposer = (update: () => string) => {
      composer = update()
    }
    const writeBox = (update: (current: string) => string) => {
      box = update(box)
    }
    placeLiveTranscript('hi there', 'draft', { kind: 'chat' }, writeComposer, writeBox, send)
    placeLiveTranscript('hi', 'ls', { kind: 'buffered' }, writeComposer, writeBox, send)
    expect(composer).toBe('draft hi there')
    expect(box).toBe('ls hi')
    expect(send).not.toHaveBeenCalled()
  })
})

/** The source text of every call to `callee`, printed without comments. */
function callsTo(source: ts.SourceFile, callee: string): string[] {
  const printer = ts.createPrinter({ removeComments: true })
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee) {
      found.push(printer.printNode(ts.EmitHint.Expression, node, source))
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)
  return found
}

// The session hook's cancel computed and sent its own erase from `typed`, beside the transcript
// path, so it backspaced over words the terminal never took and raced a send still in flight. The
// hook has no behavioural handle a unit test can reach without mounting the session, so this reads
// its code (not its comments): every live dictation byte goes through live-terminal-dictation.ts.
describe('the session hook cancelling a live terminal dictation', () => {
  const hook = parse(join(import.meta.dirname, '..'), 'session/use-mobile-session-native-chat-dictation.ts')

  it('sends no dictation bytes itself, and erases through the one sender', () => {
    expect(callsTo(hook, 'sendLiveTerminalInput')).toEqual([])
    expect(callsTo(hook, 'liveDictationDelta')).toEqual([])
    expect(callsTo(hook, 'eraseLiveTranscript')).toEqual(['eraseLiveTranscript(target, sendLiveTerminalInput)'])
    expect(callsTo(hook, 'ptyDictationTarget')).toEqual([
      'ptyDictationTarget(activeHandle, liveTargetRef.current)'
    ])
  })
})
