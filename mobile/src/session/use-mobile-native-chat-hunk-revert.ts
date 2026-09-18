import { useCallback, useLayoutEffect, useRef } from 'react'
import { useHostMobileCapability } from '../transport/host-mobile-capabilities'
import type { RpcClient } from '../transport/rpc-client'
import {
  revertDiffCardHunk,
  type MobileNativeChatRevertHunk
} from './mobile-diff-hunk-revert-request'

type Options = {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  /** The agent session the chat is showing, as the tap-to-open flow resolves it. */
  nativeChatSessionId: string | null
  getActiveSessionTabId: () => string | null
}

const NOT_CONNECTED_MESSAGE = 'Not connected to the desktop.'

/**
 * Binds "Revert this hunk" to this session. Identity-stable, so it never
 * disturbs a message row's memo; it reads the live client and tab at tap time.
 *
 * Undefined — no action on any card — until the host has said it lets a
 * phone call `files.write`. Orca's mobile-scope dispatch gate refuses that
 * method outright on 1.4.205 (see host-mobile-capabilities.ts), and a revert
 * that is offered and then refused on every tap is worse than none.
 */
export function useMobileNativeChatHunkRevert(
  options: Options
): MobileNativeChatRevertHunk | undefined {
  const hostAllowsWrite = useHostMobileCapability(options.hostId, 'files.write')
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  })
  const revert = useCallback<MobileNativeChatRevertHunk>(async (file, hunkIndex, cardScope) => {
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
  return hostAllowsWrite ? revert : undefined
}
