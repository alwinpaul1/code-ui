import type { HostCatalogEntry } from '../transport/types'

// Why a cap: shareHostListLoad hands every later loadHostCatalog() the SAME
// in-flight promise, so one Keychain read that never settles would leave home
// blank for the whole session. A slow-but-honest pass is 50-200 ms per host, so
// this is generous and only a stuck read reaches it.
export const HOME_CATALOG_READ_CAP_MS = 5000

export type HomeCatalogReadDeps = {
  load: () => Promise<HostCatalogEntry[]>
  capMs: number
  isStale: () => boolean
  /** True once any earlier list was applied, so this is a re-read, not the first. */
  readBefore: boolean
  /** True when that list has hosts, which is what a failed read leaves on screen. */
  keptList: boolean
  onCatalog: (catalog: HostCatalogEntry[]) => void | Promise<void>
  /** End the loading state without a fresh list. */
  onFailOpen: () => void
  /** Retire the shared in-flight read so a later focus starts its own. */
  abandonLoad: () => void
  warn: (message: string, detail?: unknown) => void
}

function failOpenLine(keptList: boolean): string {
  return keptList ? 'keeping the list from the last read' : 'showing the pairing screen'
}

export async function readHomeCatalog(deps: HomeCatalogReadDeps): Promise<void> {
  const read = deps.load()
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.capMs)
  })
  let outcome: HostCatalogEntry[] | 'timeout'
  try {
    outcome = await Promise.race([read, capped])
  } catch (error) {
    deps.warn(
      `[home] host catalog ${deps.readBefore ? 're-read' : 'first read'} failed; ${failOpenLine(deps.keptList)}`,
      error
    )
    if (!deps.isStale()) {
      deps.onFailOpen()
    }
    return
  } finally {
    clearTimeout(timer)
  }
  if (outcome === 'timeout') {
    deps.warn(
      `[home] host catalog read timed out after ${deps.capMs} ms; ${failOpenLine(deps.keptList)}`
    )
    deps.abandonLoad()
    if (!deps.isStale()) {
      deps.onFailOpen()
    }
    // The stuck read may still land; a late answer beats a permanent guess.
    void read.then(
      (late) => (deps.isStale() ? undefined : deps.onCatalog(late)),
      () => undefined
    )
    return
  }
  if (!deps.isStale()) {
    await deps.onCatalog(outcome)
  }
}
