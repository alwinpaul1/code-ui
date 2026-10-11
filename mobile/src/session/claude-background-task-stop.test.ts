import { describe, expect, it } from 'vitest'
import { matchClaudeBackgroundRow, parseClaudeBackgroundDialog, parseClaudeShellDetails, readClaudeFooterFocus } from './claude-background-dialog'
import { stopClaudeBackgroundTask, type ClaudeBackgroundStopIo } from './claude-background-task-stop'
import { busyScreen } from './fixtures/claude-busy-lead-tasks-2.1.296'

// Claude Code 2.1.296's own Background dialog, captured live on 2026-10-11
// (fixtures/claude-busy-lead-tasks-2.1.296.ts), and the key-by-key drive that stops
// one task from it. The live run this replays: two shells (the lead's `sleep 300`,
// the "Long probe agent" subagent's `sleep 240`) and that agent running; ↓ focused
// the pill, Enter opened the dialog with `sleep 240` selected, `x` stopped it, Esc
// closed the dialog.

const DOWN = '\x1b[B'
const UP = '\x1b[A'
const ENTER = '\r'
const ESC = '\x1b'

type Step = { key: string; screen: string[] }

/** The desktop as the drive sees it: each expected key moves to the next captured
 *  screen; any other key is recorded and changes nothing. */
function desktop(initial: string[], steps: Step[], options: { lateReads?: number } = {}) {
  let screen = initial
  let pending: string[] | null = null
  let readsLeft = 0
  let next = 0
  const keys: string[] = []
  let clock = 0
  const io: ClaudeBackgroundStopIo = {
    // `lateReads`: a key's repaint shows only after that many more reads (a relay's
    // round trip, a busy lead painting late).
    readScreen: async () => {
      if (pending && readsLeft-- <= 0) {
        screen = pending
        pending = null
      }
      return screen
    },
    sendKey: async (key) => {
      keys.push(key)
      if (steps[next]?.key === key) {
        if (options.lateReads) {
          if (pending) {
            screen = pending
          }
          pending = steps[next]!.screen
          readsLeft = options.lateReads
        } else {
          screen = steps[next]!.screen
        }
        next += 1
      }
      return true
    },
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock
  }
  return { io, keys }
}

const before = busyScreen('screen-before-stop-two-shells.txt')
const pillFocused = busyScreen('screen-shells-pill-focused.txt')
const dialog = busyScreen('screen-dialog-two-shells-one-agent.txt')
const afterStop = busyScreen('screen-dialog-after-stop.txt')
const closed = busyScreen('screen-after-dialog-closed.txt')

describe("reading Claude Code's Background dialog", () => {
  it('reads its rows: shells by command, agents by description, the selected one', () => {
    const read = parseClaudeBackgroundDialog(dialog)!
    expect(read.canStop).toBe(true)
    expect(read.rows).toEqual([
      { label: 'sleep 240', cut: false, kind: 'shell', status: 'running', selected: true },
      { label: 'sleep 300', cut: false, kind: 'shell', status: 'running', selected: false },
      { label: 'Long probe agent', cut: false, kind: 'agent', status: 'running', selected: false }
    ])
    // Orca's screen read drops blank rows; the same dialog.
    expect(parseClaudeBackgroundDialog(busyScreen('screen-dialog-two-shells-one-agent.txt', { dropBlank: true }))).toEqual(read)
  })

  it('reads a one-kind list, an empty list, the cut labels and wrapped hint at 48 columns', () => {
    expect(parseClaudeBackgroundDialog(busyScreen('screen-dialog-only-agent.txt'))!.rows).toEqual([
      { label: 'Long probe agent', cut: false, kind: 'agent', status: 'running', selected: true }
    ])
    expect(parseClaudeBackgroundDialog(busyScreen('screen-dialog-empty.txt'))).toEqual({ rows: [], canStop: false })
    const narrow = parseClaudeBackgroundDialog(busyScreen('screen-dialog-duplicate-commands-48.txt'))!
    expect(narrow.canStop).toBe(true)
    expect(narrow.rows.map((row) => [row.label, row.cut, row.kind])).toEqual([
      ['cd /tmp && for i i', true, 'shell'],
      ['cd /tmp && for i i', true, 'shell'],
      ['sleep 200', false, 'shell'],
      ['A rather long agen', true, 'agent']
    ])
  })

  it('is not read off a screen without it', () => {
    expect(parseClaudeBackgroundDialog(before)).toBeNull()
    expect(parseClaudeBackgroundDialog(closed)).toBeNull()
    expect(parseClaudeBackgroundDialog(busyScreen('screen-agent-panel-selected.txt'))).toBeNull()
  })

  it('matches one row, and refuses two that could be it', () => {
    const wide = parseClaudeBackgroundDialog(busyScreen('screen-dialog-duplicate-commands-110.txt'))!
    const loop = 'cd /tmp && for i in $(seq 1 400); do sleep 1; done'
    expect(matchClaudeBackgroundRow(wide, { kind: 'shell', label: loop })).toEqual({ found: false, reason: 'ambiguous' })
    expect(matchClaudeBackgroundRow(wide, { kind: 'shell', label: 'sleep 200' })).toEqual({ found: true, index: 2 })
    expect(matchClaudeBackgroundRow(wide, { kind: 'shell', label: 'sleep 20' })).toEqual({ found: false, reason: 'not-listed' })
    const description = 'A rather long agent description that will surely be truncated somewhere'
    expect(matchClaudeBackgroundRow(wide, { kind: 'agent', label: description })).toEqual({ found: true, index: 3 })
    // An agent is never matched to a shell row of the same words.
    expect(matchClaudeBackgroundRow(wide, { kind: 'agent', label: 'sleep 200' })).toEqual({ found: false, reason: 'not-listed' })
    const narrow = parseClaudeBackgroundDialog(busyScreen('screen-dialog-duplicate-commands-48.txt'))!
    expect(matchClaudeBackgroundRow(narrow, { kind: 'agent', label: description })).toEqual({ found: true, index: 3 })
    expect(matchClaudeBackgroundRow(narrow, { kind: 'shell', label: loop })).toEqual({ found: false, reason: 'ambiguous' })
  })

  it("reads the footer's focus: the hint goes when the pill takes the focus", () => {
    expect(readClaudeFooterFocus(before)).toEqual({ pill: true, inputFocused: true })
    expect(readClaudeFooterFocus(pillFocused)).toEqual({ pill: true, inputFocused: false })
    expect(readClaudeFooterFocus(busyScreen('screen-footer-no-count.txt'))).toEqual({ pill: false, inputFocused: true })
    expect(readClaudeFooterFocus(busyScreen('screen-footer-48.txt'))).toEqual({ pill: true, inputFocused: true })
    // At 40 columns the hint is cut off: the focus cannot be told, and nothing is driven.
    expect(readClaudeFooterFocus(busyScreen('screen-footer-40.txt'))).toEqual({ pill: true, inputFocused: false })
  })
})

describe('stopping one background task through that dialog', () => {
  it("stops the subagent's `sleep 240` with ↓, Enter, x, Esc, as it went live", async () => {
    const { io, keys } = desktop(before, [
      { key: DOWN, screen: pillFocused },
      { key: ENTER, screen: dialog },
      { key: 'x', screen: afterStop },
      { key: ESC, screen: closed }
    ])
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toEqual({ ok: true })
    expect(keys).toEqual([DOWN, ENTER, 'x', ESC])
  })

  it('moves the selection to the target before x, and checks it landed', async () => {
    // The live list after the first stop, `sleep 300` selected; the agent row below it
    // selected is the same screen with the marker moved down one row.
    const agentSelected = afterStop.map((line) =>
      line.startsWith('  ❯ ⏺ sleep 300') ? line.replace('  ❯ ⏺', '    ⏺') : line.startsWith('    ⏺ Long probe agent') ? line.replace('    ⏺', '  ❯ ⏺') : line
    )
    const { io, keys } = desktop(before, [
      { key: DOWN, screen: pillFocused },
      { key: ENTER, screen: afterStop },
      { key: DOWN, screen: agentSelected },
      { key: 'x', screen: busyScreen('screen-dialog-empty.txt') },
      { key: ESC, screen: closed }
    ])
    expect(await stopClaudeBackgroundTask(io, { kind: 'agent', label: 'Long probe agent' })).toEqual({ ok: true })
    expect(keys).toEqual([DOWN, ENTER, DOWN, 'x', ESC])
  })

  it('sends no Enter when ↓ did not move the focus off the input box', async () => {
    // Enter on the input box would submit what is in it.
    const { io, keys } = desktop(before, [])
    const result = await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })
    expect(result).toMatchObject({ ok: false, reason: 'not-focused' })
    // No Esc either: on the input box it would interrupt a working lead.
    expect(keys).toEqual([DOWN])
  })

  it('sends nothing while no shells pill is up, under a dialog, or with the focus unknowable', async () => {
    for (const [screen, reason] of [
      [busyScreen('screen-footer-no-count.txt'), 'no-task-list'],
      [busyScreen('screen-footer-40.txt'), 'no-task-list'],
      [dialog, 'dialog-up'],
      [busyScreen('screen-agent-panel-selected.txt'), 'no-task-list']
    ] as const) {
      const { io, keys } = desktop(screen, [])
      expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toMatchObject({ ok: false, reason })
      expect(keys).toEqual([])
    }
  })

  it('closes the dialog without stopping anything when the task is not listed or not unique', async () => {
    const duplicates = busyScreen('screen-dialog-duplicate-commands-110.txt')
    for (const [screen, label, reason] of [
      [dialog, 'sleep 999', 'not-listed'],
      [duplicates, 'cd /tmp && for i in $(seq 1 400); do sleep 1; done', 'ambiguous']
    ] as const) {
      const { io, keys } = desktop(before, [
        { key: DOWN, screen: pillFocused },
        { key: ENTER, screen },
        { key: ESC, screen: closed }
      ])
      expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label })).toMatchObject({ ok: false, reason })
      expect(keys).toEqual([DOWN, ENTER, ESC])
    }
  })

  it('says so when the stop was sent but the row did not leave', async () => {
    const { io, keys } = desktop(before, [
      { key: DOWN, screen: pillFocused },
      { key: ENTER, screen: dialog },
      { key: ESC, screen: closed }
    ])
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toMatchObject({ ok: false, reason: 'unconfirmed' })
    expect(keys).toEqual([DOWN, ENTER, 'x', ESC])
  })

  it('backs out with Esc when Enter did not open the dialog, while the pill still has the focus', async () => {
    const { io, keys } = desktop(before, [
      { key: DOWN, screen: pillFocused },
      { key: ESC, screen: before }
    ])
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toMatchObject({ ok: false, reason: 'no-dialog' })
    expect(keys).toEqual([DOWN, ENTER, ESC])
  })

  it('reports a key the host refused', async () => {
    const { io } = desktop(before, [])
    io.sendKey = async () => false
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toMatchObject({ ok: false, reason: 'send-failed' })
  })

  it('says it could not read the screen when the read fails', async () => {
    const { io, keys } = desktop(before, [])
    io.readScreen = async () => null
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(keys).toEqual([])
  })
})

describe('a desktop that repaints late', () => {
  it('sends one Esc to close the dialog, never a second onto the input box', async () => {
    // Review, 2026-10-11: the close re-read the screen 120 ms after its Esc, still saw the
    // dialog over a slow link, and sent another Esc, which lands on the input box once the
    // dialog has closed and interrupts a working lead.
    const { io, keys } = desktop(
      before,
      [
        { key: DOWN, screen: pillFocused },
        { key: ENTER, screen: dialog },
        { key: 'x', screen: afterStop },
        { key: ESC, screen: closed }
      ],
      { lateReads: 3 }
    )
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toEqual({ ok: true })
    expect(keys).toEqual([DOWN, ENTER, 'x', ESC])
  })

  it('sends no Enter on one read that lacks the hint: the focus must hold on two reads in a row', async () => {
    // A frame torn mid-repaint can show the pill without its hint; Enter on the input box
    // would submit what is in it.
    const torn = before.map((line) => line.replace(' · ← for agents', ''))
    let reads = 0
    const { io, keys } = desktop(before, [])
    io.readScreen = async () => (++reads === 2 ? torn : before)
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 240' })).toMatchObject({ ok: false, reason: 'not-focused' })
    expect(keys).toEqual([DOWN])
  })
})

describe('the one-task case: Enter opens that shell\'s details, not the list', () => {
  // Live, 2026-10-11, the lead working in a foreground ping the whole time: one shell
  // (`sleep 300`) running, ↓ and Enter opened "Shell details"; for `sleep 999` the drive
  // closed it with Esc; for `sleep 300` it pressed x, and Claude closed the view itself
  // and kept working.
  const oneShell = busyScreen('screen-before-stop-one-shell-working.txt')
  const details = busyScreen('screen-shell-details.txt')
  const afterDetailsStop = busyScreen('screen-shell-details-after-stop.txt')

  it('reads the details view', () => {
    expect(parseClaudeShellDetails(details)).toEqual({ status: 'running', command: 'sleep 400', canStop: true })
    expect(parseClaudeShellDetails(details)).toEqual(parseClaudeShellDetails(busyScreen('screen-shell-details.txt', { dropBlank: true })))
    expect(parseClaudeShellDetails(dialog)).toBeNull()
    expect(parseClaudeShellDetails(afterDetailsStop)).toBeNull()
    expect(parseClaudeBackgroundDialog(details)).toBeNull()
  })

  it('stops the shell with x and sends no Esc after it, since the view closes itself onto the input box', async () => {
    const { io, keys } = desktop(oneShell, [
      { key: DOWN, screen: pillFocused },
      { key: ENTER, screen: details },
      { key: 'x', screen: afterDetailsStop }
    ])
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 400' })).toEqual({ ok: true })
    expect(keys).toEqual([DOWN, ENTER, 'x'])
  })

  it('closes the details of another shell with Esc and stops nothing', async () => {
    const { io, keys } = desktop(oneShell, [
      { key: DOWN, screen: pillFocused },
      { key: ENTER, screen: details },
      { key: ESC, screen: oneShell }
    ])
    expect(await stopClaudeBackgroundTask(io, { kind: 'shell', label: 'sleep 999' })).toMatchObject({ ok: false, reason: 'not-listed' })
    expect(keys).toEqual([DOWN, ENTER, ESC])
  })
})

void UP
