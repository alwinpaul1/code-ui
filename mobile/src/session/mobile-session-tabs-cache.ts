import type { MobileSessionTab } from './mobile-session-route-types'
import { createPersistedMap } from './session-cache-persistence'

// Why: the session screen starts every project visit with an empty tab list
// and a "Loading tabs" spinner until the host answers. Remembering the last
// accepted tabs per project — in memory and on disk — lets a revisit or a cold
// start paint the strip and the last tab at once; the next snapshot replaces it.

const store = createPersistedMap<MobileSessionTab[]>({
  storageKey: 'codeui:session-tabs-cache',
  maxEntries: 12
})

export function sessionTabsCacheKey(hostId: string, worktreeId: string): string {
  return `${hostId}\0${worktreeId}`
}

export function readCachedSessionTabs(key: string): MobileSessionTab[] {
  return store.get(key) ?? []
}

export function writeCachedSessionTabs(key: string, tabs: MobileSessionTab[]): void {
  store.set(key, tabs)
}

/** The tab a seeded strip should open on: the last accepted active tab, else the first. */
export function pickCachedActiveSessionTab(
  tabs: readonly MobileSessionTab[]
): MobileSessionTab | null {
  return tabs.find((tab) => tab.isActive) ?? tabs[0] ?? null
}

export function hydrateSessionTabsCache(): Promise<void> {
  return store.hydrate()
}

export function resetSessionTabsCacheForTests(): void {
  store.reset()
}
