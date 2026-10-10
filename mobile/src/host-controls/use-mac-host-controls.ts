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
import { connectedAtOf, useKnownHostStates } from './use-known-host-states'
import { WINDOWS_HOST_COMMAND_TIMEOUT_MS, runMacHostCommand } from './run-mac-host-command'
import { WINDOWS_HOST_ACTION_PROGRESS, buildWindowsHostCommand, isWindowsHostAction } from './windows-host-commands'

/** The hosts the group appears on: a Mac, and a Windows PC with Lock and Mute only. */
function hasHostControls(platform: NodeJS.Platform | null | undefined): boolean {
  return platform === 'darwin' || platform === 'win32'
}

type HostClientEntry = { hostId: string; client: RpcClient; state: ConnectionState }

const TOAST_MS = 2200
/** How long a host is left alone after one of its rows ran before its menu asks it
 *  again: long enough for a Mac to have finished locking or sleeping its display. */
const ACTION_SETTLE_MS = 3000
/** The longest one open of the menu waits on a settling host before it asks anyway.
 *  An action that never finishes (osascript held on a prompt, a relay waiting to
 *  reconnect) held the menu on "Checking" past the probe's own 12 s. The wait comes
 *  off the probe's budget, so the row still ends inside it, and the probe keeps at
 *  least 5 s of its 12. Counted from the menu, not the tap: Unlock spends 3.3 s by
 *  design before it types, a little more since it checks the lock twice first
 *  (mac-host-commands.ts), and a 5 s cap from the tap let the probe read the login
 *  window before it let the user in (2026-09-26 review). */
const MENU_WAIT_MAX_MS = 7000
/** When a gate comes down even if its run never settles, so no host is left
 *  settling for good. Longer than any action's own timeout plus its settle; a read
 *  the relay holds through a reconnect can outlast it, and the gate then falls
 *  mid-action, which only means the next menu asks sooner. */
const ACTION_GATE_SAFETY_MS = 20_000

type SettleEntry = { token: number; timers: ReturnType<typeof setTimeout>[] }

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
  // Per host: the last answer, and after an action that finished OK, the state it
  // left behind, which the next open draws at once (use-known-host-states.ts).
  const { recordProbe, recordAction, actionStarted, actionFailed, expectedFor } = useKnownHostStates(args.clients)
  const [toast, setToast] = useState<string | null>(null)
  const [passwordHostId, setPasswordHostId] = useState<string | null>(null)
  // Hosts whose action is running or settling; their menu waits before asking.
  const [settlingHostIds, setSettlingHostIds] = useState<ReadonlySet<string>>(() => new Set())
  // The host whose open menu has waited MENU_WAIT_MAX_MS on its gate and asks anyway.
  const [waitExpiredHostId, setWaitExpiredHostId] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // One entry per settling host. The token is the run that raised it: only that run's
  // timers may lower it, so an earlier run ending cannot open the gate on a later one.
  const settleRef = useRef(new Map<string, SettleEntry>())
  const settleTokenRef = useRef(0)
  const mountedRef = useRef(true)
  // When the open menu started waiting on a settling host, so the probe that follows
  // gets only what is left of its budget.
  const gateWaitRef = useRef<{ hostId: string; since: number } | null>(null)
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

  useEffect(() => {
    mountedRef.current = true
    const settle = settleRef.current
    return () => {
      mountedRef.current = false
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
      for (const entry of settle.values()) {
        entry.timers.forEach(clearTimeout)
      }
      settle.clear()
    }
  }, [])

  const setSettling = useCallback((hostId: string, settling: boolean) => {
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

  /** Lowers the gate `afterMs` from now, if the run that raised it still owns it. */
  const endSettling = useCallback(
    (hostId: string, token: number, afterMs: number) => {
      const entry = settleRef.current.get(hostId)
      if (!mountedRef.current || entry?.token !== token) {
        return
      }
      const finish = () => {
        const current = settleRef.current.get(hostId)
        if (current?.token !== token) {
          return
        }
        current.timers.forEach(clearTimeout)
        settleRef.current.delete(hostId)
        setSettling(hostId, false)
      }
      if (afterMs <= 0) {
        finish()
        return
      }
      entry.timers.push(setTimeout(finish, afterMs))
    },
    [setSettling]
  )

  /** Raises the gate for one run, with a safety timer that lowers it whatever happens. */
  const beginSettling = useCallback(
    (hostId: string) => {
      settleTokenRef.current += 1
      const token = settleTokenRef.current
      settleRef.current.get(hostId)?.timers.forEach(clearTimeout)
      settleRef.current.set(hostId, { token, timers: [] })
      setSettling(hostId, true)
      endSettling(hostId, token, ACTION_GATE_SAFETY_MS)
      return token
    },
    [endSettling, setSettling]
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

  const openPlatform = openHostId ? platforms[openHostId] : undefined
  const openWorktreeId = openHostId ? worktreeIdForHost(openHostId) : null
  // Waiting on the host's gate, until the gate falls or this open has waited enough.
  const openHostGated = openHostId
    ? settlingHostIds.has(openHostId) && waitExpiredHostId !== openHostId
    : false

  // Why on every open and never persisted: the Mac may have been locked or woken from
  // its own keyboard since last time, and a remembered answer would offer Lock to an
  // already-locked Mac. An action that finished OK in the last two minutes, on this
  // connection, is the one exception to drawing: its menu shows the state that action
  // left behind at once, instead of "Checking", and this probe still runs behind it
  // and replaces it (mac-host-expected-state.ts, 2026-10-10).
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
  // and keep that answer. It says "Checking" until the host has settled, or for
  // MENU_WAIT_MAX_MS at most, and the probe then gets what is left of its budget.
  // Once the action has finished OK, its expected rows are drawn through the settle
  // instead; while it still runs, "Checking" (a disabled row) stays, so no second
  // run can start over it.
  useEffect(() => {
    // Forget the last answer at every change, so no render shows what an earlier
    // open, or an earlier connection, said. An expectation is drawn from `known`.
    setProbed(null)
    if (!openHostId || !hasHostControls(openPlatform) || openHostConnection !== 'connected') {
      gateWaitRef.current = null
      setWaitExpiredHostId(null)
      return
    }
    if (openHostGated) {
      if (gateWaitRef.current?.hostId !== openHostId) {
        gateWaitRef.current = { hostId: openHostId, since: Date.now() }
      }
      const remaining = gateWaitRef.current.since + MENU_WAIT_MAX_MS - Date.now()
      const expire = setTimeout(() => setWaitExpiredHostId(openHostId), Math.max(0, remaining))
      return () => clearTimeout(expire)
    }
    const gateWait = gateWaitRef.current
    gateWaitRef.current = null
    const alreadyWaitedMs =
      gateWait?.hostId === openHostId ? Math.min(Date.now() - gateWait.since, MENU_WAIT_MAX_MS) : 0
    const client = clientsRef.current.find((entry) => entry.hostId === openHostId)?.client
    const worktreeId = openWorktreeId
    if (!client || !worktreeId) {
      // Nothing to run the probe in; the rows say so themselves.
      setProbed({ hostId: openHostId, state: UNKNOWN_MAC_HOST_STATE })
      return
    }
    const connectedAt = connectedAtOf(client)
    let stale = false
    void probeMacHostState({
      client,
      worktreeId,
      platform: openPlatform ?? undefined,
      alreadyWaitedMs
    }).then((state) => {
      if (!stale) {
        setProbed({ hostId: openHostId, state })
        recordProbe(openHostId, state, connectedAt)
      }
    })
    return () => {
      stale = true
    }
  }, [openHostId, openHostConnection, openPlatform, openWorktreeId, openHostGated, recordProbe])

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
      showToast(windows && isWindowsHostAction(action) ? WINDOWS_HOST_ACTION_PROGRESS[action] : MAC_HOST_ACTION_PROGRESS[action])
      const token = beginSettling(hostId)
      actionStarted(hostId)
      let finished = false
      try {
        const outcome = await runMacHostCommand({
          client,
          worktreeId,
          command,
          // The unlock command line carries the password, so nothing the host
          // says about it may reach a toast.
          secret: action === 'unlock',
          ...(windows ? { timeoutMs: WINDOWS_HOST_COMMAND_TIMEOUT_MS, hostNoun: 'PC' } : {})
        })
        finished = outcome.ok
        if (outcome.ok && mountedRef.current) {
          // Only an action that finished OK says what the host is now; a failed,
          // unfinished or thrown one forgets what was known (finally, below), and
          // the next open asks behind "Checking".
          recordAction(hostId, action, platforms[hostId], clientsRef.current.find((c) => c.hostId === hostId)?.client)
        }
        if (!outcome.ok) {
          // The reason comes from the host's own error text, never from the command.
          showToast(outcome.reason)
        }
      } catch {
        // Nothing thrown here may be shown: it can carry the command, and the
        // unlock command is the password. A fixed line still says where to look.
        showToast(windows ? 'The PC did not answer.' : 'The Mac did not answer.')
      } finally {
        // No second probe here. The sheet has closed, and the next open asks the
        // host itself once it has settled; a probe three seconds after every action
        // opened another tab on the desktop that nobody read unless the menu was
        // open, and its answer could land in another host's menu (2026-09-26). A
        // finished action gets its settle; a failed, unfinished or thrown one has
        // nothing to wait for.
        if (!finished) {
          actionFailed(hostId) // a no-op once unmounted
        }
        endSettling(hostId, token, finished ? ACTION_SETTLE_MS : 0)
      }
    },
    // prettier-ignore
    [actionFailed, actionStarted, beginSettling, endSettling, platforms, recordAction, showToast, worktreeIdForHost]
  )

  const onAction = useCallback(
    (hostId: string, action: MacHostAction) => {
      if (platforms[hostId] === 'win32') {
        // Windows has no Unlock, Sleep display or Wake display row
        // (windows-host-commands.ts); refuse one that arrives anyway.
        if (isWindowsHostAction(action)) {
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

  const openExpected = expectedFor(openHostId, args.clients.find((entry) => entry.hostId === openHostId)?.client)

  const macOptions: MacHostSheetOptions | undefined = openHostId
    ? {
        hostPlatform: platforms[openHostId] ?? null,
        worktreeId: worktreeIdForHost(openHostId),
        // An expectation already holds the probe's answer laid over it.
        state: macHostSheetState(openHostConnection, openExpected ?? (probed?.hostId === openHostId ? probed.state : 'checking')),
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
