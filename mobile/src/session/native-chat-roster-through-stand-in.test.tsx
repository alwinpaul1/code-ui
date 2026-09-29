// Orca's stand-in status and the roster every task reader in the chat takes
// from the tab's status (use-mobile-native-chat-active-resolution.ts). The run
// clock's own case is in use-subagent-run-clock.test.ts.
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { resetAgentHudBeacons } from './agent-hud-beacon'
import { resetHeldRostersForTest } from './agent-status-stand-in'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { useMobileNativeChatActiveResolution } from './use-mobile-native-chat-active-resolution'

vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    void effect
  }
}))

const NOW = Date.parse('2026-09-29T15:00:00Z')
const agent = { id: 'a1', description: 'Sweep', agentType: 'general-purpose', state: 'working' as const, startedAt: NOW - 75 * 60_000 }
const real: AgentStatusEntry = {
  state: 'working',
  prompt: 'go',
  updatedAt: NOW - 60_000,
  stateStartedAt: NOW - 80 * 60_000,
  paneKey: 'tab-1:leaf-1',
  agentType: 'claude',
  stateHistory: [{ state: 'done', prompt: 'before', startedAt: NOW - 90 * 60_000 }],
  subagents: [agent]
} as AgentStatusEntry
/** Orca's stand-in (the title-only branch of Orca 1.4.216's status
 *  projection): the pane's key and a state from the terminal title, no
 *  prompt, no history, no roster. */
const standIn = (state: 'working' | 'done'): AgentStatusEntry =>
  ({ state, prompt: '', updatedAt: NOW, stateStartedAt: NOW - 1_000, paneKey: 'tab-1:leaf-1', agentType: 'claude', stateHistory: [] }) as AgentStatusEntry

function mountWithStatus(first: AgentStatusEntry) {
  let latest: AgentStatusEntry | null = null
  function Probe({ status }: { status: AgentStatusEntry }) {
    const tab: MobileNativeChatTab & { id: string } = { type: 'terminal', id: 'tab-1::leaf-1', agentStatus: status }
    latest = useMobileNativeChatActiveResolution({
      hostId: 'host-1',
      worktreeId: 'repo-1::/w',
      activeSessionTab: tab,
      activeSessionTabId: tab.id,
      activeHandle: 'pty-1',
      activeHandleRef: { current: 'pty-1' },
      nativeChatTranscriptIsLocalReadable: true
    }).activeChatAgentStatus
    return null
  }
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(Probe, { status: first }))
  })
  return {
    show(status: AgentStatusEntry): AgentStatusEntry | null {
      act(() => renderer.update(createElement(Probe, { status })))
      return latest
    }
  }
}

describe('the roster the chat reads while Orca stands in its status', () => {
  beforeEach(() => {
    resetAgentHudBeacons()
    resetHeldRostersForTest()
  })

  // The same stand-in that reset the run clock (the user, 2026-09-29: "1h
  // 15m" on the desk, seconds on the phone) also took every roster subagent
  // off the running count and the sheet for as long as it stood, and the
  // task memory lost which of them the lead had not started.
  it('keeps the last roster through a working stand-in, which carries none', () => {
    const chat = mountWithStatus(real)
    const during = chat.show(standIn('working'))
    expect(during?.subagents).toEqual([agent])
    expect(during?.state).toBe('working')
  })

  // A done stand-in may be an agent that exited: the roster is not carried
  // into it. A real status with no roster is the host saying none is
  // tracked.
  it('carries no roster into a done stand-in, and drops it on a real status with none', () => {
    const chat = mountWithStatus(real)
    expect(chat.show(standIn('done'))?.subagents).toBeUndefined()
    chat.show(real)
    const { subagents: _gone, ...none } = real
    void _gone
    expect(chat.show(none)?.subagents).toBeUndefined()
    expect(chat.show(standIn('working'))?.subagents).toBeUndefined()
  })
})
