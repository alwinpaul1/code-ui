import { mergeNativeChatMessages, type createNativeChatMerger } from '../../../src/shared/native-chat-merge'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { nativeChatSessionPageRead } from './mobile-session-read-operations'
import type { createWholeSessionTracker } from './mobile-native-chat-whole-session'

type Ref<T> = { current: T }

type ReadSessionResult =
  | { messages: NativeChatMessage[]; hasMore?: boolean; beforeOffset?: number }
  | { error: string }

/** What one page-back needs from the chat hook: its props, its refs, its setters. */
export type LoadEarlierContext = {
  client: RpcClient | null
  agent: string | null
  sessionId: string | null
  readPath: string | null
  hasMore: boolean
  page: number
  maxMessages: number
  setList: (next: readonly NativeChatMessage[]) => void
  setHasMore: (value: boolean) => void
  setLoadingEarlier: (value: boolean) => void
  loadingEarlierRef: Ref<boolean>
  streamGenerationRef: Ref<number>
  sessionIdRef: Ref<string | null>
  mergerRef: Ref<ReturnType<typeof createNativeChatMerger>>
  limitRef: Ref<number>
  beforeOffsetRef: Ref<number | null>
  whole: ReturnType<typeof createWholeSessionTracker>
}

/** Grow the window to page in older history (the body of the hook's `loadEarlier`). */
export function startLoadEarlier(ctx: LoadEarlierContext): void {
  const {
    client, agent, sessionId, readPath, hasMore, setList, setHasMore, setLoadingEarlier,
    loadingEarlierRef, streamGenerationRef, sessionIdRef, mergerRef, limitRef, beforeOffsetRef, whole
  } = ctx
  const PAGE = ctx.page
  const MAX_MESSAGES = ctx.maxMessages
  if (!client || !agent || !sessionId || loadingEarlierRef.current || !hasMore) {
    return
  }
  // Capture the session this page belongs to; a swap underneath us must not
  // apply this read's result onto the new session (mirrors desktop's guard).
  const requestSessionId = sessionId
  const requestGeneration = streamGenerationRef.current
  const requestMessages = new Map(mergerRef.current.list.map((message) => [message.id, message]))
  const nextLimit = Math.min(limitRef.current + PAGE, MAX_MESSAGES)
  const pageLimit = nextLimit - limitRef.current
  if (pageLimit <= 0) {
    setHasMore(false)
    return
  }
  const beforeOffset = beforeOffsetRef.current
  loadingEarlierRef.current = true
  setLoadingEarlier(true)
  void (async () => {
    try {
      const response = await nativeChatSessionPageRead.request(client, {
        agent,
        sessionId,
        limit: beforeOffset === null ? nextLimit : pageLimit,
        ...(beforeOffset === null ? {} : { beforeOffset }),
        ...(readPath ? { transcriptPath: readPath } : {})
      })
      const accepted = nativeChatSessionPageRead.interpret(response)
      if (!accepted.accepted) {
        return
      }
      // The read is `z.unknown()` because the reply is a union, so an accepted success can still
      // carry no result at all, or null; `'error' in` throws on either.
      const payload = accepted.value
      if (payload === null || typeof payload !== 'object') {
        return
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: main cast this payload unread; the reader hands back the same result.
      const result = payload as ReadSessionResult
      if ('error' in result) {
        return
      }
      // Drop a stale resolve from a session that swapped underneath us.
      if (
        sessionIdRef.current !== requestSessionId ||
        streamGenerationRef.current !== requestGeneration
      ) {
        return
      }
      limitRef.current = nextLimit
      whole.page(result.hasMore, client?.getLastConnectedAt?.())
      if (beforeOffset !== null && result.beforeOffset != null) {
        beforeOffsetRef.current = result.beforeOffset
        setList(mergeNativeChatMessages(result.messages, mergerRef.current.list))
        setHasMore(
          nextLimit < MAX_MESSAGES && (result.hasMore ?? result.messages.length >= pageLimit)
        )
      } else {
        // Older runtimes ignore the cursor and return the growing tail.
        // The read may predate live frames received while it was in flight.
        // Preserve those updates without resurrecting the request's old base.
        const liveUpdates = mergerRef.current.list.filter(
          (message) => requestMessages.get(message.id) !== message
        )
        setList(mergeNativeChatMessages(result.messages, liveUpdates))
        setHasMore(result.messages.length >= nextLimit)
      }
    } catch {
      // Nothing awaits this page, so a rejected request — a transport drop, or the client
      // abandoning it at teardown — would otherwise reach the document as an unhandled
      // rejection. Swallowed to match the operation's own skip policy: a page that never
      // arrives leaves the window the subscription already delivered.
    } finally {
      // A late page from a prior tab must not unlock the current tab's request.
      if (
        sessionIdRef.current === requestSessionId &&
        streamGenerationRef.current === requestGeneration
      ) {
        loadingEarlierRef.current = false
        setLoadingEarlier(false)
      }
    }
  })()
}
