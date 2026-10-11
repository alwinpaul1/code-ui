import { describe, expect, it } from 'vitest'
import type { BackgroundTask } from './mobile-background-tasks'
import { terminalStopTargets } from './terminal-background-task-stops'

// Which rows of a terminal Claude tab draw Claude's own Stop. Claude's Background dialog
// tells tasks apart only by what it draws (a shell's command, an agent's description), so a
// row whose label another of the phone's rows shares, while either could still be running,
// gets no Stop: the phone keeps rows "running" that ended unseen, and the footer fit retires
// the OLDEST of them, not necessarily the one that ended (review, 2026-10-11).

const shell = (id: string, status: BackgroundTask['status'], label = 'pnpm test'): BackgroundTask => ({
  id,
  kind: 'shell',
  title: 'Run the tests',
  status,
  startedAt: 1,
  elapsedMs: status === 'running' ? 5 : null,
  stopLabel: label
})

describe('a Stop on a terminal tab selects by label, so a shared label takes none', () => {
  it('gives each running shell with its own command a Stop', () => {
    const { tasks, targets } = terminalStopTargets({ running: [shell('a', 'running', 'sleep 20'), shell('b', 'running', 'sleep 45')], finished: [] }, 2)
    expect(tasks.running.map((task) => task.stoppable)).toEqual([true, true])
    expect([...targets.values()]).toEqual([
      { kind: 'shell', label: 'sleep 20' },
      { kind: 'shell', label: 'sleep 45' }
    ])
  })

  it('refuses two running shells with one command', () => {
    const { tasks, targets } = terminalStopTargets({ running: [shell('a', 'running'), shell('b', 'running')], finished: [] }, 2)
    expect(tasks.running.map((task) => task.stoppable)).toEqual([false, false])
    expect(targets.size).toBe(0)
  })

  it('allows one whose command a footer-retired row shares: only one of them runs, and that is the one the dialog lists', () => {
    // Re-review, 2026-10-11: counting footer-retired rows took the Stop away from every
    // later run of a command for the rest of a beacon-less session, and bought nothing:
    // the footer says one runs, and Claude's list shows that one whichever row was pressed.
    const { tasks } = terminalStopTargets({ running: [shell('new', 'running')], finished: [shell('old', 'finished')] }, 1)
    expect(tasks.running[0]!.stoppable).toBe(true)
  })

  it('allows one whose command only a row with a seen ending shares', () => {
    const { tasks } = terminalStopTargets({ running: [shell('new', 'running')], finished: [shell('old', 'completed')] }, 1)
    expect(tasks.running[0]!.stoppable).toBe(true)
  })
})
