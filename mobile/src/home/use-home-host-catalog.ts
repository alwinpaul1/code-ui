import type { useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../onboarding/mobile-onboarding-plan'
import {
  dropSharedHostListLoad,
  getHostMembershipRevision
} from '../transport/host-list-load-sharing'
import { loadHostCatalog } from '../transport/host-store'
import type { HostCatalogEntry } from '../transport/types'
import { HOME_CATALOG_READ_CAP_MS, readHomeCatalog } from './home-catalog-read'
import { createHomeCatalogSequence } from './home-catalog-sequence'

type FocusPass = { stale: boolean }

/** The paired-host list home draws, and every read that may change it. */
export function useHomeHostCatalog(router: ReturnType<typeof useRouter>) {
  const [hostCatalog, setHostCatalogState] = useState<HostCatalogEntry[]>([])
  // Why: `[]` before the first read finishes is "not known yet", not "no hosts".
  const [hostCatalogLoaded, setHostCatalogLoaded] = useState(false)
  // Why apart from `loaded`: a read that rejected or passed its cap ends the wait
  // too, but with no answer. Only a list that lands clears it.
  const [hostCatalogFailed, setHostCatalogFailed] = useState(false)
  // The list as last applied, for a removal that finishes after later renders.
  const catalogRef = useRef<HostCatalogEntry[]>([])
  const onboardingCheckedRef = useRef(false)
  const membershipReadRef = useRef<number | null>(null)
  const passRef = useRef<FocusPass | null>(null)
  const [catalogSequence] = useState(createHomeCatalogSequence)

  const show = useCallback((catalog: HostCatalogEntry[]) => {
    catalogRef.current = catalog
    setHostCatalogState(catalog)
    setHostCatalogLoaded(true)
    setHostCatalogFailed(false)
  }, [])

  // A list this screen produced itself (the list after a removal): it supersedes
  // any read still in flight, and it is already current, so a membership change
  // it caused must not send the next return to home back to loading.
  const setHostCatalog = useCallback(
    (catalog: HostCatalogEntry[]) => {
      catalogSequence.localChange(catalog.length)
      membershipReadRef.current = getHostMembershipRevision()
      show(catalog)
    },
    [catalogSequence, show]
  )

  // A committed removal, applied without a read: the list on screen minus that
  // desktop. Removing the only one leaves [], which is a known answer ("none"),
  // not a failed read.
  const dropHostLocally = useCallback(
    (hostId: string) => {
      setHostCatalog(catalogRef.current.filter((host) => host.id !== hostId))
    },
    [setHostCatalog]
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
    show(catalog)
  }, [catalogSequence, show])

  const readCatalog = useCallback(
    (pass: FocusPass, retry: boolean): Promise<void> => {
      const readNo = catalogSequence.start()
      return readHomeCatalog({
        load: loadHostCatalog,
        capMs: HOME_CATALOG_READ_CAP_MS,
        isStale: () => pass.stale,
        readBefore: catalogSequence.hasAnswer(),
        retry,
        keptList: catalogSequence.drawingHosts(),
        abandonLoad: dropSharedHostListLoad,
        // Why not the pairing screen: a Keychain that is locked or failing says
        // nothing about what is paired. Home says the list could not be read and
        // offers Retry; a list already drawn stays. A read older than what is on
        // screen failing changes nothing.
        onReadFailed: () => {
          if (catalogSequence.superseded(readNo)) {
            return
          }
          setHostCatalogLoaded(true)
          setHostCatalogFailed(true)
        },
        warn: (message, detail) => console.warn(message, detail),
        onCatalog: async (catalog) => {
          if (!catalogSequence.accept(readNo, catalog.length)) {
            return
          }
          show(catalog)
          if (catalog.length === 0 || onboardingCheckedRef.current) {
            return
          }
          onboardingCheckedRef.current = true
          const steps = await loadMobileOnboardingSteps()
          if (!pass.stale && steps.length > 0) {
            router.replace(mobileOnboardingDestination(steps))
          }
        }
      })
    },
    [catalogSequence, router, show]
  )

  /** Starts this focus's read; the returned cleanup marks it stale. */
  const beginFocusRead = useCallback((): (() => void) => {
    // Why: pairing the first desktop, or removing the last, happens on other
    // screens. Home stays mounted underneath, so on return it would still draw
    // the answer it read before. A membership change since that read makes the
    // old answer untrue in either direction, so hide it until the store is re-read.
    const membership = getHostMembershipRevision()
    if (membershipReadRef.current !== null && membershipReadRef.current !== membership) {
      setHostCatalogLoaded(false)
    }
    membershipReadRef.current = membership
    const pass: FocusPass = { stale: false }
    passRef.current = pass
    void readCatalog(pass, false)
    return () => {
      pass.stale = true
    }
  }, [readCatalog])

  /** Retry from the failed-read body: the same bounded read, under this focus. */
  const retryHostCatalog = useCallback(async (): Promise<void> => {
    const pass = passRef.current
    if (!pass || pass.stale) {
      return
    }
    await readCatalog(pass, true)
  }, [readCatalog])

  return {
    beginFocusRead,
    dropHostLocally,
    hostCatalog,
    hostCatalogFailed,
    hostCatalogLoaded,
    recheckHostCatalog,
    retryHostCatalog,
    setHostCatalog
  }
}
