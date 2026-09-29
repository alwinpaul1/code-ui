import { useEffect, useState } from 'react'
import { loadHostCatalog } from './host-store'

// Why 1 s: the Keychain pass is 50-200 ms per host, so a healthy phone settles
// well inside this. A slow or stuck one must not hold the native splash open;
// after the cap the home screen shows its own blank loading body instead.
export const HOST_CATALOG_SPLASH_CAP_MS = 1000

export function shouldHideSplash(ready: {
  layoutReady: boolean
  fontsReady: boolean
  catalogReady: boolean
}): boolean {
  return ready.layoutReady && ready.fontsReady && ready.catalogReady
}

// Starts the first host-catalog read in the root, before home mounts. Home's own
// loadHostCatalog() joins the same in-flight pass (shareHostListLoad), so this
// costs no extra Keychain work. Ready when the read settles, whether it
// succeeded or not (home logs a failure itself), or when the cap passes.
export function useHostCatalogWarmup(capMs: number = HOST_CATALOG_SPLASH_CAP_MS): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let disposed = false
    const finish = () => {
      if (!disposed) {
        setReady(true)
      }
    }
    const timer = setTimeout(finish, capMs)
    // Deliberately no logging here: the read's rejection is home's to report.
    loadHostCatalog().then(finish, finish)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [capMs])
  return ready
}
