import { beforeEach, describe, expect, it, vi } from 'vitest'

const syncs: number[] = []
let listener: ((state: string) => void) | null = null
const removed: number[] = []

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn((_event: string, handler: (state: string) => void) => {
      listener = handler
      return {
        remove: () => {
          removed.push(1)
          listener = null
        }
      }
    })
  }
}))

let syncThrows = false
vi.mock('./background-link', () => ({
  syncBackgroundLinkFromPreferences: vi.fn(async () => {
    syncs.push(1)
    if (syncThrows) {
      throw new Error('storage unavailable')
    }
    return true
  })
}))

const { startBackgroundLinkHealing } = await import('./background-link-healing')

/**
 * Opening the app did NOT bring the link back.
 *
 * `applyBackgroundDelivery` had exactly one caller — the Settings toggle — and
 * `syncBackgroundLinkFromPreferences` had one, the headless task, which only
 * runs once the service is already up. Nothing in the launch path called
 * either. `background-link.ts` even says "which is why the app calls it on
 * launch and on the toggle"; the launch half was never written.
 *
 * So once Android killed the service, the only way back was Settings →
 * Notifications → toggle off → toggle on. Nobody would guess that, and the
 * reported symptom was that notifications simply stopped for good. The boot
 * receiver covers reboots; this covers every other kill, at the moment the app
 * is in the foreground and therefore allowed to start a foreground service.
 */
describe('opening the app restores the link', () => {
  beforeEach(() => {
    syncs.length = 0
    removed.length = 0
    listener = null
    syncThrows = false
  })

  it('syncs once at startup, without waiting for a foreground event', async () => {
    startBackgroundLinkHealing()
    await Promise.resolve()
    expect(syncs).toHaveLength(1)
  })

  it('syncs again every time the app comes back to the foreground', async () => {
    startBackgroundLinkHealing()
    await Promise.resolve()
    listener?.('active')
    listener?.('active')
    await Promise.resolve()
    expect(syncs).toHaveLength(3)
  })

  // Android refuses a foreground-service start from the background, so a sync
  // on the way OUT would throw and achieve nothing.
  it.each([['background'], ['inactive'], ['unknown']])('does not sync on %s', async (state) => {
    startBackgroundLinkHealing()
    await Promise.resolve()
    syncs.length = 0
    listener?.(state)
    await Promise.resolve()
    expect(syncs).toEqual([])
  })

  // Failure path: this runs on the launch path, where a rejection is an
  // unhandled promise and, in development, a redbox over the app.
  it('does not reject when the preference cannot be read', async () => {
    syncThrows = true
    expect(() => startBackgroundLinkHealing()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('stops listening when torn down', () => {
    const stop = startBackgroundLinkHealing()
    stop()
    expect(removed).toHaveLength(1)
  })
})
