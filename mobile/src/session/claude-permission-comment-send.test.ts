import { describe, expect, it, vi } from 'vitest'
import { capturedScreen } from './claude-permission-dialog.test-support'
import {
  driveClaudePermissionComment,
  sanitizeDenyComment,
  sendClaudePermissionComment,
  type ClaudePermissionCommentIo
} from './claude-permission-comment-send'
import type { RpcClient } from '../transport/rpc-client'

const DOWN = '\x1b[B'
const UP = '\x1b[A'
const TAB = '\t'
const ENTER = '\r'
const COMMENT = 'use the date command instead'

// "Deny with comment" on a notification (the Claude app's `hub_deny_comment`, "Tell Claude what to
// do instead": n030.java:486-520, i09.java), typed into Claude Code's own permission dialog with
// the dialog's own keys, each read back before the next. Claude Code 2.1.299, real frames
// (fixtures/claude-screen-permission-amend-2.1.299.txt, tmux capture-pane -p, 2026-10-14):
//   Down moves the highlight and submits nothing; the DIGIT of "No" submits a plain rejection;
//   Tab on the highlighted No row opens it ("No, and tell Claude what to do differently");
//   typed words follow "No, " on the row; Enter submits them. Esc inside that input rejects the
//   whole request, so nothing here uses it to back out.

/** The frame with the `❯` moved to another numbered row of the dialog at the bottom. The only
 *  difference between the two captured Bash frames (bash-dialog, highlight on 1, and
 *  bash-no-highlighted, highlight on 4) is where the marker is, so the frames between them are the
 *  same frame with the marker on 2 or 3. The tests below prove the move reproduces a real capture
 *  exactly at each end. */
export function moveHighlight(frame: string[], digit: number): string[] {
  const question = frame.findLastIndex((row) => /\?\s*$/.test(row) && !/^\s*(?:❯\s*)?\d\./.test(row))
  return frame.map((row, at) => {
    if (at <= question) {
      return row
    }
    const unmarked = row.replace(/^ ❯ (?=\d\. )/, '   ')
    return unmarked.replace(new RegExp(`^ {3}(?=${digit}\\. )`), ' ❯ ')
  })
}

type Start = 'dialog' | 'no-highlighted' | 'no-amend' | 'no-typed' | 'after-submit'

/** A Claude Code dialog that answers keys the way the captured sequence did, and records every
 *  write it was handed. Any key it was not captured answering leaves the screen unchanged and is
 *  noted, so a test fails on a digit or an Esc that should never have been sent. */
function simulator(path: 'bash' | 'write', start: Start) {
  const rows = path === 'bash' ? 4 : 3
  const phases = { dialog: 'select', 'no-highlighted': 'select', 'no-amend': 'amend', 'no-typed': 'typed', 'after-submit': 'done' } as const
  const state = {
    phase: phases[start] as 'select' | 'amend' | 'typed' | 'done',
    highlight: start === 'dialog' ? 1 : rows,
    written: [] as string[],
    unexpected: [] as string[],
    plainRejection: false
  }
  const screen = (): string[] => {
    switch (state.phase) {
      case 'select':
        if (state.highlight === 1) {
          return capturedScreen(`${path}-dialog`)
        }
        return state.highlight === rows
          ? capturedScreen(`${path}-no-highlighted`)
          : moveHighlight(capturedScreen(`${path}-dialog`), state.highlight)
      case 'amend':
        return capturedScreen(`${path}-no-amend`)
      case 'typed':
        return capturedScreen(`${path}-no-typed`)
      default:
        return capturedScreen('bash-after-submit')
    }
  }
  const io: ClaudePermissionCommentIo & { state: typeof state } = {
    state,
    readScreen: async () => screen(),
    sendKeys: async (keys) => {
      state.written.push(keys)
      if (state.phase === 'select' && keys === DOWN) {
        state.highlight = Math.min(rows, state.highlight + 1)
      } else if (state.phase === 'select' && keys === UP) {
        state.highlight = Math.max(1, state.highlight - 1)
      } else if (state.phase === 'select' && keys === TAB && state.highlight === rows) {
        state.phase = 'amend'
      } else if (state.phase === 'amend' && keys === COMMENT && path === 'bash') {
        state.phase = 'typed'
      } else if (state.phase === 'typed' && keys === ENTER) {
        state.phase = 'done'
      } else {
        state.unexpected.push(keys)
        if (/^\d$/.test(keys)) {
          state.plainRejection = true
        }
      }
      return true
    },
    sleep: async () => undefined,
    now: (() => {
      let clock = 0
      return () => (clock += 400)
    })()
  }
  return io
}

describe('the frames the simulator draws between the captured ones', () => {
  it('reproduce the captured Bash frame exactly when the marker moves from 1 to 4', () => {
    expect(moveHighlight(capturedScreen('bash-dialog'), 4)).toEqual(capturedScreen('bash-no-highlighted'))
  })

  it('reproduce the captured Bash frame exactly when the marker moves back from 4 to 1', () => {
    expect(moveHighlight(capturedScreen('bash-no-highlighted'), 1)).toEqual(capturedScreen('bash-dialog'))
  })

  it('reproduce the captured Write frame exactly when the marker moves from 1 to 3', () => {
    expect(moveHighlight(capturedScreen('write-dialog'), 3)).toEqual(capturedScreen('write-no-highlighted'))
  })
})

describe('denying a Bash prompt with a comment, from the shade', () => {
  it('walks Down one row at a time to the No row, opens it with Tab, types the words and presses Enter', async () => {
    const io = simulator('bash', 'dialog')
    expect(await driveClaudePermissionComment(io, COMMENT)).toEqual({ ok: true })
    expect(io.state.written).toEqual([DOWN, DOWN, DOWN, TAB, COMMENT, ENTER])
    expect(io.state.unexpected).toEqual([])
  })

  it('never sends the No row’s digit, which would submit a plain rejection and lose the comment', async () => {
    const io = simulator('bash', 'dialog')
    await driveClaudePermissionComment(io, COMMENT)
    expect(io.state.plainRejection).toBe(false)
    expect(io.state.written.join('')).not.toMatch(/\d/)
    // Nor an Esc, which inside the row's input rejects the whole request.
    expect(io.state.written.join('')).not.toContain('\x1b\x1b')
  })

  it('skips the walk when the highlight is already on No', async () => {
    const io = simulator('bash', 'no-highlighted')
    expect(await driveClaudePermissionComment(io, COMMENT)).toEqual({ ok: true })
    expect(io.state.written).toEqual([TAB, COMMENT, ENTER])
  })

  it('goes on from a No row already open for typing with nothing typed in it', async () => {
    const io = simulator('bash', 'no-amend')
    expect(await driveClaudePermissionComment(io, COMMENT)).toEqual({ ok: true })
    expect(io.state.written).toEqual([COMMENT, ENTER])
  })
})

describe('denying a Write prompt with a comment, from the shade', () => {
  it('walks two rows down to No and opens it, the Write dialog having one option fewer', async () => {
    const io = simulator('write', 'dialog')
    // The frame after the words are typed is not in the capture, so the drive stops where the
    // simulator has nothing to show, having read the row back and refused to press Enter.
    const result = await driveClaudePermissionComment(io, COMMENT)
    expect(io.state.written.slice(0, 3)).toEqual([DOWN, DOWN, TAB])
    expect(result).toMatchObject({ ok: false, reason: 'not-echoed' })
    expect(io.state.written).not.toContain(ENTER)
    expect(io.state.plainRejection).toBe(false)
  })
})

describe('when the screen is not what the drive expects, it stops and says why', () => {
  it('sends nothing when no dialog is on the screen (the agent has carried on)', async () => {
    const io = simulator('bash', 'after-submit')
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'no-dialog' })
    expect(io.state.written).toEqual([])
  })

  it('sends nothing when the screen cannot be read', async () => {
    const io = simulator('bash', 'dialog')
    io.readScreen = async () => null
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(io.state.written).toEqual([])
  })

  it('sends nothing for an empty comment', async () => {
    const io = simulator('bash', 'dialog')
    expect(await driveClaudePermissionComment(io, '  \n ')).toMatchObject({ ok: false, reason: 'empty' })
    expect(io.state.written).toEqual([])
  })

  it('refuses a dialog whose footer does not offer Tab to amend (an older Claude Code)', async () => {
    const io = simulator('bash', 'dialog')
    io.readScreen = async () => capturedScreen('bash-dialog').map((row) => row.replace(' · Tab to amend', ''))
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'not-amendable' })
    expect(io.state.written).toEqual([])
  })

  it('refuses a dialog whose last row is not a plain No, such as the older "(esc)" wording', async () => {
    const io = simulator('bash', 'dialog')
    io.readScreen = async () =>
      capturedScreen('bash-dialog').map((row) =>
        row.replace('   4. No', '   4. No, and tell Claude what to do differently (esc)')
      )
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'no-deny-row' })
    expect(io.state.written).toEqual([])
  })

  it('refuses a No row that already holds someone’s words', async () => {
    const io = simulator('bash', 'no-typed')
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'no-deny-row' })
    expect(io.state.written).toEqual([])
  })

  it('refuses a dialog with no highlight it can see', async () => {
    const io = simulator('bash', 'dialog')
    io.readScreen = async () => capturedScreen('bash-dialog').map((row) => row.replace(' ❯ 1. Yes', '   1. Yes'))
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'cursor' })
    expect(io.state.written).toEqual([])
  })

  it('stops after the first Down when the highlight did not move, and sends no Tab', async () => {
    const io = simulator('bash', 'dialog')
    io.sendKeys = async (keys) => {
      io.state.written.push(keys)
      return true
    }
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'cursor' })
    expect(io.state.written).toEqual([DOWN])
  })

  it('stops before typing when Tab did not open the row', async () => {
    const io = simulator('bash', 'no-highlighted')
    io.sendKeys = async (keys) => {
      io.state.written.push(keys)
      return true
    }
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'not-amended' })
    expect(io.state.written).toEqual([TAB])
  })

  it('does not press Enter when the words did not show up on the row', async () => {
    const io = simulator('bash', 'no-amend')
    io.sendKeys = async (keys) => {
      io.state.written.push(keys)
      return true
    }
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'not-echoed' })
    expect(io.state.written).toEqual([COMMENT])
  })

  it('says it could not confirm when the dialog still shows the words after Enter', async () => {
    const io = simulator('bash', 'no-amend')
    const original = io.sendKeys
    io.sendKeys = async (keys) => {
      await original(keys)
      if (keys === ENTER) {
        io.state.phase = 'typed'
      }
      return true
    }
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'unconfirmed' })
  })

  it('reports a write the host refused, and stops there', async () => {
    const io = simulator('bash', 'dialog')
    io.sendKeys = async (keys) => {
      io.state.written.push(keys)
      return false
    }
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'send-failed' })
    expect(io.state.written).toEqual([DOWN])
  })

  it('reports a Tab the host refused, before anything is typed', async () => {
    const io = simulator('bash', 'no-highlighted')
    io.sendKeys = async (keys) => {
      io.state.written.push(keys)
      return false
    }
    expect(await driveClaudePermissionComment(io, COMMENT)).toMatchObject({ ok: false, reason: 'send-failed' })
    expect(io.state.written).toEqual([TAB])
  })
})

describe('what is typed', () => {
  it('has control characters taken out, so no key of the dialog can be pressed by a reply', () => {
    expect(sanitizeDenyComment('run\x1b[B it\x03 \tagain')).toBe('run [B it again')
  })

  it('collapses line breaks and runs of spaces into single spaces', () => {
    expect(sanitizeDenyComment('use\n\n  the   date\r\ncommand')).toBe('use the date command')
  })

  it('is cut at a whole character, never through an emoji', () => {
    const long = `${'a'.repeat(499)}😀tail`
    const cut = sanitizeDenyComment(long)
    expect(cut.length).toBeLessThanOrEqual(500)
    expect(cut.endsWith('\ud83d')).toBe(false)
  })

  // Claude Code draws a long chunk of typed input as a "[Pasted text]" placeholder in place of the
  // words (a paste is told by its size), and then the words are not on the No row to be read back.
  // A comment from a notification's reply field is short; this keeps well under any such size.
  it('is kept to 500 characters, far under the size at which Claude Code treats typed input as a paste', () => {
    expect(sanitizeDenyComment('a'.repeat(5_000)).length).toBe(500)
    expect(sanitizeDenyComment('a'.repeat(500))).toHaveLength(500)
    expect(sanitizeDenyComment('a'.repeat(499))).toHaveLength(499)
  })

  it('is empty for nothing but whitespace and controls', () => {
    expect(sanitizeDenyComment(' \x1b \n')).toBe('')
  })
})

describe('over the relay', () => {
  function rpc(screens: string[][], accepted = true) {
    let read = 0
    const sendRequest = vi.fn(async (method: string, _params?: unknown) => {
      if (method === 'terminal.read') {
        return { ok: true, result: { terminal: { source: 'screen', lines: screens[Math.min(read++, screens.length - 1)] } } }
      }
      return { ok: true, result: { send: { accepted } } }
    })
    const client = { sendRequest, getState: () => 'connected' } as unknown as RpcClient
    return { client, sendRequest }
  }

  it('answers stale and writes nothing when the terminal shows no dialog', async () => {
    const { client, sendRequest } = rpc([capturedScreen('bash-after-submit')])
    expect(await sendClaudePermissionComment({ client, terminal: 't1', comment: COMMENT })).toBe('stale')
    expect(sendRequest.mock.calls.filter((call) => call[0] === 'terminal.send')).toHaveLength(0)
  })

  it('answers refused for an empty comment without touching the terminal', async () => {
    const { client, sendRequest } = rpc([capturedScreen('bash-dialog')])
    expect(await sendClaudePermissionComment({ client, terminal: 't1', comment: ' ' })).toBe('refused')
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('answers failed when the link is down', async () => {
    const { client } = rpc([capturedScreen('bash-dialog')])
    ;(client as unknown as { getState: () => string }).getState = () => 'disconnected'
    expect(await sendClaudePermissionComment({ client, terminal: 't1', comment: COMMENT })).toBe('failed')
  })

  it('writes each key to the terminal it was asked for, with no Enter appended to any of them', async () => {
    const { client, sendRequest } = rpc([capturedScreen('bash-dialog')])
    await sendClaudePermissionComment({ client, terminal: 't1', comment: COMMENT })
    const writes = sendRequest.mock.calls.filter((call) => call[0] === 'terminal.send')
    expect(writes.length).toBeGreaterThan(0)
    for (const [, params] of writes) {
      expect(params).toMatchObject({ terminal: 't1', enter: false })
    }
    // The first screen never changes in this fake, so the highlight never moves and the drive stops
    // at the first Down: nothing but arrow keys was written.
    expect(writes.map((call) => (call[1] as { text: string }).text)).toEqual([DOWN])
  })
})
