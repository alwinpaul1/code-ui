// Orca's stand-in status and the roster the chat's task readers take from the
// tab (use-mobile-native-chat-active-resolution.ts). The running count, the
// tasks sheet, the task memory and the run clock read `activeChatTaskStatus`:
// the pane's last hook row through a stand-in while the phone watched the
// pane since that row (agent-status-stand-in.ts). The chat's other readers
// (the Working row, Stop, the prompt reader) read `activeChatAgentStatus`, the
// stand-in as it comes. Holding each pane's last roster through ANY stand-in
// (b860f0d1, reverted on fix/midturn-residuals) brought back the cases below;
// each guard here fails on that hold. The whole chat, mounted through the
// real controller, is in running-tasks-through-orca-stand-in.test.ts.
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
/** The pane's hook row, with the identity Orca's stand-in copies from it. */
const real = (tab: string, subagents: (typeof A)[] | undefined, extra: Partial<AgentStatusEntry> = {}): AgentStatusEntry =>
  ({
    state: 'working',
    prompt: 'go',
    updatedAt: NOW - 60_000,
    stateStartedAt: NOW - 80 * 60_000,
    paneKey: `${tab}:leaf-1`,
    agentType: 'claude',
    tabId: tab,
    terminalTitle: '✳ Sweep',
    stateHistory: [{ state: 'done', prompt: 'before', startedAt: NOW - 90 * 60_000 }],
    ...(subagents ? { subagents } : {}),
    ...extra
  }) as AgentStatusEntry
/** Orca's stand-in (the title-only branch of Orca 1.4.216's status
 *  projection): a state from the terminal title, the row's identity copied,
 *  no prompt, no history, no roster. */
const standIn = (tab: string): AgentStatusEntry =>
  ({
    state: 'working',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW - 1_000,
    paneKey: `${tab}:leaf-1`,
    agentType: 'claude',
    tabId: tab,
    terminalTitle: '✳ Sweep',
    stateHistory: []
  }) as AgentStatusEntry

type Read = { task: string[]; chat: string[] }

function mount(watching = true) {
  let latest: Read = { task: [], chat: [] }
  const ids = (status: AgentStatusEntry | null) => (status?.subagents ?? []).map((row) => row.id)
  function Probe({ tab, status }: { tab: string; status: AgentStatusEntry }) {
    const t: MobileNativeChatTab & { id: string } = { type: 'terminal', id: `${tab}::leaf-1`, agentStatus: status }
    const resolution = useMobileNativeChatActiveResolution({
      hostId: 'host-1',
      worktreeId: 'repo-1::/w',
      activeSessionTab: t,
      activeSessionTabId: t.id,
      activeHandle: `pty-${tab}`,
      activeHandleRef: { current: `pty-${tab}` },
      nativeChatTranscriptIsLocalReadable: true,
      watching
    })
    latest = { task: ids(resolution.activeChatTaskStatus), chat: ids(resolution.activeChatAgentStatus) }
    return null
  }
  let renderer: ReturnType<typeof create> | null = null
  return {
    show(tab: string, status: AgentStatusEntry): Read {
      act(() => {
        const element = createElement(Probe, { tab, status })
        if (renderer) {
          renderer.update(element)
        } else {
          renderer = create(element)
        }
      })
      return latest
    }
  }
}

describe('the roster the chat’s task readers read while Orca stands in its status', () => {
  beforeEach(() => resetAgentHudBeacons())

  // A stand-in says what the title says, nothing of the roster: while the
  // phone watched the pane, the task readers read its last hook row through
  // it, and the chat's other readers the stand-in.
  it('keeps the roster for the task readers through a stand-in on a pane the phone watched', () => {
    const chat = mount()
    expect(chat.show('tab-1', real('tab-1', [A])).task).toEqual(['a1'])
    expect(chat.show('tab-1', standIn('tab-1'))).toEqual({ task: ['a1'], chat: [] })
    expect(chat.show('tab-1', real('tab-1', [A])).task).toEqual(['a1'])
  })

  // The review of b860f0d1: a subagent that finished while the chat showed
  // another tab came back, running for good, when the first status back was
  // a stand-in: the hold never saw the status that dropped it.
  it('does not bring back a subagent that finished while the chat showed another tab', () => {
    const chat = mount()
    chat.show('tab-1', real('tab-1', [A, B]))
    chat.show('tab-2', real('tab-2', undefined))
    expect(chat.show('tab-1', standIn('tab-1')).task).toEqual([])
  })

  // Nor one that finished while the link was down or the tab list was the one
  // the last visit cached: the phone did not watch.
  it('reads the stand-in as it comes when the phone was not watching', () => {
    const chat = mount(false)
    chat.show('tab-1', real('tab-1', [A]))
    expect(chat.show('tab-1', standIn('tab-1')).task).toEqual([])
  })

  // And on a host whose real hook rows carry no history (Orca's headless
  // builder, or its PTY builder when the renderer published none), a real
  // status that says none is tracked has the stand-in's shape.
  it('drops a finished subagent when a real status with no prompt and no history says none is tracked', () => {
    const chat = mount()
    chat.show('tab-1', real('tab-1', [A], { prompt: '', stateHistory: [] }))
    expect(chat.show('tab-1', real('tab-1', undefined, { prompt: '', stateHistory: [], updatedAt: NOW - 10_000 })).task).toEqual([])
  })
})
