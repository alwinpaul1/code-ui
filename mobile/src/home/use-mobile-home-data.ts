import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountsSnapshot } from '../components/AccountUsage'
import { hasRenderableUsage } from '../components/AccountUsage'
import { loadHomeSnapshot, saveHomeSnapshot } from '../cache/home-snapshot-cache'
import { getCachedWorktrees, setCachedWorktrees } from '../cache/worktree-cache'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../onboarding/mobile-onboarding-plan'
import { totalHomeStats, type HomeStatsRow } from '../stats/home-stats-total'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import {
  selectConnectableHostProfiles,
  sortHostsByLastConnected
} from '../transport/host-catalog-selection'
import {
  dropSharedHostListLoad,
  getHostMembershipRevision
} from '../transport/host-list-load-sharing'
import { loadHostCatalog } from '../transport/host-store'
import { createHomeCatalogSequence } from './home-catalog-sequence'
import { HOME_CATALOG_READ_CAP_MS, readHomeCatalog } from './home-catalog-read'
import type { HostCatalogEntry, HostProfile } from '../transport/types'
import { fetchHomeHostWorktreeInfo } from '../worktree/home-host-worktree-fetch'
import type { HomeWorktreeSummary, HostWorktreeInfo } from '../worktree/home-worktree-info'
import {
  LAST_VISITED_WORKTREE_STORAGE_KEY,
  readLastVisitedWorktreeRecord
} from '../worktree/last-visited-worktree-repo'
import { selectHomeResumeCard } from '../worktree/home-resume-card'
import { refreshAccountUsage } from './refresh-account-usage'
import {
  fetchMobileHomeAccounts,
  fetchMobileHomeStats,
  fetchMobileHomeTaskProviders
} from './mobile-home-host-requests'
import { projectHomeHostConnections } from './home-host-connection-projection'
import { useMobileHomeHostConnections } from './use-mobile-home-host-connections'

export function useMobileHomeData() {
  const router = useRouter()
  const [hostCatalog, setHostCatalogState] = useState<HostCatalogEntry[]>([])
  // Why: `[]` before the first read finishes is "not known yet", not "no hosts".
  const [hostCatalogLoaded, setHostCatalogLoaded] = useState(false)
  const [statsByHost, setStatsByHost] = useState<Record<string, HomeStatsRow>>({})
  const [worktreeInfo, setWorktreeInfo] = useState<Record<string, HostWorktreeInfo>>({})
  const [accountsByHost, setAccountsByHost] = useState<Record<string, AccountsSnapshot>>({})
  const [taskProvidersByHost, setTaskProvidersByHost] = useState<Record<string, TaskProvider[]>>({})
  const [lastVisited, setLastVisited] = useState<{ hostId: string; worktreeId: string } | null>(
    null
  )
  const onboardingCheckedRef = useRef(false)
  const membershipReadRef = useRef<number | null>(null)
  const [catalogSequence] = useState(createHomeCatalogSequence)
  const hydratedRef = useRef(false)
  // A list this screen produced itself (a removal, a re-check): it supersedes any
  // read still in flight, and it is already current, so a membership change it
  // caused must not send the next return to home back to loading.
  const setHostCatalog = useCallback(
    (catalog: HostCatalogEntry[]) => {
      catalogSequence.localChange(catalog.length)
      membershipReadRef.current = getHostMembershipRevision()
      setHostCatalogState(catalog)
      setHostCatalogLoaded(true)
    },
    [catalogSequence]
  )
  // Home's own re-check of the store (a tap on an unavailable card). Unlike a
  // removal it has no write of its own behind it, so it takes a place in the read
  // order when it STARTS: a focus read that starts after it is newer and must win,
  // and this one lands only if nothing newer already has.
  const recheckHostCatalog = useCallback(async (): Promise<void> => {
    const readNo = catalogSequence.start()
    const membership = getHostMembershipRevision()
    const catalog = await loadHostCatalog()
    if (!catalogSequence.accept(readNo, catalog.length)) {
      return
    }
    membershipReadRef.current = membership
    setHostCatalogState(catalog)
    setHostCatalogLoaded(true)
  }, [catalogSequence])
  const hosts = useMemo(() => selectConnectableHostProfiles(hostCatalog), [hostCatalog])
  const connections = useMobileHomeHostConnections(hosts, hostCatalog, {
    setStats: setStatsByHost,
    setWorktreeInfo,
    setAccounts: setAccountsByHost,
    setTaskProviders: setTaskProvidersByHost
  })
  const allClientsRef = useRef(connections.allClients)

  useEffect(() => {
    if (hydratedRef.current) {
      return
    }
    hydratedRef.current = true
    let cancelled = false
    void loadHomeSnapshot().then((snapshot) => {
      if (cancelled || !snapshot) {
        return
      }
      setWorktreeInfo((previous) =>
        Object.keys(previous).length > 0 ? previous : snapshot.worktreeInfo
      )
      setAccountsByHost((previous) =>
        Object.keys(previous).length > 0 ? previous : snapshot.accountsByHost
      )
      for (const [hostId, info] of Object.entries(snapshot.worktreeInfo)) {
        if (info.lastActiveWorktree) {
          setCachedWorktrees(hostId, [info.lastActiveWorktree])
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (Object.keys(worktreeInfo).length > 0 || Object.keys(accountsByHost).length > 0) {
      saveHomeSnapshot({ worktreeInfo, accountsByHost, savedAt: Date.now() })
    }
  }, [worktreeInfo, accountsByHost])

  useEffect(() => {
    allClientsRef.current = connections.allClients
  }, [connections.allClients])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      // Why: pairing the first desktop, or removing the last, happens on other
      // screens. Home stays mounted underneath, so on return it would still draw
      // the answer it read before. A membership change since that read makes the
      // old answer untrue in either direction, so hide it until the store is re-read.
      const membership = getHostMembershipRevision()
      if (membershipReadRef.current !== null && membershipReadRef.current !== membership) {
        setHostCatalogLoaded(false)
      }
      membershipReadRef.current = membership
      const readNo = catalogSequence.start()
      void readHomeCatalog({
        load: loadHostCatalog,
        capMs: HOME_CATALOG_READ_CAP_MS,
        isStale: () => stale,
        readBefore: catalogSequence.hasAnswer(),
        keptList: catalogSequence.drawingHosts(),
        abandonLoad: dropSharedHostListLoad,
        // Fail open: an unreadable or stuck store must not leave home blank
        // forever. Pairing is the one thing that still works, and the next focus
        // reads again.
        onFailOpen: () => setHostCatalogLoaded(true),
        warn: (message, detail) => console.warn(message, detail),
        onCatalog: async (catalog) => {
          if (!catalogSequence.accept(readNo, catalog.length)) {
            return
          }
          setHostCatalogState(catalog)
          setHostCatalogLoaded(true)
          if (catalog.length === 0 || onboardingCheckedRef.current) {
            return
          }
          onboardingCheckedRef.current = true
          const steps = await loadMobileOnboardingSteps()
          if (!stale && steps.length > 0) {
            router.replace(mobileOnboardingDestination(steps))
          }
        }
      })
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
      }
    }, [router, catalogSequence])
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
  const primaryTaskProviders = primaryHost
    ? (taskProvidersByHost[primaryHost.id] ?? ['github'])
    : []
  const hostConnections = useMemo(
    () => projectHomeHostConnections(connections.allClients),
    [connections.allClients]
  )

  return {
    ...connections,
    accountsHosts,
    connectedHosts,
    hostCatalog,
    hostCatalogLoaded,
    hostConnections,
    primaryHost,
    primaryTaskProviders,
    refreshAccounts,
    refreshingAccounts,
    resumeCard,
    router,
    recheckHostCatalog,
    setHostCatalog,
    sortedHostCatalog,
    stats,
    worktreeInfo
  }
}
