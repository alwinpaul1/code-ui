import { describe, expect, it, vi } from 'vitest'
import { stepTerminalMode } from './terminal-mode-stepper'

type Mode = 'manual' | 'acceptEdits' | 'plan' | 'bypass'
const CYCLE: Mode[] = ['manual', 'acceptEdits', 'plan', 'bypass']

/** A TUI whose footer repaints `lagPolls` reads after each press. */
function slowTui(start: Mode, lagPolls: number) {
  let index = CYCLE.indexOf(start)
  let pendingPolls = 0
  let pendingIndex = index
  const presses: number[] = []
  return {
    presses,
    read: vi.fn(async () => {
      if (pendingPolls > 0) {
        pendingPolls -= 1
        if (pendingPolls === 0) {
          index = pendingIndex
        }
      }
      return CYCLE[index]!
    }),
    press: vi.fn(async () => {
      presses.push(1)
      pendingIndex = (pendingIndex + 1) % CYCLE.length
      pendingPolls = lagPolls
    }),
    wait: vi.fn(async () => undefined)
  }
}

describe('stepping the agent to a mode', () => {
  it('does not overshoot when the footer repaints late', async () => {
    // 2026-09-14, "mode switching glitches sometimes": with a fixed sleep the
    // re-read after a press still showed the old mode, so it pressed again and
    // sailed past the pick. Here the screen lags three polls behind each press.
    const tui = slowTui('manual', 3)
    const reached = await stepTerminalMode({
      ...tui,
      wanted: 'acceptEdits',
      maxPresses: 4,
      settleMs: 2000,
      pollMs: 100
    })
    expect(reached).toBe(true)
    expect(tui.presses).toHaveLength(1)
  })

  it('presses once per step and stops on the wanted mode', async () => {
    const tui = slowTui('manual', 1)
    expect(
      await stepTerminalMode({ ...tui, wanted: 'bypass', maxPresses: 4, settleMs: 500, pollMs: 50 })
    ).toBe(true)
    expect(tui.presses).toHaveLength(3)
  })

  it('returns at once when the footer already shows the pick', async () => {
    const tui = slowTui('plan', 0)
    expect(await stepTerminalMode({ ...tui, wanted: 'plan', maxPresses: 4 })).toBe(true)
    expect(tui.presses).toHaveLength(0)
  })

  it('gives up after a full lap when the mode is not in this session', async () => {
    const tui = slowTui('manual', 1)
    expect(
      await stepTerminalMode({
        ...tui,
        wanted: 'nowhere' as Mode,
        maxPresses: 4,
        settleMs: 300,
        pollMs: 50
      })
    ).toBe(false)
    expect(tui.presses).toHaveLength(4)
  })

  it('treats an unreadable screen as "look again", not as a change', async () => {
    let reads = 0
    const read = vi.fn(async (): Promise<Mode | null> => {
      reads += 1
      // First three reads after the press fail entirely, then the new mode shows.
      return reads <= 4 ? (reads === 1 ? 'manual' : null) : 'acceptEdits'
    })
    const press = vi.fn(async () => undefined)
    expect(
      await stepTerminalMode({
        read,
        press,
        wait: async () => undefined,
        wanted: 'acceptEdits',
        maxPresses: 4,
        settleMs: 1000,
        pollMs: 100
      })
    ).toBe(true)
    expect(press).toHaveBeenCalledTimes(1)
  })

  it('never reports success from a frame where the footer was not visible', () => {
    // 2026-09-14: the permission read collapsed "no footer on screen" to
    // 'default', which the caller mapped to 'manual'. Asked for Manual while
    // the agent was on Accept edits, one blank frame made this return true with
    // zero presses, and the pill then claimed a mode the agent was not in.
    return (async () => {
      const press = vi.fn(async () => undefined)
      let call = 0
      const reached = await stepTerminalMode<'manual' | 'acceptEdits'>({
        // Every read is blank: the footer never states a mode.
        read: async () => {
          call += 1
          return null
        },
        press,
        wait: async () => undefined,
        wanted: 'manual',
        maxPresses: 2,
        settleMs: 300,
        pollMs: 100,
        budgetMs: 100000,
        now: () => call * 10
      })
      expect(reached).toBe(false)
      expect(press).toHaveBeenCalled()
    })()
  })

  it('stops at its wall-clock budget instead of pressing for minutes', async () => {
    // Each read is a relay round trip; counting polls bounded nothing, so a
    // slow link turned six presses into 85 reads (2026-09-14).
    let clock = 0
    const press = vi.fn(async () => undefined)
    const reached = await stepTerminalMode<'a' | 'b'>({
      read: async () => {
        clock += 2500
        return 'a'
      },
      press,
      wait: async () => {
        clock += 120
      },
      wanted: 'b',
      maxPresses: 6,
      settleMs: 1500,
      pollMs: 120,
      budgetMs: 8000,
      now: () => clock
    })
    expect(reached).toBe(false)
    expect(press.mock.calls.length).toBeLessThan(6)
    expect(clock).toBeLessThan(20000)
  })
})
