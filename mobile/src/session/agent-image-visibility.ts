import { useEffect, useSyncExternalStore } from 'react'

/**
 * Which pictures an agent read or sent have a slot on screen now.
 *
 * The host is asked for such a picture only while its slot is mounted
 * (use-host-image-previews.ts). A long session reads dozens of screenshots,
 * and asking for every one the moment the transcript loads pulled each across
 * the relay as base64, most of them scrolled far out of view and never looked
 * at. The chat list mounts a row only when it comes near the viewport, so a
 * slot that has mounted is one the user can scroll to without waiting.
 *
 * Counted per path: one file can hold a slot in two rows, and the picture
 * stays wanted until the last of them is gone. Keyed by path alone, as the
 * slot knows no host; the hook asks its own host.
 */

const shownCount = new Map<string, number>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

/** Marks a slot for `path` as on screen; the returned function takes it off. */
export function showAgentImage(path: string): () => void {
  const before = shownCount.get(path) ?? 0
  shownCount.set(path, before + 1)
  if (before === 0) {
    changed()
  }
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    const now = (shownCount.get(path) ?? 1) - 1
    if (now <= 0) {
      shownCount.delete(path)
      changed()
    } else {
      shownCount.set(path, now)
    }
  }
}

export function isAgentImageShown(path: string): boolean {
  return (shownCount.get(path) ?? 0) > 0
}

export function subscribeAgentImagesShown(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Changes whenever a path gains its first slot or loses its last. */
export function agentImagesShownVersion(): number {
  return version
}

/** For the hook that asks the host: re-run when what is on screen changes. */
export function useAgentImagesShownVersion(): number {
  return useSyncExternalStore(subscribeAgentImagesShown, agentImagesShownVersion, agentImagesShownVersion)
}

/** A slot for `path` is mounted: the host may be asked for it. */
export function useShowAgentImage(path: string | undefined): void {
  useEffect(() => (path ? showAgentImage(path) : undefined), [path])
}

export function resetAgentImagesShownForTests(): void {
  shownCount.clear()
  changed()
}
