import { describe, expect, it } from 'vitest'
import { styleText } from '../notifications/notification-plain-text'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  agentDisplayLabel,
  agentDotState,
  agentIdentityLabel,
  agentRowVerdict,
  agentRowVerdictMark,
  formatTimeAgo,
  previewLine
} from './agent-row-display'

function row(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'p',
    parentPaneKey: null,
    state: 'working',
    agentType: 'claude',
    prompt: '',
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('agentDotState', () => {
  it('maps known states through and unknown to idle', () => {
    expect(agentDotState(row({ state: 'working', updatedAt: 0 }), 0)).toBe('working')
    expect(
      agentDotState(row({ state: 'working', workingMode: 'monitoring', updatedAt: 0 }), 0)
    ).toBe('monitoring')
    expect(agentDotState(row({ state: 'blocked', updatedAt: 0 }), 0)).toBe('blocked')
    expect(agentDotState(row({ state: 'waiting', updatedAt: 0 }), 0)).toBe('waiting')
    expect(agentDotState(row({ state: 'done', updatedAt: 0 }), 0)).toBe('done')
    expect(agentDotState(row({ state: 'unknown-state' as never }), 0)).toBe('idle')
  })

  it("reads an old host's legacy interrupted flag as a user's Stop, on a done row", () => {
    expect(agentDotState(row({ state: 'done', interrupted: true }), 0)).toBe('interrupted')
  })

  // Orca #23467. `mainAgent.outcome` is the host's verdict on the main agent's last turn.
  const mainAgentDone = (outcome: string) => ({
    mainAgent: { state: 'done' as const, outcome: outcome as never, stateStartedAt: 0 }
  })

  it('reads a turn a crash cut off as failed, and a user stop or a replaced turn as interrupted', () => {
    expect(agentDotState(row({ state: 'done', ...mainAgentDone('interruption') }), 0)).toBe(
      'failed'
    )
    expect(agentDotState(row({ state: 'done', ...mainAgentDone('failure') }), 0)).toBe('failed')
    expect(agentDotState(row({ state: 'done', ...mainAgentDone('cancellation') }), 0)).toBe(
      'interrupted'
    )
    expect(agentDotState(row({ state: 'done', ...mainAgentDone('superseded') }), 0)).toBe(
      'interrupted'
    )
    expect(agentDotState(row({ state: 'done', ...mainAgentDone('success') }), 0)).toBe('done')
  })

  it("reads an end the host could not prove as unconfirmed, worded 'Couldn’t confirm'", () => {
    const unproven = row({ state: 'done', ...mainAgentDone('unconfirmed') })
    expect(agentDotState(unproven, 0)).toBe('unconfirmed')
    expect(agentDisplayLabel(unproven, 0)).toBe('Couldn’t confirm')
    expect(agentDisplayLabel(row({ state: 'done', ...mainAgentDone('interruption') }), 0)).toBe(
      'Failed'
    )
  })

  it('lets a fault outrank live subagent work, but a stop or an unproven end only marks a done row', () => {
    expect(agentDotState(row({ state: 'working', ...mainAgentDone('interruption') }), 0)).toBe(
      'failed'
    )
    expect(agentDotState(row({ state: 'working', ...mainAgentDone('cancellation') }), 0)).toBe(
      'working'
    )
    expect(agentDotState(row({ state: 'working', ...mainAgentDone('unconfirmed') }), 0)).toBe(
      'working'
    )
  })

  // Rows arrive unparsed, so an arm a newer host adds must read as the done it always did.
  it('reads a done row carrying a verdict it cannot name as done', () => {
    expect(agentDotState(row({ state: 'done', ...mainAgentDone('from-a-newer-host') }), 0)).toBe(
      'done'
    )
    expect(agentRowVerdict(row({ state: 'done', ...mainAgentDone('from-a-newer-host') }))).toBeNull()
    expect(agentRowVerdictMark(row({ state: 'done' }))).toBeNull()
  })

  it('ignores a verdict that rides on a main agent that is not itself done', () => {
    const live = row({
      state: 'done',
      mainAgent: { state: 'working', outcome: 'failure', stateStartedAt: 0 }
    })
    expect(agentRowVerdict(live)).toBeNull()
  })

  it('decays a stale active state to idle, matching desktop', () => {
    const stale = AGENT_STATUS_STALE_AFTER_MS + 1
    // Active states past the staleness window read as idle…
    expect(agentDotState(row({ state: 'working', updatedAt: 0 }), stale)).toBe('idle')
    expect(agentDotState(row({ state: 'blocked', updatedAt: 0 }), stale)).toBe('idle')
    expect(agentDotState(row({ state: 'waiting', updatedAt: 0 }), stale)).toBe('idle')
    // …exactly at the threshold it is still fresh (decay is strictly past it).
    expect(
      agentDotState(row({ state: 'working', updatedAt: 0 }), AGENT_STATUS_STALE_AFTER_MS)
    ).toBe('working')
    // 'done' never decays, and neither does its verdict.
    expect(agentDotState(row({ state: 'done', updatedAt: 0 }), stale)).toBe('done')
    expect(agentDotState(row({ state: 'done', updatedAt: 0, interrupted: true }), stale)).toBe(
      'interrupted'
    )
  })
})

describe('agentDisplayLabel', () => {
  it('prefers last message, then prompt, then state label', () => {
    expect(agentDisplayLabel(row({ lastAssistantMessage: 'hello there' }), 0)).toBe('hello there')
    expect(agentDisplayLabel(row({ lastAssistantMessage: '   ', prompt: 'do the thing' }), 0)).toBe(
      'do the thing'
    )
    expect(agentDisplayLabel(row({ state: 'working', prompt: '', updatedAt: 0 }), 0)).toBe(
      'Working'
    )
    expect(
      agentDisplayLabel(
        row({ state: 'working', workingMode: 'monitoring', prompt: '', updatedAt: 0 }),
        0
      )
    ).toBe('Monitoring background tasks')
  })

  it('falls back to the decayed state label when stale', () => {
    expect(
      agentDisplayLabel(
        row({ state: 'working', prompt: '', updatedAt: 0 }),
        AGENT_STATUS_STALE_AFTER_MS + 1
      )
    ).toBe('Idle')
  })
})

describe('agentIdentityLabel', () => {
  it('maps known agent types and falls back to initials', () => {
    expect(agentIdentityLabel('claude')).toBe('CL')
    expect(agentIdentityLabel('codex')).toBe('CX')
    expect(agentIdentityLabel('mystery')).toBe('MY')
    expect(agentIdentityLabel(null)).toBe('')
  })
})

describe('formatTimeAgo', () => {
  const now = 10_000_000
  it('formats across thresholds', () => {
    expect(formatTimeAgo(now - 30_000, now)).toBe('just now')
    expect(formatTimeAgo(now - 5 * 60_000, now)).toBe('5m')
    expect(formatTimeAgo(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatTimeAgo(now - 2 * 86_400_000, now)).toBe('2d')
  })

  it('shows the agent\'s last message without Markdown markers, as one line', () => {
    // Galaxy S23, 2026-09-09: the row painted "**Nothing is touched on the host** on a…".
    expect(previewLine('**Nothing is touched on the host** on any platform.\n\n- one\n- two')).toBe(
      `${styleText('Nothing is touched on the host', 'bold')} on any platform. · • one · • two`
    )
    expect(previewLine('  ')).toBe('')
  })
})
