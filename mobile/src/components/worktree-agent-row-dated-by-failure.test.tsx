// A row whose main agent FAILED while its subagents keep it working shows the red dot (a fault
// outranks live work), so its time has to say when that failure happened, not how long the
// subagents have run. Orca #22944 (85067494a1) dates it by the main agent's own clock
// (`agentRowTimeAt`, mirroring desktop lastEnteredDoneAt).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { WorktreeAgentRow } from './WorktreeAgentRow'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default }
}))
vi.mock('./AgentStateDot', () => ({ AgentStateDot: 'AgentStateDot' }))
vi.mock('./MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))

const HOUR = 3_600_000

describe('an agent row whose main agent failed while its subagents run', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('is dated by the failure, not by when its subagents started', async () => {
    const now = 5 * HOUR
    const row: RuntimeWorktreeAgentRow = {
      paneKey: 'tab-1:pane-1',
      parentPaneKey: null,
      state: 'working',
      agentType: 'claude',
      prompt: 'fix the tests',
      taskTitle: null,
      displayName: null,
      lastAssistantMessage: null,
      toolName: null,
      toolInput: null,
      interrupted: false,
      // The combined row has been working (its subagents) for three hours...
      stateStartedAt: now - 3 * HOUR,
      updatedAt: now - 60_000,
      // ...and the main agent failed ten minutes ago.
      mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: now - 10 * 60_000 }
    }
    await act(async () => {
      renderer = create(createElement(WorktreeAgentRow, { agent: row, depth: 0, now, unvisited: false }))
    })
    expect(renderer!.root.findByType('AgentStateDot' as never).props.state).toBe('failed')
    const texts = renderer!.root
      .findAllByType('Text' as never)
      .flatMap((node) => node.props.children)
      .filter((child: unknown) => typeof child === 'string')
    expect(texts).toContain('10m')
  })
})
