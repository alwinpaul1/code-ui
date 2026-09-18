import { useCallback, useLayoutEffect, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  revertDiffCardHunk,
  type MobileNativeChatRevertHunk
} from './mobile-diff-hunk-revert-request'

type Options = {
  client: RpcClient | null
  worktreeId: string
  /** The agent session the chat is showing, as the tap-to-open flow resolves it. */
  nativeChatSessionId: string | null
  getActiveSessionTabId: () => string | null
}

const NOT_CONNECTED_MESSAGE = 'Not connected to the desktop.'

/** Binds "Revert this hunk" to this session. Identity-stable, so it never
 *  disturbs a message row's memo; it reads the live client and tab at tap time. */
export function useMobileNativeChatHunkRevert(options: Options): MobileNativeChatRevertHunk {
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  })
  return useCallback(async (file, hunkIndex, cardScope) => {
    const current = optionsRef.current
    if (!current.client) {
      return { status: 'failed', message: NOT_CONNECTED_MESSAGE }
    }
    const tabId = current.getActiveSessionTabId()
    return revertDiffCardHunk({
      client: current.client,
      worktreeId: current.worktreeId,
      nativeChatContext:
        current.nativeChatSessionId && tabId
          ? { tabId, sessionId: current.nativeChatSessionId }
          : null,
      file,
      hunkIndex,
      cardScope
    })
  }, [])
}
