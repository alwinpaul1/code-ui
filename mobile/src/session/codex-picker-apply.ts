// Drive Codex's `/model` picker from the phone to set the model and reasoning
// effort. See codex-picker-screen.ts for why the picker, not a command.
//
// Sequence: confirm the TUI is idle → type "/model" → wait for the model step
// → arrow the cursor from its current row to the target → Enter → wait for the
// effort step → (expand "More reasoning…" if the level hides behind it) → arrow
// → Enter → wait for the picker to close and the footer to name the pair.
// Every wait is bounded; on any miss the picker is escaped — but never while a
// turn is running, because Esc there interrupts the agent.
import { codexPermissionFromScreen } from './codex-terminal-permission'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'
import { AGENT_TUI_CLEAR_INPUT_LINE } from '../../../src/shared/agent-tui-input-clear'
import {
  isCodexWorking,
  matchCodexEffortRow,
  parseCodexPickerScreen,
  type CodexPickerScreen
} from './codex-picker-screen'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_ENTER = '\r'
const KEY_ESC = '\x1b'
// Each poll is a terminal.read round trip; the interval only adds to that.
const POLL_MS = 120
// Gap between the command text and its Enter, so the slash palette has
// filtered to the command before Enter picks it.
const COMMAND_ENTER_GAP_MS = 60
// How long a typed command may stay on the input line after Enter before the
// Enter is treated as lost and sent again.
const ENTER_VERIFY_MS = 900
const STEP_TIMEOUT_MS = 5_000
const CLOSE_TIMEOUT_MS = 6_000
const SEND_TIMEOUT_MS = 8_000

export type CodexPickerTarget = {
  model: string
  /** Omit to keep the model's current effort (Enter on the highlighted row). */
  effort?: { id: string; label: string } | null
}

export type CodexPickerApplyResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'busy'
        | 'no-picker'
        | 'model-unavailable'
        | 'effort-unavailable'
        | 'cursor'
        | 'send-failed'
        | 'unverified'
    }

export type CodexPickerIo = {
  readScreen: () => Promise<string[]>
  /** One raw write; resolves false when the host rejected it. */
  sendKey: (text: string) => Promise<boolean>
  typeCommand: (command: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export function createCodexPickerIo(args: {
  client: RpcClient
  terminal: string
  deviceToken: string | null
}): CodexPickerIo {
  const { client, terminal, deviceToken } = args
  const io: CodexPickerIo = {
    readScreen: async () => {
      const response = await client.sendRequest(
        'terminal.read',
        { terminal, screen: true },
        { timeoutMs: SEND_TIMEOUT_MS }
      )
      if (!response.ok) {
        return []
      }
      const result = (response as RpcSuccess).result as {
        terminal?: { tail?: unknown; lines?: unknown }
      }
      const raw = result.terminal?.tail ?? result.terminal?.lines
      return Array.isArray(raw)
        ? raw.filter((line): line is string => typeof line === 'string')
        : []
    },
    sendKey: async (text) => {
      const response = await client.sendRequest(
        'terminal.send',
        buildTerminalSendParams({ terminal, text, enter: false, deviceToken }),
        { timeoutMs: SEND_TIMEOUT_MS }
      )
      return isTerminalSendRpcAccepted(response)
    },
    // Why not the per-key typer the chat composer uses: that is one round trip
    // per character (8 for "/model"), which was most of a pick's latency. Codex
    // reads a burst of bytes as separate key events, so the clear + command
    // goes in one write and Enter in a second (verified live 2026-09-06).
    typeCommand: async (command) => {
      const write = async (text: string): Promise<boolean> => {
        const response = await client.sendRequest(
          'terminal.send',
          buildTerminalSendParams({ terminal, text, enter: false, deviceToken }),
          { timeoutMs: SEND_TIMEOUT_MS }
        )
        return isTerminalSendRpcAccepted(response)
      }
      if (!(await write(AGENT_TUI_CLEAR_INPUT_LINE + command))) {
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, COMMAND_ENTER_GAP_MS))
      if (!(await write(KEY_ENTER))) {
        return false
      }
      // Why: one Enter was lost once (a "/status" sat on the input line with the
      // palette open, and would have glued onto the user's next message). Confirm
      // the line cleared; if the command is still typed there, Enter again once.
      const still = new RegExp(`^\\s*›\\s*${escapeRegExp(command)}\\s*$`)
      const deadline = Date.now() + ENTER_VERIFY_MS
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        const lines = await io.readScreen()
        if (!lines.some((line) => still.test(line))) {
          return true
        }
      }
      return write(KEY_ENTER)
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now()
  }
  return io
}

export async function waitForCodexPickerStep(
  io: CodexPickerIo,
  step: CodexPickerScreen['step'],
  timeoutMs: number
): Promise<CodexPickerScreen | null> {
  const deadline = io.now() + timeoutMs
  while (io.now() < deadline) {
    const screen = parseCodexPickerScreen(await io.readScreen())
    if (screen?.step === step) {
      return screen
    }
    await io.sleep(POLL_MS)
  }
  return null
}

export async function escapeCodexPicker(io: CodexPickerIo): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lines = await io.readScreen()
    if (isCodexWorking(lines)) {
      return
    }
    if (!parseCodexPickerScreen(lines)) {
      return
    }
    await io.sendKey(KEY_ESC)
    await io.sleep(POLL_MS)
  }
}

/** Move the cursor from `from` to `to` (1-based rows) and confirm it landed. */
async function moveCursor(
  io: CodexPickerIo,
  step: CodexPickerScreen['step'],
  from: number,
  to: number
): Promise<boolean> {
  const delta = to - from
  if (delta === 0) {
    return true
  }
  // One write for the whole run of arrows: the TUI reads them as separate
  // key events, and a write per row was a round trip per row.
  const keys = (delta > 0 ? KEY_DOWN : KEY_UP).repeat(Math.abs(delta))
  if (!(await io.sendKey(keys))) {
    return false
  }
  const deadline = io.now() + STEP_TIMEOUT_MS
  while (io.now() < deadline) {
    const screen = parseCodexPickerScreen(await io.readScreen())
    if (screen?.step === step && screen.cursorIndex === to) {
      return true
    }
    await io.sleep(POLL_MS)
  }
  return false
}

export async function applyCodexPickerSelection(
  io: CodexPickerIo,
  target: CodexPickerTarget
): Promise<CodexPickerApplyResult> {
  const before = await io.readScreen()
  if (codexPermissionFromScreen(before)) {
    return { ok: false, reason: 'busy' }
  }
  if (parseCodexPickerScreen(before)) {
    await escapeCodexPicker(io)
  }
  if (!(await io.typeCommand('/model'))) {
    return { ok: false, reason: 'send-failed' }
  }
  const modelStep = await waitForCodexPickerStep(io, 'model', STEP_TIMEOUT_MS)
  if (!modelStep) {
    return { ok: false, reason: 'no-picker' }
  }
  const modelRow = modelStep.rows.find((row) => row.name === target.model)
  const cursor = modelStep.cursorIndex ?? modelStep.rows.find((row) => row.isCurrent)?.index ?? null
  if (!modelRow || cursor === null) {
    await escapeCodexPicker(io)
    return { ok: false, reason: modelRow ? 'cursor' : 'model-unavailable' }
  }
  if (!(await moveCursor(io, 'model', cursor, modelRow.index))) {
    await escapeCodexPicker(io)
    return { ok: false, reason: 'cursor' }
  }
  if (!(await io.sendKey(KEY_ENTER))) {
    return { ok: false, reason: 'send-failed' }
  }
  let effortStep = await waitForCodexPickerStep(io, 'effort', STEP_TIMEOUT_MS)
  if (!effortStep) {
    await escapeCodexPicker(io)
    return { ok: false, reason: 'no-picker' }
  }
  if (target.effort) {
    let effortRow = matchCodexEffortRow(effortStep.rows, target.effort)
    if (!effortRow) {
      // Max/Ultra sit behind an expander row; open it and look again.
      const more = effortStep.rows.find((row) => row.isMore)
      const effortCursor =
        effortStep.cursorIndex ?? effortStep.rows.find((row) => row.isCurrent)?.index
      if (!more || effortCursor === undefined) {
        await escapeCodexPicker(io)
        return { ok: false, reason: 'effort-unavailable' }
      }
      if (
        !(await moveCursor(io, 'effort', effortCursor, more.index)) ||
        !(await io.sendKey(KEY_ENTER))
      ) {
        await escapeCodexPicker(io)
        return { ok: false, reason: 'cursor' }
      }
      await io.sleep(POLL_MS)
      effortStep = await waitForCodexPickerStep(io, 'effort', STEP_TIMEOUT_MS)
      effortRow = effortStep ? matchCodexEffortRow(effortStep.rows, target.effort) : undefined
      if (!effortStep || !effortRow) {
        await escapeCodexPicker(io)
        return { ok: false, reason: 'effort-unavailable' }
      }
    }
    const effortCursor =
      effortStep.cursorIndex ?? effortStep.rows.find((row) => row.isCurrent)?.index
    if (effortCursor === undefined) {
      await escapeCodexPicker(io)
      return { ok: false, reason: 'cursor' }
    }
    if (!(await moveCursor(io, 'effort', effortCursor, effortRow.index))) {
      await escapeCodexPicker(io)
      return { ok: false, reason: 'cursor' }
    }
  }
  if (!(await io.sendKey(KEY_ENTER))) {
    return { ok: false, reason: 'send-failed' }
  }
  // The footer names the active pair ("gpt-5.6-sol xhigh · ~/dir") once applied.
  const deadline = io.now() + CLOSE_TIMEOUT_MS
  const wantedEffort = target.effort?.id ?? null
  while (io.now() < deadline) {
    const lines = await io.readScreen()
    if (!parseCodexPickerScreen(lines)) {
      const footer = lines.slice(-4).join('\n')
      const named = new RegExp(
        `\\b${escapeRegExp(target.model)}\\s+${wantedEffort ? escapeRegExp(wantedEffort) : '\\S+'}\\s*·`
      )
      if (named.test(footer)) {
        return { ok: true }
      }
    }
    await io.sleep(POLL_MS)
  }
  return { ok: false, reason: 'unverified' }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
