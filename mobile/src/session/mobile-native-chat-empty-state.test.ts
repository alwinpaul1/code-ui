import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { mobileNativeChatEmptyState } from './mobile-native-chat-empty-state'

/** The 1037 pane's status as Orca saved it on 2026-09-25: Claude's Stop hook,
 *  with the session and the transcript it reported. */
const PANE_1037_STATUS: AgentStatusEntry = {
  state: 'done',
  prompt: 'rate the charging stations',
  lastAssistantMessage: 'Done.',
  updatedAt: 1_790_343_051_462,
  stateStartedAt: 1_790_343_051_462,
  paneKey: '12eaca17-5ae4-4948-a085-d33f13a25f41:052ceda2-70ad-4c78-ba88-fc99dc338911',
  stateHistory: [],
  agentType: 'claude',
  providerSession: {
    key: 'session_id',
    id: 'ad1e3053-f9ac-40be-80be-8f33a800e9b1',
    transcriptPath:
      '/Users/me/.claude-work/projects/-Users-me-Desktop-NexDash-NexOS/ad1e3053-f9ac-40be-80be-8f33a800e9b1.jsonl'
  }
}

describe('mobileNativeChatEmptyState', () => {
  it('invites a first message naming the agent, matching desktop copy', () => {
    // waiting-session (live agent, no transcript) and ready (loaded, empty) both
    // resolve to the shared "empty" copy with the agent label substituted.
    const waiting = mobileNativeChatEmptyState('waiting-session', 'claude')
    expect(waiting).toMatchObject({
      title: 'Start a chat with Claude',
      subtitle: 'Ask Claude to inspect code, explain output, or make a change.'
    })
    expect(mobileNativeChatEmptyState('ready', 'codex')?.title).toBe('Start a chat with Codex')
  })

  // 2026-09-25, phone 0.9.54: one pane of a four-pane split tab showed "Start a
  // chat with Claude" over a 13,000-line conversation, and the screen gave no
  // way to tell "this pane named no session" from "the desktop found no file"
  // from "the file was read and came back empty". None of those is an empty
  // conversation once the pane's own status says the agent has taken turns,
  // so each says which one it is. A session that has only just started says
  // nothing extra: an empty chat is exactly what it is.
  it('says the pane reported no session instead of passing for an empty conversation', () => {
    const { providerSession: _none, ...noSession } = PANE_1037_STATUS
    expect(
      mobileNativeChatEmptyState('waiting-session', 'claude', undefined, { agentStatus: noSession })
        ?.detail
    ).toBe(
      'The desktop reports this pane but not which session runs in it, so there is no transcript to read.'
    )
  })

  it('names the session the desktop has no transcript for', () => {
    expect(
      mobileNativeChatEmptyState('awaiting-transcript', 'claude', undefined, {
        agentStatus: PANE_1037_STATUS
      })?.detail
    ).toBe('The desktop has no transcript for session ad1e3053.')
  })

  it('says when the desktop was given no transcript file to read', () => {
    // Without a path the host searches by id under its own Claude home, which
    // on this machine is not where Claude writes (CLAUDE_CONFIG_DIR is set per
    // launch, not for Orca). The line has to tell that apart from a missing file.
    const idOnly = {
      ...PANE_1037_STATUS,
      providerSession: { key: 'session_id' as const, id: 'ad1e3053-f9ac-40be-80be-8f33a800e9b1' }
    }
    expect(
      mobileNativeChatEmptyState('awaiting-transcript', 'claude', undefined, { agentStatus: idOnly })
        ?.detail
    ).toBe('The desktop has no transcript for session ad1e3053, and no transcript file was named for it.')
  })

  it('says the desktop sent nothing when a session that has taken turns reads empty', () => {
    expect(
      mobileNativeChatEmptyState('ready', 'claude', undefined, {
        agentStatus: PANE_1037_STATUS,
        transcriptMessageCount: 0
      })?.detail
    ).toBe('The desktop read session ad1e3053 and sent no messages.')
  })

  it('adds no line to a session that has only just started', () => {
    // Claude's SessionStart reports the session before its file exists, and a
    // phone-launched tab has no status at all for its first second. Both are
    // an empty conversation, and a line under them would cry wolf.
    const started: AgentStatusEntry = {
      ...PANE_1037_STATUS,
      state: 'done',
      sessionBoundary: true,
      prompt: '',
      lastAssistantMessage: undefined
    }
    for (const status of ['awaiting-transcript', 'ready'] as const) {
      expect(
        mobileNativeChatEmptyState(status, 'claude', undefined, {
          agentStatus: started,
          transcriptMessageCount: 0
        })?.detail
      ).toBeUndefined()
    }
    expect(
      mobileNativeChatEmptyState('waiting-session', 'claude', undefined, { agentStatus: null })?.detail
    ).toBeUndefined()
  })

  it('adds no line when the read held rows that were all folded away', () => {
    // Not "sent no messages": it sent some, and none of them draw.
    expect(
      mobileNativeChatEmptyState('ready', 'claude', undefined, {
        agentStatus: PANE_1037_STATUS,
        transcriptMessageCount: 3
      })?.detail
    ).toBeUndefined()
  })

  it('invites a first message while the transcript file is still unwritten', () => {
    // The spinner is already gone by then, so a bare list would read as broken.
    expect(mobileNativeChatEmptyState('awaiting-transcript', 'claude')?.title).toBe(
      'Start a chat with Claude'
    )
  })

  it('falls back to "the agent" when the agent is unknown', () => {
    expect(mobileNativeChatEmptyState('waiting-session', null)?.title).toBe(
      'Start a chat with the agent'
    )
  })

  it('prefers the provided error message over the default subtitle', () => {
    expect(mobileNativeChatEmptyState('error', 'claude', 'boom')?.subtitle).toBe('boom')
    expect(mobileNativeChatEmptyState('error', 'claude')?.subtitle).toBe(
      'The transcript could not be read. Toggle back to the terminal to keep working.'
    )
  })

  it('returns null for states that show no empty copy', () => {
    expect(mobileNativeChatEmptyState('loading', 'claude')).toBeNull()
    expect(mobileNativeChatEmptyState('idle', 'claude')).toBeNull()
  })
})
