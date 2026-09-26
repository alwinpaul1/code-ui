// Hands the created-file read-back counts to the tool runs on screen. The
// overlay provides the store and the loaded transcript; a finished run that
// holds a cut create asks for it while mounted and drawing a count, and
// re-renders when the count lands.
// A run with no cut create, or a chat with no provider, reads nothing and
// draws exactly what it drew before.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { cutCreateOf, cutCreatesIn } from './mobile-native-chat-created-file-count'
import type { CreatedFileCountStore } from './mobile-native-chat-created-file-count-store'
import type { VerifiedCreateCount } from './mobile-native-chat-tool-run-diff-stat'

const CreatedFileCountContext = createContext<CreatedFileCountStore | null>(null)

const NO_COUNT = '-'

function subscribeToNothing(): () => void {
  return () => {}
}

export function CreatedFileCountProvider({
  store,
  messages,
  live,
  children
}: {
  store: CreatedFileCountStore | undefined
  /** The loaded transcript, which says whether a later call touched a file. */
  messages: readonly NativeChatMessage[]
  /** The chat's own read of it settled; not a transcript held over. */
  live: boolean
  children: ReactNode
}) {
  // A layout effect, so the transcript is in before any row's passive effect
  // asks for a file.
  useLayoutEffect(() => {
    store?.setTranscript(messages, live)
  }, [store, messages, live])
  return (
    <CreatedFileCountContext.Provider value={store ?? null}>
      {children}
    </CreatedFileCountContext.Provider>
  )
}

/** The verified count of each cut create in `blocks`, for as long as the
 *  caller is mounted; undefined when there is nothing to look up. `wanted` is
 *  false while the caller draws no count: a run still going, whose next call
 *  may change the file, or one folded away in focus view. It then reads
 *  nothing, and still draws a count already known. */
export function useCreatedFileCounts(
  blocks: readonly NativeChatBlock[],
  wanted: boolean
): VerifiedCreateCount | undefined {
  const store = useContext(CreatedFileCountContext)
  const creates = useMemo(() => (store ? cutCreatesIn(blocks) : []), [store, blocks])
  // The keys, not the array: a run re-rendered with the same creates keeps
  // its place in the read queue.
  const signature = creates.map((create) => create.key).join('\u0001')
  useEffect(() => {
    if (!store || !wanted || creates.length === 0) {
      return undefined
    }
    const releases = creates.map((create) => store.want(create))
    return () => {
      for (const release of releases) {
        release()
      }
    }
  }, [store, signature, wanted])
  const snapshot = useCallback(
    () =>
      store && creates.length > 0
        ? creates.map((create) => store.countFor(create.key) ?? NO_COUNT).join(',')
        : '',
    [store, creates]
  )
  const counts = useSyncExternalStore(store ? store.subscribe : subscribeToNothing, snapshot)
  return useMemo(() => {
    if (!store || creates.length === 0) {
      return undefined
    }
    const byKey = new Map<string, number>()
    counts.split(',').forEach((count, index) => {
      const create = creates[index]
      if (create && count !== NO_COUNT) {
        byKey.set(create.key, Number(count))
      }
    })
    return (call, result) => {
      const create = cutCreateOf(call, result)
      return create ? (byKey.get(create.key) ?? null) : null
    }
  }, [store, creates, counts])
}
