import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { selectStructuredAgentTurnActivity } from './mobile-native-chat-turn-activity'

function status(
  sequence: number,
  text: string,
  turn?: { turnId: string; state: 'running' | 'completed' }
): AgentJournalRenderItem {
  return {
    itemId: `status-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: {
      kind: 'status',
      text,
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
})
