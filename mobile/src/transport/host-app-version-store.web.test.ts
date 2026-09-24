import { describe, expect, it } from 'vitest'
import { loadHostAppVersion, recordHostAppVersion } from './host-app-version-store.web'

/**
 * The page's own store, imported directly by its `.web` path: the default resolver in this suite's
 * `node` environment has no `.web` precedence, so the plain specifier `./host-app-version-store`
 * would land on the native sibling and never exercise this one.
 *
 * `host-status-gates.ts` runs above every page route and calls `recordHostAppVersion` on every
 * readable `status.get`. Before this file existed that reached the real `AsyncStorage`-backed
 * store, which the page's bridge storage adapter refuses (the key is not on `page-storage-keys.ts`'s
 * allowlist) and logs as `storage-write-dropped` on every mount. Nothing in the page reads a host's
 * app version back — the only reader is the native troubleshoot screen — so this sibling keeps no
 * record at all rather than losing a fight with the storage seam.
 */
describe('the page keeps no host app-version record', () => {
  it('answers null for a version nothing here ever stored', async () => {
    await expect(loadHostAppVersion('host-1')).resolves.toBeNull()
  })

  it('resolves a write without throwing and without a value to read back', async () => {
    await expect(recordHostAppVersion('host-1', '1.4.210')).resolves.toBeUndefined()
    await expect(loadHostAppVersion('host-1')).resolves.toBeNull()
  })
})
