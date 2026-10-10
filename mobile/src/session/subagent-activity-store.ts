// The open Background tasks sheet asks for its running subagents' transcripts
// here; the session content mounts one <MobileSubagentActivityFeeds/> that
// reads the request, holds one host subscription per target, and puts what
// each read back here for the sheet. Kept out of props for the same reason as
// the subagent viewer (`subagent-transcript-store.ts`): the sheet lives three
// components below the screen that knows the host.
//
// One request at a time, tagged with its owner, so a sheet that closes late
// never clears the request a newer sheet made. A feed leaves the moment its
// target does, so a finished agent's rows never outlive its read.
import { useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { SubagentTranscriptTarget } from './mobile-subagent-transcript'

export type SubagentActivityRequest = { owner: object; targets: readonly SubagentTranscriptTarget[] }

type Feeds = ReadonlyMap<string, readonly NativeChatMessage[]>

const NO_FEEDS: Feeds = new Map()

let request: SubagentActivityRequest | null = null
let feeds: Feeds = NO_FEEDS
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Ask for these targets' transcripts (an empty list asks for none). The same
 *  owner and the same targets change nothing, so a render that recomputes the
 *  list does not tear the subscriptions down. */
export function watchSubagentActivity(owner: object, targets: readonly SubagentTranscriptTarget[]): void {
  if (request?.owner === owner && sameTargets(request.targets, targets)) {
    return
  }
  // Asking for nothing withdraws only this owner's own request.
  if (targets.length === 0 && (request === null || request.owner !== owner)) {
    return
  }
  request = targets.length === 0 ? null : { owner, targets }
  dropFeedsOutside(request?.targets ?? [])
  emit()
}

/** The owner's sheet closed or unmounted: stop every read it asked for. */
export function stopWatchingSubagentActivity(owner: object): void {
  if (request === null || request.owner !== owner) {
    return
  }
  request = null
  dropFeedsOutside([])
  emit()
}

/** One feed's latest transcript window, or null when it has none to offer
 *  (not read yet, refused, failed, or gone): the agent's row then stays as it
 *  was. Ignored for an agent no longer asked for. */
export function publishSubagentFeed(agentId: string, messages: readonly NativeChatMessage[] | null): void {
  if (messages === null) {
    if (!feeds.has(agentId)) {
      return
    }
    const next = new Map(feeds)
    next.delete(agentId)
    feeds = next.size === 0 ? NO_FEEDS : next
    emit()
    return
  }
  if (!request?.targets.some((target) => target.agentId === agentId) || feeds.get(agentId) === messages) {
    return
  }
  feeds = new Map(feeds).set(agentId, messages)
  emit()
}

function dropFeedsOutside(targets: readonly SubagentTranscriptTarget[]): void {
  const wanted = new Set(targets.map((target) => target.agentId))
  if ([...feeds.keys()].every((id) => wanted.has(id))) {
    return
  }
  const next = new Map([...feeds].filter(([id]) => wanted.has(id)))
  feeds = next.size === 0 ? NO_FEEDS : next
}

function sameTargets(left: readonly SubagentTranscriptTarget[], right: readonly SubagentTranscriptTarget[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (target, index) =>
        target.agentId === right[index]!.agentId &&
        target.sessionId === right[index]!.sessionId &&
        target.transcriptPath === right[index]!.transcriptPath
    )
  )
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSubagentActivityRequest(): SubagentActivityRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => request
  )
}

export function useSubagentActivityFeeds(): Feeds {
  return useSyncExternalStore(
    subscribe,
    () => feeds,
    () => feeds
  )
}

export function peekSubagentActivityRequest(): SubagentActivityRequest | null {
  return request
}

export function resetSubagentActivityForTests(): void {
  request = null
  feeds = NO_FEEDS
  listeners.clear()
}
