// Orca's stand-in status and the roster every task reader in the chat takes
// from the tab's status (use-mobile-native-chat-active-resolution.ts). The run
// clock keeps its runs through a stand-in (use-subagent-run-clock.test.ts);
// the roster itself is read as it comes, and these pin why.
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { resetAgentHudBeacons } from './agent-hud-beacon'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { useMobileNativeChatActiveResolution } from './use-mobile-native-chat-active-resolution'

vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    void effect
  }
}))

const NOW = Date.parse('2026-09-29T15:00:00Z')
const A = { id: 'a1', description: 'Sweep', agentType: 'general-purpose', state: 'working' as const, startedAt: NOW - 75 * 60_000 }
const B = { id: 'b2', description: 'Review', agentType: 'general-purpose', state: 'working' as const, startedAt: NOW - 30 * 60_000 }
const real = (tab: string, subagents: (typeof A)[] | undefined, extra: Partial<AgentStatusEntry> = {}): AgentStatusEntry =>
  ({
    state: 'working',
    prompt: 'go',
    updatedAt: NOW - 60_000,
    stateStartedAt: NOW - 80 * 60_000,
    paneKey: `${tab}:leaf-1`,
    agentType: 'claude',
    stateHistory: [{ state: 'done', prompt: 'before', startedAt: NOW - 90 * 60_000 }],
    ...(subagents ? { subagents } : {}),
    ...extra
  }) as AgentStatusEntry
/** Orca's stand-in (the title-only branch of Orca 1.4.216's status
 *  projection): the pane's key and a state from the terminal title, no
 *  prompt, no history, no roster. */
const standIn = (tab: string): AgentStatusEntry =>
  ({ state: 'working', prompt: '', updatedAt: NOW, stateStartedAt: NOW - 1_000, paneKey: `${tab}:leaf-1`, agentType: 'claude', stateHistory: [] }) as AgentStatusEntry

function mount() {
  let latest: AgentStatusEntry | null = null
  function Probe({ tab, status }: { tab: string; status: AgentStatusEntry }) {
    const t: MobileNativeChatTab & { id: string } = { type: 'terminal', id: `${tab}::leaf-1`, agentStatus: status }
    latest = useMobileNativeChatActiveResolution({
      hostId: 'host-1',
      worktreeId: 'repo-1::/w',
      activeSessionTab: t,
      activeSessionTabId: t.id,
      activeHandle: `pty-${tab}`,
      activeHandleRef: { current: `pty-${tab}` },
      nativeChatTranscriptIsLocalReadable: true
    }).activeChatAgentStatus
    return null
  }
  let renderer: ReturnType<typeof create> | null = null
  return {
    show(tab: string, status: AgentStatusEntry): string[] {
      act(() => {
        const element = createElement(Probe, { tab, status })
        if (renderer) {
          renderer.update(element)
        } else {
          renderer = create(element)
        }
      })
      return ((latest as AgentStatusEntry | null)?.subagents ?? []).map((row) => row.id)
    }
  }
}

describe('the roster the chat reads while Orca stands in its status', () => {
  beforeEach(() => resetAgentHudBeacons())

  // The limit, pinned. A stand-in carries no roster, so the roster
  // subagents leave the running count and the sheet for as long as it
  // stands, and come back, their clock kept, with the next real status.
  // Holding the last roster through it (b860f0d1, reverted) is right only for
  // a pane the phone watched all along, and brought back the two cases below.
  it('reads no roster from a working stand-in (a limit)', () => {
    const chat = mount()
    expect(chat.show('tab-1', real('tab-1', [A]))).toEqual(['a1'])
    expect(chat.show('tab-1', standIn('tab-1'))).toEqual([])
    expect(chat.show('tab-1', real('tab-1', [A]))).toEqual(['a1'])
  })

  // The review of b860f0d1: a subagent that finished while the chat showed
  // another tab came back, running for good, when the first status back was
  // a stand-in: the hold never saw the status that dropped it.
  it('does not bring back a subagent that finished while the chat showed another tab', () => {
    const chat = mount()
    chat.show('tab-1', real('tab-1', [A, B]))
    chat.show('tab-2', real('tab-2', undefined))
    expect(chat.show('tab-1', standIn('tab-1'))).not.toContain('a1')
  })

  // And on a host whose real hook rows carry no history (Orca's headless
  // builder, or its PTY builder when the renderer published none), a real
  // status that says none is tracked has the stand-in's shape.
  it('drops a finished subagent when a real status with no prompt and no history says none is tracked', () => {
    const chat = mount()
    chat.show('tab-1', real('tab-1', [A], { prompt: '', stateHistory: [] }))
    expect(chat.show('tab-1', real('tab-1', undefined, { prompt: '', stateHistory: [], updatedAt: NOW - 10_000 }))).toEqual([])
  })
})
