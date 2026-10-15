/**
 * "It must work for that claude session and that profile of that session exactly" (user,
 * 2026-10-15). A session copied between profiles exists on Anthropic twice: the pr-12 session has
 * a personal Remote Control session cse_01NmzBrN6cdXv6SaRde5pR7H (`~/.claude`, the live one) and
 * a work copy cse_019B3GJ144LCrvsuFFkN8U6U (`~/.claude-work`). A phone send must go to the copy
 * of the profile the tab runs under, with that account's sign-in, and to nothing else.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindCcrConfigDir, ccrSendTargetForTab, resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import { CCR_SEND_REFUSALS, useCcrComposerSend, type CcrComposerSendDeps } from './use-ccr-composer-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

const TAB = 'pane-90bb5855'
const CLAUDE_SESSION = 'e50745d9-0000-4000-8000-000000000001'
const PERSONAL_DIR = '/Users/alwinpaul/.claude'
const WORK_DIR = '/Users/alwinpaul/.claude-work'
const PERSONAL = 'acct-personal'
const WORK = 'acct-work-nexdash'
const PERSONAL_CSE = 'cse_01NmzBrN6cdXv6SaRde5pR7H'
const WORK_CSE = 'cse_019B3GJ144LCrvsuFFkN8U6U'

beforeEach(() => {
  resetCcrCacheForTests()
  bindCcrConfigDir(PERSONAL_DIR, PERSONAL)
  bindCcrConfigDir(WORK_DIR, WORK)
})

describe('the send target of a Claude tab', () => {
  it('is the copy of the profile the tab runs under, with that account', () => {
    setCcrMapping(TAB, PERSONAL_CSE, 1, PERSONAL, CLAUDE_SESSION, PERSONAL_DIR)
    expect(ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, PERSONAL_DIR)).toEqual({ kind: 'target', sessionId: PERSONAL_CSE, accountId: PERSONAL })
  })

  it('is refused while the tab has no match yet', () => {
    expect(ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, PERSONAL_DIR)).toEqual({ kind: 'refused', reason: 'unmatched' })
  })

  it('is refused while the tab profile is not known', () => {
    setCcrMapping(TAB, PERSONAL_CSE, 1, PERSONAL, CLAUDE_SESSION, PERSONAL_DIR)
    expect(ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, null)).toEqual({ kind: 'refused', reason: 'profile-unknown' })
  })

  it('is refused while a match kept with no profile is not confirmed for this one', () => {
    resetCcrCacheForTests()
    setCcrMapping(TAB, PERSONAL_CSE, 1, PERSONAL, CLAUDE_SESSION, null)
    expect(ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, PERSONAL_DIR)).toEqual({ kind: 'refused', reason: 'unsettled' })
  })

  it('is refused when the match account is not the one the profile belongs to', () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, PERSONAL_DIR)
    expect(ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, PERSONAL_DIR)).toEqual({ kind: 'refused', reason: 'other-account' })
  })

  it('drops the old target when the tab config dir switches, before the next send', () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    expect(ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, PERSONAL_DIR)).toEqual({ kind: 'refused', reason: 'unmatched' })
    // Gone for good, not just hidden for the other dir: switching back does not revive it.
    expect(ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, WORK_DIR)).toEqual({ kind: 'refused', reason: 'unmatched' })
  })
})

describe('a phone send on a tab whose session was copied between profiles', () => {
  let renderer: ReactTestRenderer | null = null
  let api!: ReturnType<typeof useCcrComposerSend>
  const posts: { accountId: string; sessionId: string; body: unknown }[] = []
  const onSendError = vi.fn()
  const configDir = { current: PERSONAL_DIR as string | null }
  const deps: CcrComposerSendDeps = {
    post: async (accountId, sessionId, body) => {
      posts.push({ accountId, sessionId, body })
    },
    readStatus: async () => 'connected',
    log: () => undefined,
    newUuid: () => 'uuid-1'
  }
  const origin = (text: string): MobileNativeChatSendOrigin => ({ draftKey: 'k', draftEditGeneration: 0, pendingKey: 'p', normalizedText: text, baselineOccurrences: 0, baselineTailMessageId: null, baselineResolved: true })

  function Harness(): null {
    api = useCcrComposerSend({
      active: true,
      resolveTarget: () => ccrSendTargetForTab(TAB, 1, CLAUDE_SESSION, configDir.current),
      events: [],
      connectionStatus: 'connected',
      working: false,
      promptUp: false,
      attachments: 0,
      composerText: '',
      setComposerText: vi.fn(),
      captureSendOrigin: origin,
      clearDraftForSend: vi.fn(),
      acceptSend: () => 'row-1',
      restoreRejectedDraft: vi.fn(),
      removePending: vi.fn(),
      onSendError,
      deps
    })
    return null
  }

  beforeEach(() => {
    posts.length = 0
    onSendError.mockReset()
    configDir.current = PERSONAL_DIR
    act(() => {
      renderer = create(createElement(Harness))
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('sends to the live profile cse with that account and never to the other copy', async () => {
    setCcrMapping(TAB, PERSONAL_CSE, 1, PERSONAL, CLAUDE_SESSION, PERSONAL_DIR)
    await act(async () => {
      expect(await api.sendWithOutcome('ship it')).toBe('accepted')
    })
    expect(posts.map(({ accountId, sessionId }) => ({ accountId, sessionId }))).toEqual([{ accountId: PERSONAL, sessionId: PERSONAL_CSE }])
    expect(JSON.stringify(posts)).not.toContain(WORK_CSE)
  })

  it('refuses and posts nothing while the match is unsettled', async () => {
    await act(async () => {
      expect(await api.sendWithOutcome('ship it')).toBe('rejected')
    })
    expect(posts).toEqual([])
    expect(onSendError).toHaveBeenCalledWith(CCR_SEND_REFUSALS.unmatched)
  })

  it('drops the old target when the tab config dir switches, and posts nothing to it', async () => {
    setCcrMapping(TAB, WORK_CSE, 1, WORK, CLAUDE_SESSION, WORK_DIR)
    configDir.current = WORK_DIR
    await act(async () => {
      await api.sendWithOutcome('first')
    })
    expect(posts.map((post) => post.sessionId)).toEqual([WORK_CSE])
    configDir.current = PERSONAL_DIR
    await act(async () => {
      expect(await api.sendWithOutcome('second')).toBe('rejected')
    })
    expect(posts.map((post) => post.sessionId)).toEqual([WORK_CSE])
    expect(onSendError).toHaveBeenLastCalledWith(CCR_SEND_REFUSALS.unmatched)
  })
})
