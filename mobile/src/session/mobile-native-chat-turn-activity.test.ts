import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { selectStructuredAgentTurnActivity } from './mobile-native-chat-turn-activity'

function status(
  sequence: number,
  text: string,
  turn?: { turnId: string; state: 'running' | 'completed' },
  tone?: string
): AgentJournalRenderItem {
  return {
    itemId: `status-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: {
      kind: 'status',
      text,
      ...(tone ? { tone } : {}),
      ...(turn ? { turnLifecycle: { turnId: turn.turnId, state: turn.state } } : {})
    }
  }
}

describe('provider activity in a structured turn tail', () => {
  it('shows the host activity copy instead of repeating the tool row', () => {
    const items: AgentJournalRenderItem[] = [
      status(1, 'turn started', { turnId: 'turn-1', state: 'running' })
    ]
    expect(
      selectStructuredAgentTurnActivity(items, 'turn-1', {
        turnId: 'turn-1',
        text: 'Checking the renderer'
      })
    ).toEqual({ kind: 'description', text: 'Checking the renderer' })
  })

  it('shows nothing when there is no live turn', () => {
    expect(
      selectStructuredAgentTurnActivity([], null, { turnId: 'turn-1', text: 'Checking' })
    ).toBeNull()
  })

  // Orca #24218: the line fell back to the newest status row of the turn, so a retry warning
  // from minutes ago kept reading as what the agent was doing.
  it.each([
    ['a retry warning', 'Claude hit a temporary problem and is retrying.', 'warning'],
    ['a compaction notice', 'Context compacted', undefined],
    ['a cancellation notice', 'Cancellation requested.', undefined]
  ])('never reads %s in the journal as the live activity', (_name, text, tone) => {
    const items: AgentJournalRenderItem[] = [
      status(1, 'turn started', { turnId: 'turn-1', state: 'running' }),
      status(2, text, undefined, tone)
    ]
    expect(selectStructuredAgentTurnActivity(items, 'turn-1')).toBeNull()
    expect(selectStructuredAgentTurnActivity(items, 'turn-1', null)).toBeNull()
    // Activity the host reported for an earlier turn is not this turn's either.
    expect(
      selectStructuredAgentTurnActivity(items, 'turn-1', { turnId: 'turn-0', text: 'Old work' })
    ).toBeNull()
  })

  it("keeps the host's live activity ahead of a status row, and reads a blank one as none", () => {
    const items: AgentJournalRenderItem[] = [
      status(1, 'turn started', { turnId: 'turn-1', state: 'running' }),
      status(2, 'Context compacted')
    ]
    expect(
      selectStructuredAgentTurnActivity(items, 'turn-1', {
        turnId: 'turn-1',
        text: 'Updating the plan'
      })
    ).toEqual({ kind: 'description', text: 'Updating the plan' })
    expect(
      selectStructuredAgentTurnActivity(items, 'turn-1', { turnId: 'turn-1', text: '  \n ' })
    ).toBeNull()
  })

  it('reads the live activity of a turn whose record is not in the loaded page', () => {
    expect(
      selectStructuredAgentTurnActivity([], 'turn-1', { turnId: 'turn-1', text: 'Reading files' })
    ).toEqual({ kind: 'description', text: 'Reading files' })
  })
})
