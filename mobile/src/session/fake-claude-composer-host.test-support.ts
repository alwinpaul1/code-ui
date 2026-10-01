import { vi } from 'vitest'

/**
 * A stand-in for the desktop side of one Claude Code tab: Orca's `terminal.send`
 * and `terminal.read --screen` in front of Claude Code's input.
 *
 * It models the ONE rule that made a send arrive as `msg + 33 newlines + msg`
 * (2026-10-01, Claude Code 2.1.287), taken from the binary's input tokenizer:
 * a control byte becomes its own key only when the whole stdin READ is under 64
 * bytes (`a.length<64||u===WZ.BS`). Writes the host makes between two looks at
 * the screen coalesce into one read, so a burst split into 63 + 3 bytes is one
 * 66-byte read, and every control byte in it is literal text.
 *
 * What is transcribed and what is not. TRANSCRIBED from the 2.1.287 binary and
 * Orca's history log of the incident: the 64-byte rule; Enter on an input that
 * holds control characters strips them (`^U` dropped, the rest become newlines)
 * and does NOT submit, drawing "Removed N invisible characters · review and
 * press Enter to send" above the composer; the composer is `❯` and a no-break
 * space, wrapped rows indented two columns, between two rules; Orca drops blank
 * rows. NOT captured live, so MODELLED: Ctrl+U kills the last visual row (2.1.266
 * measurement, mobile-native-chat-input-clear.ts), the wrap column, and the
 * conversation rows above.
 */
export type FakeComposerHostOptions = {
  /** The terminal's width; the input wraps two columns narrower than it. */
  columns?: number
  /**
   * Where the host publishes the composer's text: `tail` is a screen with the
   * text in the rows (a rule that carries a name or tag, where Orca's composer
   * detector declines, 2.1.285), `draft` is Orca's reading with a bare `❯` row
   * and the text in `terminal.draft`.
   */
  publishes?: 'tail' | 'draft'
  /** Every control byte arrives as literal text, whatever the read size: a
   *  clear that cannot work on this host, whatever the phone does. */
  controlsAreLiteral?: boolean
  /** Text that lands on the input just ahead of the next Enter, from anywhere
   *  the phone does not know about: the desktop user, a late echo. */
  junkBeforeEnter?: string
  /** A permission dialog takes the composer's place the moment Enter is pressed:
   *  the message went, and the screen can no longer say so. */
  dialogAfterEnter?: boolean
  /** The placeholder drawn in an empty composer. */
  placeholder?: string
  /** Rows above the rule: the conversation. */
  conversation?: readonly string[]
}

type Send = { text: string; enter: boolean }

const RULE = '─'.repeat(90)

export function createFakeComposerHost(options: FakeComposerHostOptions = {}) {
  const width = (options.columns ?? 90) - 2
  const publishes = options.publishes ?? 'draft'
  const conversation = options.conversation ?? ['⏺ Done. The change is in.', '', '✻ Sautéed for 31s']
  let input = ''
  let notice: string | null = null
  let pending = ''
  /** Every write the phone made, in order. */
  const sends: Send[] = []
  /** Every message Claude actually took as a turn. */
  const submitted: string[] = []
  let reads = 0
  let enters = 0
  /** Bytes Claude read at once, per read. */
  const readSizes: number[] = []
  /** Runs once, in the read that follows it, before its bytes are processed. */
  let beforeNextRead: (() => void) | null = null

  const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)

  function killLastRow(): void {
    if (input.length === 0) {
      return
    }
    const rowStart = input.length % width === 0 ? input.length - width : input.length - (input.length % width)
    input = input.slice(0, Math.max(0, rowStart))
  }

  function readBytes(bytes: string): void {
    if (bytes.length === 0) {
      return
    }
    readSizes.push(bytes.length)
    const literal = options.controlsAreLiteral === true || bytes.length >= 64
    for (const char of bytes) {
      const code = char.charCodeAt(0)
      if (code === 8 || code === 127) {
        input = input.slice(0, -1)
      } else if (code < 32 && !literal) {
        if (code === 0x15) {
          killLastRow()
        }
        // ^K at the end of the input kills nothing.
      } else {
        input += char
      }
    }
  }

  function flush(): void {
    const bytes = pending
    pending = ''
    beforeNextRead?.()
    beforeNextRead = null
    readBytes(bytes)
  }

  function pressEnter(): void {
    enters += 1
    if (hasControl(input)) {
      const stripped = [...input]
        .map((c) => (c === '\x15' ? '' : c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? '\n' : c))
        .join('')
      const removed = [...input].filter((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127).length
      notice = `Removed ${removed} invisible characters · review and press Enter to send`
      input = stripped
      return
    }
    notice = null
    if (input.trim()) {
      submitted.push(input)
    }
    input = ''
  }

  function composerRows(): string[] {
    if (input === '') {
      return [options.placeholder ? `❯ ${options.placeholder}` : '❯ ']
    }
    if (publishes === 'draft') {
      return ['❯']
    }
    const chunks: string[] = []
    for (let at = 0; at < input.length; at += width) {
      chunks.push(input.slice(at, at + width))
    }
    return chunks.map((chunk, index) => (index === 0 ? `❯ ${chunk}` : `  ${chunk}`))
  }

  function screen(): string[] {
    if (options.dialogAfterEnter && enters > 0) {
      return ['⏺ Bash(ls)', '  Do you want to proceed?', '❯ 1. Yes', '  2. No', '  Esc to cancel']
    }
    return [
      ...conversation.filter((row) => row !== ''),
      ...(notice ? [`${' '.repeat(128)}${notice}`] : []),
      RULE,
      ...composerRows(),
      RULE,
      '  [Opus 5.5 xhigh | Max 20x] ██░░░░░░░░ 16%',
      '  ⏵⏵ auto mode on (shift+tab to cycle)'
    ]
  }

  const handle = vi.fn(async (method: string, params: unknown) => {
    const body = (params ?? {}) as { text?: string; enter?: boolean; screen?: boolean }
    if (method === 'terminal.send') {
      const text = body.text ?? ''
      sends.push({ text, enter: body.enter === true })
      pending += text
      if (body.enter === true) {
        input += options.junkBeforeEnter ?? ''
        flush()
        pressEnter()
      }
      return { id: 'r', ok: true, result: { send: { accepted: true } }, _meta: { runtimeId: 'rt' } }
    }
    if (method === 'terminal.read') {
      reads += 1
      flush()
      return {
        id: 'r',
        ok: true,
        result: {
          terminal: {
            source: 'screen',
            tail: screen(),
            ...(publishes === 'draft' ? { draft: input || options.placeholder || '' } : { draft: '' })
          }
        },
        _meta: { runtimeId: 'rt' }
      }
    }
    throw new Error(`unexpected ${method}`)
  })

  return {
    handle,
    sends,
    submitted,
    /** The composer's text as Claude holds it, control characters included. */
    get input() {
      return input
    },
    get notice() {
      return notice
    },
    get reads() {
      return reads
    },
    get enters() {
      return enters
    },
    readSizes,
    screen,
    /** The input as the mirror leaves it: typed in, on screen, before the send. */
    holdInput(text: string): void {
      input = text
    },
    /** Something the host does to the input just before it takes the next read. */
    beforeNextRead(run: () => void): void {
      beforeNextRead = run
    },
    typeIntoInput(text: string): void {
      input += text
    }
  }
}

export type FakeComposerHost = ReturnType<typeof createFakeComposerHost>
