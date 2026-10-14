import type { RpcClient } from '../transport/rpc-client'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'
import { cutWholeCharacters } from '../text/whole-character-cut'
import { planFeedbackScreenRead, planFeedbackWrite } from './claude-plan-feedback-operations'
import { readClaudePermissionDialog, type ClaudePermissionDialog } from './claude-permission-dialog'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

// ─── "Deny with comment" on a Claude Code permission dialog ──────────────────
//
// The Claude app's notification offers Deny with comment (`hub_deny_comment`, "Tell Claude what to
// do instead": n030.java:486-520, i09.java). Over a terminal tab the same thing is the dialog's own
// "No, and tell Claude what to do differently" row, driven with the dialog's own keys. Verified live
// on Claude Code 2.1.299 (tmux capture-pane -p, 2026-10-14; the frames are in
// fixtures/claude-screen-permission-amend-2.1.299.txt):
//
//  - Down and Up move the `❯` and submit nothing.
//  - The DIGIT of the No row submits a plain rejection at once. It is never sent here: it would lose
//    the comment, and it is the one key that cannot be taken back.
//  - Tab on a highlighted row opens it for words, when the footer says "Tab to amend": the No row
//    then reads "No, and tell Claude what to do differently" and the footer reads "Esc to cancel".
//  - Typed words follow "No, " on the row, and Enter submits them as the rejection's reason. The
//    agent received them: "use the date command instead" made it run date; "name it hello.md" made
//    it ask for a Write to /tmp/hello.md.
//  - Esc inside that input rejects the whole request ("Interrupted · What should Claude do
//    instead?"). It is no way back out, so nothing here sends it as a recovery. A refusal part-way
//    leaves the row as it is, which is Claude's own "type your comment" state, and the next tap goes
//    on from there when the row still holds nothing of anyone's.
//
// Every key is sent only on a screen that says where it lands, and read back before the next
// (as claude-background-task-stop.ts and claude-plan-feedback-send.ts do). Anything else stops the
// drive with the reason, and a stop sends nothing more: the diagnostic says where it stopped.

/** The row's words once Tab has opened it. */
const AMEND_LABEL = 'No, and tell Claude what to do differently'
const KEY_DOWN = '\x1b[B'
const KEY_UP = '\x1b[A'
const KEY_TAB = '\t'
const KEY_ENTER = '\r'
const POLL_MS = 120
const STEP_TIMEOUT_MS = 2_500
/** What a reply can type: a notification's reply field is a line, not a document. */
const MAX_COMMENT_CHARS = 1_000

export type ClaudePermissionCommentIo = {
  /** The terminal's current screen, or null when it cannot be read. */
  readScreen: () => Promise<string[] | null>
  /** One raw write, no Enter added; false when the host refused it. */
  sendKeys: (keys: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

type Reason =
  | 'empty'
  | 'unreadable'
  | 'no-dialog'
  | 'not-amendable'
  | 'no-deny-row'
  | 'cursor'
  | 'not-amended'
  | 'not-echoed'
  | 'unconfirmed'
  | 'send-failed'

export type ClaudePermissionCommentResult = { ok: true } | { ok: false; reason: Reason; message: string }

const MESSAGES: Record<Reason, string> = {
  empty: 'the comment was empty, so nothing was sent',
  unreadable: "couldn't read the desktop screen, so nothing was sent",
  'no-dialog': "Claude's prompt is no longer on the desktop screen, so nothing was sent",
  'not-amendable': "Claude's prompt does not offer Tab to amend (an older Claude Code), so nothing was sent",
  'no-deny-row': "the prompt's last row is not a plain No, or already holds words, so nothing was sent",
  cursor: "the highlight did not reach the prompt's No row, so no comment was typed",
  'not-amended': "Claude did not open the No row for typing, so no comment was typed",
  'not-echoed': "the words did not appear on the No row, so Enter was not pressed",
  unconfirmed: "Enter was sent but the prompt is still showing the comment; check the desktop",
  'send-failed': "the desktop refused the keys; the prompt is as it was left"
}

const fail = (reason: Reason): ClaudePermissionCommentResult => ({ ok: false, reason, message: MESSAGES[reason] })

/** The comment as it may be typed: control characters (an Esc, an arrow's escape sequence, a Ctrl
 *  key) turned into spaces so no key of the dialog can be pressed by a reply, line breaks and runs
 *  of spaces collapsed, and the whole cut at a whole character. */
export function sanitizeDenyComment(text: string): string {
  const noControls = Array.from(text, (char) => (isControlCharacter(char.codePointAt(0)!) ? ' ' : char)).join('')
  const plain = noControls.replace(/\s+/g, ' ').trim()
  return cutWholeCharacters(plain, MAX_COMMENT_CHARS).trimEnd()
}

/** C0 (Esc, Tab, Ctrl keys, a line break), DEL and C1: anything a terminal reads as a key or a
 *  command and not as a letter. */
function isControlCharacter(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

/** Whitespace out: a long comment wraps onto a second row, which can split a word. */
const compact = (text: string): string => text.replace(/\s+/g, '')

/** Polls until `read` accepts the screen, on two reads in a row so a frame torn mid-repaint cannot
 *  pass; null on the timeout. */
async function waitFor<T>(io: ClaudePermissionCommentIo, read: (lines: string[]) => T | null): Promise<T | null> {
  const deadline = io.now() + STEP_TIMEOUT_MS
  let seen = false
  for (;;) {
    const lines = await io.readScreen()
    const value = lines ? read(lines) : null
    if (value !== null && seen) {
      return value
    }
    seen = value !== null
    if (io.now() >= deadline) {
      return null
    }
    await io.sleep(POLL_MS)
  }
}

function sameRows(now: ClaudePermissionDialog, before: ClaudePermissionDialog): boolean {
  return (
    now.options.length === before.options.length &&
    now.options.every((option, at) => option.text === before.options[at]!.text)
  )
}

export async function driveClaudePermissionComment(
  io: ClaudePermissionCommentIo,
  rawComment: string
): Promise<ClaudePermissionCommentResult> {
  const comment = sanitizeDenyComment(rawComment)
  if (comment === '') {
    return fail('empty')
  }
  const first = await io.readScreen()
  if (!first) {
    return fail('unreadable')
  }
  const dialog = readClaudePermissionDialog(first)
  if (!dialog) {
    return fail('no-dialog')
  }
  const deny = dialog.options.at(-1)!
  const alreadyOpen = deny.text === AMEND_LABEL
  // Only the plain "No" of 2.1.299 (or its open, empty form): the older "(esc)" wording, or a row
  // with someone's words in it, is a screen this was not verified against.
  if (!alreadyOpen && deny.text !== 'No') {
    return fail('no-deny-row')
  }
  if (!alreadyOpen && !dialog.amendable) {
    return fail('not-amendable')
  }
  if (dialog.highlighted === null) {
    return fail('cursor')
  }
  // One key to a write, the highlight read back after each: the arrows are the dialog's own, but a
  // run of them in one chunk is not something this has seen the dialog take (the repo's other drives
  // of Claude's keys, claude-background-task-stop.ts, send one at a time too).
  let at = Number(dialog.highlighted)
  const target = Number(deny.digit)
  while (at !== target) {
    const next = at + Math.sign(target - at)
    if (!(await io.sendKeys(next > at ? KEY_DOWN : KEY_UP))) {
      return fail('send-failed')
    }
    const moved = await waitFor(io, (lines) => {
      const now = readClaudePermissionDialog(lines)
      return now !== null && now.highlighted === String(next) && sameRows(now, dialog) ? now : null
    })
    if (!moved) {
      return fail('cursor')
    }
    at = next
  }
  if (!alreadyOpen) {
    if (!(await io.sendKeys(KEY_TAB))) {
      return fail('send-failed')
    }
    const opened = await waitFor(io, (lines) => {
      const now = readClaudePermissionDialog(lines)
      return now !== null &&
        now.highlighted === deny.digit &&
        now.options.at(-1)?.text === AMEND_LABEL &&
        !now.amendable
        ? now
        : null
    })
    if (!opened) {
      return fail('not-amended')
    }
  }
  if (!(await io.sendKeys(comment))) {
    return fail('send-failed')
  }
  const typedRow = compact(`No, ${comment}`)
  const echoed = await waitFor(io, (lines) => {
    const now = readClaudePermissionDialog(lines)
    return now !== null && now.highlighted === deny.digit && compact(now.options.at(-1)!.text) === typedRow
      ? now
      : null
  })
  if (!echoed) {
    return fail('not-echoed')
  }
  if (!(await io.sendKeys(KEY_ENTER))) {
    return fail('send-failed')
  }
  // Gone, or no longer the row with our words on it (the agent may ask again at once).
  const submitted = await waitFor(io, (lines) => {
    const now = readClaudePermissionDialog(lines)
    return now === null || compact(now.options.at(-1)!.text) !== typedRow ? ({ gone: true } as const) : null
  })
  return submitted ? { ok: true } : fail('unconfirmed')
}

/** How a tap on Deny with comment ended, for the notification's answer path. */
export type ClaudePermissionCommentOutcome = 'sent' | 'stale' | 'refused' | 'failed'

const OUTCOMES: Record<Reason, Exclude<ClaudePermissionCommentOutcome, 'sent'>> = {
  empty: 'refused',
  unreadable: 'failed',
  'no-dialog': 'stale',
  'not-amendable': 'refused',
  'no-deny-row': 'refused',
  cursor: 'refused',
  'not-amended': 'refused',
  'not-echoed': 'failed',
  unconfirmed: 'failed',
  'send-failed': 'failed'
}

/**
 * Types a comment into the terminal's permission dialog, over the relay. Never throws; holds the
 * terminal's write lock for the whole drive, so no composer send or answer interleaves keys with
 * it. Leaves one line behind when it stops: this runs from the shade with no screen up, and a
 * comment that went nowhere is otherwise indistinguishable from a slow one. The words are never
 * logged, only the reason and their length.
 */
export async function sendClaudePermissionComment(args: {
  client: RpcClient
  terminal: string
  comment: string
}): Promise<ClaudePermissionCommentOutcome> {
  const { client, terminal } = args
  if (sanitizeDenyComment(args.comment) === '') {
    return 'refused'
  }
  if (client.getState() !== 'connected') {
    console.warn('[permission-comment] comment not sent: link is down', { terminal })
    return 'failed'
  }
  if (!acquireMobileNativeChatTerminalWrite(terminal)) {
    console.warn('[permission-comment] comment not sent: terminal is busy with another write', { terminal })
    return 'failed'
  }
  const io: ClaudePermissionCommentIo = {
    readScreen: async () => {
      try {
        const screen = planFeedbackScreenRead.interpret(
          await planFeedbackScreenRead.request(client, { terminal, screen: true }, { timeoutMs: 4_000 })
        )
        return screen?.isScreen ? [...screen.lines] : null
      } catch {
        return null
      }
    },
    sendKeys: async (keys) => {
      try {
        return (
          planFeedbackWrite.interpret(
            await planFeedbackWrite.request(
              client,
              buildTerminalSendParams({ terminal, text: keys, enter: false, deviceToken: null })
            )
          ) === true
        )
      } catch {
        return false
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now()
  }
  try {
    const result = await driveClaudePermissionComment(io, args.comment)
    if (result.ok) {
      return 'sent'
    }
    console.warn('[permission-comment] comment not sent', {
      terminal,
      reason: result.reason,
      message: result.message,
      length: args.comment.length
    })
    return OUTCOMES[result.reason]
  } catch {
    console.warn('[permission-comment] comment not sent: the drive threw', { terminal })
    return 'failed'
  } finally {
    releaseMobileNativeChatTerminalWrite(terminal)
  }
}
