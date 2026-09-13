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
import { UNKNOWN_MAC_HOST_STATE, type MacHostState } from './mac-host-state'
import { readMacUnlockPassword } from './mac-unlock-password-store'
import { probeMacHostState } from './probe-mac-host-state'
import { runMacHostCommand } from './run-mac-host-command'

type HostClientEntry = { hostId: string; client: RpcClient; state: ConnectionState }

const TOAST_MS = 2200
/** Long enough for the Mac to have finished locking or sleeping before we ask again. */
const REPROBE_DELAY_MS = 3000

export function useMacHostControls(args: {
  clients: HostClientEntry[]
  worktreeInfo: Record<string, HostWorktreeInfo>
  /** The host whose sheet is open, or null. Opening one probes that Mac once. */
  openHostId: string | null
}) {
  const [platforms, setPlatforms] = useState<Record<string, NodeJS.Platform | null>>({})
  const [macState, setMacState] = useState<MacHostState | 'checking'>('checking')
  const [toast, setToast] = useState<string | null>(null)
  const [passwordHostId, setPasswordHostId] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reprobeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clientsRef = useRef(args.clients)
  clientsRef.current = args.clients
  const { openHostId } = args

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
      if (reprobeTimerRef.current) {
        clearTimeout(reprobeTimerRef.current)
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

  const probe = useCallback(
    async (hostId: string) => {
      const client = clientsRef.current.find((entry) => entry.hostId === hostId)?.client
      const worktreeId = worktreeIdForHost(hostId)
      if (!client || !worktreeId) {
        // Nothing to run the probe in; the rows say so themselves.
        return null
      }
      return probeMacHostState({ client, worktreeId })
    },
    [worktreeIdForHost]
  )

  // Why on every open and never persisted: the Mac may have been locked or woken from
  // its own keyboard since last time, and a remembered answer would offer Lock to an
  // already-locked Mac.
  useEffect(() => {
    if (!openHostId || platforms[openHostId] !== 'darwin') {
      return
    }
    let stale = false
    setMacState('checking')
    void probe(openHostId).then((state) => {
      if (!stale) {
        setMacState(state ?? UNKNOWN_MAC_HOST_STATE)
      }
    })
    return () => {
      stale = true
    }
  }, [openHostId, platforms, probe])

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
        return
      }
      // Let the Mac settle, then ask it again so the rows flip for the next open.
      if (reprobeTimerRef.current) {
        clearTimeout(reprobeTimerRef.current)
      }
      reprobeTimerRef.current = setTimeout(() => {
        reprobeTimerRef.current = null
        void probe(hostId).then((state) => setMacState(state ?? 'checking'))
      }, REPROBE_DELAY_MS)
    },
    [probe, showToast, worktreeIdForHost]
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

  const macOptions: MacHostSheetOptions | undefined = openHostId
    ? {
        hostPlatform: platforms[openHostId] ?? null,
        worktreeId: worktreeIdForHost(openHostId),
        state: macState,
        onAction: (action) => onAction(openHostId, action)
      }
    : undefined

  return {
    macOptions,
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
