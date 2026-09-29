export type HomeRemovalTarget = { id: string; name: string }

export type HomeHostRemovalDeps = {
  /** The durable removal: the store write, then the host's client is closed. */
  remove: (hostId: string) => Promise<void>
  /** Takes the removed desktop off the list on screen, without a read. */
  dropLocally: (hostId: string) => void
  /** Re-reads the store and applies it unless something newer already landed. */
  reread: () => Promise<void>
  setConfirm: (host: HomeRemovalTarget | null) => void
  alert: (title: string, message: string) => void
  warn: (message: string, detail?: unknown) => void
}

// Why two steps with their own failures: the removal and the read after it used
// to share one try, so a Keychain that failed the READ after a committed removal
// said "Could not remove host", put the Remove Host sheet back over a desktop that
// was already gone, and left it listed. Only the removal failing means the host is
// still there. Once it has committed, the list drops the host at once, and the
// re-read only freshens what is left.
export async function removeHomeHost(
  host: HomeRemovalTarget,
  deps: HomeHostRemovalDeps
): Promise<void> {
  try {
    await deps.remove(host.id)
  } catch (error) {
    deps.warn(`[home] removing host ${host.id} failed`, error)
    deps.setConfirm(host)
    deps.alert('Could not remove host', 'Please try again.')
    return
  }
  deps.setConfirm(null)
  deps.dropLocally(host.id)
  try {
    await deps.reread()
  } catch (error) {
    deps.warn(
      `[home] host ${host.id} was removed, but the catalog re-read after it failed; the list drops it without a fresh read`,
      error
    )
  }
}
