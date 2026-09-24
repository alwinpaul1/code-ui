import { describe, expect, it, vi } from 'vitest'

const removeHostMock = vi.hoisted(() => vi.fn())
const forgetNotificationSessionMock = vi.hoisted(() => vi.fn())
const clearWatermarkMock = vi.hoisted(() => vi.fn())
const clearDeliveredPushesMock = vi.hoisted(() => vi.fn())
const forgetPushRegistrationOutcomeMock = vi.hoisted(() => vi.fn())

vi.mock('./host-store', () => ({ removeHost: removeHostMock }))
vi.mock('../notifications/notification-reconnect-catchup', () => ({
  forgetHostNotificationSession: forgetNotificationSessionMock,
  clearWatermark: clearWatermarkMock
}))
vi.mock('../notifications/push-delivery-log', () => ({
  clearDeliveredPushes: clearDeliveredPushesMock
}))
vi.mock('../notifications/push-registration-outcome', () => ({
  forgetPushRegistrationOutcome: forgetPushRegistrationOutcomeMock
}))

import { removeHostAndCloseClient } from './host-removal-lifecycle.web'
import {
  PAGE_HOST_REMOVAL_UNAVAILABLE_CODE,
  isPageHostRemovalUnavailable
} from './page-host-removal-refusal'

describe('removing a host from the page', () => {
  it('refuses with a code the screen can branch on', async () => {
    const error = await removeHostAndCloseClient('host-1', vi.fn()).catch(
      (reason: unknown) => reason
    )
    expect(isPageHostRemovalUnavailable(error)).toBe(true)
    expect({
      name: error instanceof Error ? error.name : null,
      code: isPageHostRemovalUnavailable(error) ? error.code : null
    }).toEqual({
      name: 'PageHostRemovalUnavailableError',
      code: PAGE_HOST_REMOVAL_UNAVAILABLE_CODE
    })
  })

  it('says where removal does work, rather than asking for a retry that cannot succeed', async () => {
    await expect(removeHostAndCloseClient('host-1', vi.fn())).rejects.toThrow(
      'Remove this host from the host list in the Orca app.'
    )
  })

  it('touches no store, no notification bookkeeping and no client', async () => {
    // The page storage adapter drops writes and reports it, and there is no credential here to
    // drop from a keychain: the refusal is what keeps any of this from being attempted at all.
    const forgetHostClient = vi.fn()
    await removeHostAndCloseClient('host-1', forgetHostClient).catch(() => {})
    expect({
      removeHost: removeHostMock.mock.calls.length,
      forgetNotificationSession: forgetNotificationSessionMock.mock.calls.length,
      clearWatermark: clearWatermarkMock.mock.calls.length,
      clearDeliveredPushes: clearDeliveredPushesMock.mock.calls.length,
      forgetPushRegistrationOutcome: forgetPushRegistrationOutcomeMock.mock.calls.length,
      forgetHostClient: forgetHostClient.mock.calls.length
    }).toEqual({
      removeHost: 0,
      forgetNotificationSession: 0,
      clearWatermark: 0,
      clearDeliveredPushes: 0,
      forgetPushRegistrationOutcome: 0,
      forgetHostClient: 0
    })
  })
})
