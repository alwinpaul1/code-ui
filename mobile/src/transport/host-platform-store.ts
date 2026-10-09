import { useSyncExternalStore } from 'react'

/**
 * The platform each host said it runs on (`status.get`'s `hostPlatform`), by
 * host id, for readers that are not on the capability probe's path.
 *
 * Memory only: a host does not change platform, and until its first probe of
 * this run answers the platform is unknown (null), which every reader must
 * treat as "may be any", never as "not Windows" (a failed `status.get` once
 * read that way and put a beacon flag on a Windows host, 2026-09-25).
 */
const platforms = new Map<string, NodeJS.Platform>()
const listeners = new Set<() => void>()

/** Record what the host's status said; an unknown platform changes nothing. */
export function noteHostPlatform(hostId: string, platform: NodeJS.Platform | null): void {
  if (platform === null || platforms.get(hostId) === platform) {
    return
  }
  platforms.set(hostId, platform)
  for (const listener of listeners) {
    listener()
  }
}

export function getHostPlatform(hostId: string): NodeJS.Platform | null {
  return platforms.get(hostId) ?? null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHostPlatform(hostId: string): NodeJS.Platform | null {
  return useSyncExternalStore(subscribe, () => getHostPlatform(hostId))
}

export function resetHostPlatformsForTests(): void {
  platforms.clear()
  listeners.clear()
}
