import { describe, expect, it } from 'vitest'
import { loadBackgroundDeliveryEnabled } from './background-link-preference'

// 2026-09-12: "deliver while the app is closed must be default, and remove
// that from my phone in notifications." The switch is gone; delivery rides on
// agent notifications alone.
describe('background delivery', () => {
  it('is on without anyone flipping a switch', async () => {
    await expect(loadBackgroundDeliveryEnabled()).resolves.toBe(true)
  })
})
