import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { vi } from 'vitest'
import { returnCcrQueueToComposer } from './ccr-local-queue'
import type { buildCcrUserEventBody } from './ccr-send'
import type { CcrEvent } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { useCcrComposerSend, type CcrComposerSendDeps } from './use-ccr-composer-send'

/**
 * A harness for useCcrComposerSend as the chat controller mounts it: one hook for the whole
 * worktree route, with the tab on screen, its working state and its send target changing under
 * it as the user switches tabs. Every POST is recorded; nothing reaches Anthropic.
 */

export const CSE_A = 'cse_01FaTuRHkvnrgXpjd3nuGiQF'
export const CSE_B = 'cse_01OtherTabSessionZZZZZZ'
export type Body = ReturnType<typeof buildCcrUserEventBody>
export type Post = { accountId: string; sessionId: string; body: Body }

export const targetOf = (sessionId: string): CcrSendTarget => ({ kind: 'target', sessionId, accountId: 'acct-personal' })

export const state = {
  tabId: 'tab-a' as string | null,
  events: [] as CcrEvent[],
  connectionStatus: 'connected' as string | null,
  working: false,
  promptUp: false,
  attachments: 0,
  composerText: '',
  active: true,
  /** The target each tab resolves to now (ccrSendTargetForTab). */
  targets: { 'tab-a': targetOf(CSE_A), 'tab-b': targetOf(CSE_B) } as Record<string, CcrSendTarget>
}
export const posts: Post[] = []
export const logs: string[] = []
export const restored: { draftKey: string; text: string }[] = []
export const io = {
  post: (async () => undefined) as (body: Body) => Promise<void>,
  readStatus: (async () => 'connected') as () => Promise<string | null>
}
let uuids = 0
export const deps: CcrComposerSendDeps = {
  post: async (accountId, sessionId, body) => {
    posts.push({ accountId, sessionId, body })
    await io.post(body)
  },
  readStatus: async () => io.readStatus(),
  log: (line) => logs.push(line),
  newUuid: () => `uuid-${(uuids += 1)}`,
  restoreDraft: async (draftKey, text) => {
    restored.push({ draftKey, text })
  }
}
export const calls = {
  clear: vi.fn(),
  accept: vi.fn((_origin: MobileNativeChatSendOrigin, _text: string) => 'row-1' as string | null),
  restore: vi.fn(),
  remove: vi.fn(),
  error: vi.fn()
}
export const composer = { text: '' }
/** Stored composer drafts by key, for tabs not on screen: what `returnQueueToDraft` writes. */
export const drafts: Record<string, string> = {}
const setComposerText = (next: string | ((previous: string) => string)): void => {
  composer.text = typeof next === 'function' ? next(composer.text) : next
}
/** The draft key is the tab's, as captureSendOrigin's is (host, worktree, tab). */
const origin = (text: string): MobileNativeChatSendOrigin => ({
  draftKey: `draft:${state.tabId}`,
  draftEditGeneration: 0,
  pendingKey: 'p',
  normalizedText: text,
  baselineOccurrences: 0,
  baselineTailMessageId: null,
  baselineResolved: true
})

let renderer: ReactTestRenderer | null = null
/** The hook's return at the last render. */
export const hook = {} as { api: ReturnType<typeof useCcrComposerSend> }
function Harness(): null {
  // The controller's closure: the tab on screen at this render, resolved when called.
  const tabId = state.tabId
  hook.api = useCcrComposerSend({
    active: state.active,
    tabId,
    resolveTarget: () => state.targets[tabId ?? ''] ?? { kind: 'refused', reason: 'unmatched' },
    events: state.events,
    connectionStatus: state.connectionStatus,
    working: state.working,
    promptUp: state.promptUp,
    attachments: () => state.attachments,
    composerText: state.composerText,
    setComposerText,
    captureSendOrigin: origin,
    clearDraftForSend: calls.clear,
    acceptSend: calls.accept,
    restoreRejectedDraft: calls.restore,
    returnQueueToDraft: (draftKey, text) => {
      drafts[draftKey] = returnCcrQueueToComposer(text, drafts[draftKey] ?? '')
    },
    removePending: calls.remove,
    onSendError: calls.error,
    deps
  })
  return null
}
export function render(): void {
  act(() => {
    if (renderer) {
      renderer.update(createElement(Harness))
    } else {
      renderer = create(createElement(Harness))
    }
  })
}
export function unmount(): void {
  act(() => renderer?.unmount())
  renderer = null
}
export async function send(text: string): Promise<string> {
  let outcome = ''
  await act(async () => {
    outcome = await hook.api.sendWithOutcome(text)
  })
  return outcome
}
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
export const postedTexts = (): { sessionId: string; text: unknown; priority: unknown }[] =>
  posts.map((post) => ({ sessionId: post.sessionId, text: (post.body.events[0]?.payload.message as { content?: unknown } | undefined)?.content, priority: post.body.events[0]?.payload.priority }))

export function resetCcrComposerHarness(): void {
  Object.assign(state, {
    tabId: 'tab-a',
    events: [],
    connectionStatus: 'connected',
    working: false,
    promptUp: false,
    attachments: 0,
    composerText: '',
    active: true,
    targets: { 'tab-a': targetOf(CSE_A), 'tab-b': targetOf(CSE_B) }
  })
  posts.length = 0
  logs.length = 0
  restored.length = 0
  uuids = 0
  composer.text = ''
  for (const key of Object.keys(drafts)) {
    delete drafts[key]
  }
  io.post = async () => undefined
  io.readStatus = async () => 'connected'
  for (const fn of Object.values(calls)) {
    fn.mockClear()
  }
  calls.accept.mockImplementation(() => 'row-1')
  render()
}
