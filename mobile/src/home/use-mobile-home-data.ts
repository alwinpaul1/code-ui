import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountsSnapshot } from '../components/AccountUsage'
import { hasRenderableUsage } from '../components/AccountUsage'
import { loadHomeSnapshot, saveHomeSnapshot } from '../cache/home-snapshot-cache'
import { getCachedWorktrees, setCachedWorktrees } from '../cache/worktree-cache'
import { totalHomeStats, type HomeStatsRow } from '../stats/home-stats-total'
import {
  selectConnectableHostProfiles,
  sortHostsByLastConnected
} from '../transport/host-catalog-selection'
import type { HostProfile } from '../transport/types'
import { fetchHomeHostWorktreeInfo } from '../worktree/home-host-worktree-fetch'
import type { HomeWorktreeSummary, HostWorktreeInfo } from '../worktree/home-worktree-info'
import {
  LAST_VISITED_WORKTREE_STORAGE_KEY,
  readLastVisitedWorktreeRecord
} from '../worktree/last-visited-worktree-repo'
import { selectHomeResumeCard } from '../worktree/home-resume-card'
import { refreshAccountUsage } from './refresh-account-usage'
import type { HomeTaskSources } from './home-task-sources'
import {
  fetchMobileHomeAccounts,
  fetchMobileHomeStats,
  fetchMobileHomeTaskProviders
} from './mobile-home-host-requests'
import { projectHomeHostConnections } from './home-host-connection-projection'
import { useMobileHomeHostConnections } from './use-mobile-home-host-connections'
import { useHomeHostCatalog } from './use-home-host-catalog'

export function useMobileHomeData() {
  const router = useRouter()
  const catalog = useHomeHostCatalog(router)
  const { beginFocusRead, hostCatalog } = catalog
  const [statsByHost, setStatsByHost] = useState<Record<string, HomeStatsRow>>({})
  const [worktreeInfo, setWorktreeInfo] = useState<Record<string, HostWorktreeInfo>>({})
  const [accountsByHost, setAccountsByHost] = useState<Record<string, AccountsSnapshot>>({})
  const [taskProvidersByHost, setTaskProvidersByHost] = useState<Record<string, HomeTaskSources>>(
    {}
  )
  const [lastVisited, setLastVisited] = useState<{ hostId: string; worktreeId: string } | null>(
    null
  )
  const hydratedRef = useRef(false)
  const hosts = useMemo(() => selectConnectableHostProfiles(hostCatalog), [hostCatalog])
  const connections = useMobileHomeHostConnections(hosts, hostCatalog, {
    setStats: setStatsByHost,
    setWorktreeInfo,
    setAccounts: setAccountsByHost,
    setTaskProviders: setTaskProvidersByHost
  })
  const allClientsRef = useRef(connections.allClients)

  // Whether the stored snapshot has been read: nothing is saved before it has, and nothing after a
  // refused read. A snapshot built from live data alone and saved over the stored one erased every
  // other desktop's cached cards, both after a refused read and when one desktop's live data beat
  // the read (review, 2026-09-30). It is a render cache, so a launch that cannot read it only
  // loses its cache for this launch; the stored one stays for the next.
  const [snapshotRead, setSnapshotRead] = useState<'pending' | 'read' | 'refused'>('pending')

  useEffect(() => {
    if (hydratedRef.current) {
      return
    }
    hydratedRef.current = true
    let cancelled = false
    loadHomeSnapshot().then(
      (snapshot) => {
        if (cancelled) {
          return
        }
        if (snapshot) {
          // Per desktop: live data that landed first wins for its desktop, and the stored cards
          // stay for every other one.
          setWorktreeInfo((previous) => ({ ...snapshot.worktreeInfo, ...previous }))
          setAccountsByHost((previous) => ({ ...snapshot.accountsByHost, ...previous }))
          for (const [hostId, info] of Object.entries(snapshot.worktreeInfo)) {
            if (info.lastActiveWorktree) {
              setCachedWorktrees(hostId, [info.lastActiveWorktree])
            }
          }
        }
        setSnapshotRead('read')
      },
      (error: unknown) => {
        console.warn('[home] the cached home snapshot could not be read; not saving over it', error)
        if (!cancelled) {
          setSnapshotRead('refused')
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (snapshotRead !== 'read') {
      return
    }
    if (Object.keys(worktreeInfo).length > 0 || Object.keys(accountsByHost).length > 0) {
      saveHomeSnapshot({ worktreeInfo, accountsByHost, savedAt: Date.now() })
    }
  }, [snapshotRead, worktreeInfo, accountsByHost])

  useEffect(() => {
    allClientsRef.current = connections.allClients
  }, [connections.allClients])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      const endCatalogRead = beginFocusRead()
      void AsyncStorage.getItem(LAST_VISITED_WORKTREE_STORAGE_KEY).then((raw) => {
        if (!stale) {
          setLastVisited(readLastVisitedWorktreeRecord(raw))
        }
      })
      for (const entry of allClientsRef.current) {
        if (entry.client.getState() === 'connected') {
          fetchMobileHomeStats(entry.client, entry.hostId, setStatsByHost, () => stale)
          void fetchHomeHostWorktreeInfo(entry.client, entry.hostId, setWorktreeInfo, () => stale)
          fetchMobileHomeAccounts(entry.client, entry.hostId, setAccountsByHost, () => stale)
          fetchMobileHomeTaskProviders(
            entry.client,
            entry.hostId,
            setTaskProvidersByHost,
            () => stale
          )
        }
      }
      return () => {
        stale = true
        endCatalogRead()
      }
    }, [beginFocusRead])
  )

  const [refreshingAccounts, setRefreshingAccounts] = useState(false)
  const refreshAccounts = useCallback(async () => {
    setRefreshingAccounts(true)
    try {
      await refreshAccountUsage(allClientsRef.current, setAccountsByHost)
    } finally {
      setRefreshingAccounts(false)
    }
  }, [])

  const sortedHosts = useMemo(() => sortHostsByLastConnected(hosts), [hosts])
  const sortedHostCatalog = useMemo(() => sortHostsByLastConnected(hostCatalog), [hostCatalog])
  const hostIds = useMemo(() => hosts.map((host) => host.id), [hosts])
  const stats = useMemo(() => totalHomeStats(statsByHost, hostIds), [statsByHost, hostIds])
  const resumeCard = useMemo(
    () =>
      selectHomeResumeCard({
        hosts: sortedHosts,
        hostStates: connections.hostStates,
        worktreeInfo,
        lastVisited,
        cachedWorktrees: (hostId) => getCachedWorktrees(hostId) as HomeWorktreeSummary[] | null
      }),
    [sortedHosts, connections.hostStates, worktreeInfo, lastVisited]
  )
  const accountsHosts = useMemo(() => {
    const items: { host: HostProfile; snapshot: AccountsSnapshot }[] = []
    for (const host of sortedHosts) {
      const snapshot = accountsByHost[host.id]
      if (
        connections.hostStates[host.id] === 'connected' &&
        snapshot &&
        (hasRenderableUsage(snapshot, 'claude') || hasRenderableUsage(snapshot, 'codex'))
      ) {
        items.push({ host, snapshot })
      }
    }
    return items
  }, [sortedHosts, connections.hostStates, accountsByHost])
  const connectedHosts = useMemo(
    () => sortedHosts.filter((host) => connections.hostStates[host.id] === 'connected'),
    [sortedHosts, connections.hostStates]
  )
  const primaryHost = connectedHosts[0] ?? null
  // Undefined until the desktop's first provider read ends: the card says it is checking rather
  // than claim GitHub for a user whose sources are GitLab and Linear (review, 2026-09-30). A read
  // that ended without an answer is TASK_SOURCES_READ_FAILED, which the card says in so many words
  // until the next focus or new connection reads again; it no longer sits on "Checking sources…"
  // after nothing is checking (review round 3). A failed read after a good one keeps the good one.
  const primaryTaskProviders: HomeTaskSources | undefined = primaryHost
    ? taskProvidersByHost[primaryHost.id]
    : []
  const hostConnections = useMemo(
    () => projectHomeHostConnections(connections.allClients),
    [connections.allClients]
  )

  return {
    ...connections,
    accountsHosts,
    connectedHosts,
    dropHostLocally: catalog.dropHostLocally,
    hostCatalog,
    hostCatalogFailed: catalog.hostCatalogFailed,
    hostCatalogLoaded: catalog.hostCatalogLoaded,
    hostConnections,
    primaryHost,
    primaryTaskProviders,
    refreshAccounts,
    refreshingAccounts,
    resumeCard,
    router,
    recheckHostCatalog: catalog.recheckHostCatalog,
    retryHostCatalog: catalog.retryHostCatalog,
    setHostCatalog: catalog.setHostCatalog,
    sortedHostCatalog,
    stats,
    worktreeInfo
  }
}
