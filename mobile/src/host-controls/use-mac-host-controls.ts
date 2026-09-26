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
import { macHostSheetState, type MacHostSheetOptions } from './mac-host-sheet-actions'
import { UNKNOWN_MAC_HOST_STATE, type MacHostState } from './mac-host-state'
import { clearMacUnlockPassword, readMacUnlockPassword } from './mac-unlock-password-store'
import { probeMacHostState } from './probe-mac-host-state'
import { WINDOWS_HOST_COMMAND_TIMEOUT_MS, runMacHostCommand } from './run-mac-host-command'
import {
  WINDOWS_HOST_ACTION_PROGRESS,
  buildWindowsHostCommand
} from './windows-host-commands'

/** The hosts the group appears on: a Mac, and a Windows PC without Unlock. */
function hasHostControls(platform: NodeJS.Platform | null | undefined): boolean {
  return platform === 'darwin' || platform === 'win32'
}

type HostClientEntry = { hostId: string; client: RpcClient; state: ConnectionState }

const TOAST_MS = 2200
/** How long a host is left alone after one of its rows ran before its menu asks it
 *  again: long enough for a Mac to have finished locking or sleeping its display. */
const ACTION_SETTLE_MS = 3000

export function useMacHostControls(args: {
  clients: HostClientEntry[]
  worktreeInfo: Record<string, HostWorktreeInfo>
  /** The host whose sheet is open, or null. Opening one probes that Mac once. */
  openHostId: string | null
}) {
  const [platforms, setPlatforms] = useState<Record<string, NodeJS.Platform | null>>({})
  // Tagged with the host it came from: the one answer slot is shared by every
  // host's sheet, and an untagged answer could be drawn under another host.
  const [probed, setProbed] = useState<{ hostId: string; state: MacHostState } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [passwordHostId, setPasswordHostId] = useState<string | null>(null)
  // Hosts whose action is running or settling; their menu waits before asking.
  const [settlingHostIds, setSettlingHostIds] = useState<ReadonlySet<string>>(() => new Set())
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const clientsRef = useRef(args.clients)
  clientsRef.current = args.clients
  const { openHostId } = args
  // Why read here and not in the probe: a sheet opened on an offline host must say
  // so at once, and must ask the host again the moment it comes back.
  const openHostConnection = openHostId
    ? args.clients.find((entry) => entry.hostId === openHostId)?.state
    : undefined

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
      for (const timer of settleTimersRef.current.values()) {
        clearTimeout(timer)
      }
    },
    []
  )

  const markSettling = useCallback((hostId: string, settling: boolean) => {
    const timer = settleTimersRef.current.get(hostId)
    if (timer) {
      clearTimeout(timer)
      settleTimersRef.current.delete(hostId)
    }
    setSettlingHostIds((previous) => {
      if (previous.has(hostId) === settling) {
        return previous
      }
      const next = new Set(previous)
      if (settling) {
        next.add(hostId)
      } else {
        next.delete(hostId)
      }
      return next
    })
  }, [])

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

  const openPlatform = openHostId ? platforms[openHostId] : undefined
  const openWorktreeId = openHostId ? worktreeIdForHost(openHostId) : null
  const openHostSettling = openHostId ? settlingHostIds.has(openHostId) : false

  // Why on every open and never persisted: the Mac may have been locked or woken from
  // its own keyboard since last time, and a remembered answer would offer Lock to an
  // already-locked Mac.
  //
  // Why keyed on these values and not on the home screen's objects: the home
  // screen replaces its worktree info whenever it fetches a host's workspaces
  // (every return to it, every reconnect), and the platform map whenever any host
  // names its platform. An effect keyed on those threw the running probe away and
  // opened a second tab on the desktop, so the sheet sat on "Checking" for two
  // probes, not one (2026-09-26). The same workspace fetched again is the same id,
  // so it no longer restarts anything; a different one does, because a workspace
  // remembered from the last launch may be gone from the desktop, and the probe
  // could not open its tab there.
  //
  // A host whose action is still running or settling is not asked yet: a menu
  // reopened straight after Sleep display would read the display before it slept,
  // and keep that answer. It says "Checking" until the host has settled.
  useEffect(() => {
    // Forget the last answer at every change, so no render shows what an earlier
    // open, or an earlier connection, said.
    setProbed(null)
    if (
      !openHostId ||
      !hasHostControls(openPlatform) ||
      openHostConnection !== 'connected' ||
      openHostSettling
    ) {
      return
    }
    const client = clientsRef.current.find((entry) => entry.hostId === openHostId)?.client
    const worktreeId = openWorktreeId
    if (!client || !worktreeId) {
      // Nothing to run the probe in; the rows say so themselves.
      setProbed({ hostId: openHostId, state: UNKNOWN_MAC_HOST_STATE })
      return
    }
    let stale = false
    void probeMacHostState({ client, worktreeId, platform: openPlatform ?? undefined }).then((state) => {
      if (!stale) {
        setProbed({ hostId: openHostId, state })
      }
    })
    return () => {
      stale = true
    }
  }, [openHostId, openHostConnection, openPlatform, openWorktreeId, openHostSettling])

  const run = useCallback(
    async (hostId: string, action: MacHostAction, command: string) => {
      const entry = clientsRef.current.find((candidate) => candidate.hostId === hostId)
      const client = entry?.client
      const worktreeId = worktreeIdForHost(hostId)
      const windows = platforms[hostId] === 'win32'
      if (entry?.state !== 'connected') {
        // The rows say so already; a tap that lands anyway must not wait out a
        // timeout to report a host that was never reachable.
        showToast(windows ? 'The PC is offline.' : 'The Mac is offline.')
        return
      }
      if (!client || !worktreeId) {
        showToast(windows ? 'Open a workspace on this PC first' : 'Open a workspace on this Mac first')
        return
      }
      showToast(
        windows && action !== 'unlock' ? WINDOWS_HOST_ACTION_PROGRESS[action] : MAC_HOST_ACTION_PROGRESS[action]
      )
      markSettling(hostId, true)
      const outcome = await runMacHostCommand({
        client,
        worktreeId,
        command,
        // The unlock command line carries the password, so nothing the host
        // says about it may reach a toast.
        secret: action === 'unlock',
        ...(windows ? { timeoutMs: WINDOWS_HOST_COMMAND_TIMEOUT_MS, hostNoun: 'PC' } : {})
      })
      if (!outcome.ok) {
        // The reason comes from the host's own error text, never from the command.
        showToast(outcome.reason)
      }
      // No second probe here. The sheet has closed, and the next open asks the host
      // itself once it has settled; a probe three seconds after every action opened
      // another tab on the desktop that nobody read unless the menu was open, and
      // its answer could land in another host's menu (2026-09-26).
      settleTimersRef.current.set(
        hostId,
        setTimeout(() => markSettling(hostId, false), ACTION_SETTLE_MS)
      )
    },
    [markSettling, platforms, showToast, worktreeIdForHost]
  )

  const onAction = useCallback(
    (hostId: string, action: MacHostAction) => {
      if (platforms[hostId] === 'win32') {
        // Windows has no Unlock row (windows-host-commands.ts); refuse one that arrives anyway.
        if (action !== 'unlock') {
          void run(hostId, action, buildWindowsHostCommand(action))
        }
        return
      }
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
    [platforms, run, showToast]
  )

  const macOptions: MacHostSheetOptions | undefined = openHostId
    ? {
        hostPlatform: platforms[openHostId] ?? null,
        worktreeId: worktreeIdForHost(openHostId),
        state: macHostSheetState(
          openHostConnection,
          probed && probed.hostId === openHostId ? probed.state : 'checking'
        ),
        onAction: (action) => onAction(openHostId, action),
        onForgetUnlockPassword: () => {
          void clearMacUnlockPassword(openHostId)
            .then(() => showToast('Saved password forgotten. Unlock will ask again.'))
            .catch(() => showToast('Could not forget the saved password on this phone.'))
        }
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
