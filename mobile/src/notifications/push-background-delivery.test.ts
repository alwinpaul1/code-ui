import { beforeEach, describe, expect, it, vi } from 'vitest'

const shown: unknown[] = []
const dismissed: unknown[] = []
let showFails = false

vi.mock('./local-notification-scheduling', () => ({
  showLocalNotification: vi.fn(async (event: unknown, hostId: string) => {
    if (showFails) {
      throw new Error('scheduling refused')
    }
    shown.push({ event, hostId })
  }),
  dismissLocalNotification: vi.fn(async (event: unknown, hostId: string) => {
    dismissed.push({ event, hostId })
  }),
  configureNotificationChannel: vi.fn()
}))

const recorded: unknown[] = []
vi.mock('./push-delivery-log', () => ({
  recordDeliveredPush: vi.fn(async (hostId: string, entry: unknown) => {
    recorded.push({ hostId, entry })
  })
}))

const { handlePushDelivery } = await import('./push-background-delivery')

const NOTIFICATION = {
  t: 'notification',
  hostId: 'host-a',
  source: 'agent-task-complete',
  title: 'Claude',
  body: 'Finished',
  notificationId: 'n-7',
  notificationSeq: '7',
  notificationEpoch: 'epoch-1'
}

/**
 * This runs with no app on screen and, when the app was killed, in a headless JS
 * context. Anything it throws is an unhandled rejection nobody sees, and the
 * banner the user was waiting for never appears.
 *
 * The envelope Android wraps the payload in has NOT been observed on a device
 * here, because that needs a Firebase project this build does not yet have.
 * Several plausible shapes are accepted for that reason; when a real one is
 * seen, pin it and delete the rest.
 */
describe('showing a notification a push delivered while the app was closed', () => {
  beforeEach(() => {
    shown.length = 0
    dismissed.length = 0
    recorded.length = 0
    showFails = false
  })

  it.each([
    ['the bare data map', NOTIFICATION],
    ['wrapped in data', { data: NOTIFICATION }],
    ['wrapped in a notification', { notification: { data: NOTIFICATION } }],
    [
      'wrapped in a notification request',
      { notification: { request: { content: { data: NOTIFICATION } } } }
    ]
  ])('renders a push delivered as %s', async (_label, envelope) => {
    await handlePushDelivery(envelope)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      hostId: 'host-a',
      event: { type: 'notification', body: 'Finished', notificationSeq: 7 }
    })
  })

  it('records the delivery so the next catch-up does not replay it', async () => {
    await handlePushDelivery(NOTIFICATION)
    expect(recorded).toEqual([
      {
        hostId: 'host-a',
        entry: { notificationId: 'n-7', notificationEpoch: 'epoch-1', notificationSeq: 7 }
      }
    ])
  })

  // Why not record: the record's whole meaning is "the reader has seen this". A
  // banner that never rendered has not been seen, and claiming it would make the
  // catch-up suppress the one replay that could still deliver it.
  it('does not claim delivery for a banner that failed to render', async () => {
    showFails = true
    await expect(handlePushDelivery(NOTIFICATION)).resolves.toBeUndefined()
    expect(recorded).toEqual([])
  })

  it('applies a dismiss', async () => {
    await handlePushDelivery({
      t: 'dismiss',
      hostId: 'host-a',
      notificationId: 'n-7',
      notificationEpoch: 'epoch-1',
      notificationSeq: '8'
    })
    expect(dismissed).toHaveLength(1)
    // A dismiss retires a banner; it never showed one, so there is nothing to
    // suppress on the next catch-up.
    expect(recorded).toEqual([])
  })

  // Failure path. Every one of these is a real possibility on a transport the
  // fork does not control, and none may throw out of the task.
  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['an error envelope from the task runner', { error: new Error('task failed') }],
    ['a payload with no host', { t: 'notification', title: 'a', body: 'b' }],
    ['a payload of the wrong shape', { hello: 'world' }]
  ])('stays quiet for %s', async (_label, envelope) => {
    await expect(handlePushDelivery(envelope)).resolves.toBeUndefined()
    expect(shown).toEqual([])
    expect(dismissed).toEqual([])
  })
})
