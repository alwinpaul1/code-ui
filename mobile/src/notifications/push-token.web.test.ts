import { describe, expect, it } from 'vitest'
import { acquirePushToken } from './push-token.web'

/**
 * The page's own reader, imported directly by its `.web` path: the default resolver in this suite's
 * `node` environment has no `.web` precedence, so the plain specifier `./push-token` would land on
 * the native sibling, which imports `expo-notifications` — a package whose
 * `DevicePushTokenAutoRegistration.fx` reads `window.localStorage` at import behind a
 * `typeof localStorage === 'undefined'` guard. The shell's WebView has DOM storage off, where
 * `localStorage` is `null` rather than `undefined`, so that guard passes and the read raises
 * `Cannot read properties of null (reading 'getItem')` on every page load. The import is the
 * defect, not the call underneath it, which was already inert on the page: the token is the
 * shell's, and the gateway has no page client to register one against.
 */
describe('the page holds no device push token', () => {
  it('answers the same shape acquirePushToken uses off Android, without touching expo-notifications', async () => {
    await expect(acquirePushToken()).resolves.toEqual({
      ok: false,
      reason: 'unsupported-platform'
    })
  })
})
