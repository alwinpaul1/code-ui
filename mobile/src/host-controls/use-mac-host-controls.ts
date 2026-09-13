import { useCallback, useEffect, useRef, useState } from 'react'
import { getCachedWorktrees } from '../cache/worktree-cache'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { HostWorktreeInfo } from '../worktree/home-worktree-info'
import {
  MAC_HOST_ACTION_PROGRESS,
  buildMacHostCommand,
  buildMacUnlockCommand,
  type MacHostAction
} from './mac-host-commands'
import { readMacHostPlatformResult, selectMacHostWorktreeId } from './mac-host-platform'
import type { MacHostSheetOptions } from './mac-host-sheet-actions'
import { readMacUnlockPassword } from './mac-unlock-password-store'
import { runMacHostCommand } from './run-mac-host-command'

type HostClientEntry = { hostId: string; client: RpcClient; state: ConnectionState }

const TOAST_MS = 2200

export function useMacHostControls(args: {
  clients: HostClientEntry[]
  worktreeInfo: Record<string, HostWorktreeInfo>
}) {
  const [platforms, setPlatforms] = useState<Record<string, NodeJS.Platform | null>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [passwordHostId, setPasswordHostId] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clientsRef = useRef(args.clients)
  clientsRef.current = args.clients

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }
    setToast(message)
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, TOAST_MS)
  }, [])

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    },
    []
  )

  // Why ask at all: the host card must know darwin from win32 before the sheet opens,
  // so a Windows user never sees a Mac row appear a moment late. One ask per connect.
  useEffect(() => {
    let stale = false
    for (const entry of args.clients) {
      if (entry.state !== 'connected' || platforms[entry.hostId] !== undefined) {
        continue
      }
      void entry.client
        .sendRequest('host.platform')
        .then((response) => {
          if (stale) {
            return
          }
          setPlatforms((previous) => ({
            ...previous,
            [entry.hostId]: response.ok ? readMacHostPlatformResult(response.result) : null
          }))
        })
        .catch(() => undefined)
    }
    return () => {
      stale = true
    }
  }, [args.clients, platforms])

  const worktreeIdForHost = useCallback(
    (hostId: string) =>
      selectMacHostWorktreeId(args.worktreeInfo[hostId], getCachedWorktrees(hostId)),
    [args.worktreeInfo]
  )

  const run = useCallback(
    async (hostId: string, action: MacHostAction, command: string) => {
      const client = clientsRef.current.find((entry) => entry.hostId === hostId)?.client
      const worktreeId = worktreeIdForHost(hostId)
      if (!client || !worktreeId) {
        showToast('Open a workspace on this Mac first')
        return
      }
      showToast(MAC_HOST_ACTION_PROGRESS[action])
      const outcome = await runMacHostCommand({ client, worktreeId, command })
      if (!outcome.ok) {
        // The reason comes from the host's own error text, never from the command.
        showToast(outcome.reason)
      }
    },
    [showToast, worktreeIdForHost]
  )

  const onAction = useCallback(
    (hostId: string, action: MacHostAction) => {
      if (action !== 'unlock') {
        void run(hostId, action, buildMacHostCommand(action))
        return
      }
      void readMacUnlockPassword(hostId)
        .then((password) => {
          if (password === null || password === '') {
            setPasswordHostId(hostId)
            return
          }
          return run(hostId, 'unlock', buildMacUnlockCommand(password))
        })
        .catch(() => showToast('Could not read the saved password on this phone.'))
    },
    [run, showToast]
  )

  const macOptionsForHost = useCallback(
    (hostId: string | null): MacHostSheetOptions | undefined => {
      if (!hostId) {
        return undefined
      }
      return {
        hostPlatform: platforms[hostId] ?? null,
        worktreeId: worktreeIdForHost(hostId),
        onAction: (action) => onAction(hostId, action)
      }
    },
    [onAction, platforms, worktreeIdForHost]
  )

  return {
    macOptionsForHost,
    toast,
    passwordHostId,
    closePasswordSheet: useCallback(() => setPasswordHostId(null), []),
    onPasswordSaved: useCallback(
      (hostId: string, password: string) => {
        setPasswordHostId(null)
        void run(hostId, 'unlock', buildMacUnlockCommand(password))
      },
      [run]
    )
  }
}
