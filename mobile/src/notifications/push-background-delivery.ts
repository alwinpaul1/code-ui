import { dismissLocalNotification, showLocalNotification } from './local-notification-scheduling'
import { recordDeliveredPush } from './push-delivery-log'
import { parsePushPayload } from './push-payload'

/**
 * Pull the FCM data map out of whatever the task runner wrapped it in.
 *
 * The envelope has NOT been observed on a device: that needs a Firebase project
 * this build does not have yet. Android's messaging layer, `expo-notifications`
 * and the task runner each add a level depending on the path, so the shapes
 * below are the plausible ones rather than a measured one. When a real payload
 * is seen on a device, pin that shape and delete the others — accepting four is
 * a hedge against ignorance, not a design.
 */
function unwrapPushData(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== 'object') {
    return null
  }
  const level = envelope as Record<string, unknown>
  if (typeof level.t === 'string') {
    return level
  }
  const notification = level.notification as Record<string, unknown> | undefined
  const request = notification?.request as Record<string, unknown> | undefined
  const content = request?.content as Record<string, unknown> | undefined
  return level.data ?? notification?.data ?? content?.data ?? null
}

/**
 * Render a notification a push carried, while the app may have no UI at all.
 *
 * Never throws. When the app was killed this runs in a headless JS context where
 * a rejection reaches nobody: no redbox, no log anyone reads, and no banner. The
 * only honest failure here is silence.
 *
 * It renders through `showLocalNotification` rather than drawing its own banner
 * so a push inherits everything that path already does — one banner per session,
 * the routing data a tap needs, and the table flattening. A second renderer
 * would have to relearn all of it and would drift the first time only one of the
 * two was fixed.
 */
export async function handlePushDelivery(envelope: unknown): Promise<void> {
  try {
    const parsed = parsePushPayload(unwrapPushData(envelope))
    if (!parsed) {
      return
    }
    const { hostId, event } = parsed
    if (event.type === 'dismiss') {
      await dismissLocalNotification(event, hostId)
      return
    }
    await showLocalNotification(event, hostId)
    // Why only after the show resolves: the record means "the reader has seen
    // this", and the next catch-up suppresses the replay on the strength of it.
    // Claiming a banner that never rendered turns a delayed notification into a
    // lost one.
    // All THREE, because that is what the desktop matches on. Guarding two of
    // them let a seq-less push through to be rejected inside the log, which is
    // the same outcome by a longer route and reads as if it were recorded.
    //
    // A push with no usable seq cannot be suppressed at all: `deliveredPushes`
    // entries are matched on the triple, so there is nothing to send. That is
    // the contract, not a gap in this guard — such a push comes back once as a
    // duplicate on the next catch-up.
    if (
      event.notificationId != null &&
      event.notificationEpoch != null &&
      event.notificationSeq != null
    ) {
      await recordDeliveredPush(hostId, {
        notificationId: event.notificationId,
        notificationEpoch: event.notificationEpoch,
        notificationSeq: event.notificationSeq
      })
    }
  } catch {
    // See above: there is nowhere for this to go.
  }
}
