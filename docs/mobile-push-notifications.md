# Remote push notifications

Verified 2026-09-17 against Code UI 0.6.6 and the vendored Orca RPC contract.

Today a notification reaches a closed app through the foreground service in
`mobile/packages/expo-background-link` (see `mobile-background-delivery.md`).
That works while the process lives, and the failure people actually report is an
OEM killing it anyway. Remote push is the backstop for that case: the system,
not our process, wakes the app.

The phone half is built. The sender does not exist and cannot be built from this
repo alone — read "What is missing" before assuming push is one config file away.

## What is built

| File | Does |
| --- | --- |
| `push-token.ts` | `acquirePushToken()` — the FCM device token, or a named reason. Android only. |
| `push-payload.ts` | `parsePushPayload()` — an FCM data map into the event the local path renders. |
| `push-background-delivery.ts` | `handlePushDelivery()` — renders a push through `showLocalNotification`. |
| `push-background-task.ts` | Defines the task at bundle load, so a killed app has it when the push lands. |
| `push-delivery-log.ts` | Remembers what a push already showed, so the next catch-up does not replay it. |
| `push-registration.ts` + `-operations.ts` | `notifications.registerPush`, through a typed `RpcOperation`. |
| `push-offer.ts` | Offers the token on connect, behind a preference that is off by default. |

Three things are worth knowing before changing any of it.

**A push renders through `showLocalNotification`, not its own banner.** That path
already owns one banner per session, the routing data a tap needs, the
markdown-table flattening and the superseded-dismiss guard. A second renderer
would have to relearn all of it and would drift the first time only one of the
two was fixed.

**The catch-up never awaits storage.** `fetchMissed` reads the delivered-push
list from memory (`cachedDeliveredPushes`) and the list is warmed at subscribe
time. An `await` there was written first and `notification-watermark-seed-race`
caught it: a held AsyncStorage read parks the catch-up behind it, which is the
same hang `WATERMARK_SEED_TIMEOUT_MS` exists to prevent. A cold open can miss one
report and repeat one banner; it can never delay the catch-up.

**Nothing is pruned on a successful catch-up.** The contract says the desktop
cuts by `lastSeenSeq`; it does not say what it does with `deliveredPushes`.
Entries the seq cut already covers are filtered at request time, which is
provable, and the rest age out against the 256 cap. Removal clears a host's list.

## What is missing

**A Firebase project.** `mobile/google-services.json` does not exist, so
`getDevicePushTokenAsync()` throws and `acquirePushToken` reports
`no-firebase-config`. Do NOT add `android.googleServicesFile` to `app.json`
before the file exists — `expo prebuild` fails hard on a path it cannot read, and
that breaks the build for everyone.

**A sender.** This is the real blocker, and no amount of phone-side work removes it.

`notifications.registerPush` hands the token to the push gateway the desktop was
built against (`src/shared/mobile-push-contract.ts` points at
`cloud/packages/push-contract`). On a stock Orca desktop that is Anthropic's
gateway, holding Anthropic's FCM credentials. An FCM token is scoped to the
project that minted it, so a token from this fork's own project
(`com.alwinpaul.codeui`) is not routable by that gateway. `gateway_rejected` is
the correct answer there, not a defect.

So a sender has to be something that (a) holds a live connection to the desktop
and (b) is awake while the phone is not. The candidates:

- **Orca's gateway.** Ruled out above.
- **A service we host** — a VPS or a Worker with a Durable Object — paired to the
  desktop as if it were a phone, subscribed to `notifications.subscribe`,
  forwarding to FCM. This works. It also holds the user's pairing credentials on
  a third machine, and it puts notification bodies through FCM. That is a real
  change to what this app promises, not an implementation detail.
- **The desktop sending directly.** Ruled out by CLAUDE.md, and it would only
  work while Orca is running anyway.

**The settings row.** `loadRemotePushEnabled` / `saveRemotePushEnabled` exist and
default to false; nothing turns them on yet. `lastPushRegistrationOutcome(hostId)`
holds the reason to show. Left out on purpose while the 0.7.0 redesign is in
flight.

## Payload the sender must produce

Data-only, high priority, non-collapsible. FCM's data block is a **flat map of
strings** — `notificationSeq` crosses the wire as `"42"`.

```
t                 "notification" | "dismiss"
hostId            required; keys the banner, the route and the delivery log
source            "agent-task-complete" | "terminal-bell" | "plugin"
title, body       required for a notification
worktreeId        optional
notificationId    required for a dismiss
notificationSeq   decimal string
notificationEpoch the desktop's counter lifetime
```

Data-only rather than a `notification` payload because the app has to render it
through its own path to get the routing and dedup right. The cost is that OEMs
throttle data messages; the battery exemption the app already asks for is what
makes them land.

`unwrapPushData` accepts four envelope shapes because **none has been observed on
a device** — that needs the Firebase project above. When a real one is seen, pin
that shape and delete the others.

## Finishing it

1. `firebase login` (the user runs this; the CLI is at `/opt/homebrew/bin/firebase`).
2. Create a project, add an Android app with package `com.alwinpaul.codeui`.
3. Put `google-services.json` in `mobile/`, and ignore it in
   `$(git rev-parse --git-common-dir)/info/exclude` before staging anything.
4. Add `"googleServicesFile": "./google-services.json"` under `android` in
   `app.json`, then `expo prebuild`.
5. Send a test message from the Firebase console to the token and confirm the
   banner renders with the app swiped away. Pin the real envelope shape.
6. Then, and only then, decide whether to host a sender.
