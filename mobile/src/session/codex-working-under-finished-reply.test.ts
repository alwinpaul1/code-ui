// Symptom 1 of 2026-09-29, reading 1, Codex only: Working and Stop drawn
// under a reply the lead already finished, while a sub-agent it spawned runs.
// Pinned as a limit, not fixed. Why:
//
// - The phone's rule for "the lead's own turn is over" reads Claude's shapes
//   only (claude-lead-turn-ended.ts); Orca holds a Codex pane `working` after
//   the lead's Stop while a sub-agent it tracks runs (vendored
//   codex-subagent-roster.ts), so such a status draws Working and Stop.
// - Whether Orca ever sends that status for Codex 0.153.4 is unproven. The
//   one real run captured here (fixtures/codex-subagent-exec-0.153.4.ts) was
//   `codex exec`, which aborts the sub-agent when the lead's turn ends, and
//   its rollout names the sub-agent in a shape Orca's reader does not read,
//   so Orca's transcript roster is empty and the lead's Stop reads `done`.
// - A capture where the sub-agent outlives its lead needs the interactive TUI
//   with Orca's Codex hooks feeding a listener. From this Mac's shell those
//   hooks post to the user's live Orca pane (they did, once, for the exec run
//   above, 2026-09-29 18:05 UTC), and pointing them elsewhere means editing
//   the user's ~/.codex/hooks.json or copying their auth into a scratch home.
//   Neither was done. A fix built on an invented status sequence would guess.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import { normalizeHookPayload } from '../../../src/shared/agent-hook-listener'
import { PANE_KEY } from '../../../src/shared/agent-hook-listener-test-harness'
import type { RpcClient } from '../transport/rpc-client'
import {
  CODEX_LEAD_RECORDS,
  CODEX_LEAD_ROLLOUT_NAME,
  CODEX_LEAD_THREAD,
  CODEX_SUBAGENT_RECORDS,
  CODEX_SUBAGENT_ROLLOUT_NAME,
  CODEX_SUBAGENT_THREAD
} from './fixtures/codex-subagent-exec-0.153.4'

vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({
    messages: [
      { id: 'reply', role: 'assistant', timestamp: 1790705142708, source: 'transcript', blocks: [{ type: 'text', text: 'lead done' }] }
    ],
    status: 'ready',
    transcriptLoading: false
  })
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: () => ({
    composerText: '',
    setComposerText: vi.fn(),
    pending: [],
    imagePreviewsByMessageId: {},
    captureSendOrigin: vi.fn(),
    getComposerEditGeneration: () => 0,
    readSeededLaunchDraft: () => null,
    readSeededLaunchDraftSeed: () => null,
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: vi.fn(),
    holdUnconfirmedSend: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-prompts', () => ({
  useMobileNativeChatPrompts: () => ({ permission: null, question: null, detectedAsk: null, ask: null })
}))
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))

import { useMobileNativeChatController, type MobileNativeChatController } from './use-mobile-native-chat-controller'

const jsonl = (records: readonly object[]) => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`

describe('Working under a finished Codex reply while a sub-agent runs (a limit)', () => {
  const dirs: string[] = []
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /** The two rollouts as codex-cli 0.153.4 wrote them, in one directory. */
  function rollouts(lead: readonly object[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'codex-0.153.4-'))
    dirs.push(dir)
    writeFileSync(join(dir, CODEX_LEAD_ROLLOUT_NAME), jsonl(lead))
    writeFileSync(join(dir, CODEX_SUBAGENT_ROLLOUT_NAME), jsonl(CODEX_SUBAGENT_RECORDS))
    return join(dir, CODEX_LEAD_ROLLOUT_NAME)
  }
  /** What Orca's hook listener publishes for the lead's spawn and its Stop. */
  function hookStatuses(transcriptPath: string) {
    const state = createHookListenerState()
    const event = (hookEventName: string, extra: Record<string, unknown> = {}) =>
      normalizeHookPayload(
        state,
        'codex',
        { paneKey: PANE_KEY, payload: { hook_event_name: hookEventName, session_id: CODEX_LEAD_THREAD, transcript_path: transcriptPath, ...extra } },
        'production'
      )?.payload
    return {
      spawned: event('PostToolUse', { tool_name: 'collaborationspawn_agent' }),
      stopped: event('Stop', { last_assistant_message: 'lead done' })
    }
  }

  it('reads a Codex 0.153.4 lead’s Stop as done: Orca’s reader finds no sub-agent in the rollout it writes', () => {
    const { spawned, stopped } = hookStatuses(rollouts(CODEX_LEAD_RECORDS))
    expect(spawned?.subagents).toBeUndefined()
    expect(stopped?.state).toBe('done')
    expect(stopped?.subagents).toBeUndefined()
  })

  it('draws Working and Stop under the finished reply when Orca holds a Codex pane working for a sub-agent', () => {
    // The shape Orca's reader does read (`sub_agent_activity`, as its own
    // tests write it), with the rest of the real run's records, so the
    // listener holds the pane `working` at the lead's Stop.
    const legacyActivity = { type: 'event_msg', payload: { type: 'sub_agent_activity', occurred_at_ms: 1790705139415, agent_thread_id: CODEX_SUBAGENT_THREAD, agent_path: '/root/sleep_task', kind: 'started' } }
    const transcriptPath = rollouts([...CODEX_LEAD_RECORDS, legacyActivity])
    const { stopped } = hookStatuses(transcriptPath)
    expect(stopped?.state).toBe('working')
    expect(stopped?.subagents?.map((row) => row.id)).toEqual([CODEX_SUBAGENT_THREAD])

    let controller: MobileNativeChatController | null = null
    const client = { sendRequest: vi.fn(), getState: () => 'connected' as const, notifyForeground: vi.fn() }
    const tab = {
      type: 'terminal',
      id: 'tab-cx',
      terminal: 'term-cx',
      launchAgent: 'codex',
      isActive: true,
      agentStatus: {
        ...stopped,
        paneKey: PANE_KEY,
        updatedAt: 1790705142771,
        stateStartedAt: 1790705133000,
        stateHistory: [],
        providerSession: { key: 'session_id', id: CODEX_LEAD_THREAD, transcriptPath }
      }
    }
    function Chat(): null {
      controller = useMobileNativeChatController({
        client: client as unknown as RpcClient,
        connState: 'connected',
        tabsLive: true,
        hostId: 'host-mac',
        worktreeId: 'scratch::main',
        activeSessionTab: tab as never,
        activeSessionTabId: 'tab-cx',
        activeHandle: 'term-cx',
        activeHandleRef: { current: 'term-cx' },
        deviceTokenRef: { current: null },
        nativeChatTranscriptIsLocalReadable: true,
        nativeChatInputLeaseReady: true,
        onSendError: vi.fn(),
        onSendResolved: vi.fn()
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Chat))
    })
    // The limit: the lead said "lead done", and the chat still draws the
    // turn as running.
    expect(controller!.nativeChatLeadTurnEnded).toBe(false)
    expect(controller!.nativeChatAgentWorking).toBe(true)
    expect(controller!.nativeChatCanStop).toBe(true)
  })
})
