# Background notification delivery (Android)

Verified 2026-09-09 against a Galaxy S23 (SM-S918B, Android 16) paired to
Orca 1.4.197 over the relay. Nothing here touches the desktop: the host is
stock Orca, the agents are stock Claude Code and Codex.

## The problem

Agent notifications ("needs your input", "finished") reach the phone over
the same encrypted RPC connection the app uses for everything else. That
connection lived inside the React tree:

- 30 s after the app went to the background the relay was suspended
  (`mobile-relay-background-grace.ts`), so nothing arrived until the app was
  reopened and the catch-up RPC replayed what was missed.
- Swiping the app out of Recents tore the tree down, closing the connection
  outright.

Real push (FCM) would need a sender that knows a task finished. Only the
desktop knows that, and changing the desktop is out of scope by design, so
the phone has to keep its own link open.

## What ships

On whenever **Settings → Notifications → Agent notifications** is on
(Android only). Until 0.5.14 it sat behind its own switch, off by default;
the user's call on 2026-09-12 was that a notification reaching a closed app
is what the feature is, so the switch is gone and delivery rides on agent
notifications alone.

1. **`@codeui/expo-background-link`** (`mobile/packages/expo-background-link`),
   a local Kotlin Expo module. `BackgroundLinkService` is a
   `HeadlessJsTaskService` running as a foreground service of type
   `remoteMessaging` with `stopWithTask="false"`. It posts one silent,
   ongoing row on a `background-link` channel (IMPORTANCE_LOW) and starts
   the headless task `CodeUIBackgroundLink`.
   - Why a headless task and not a plain service: React Native pauses every
     JS timer while no Activity is resumed unless a headless task is active.
     The socket would stay open but keepalive probes, request timeouts and
     reconnects would freeze.
   - Why `remoteMessaging`: it carries no daily time budget on Android 15+,
     unlike `dataSync`. Android 14+ requires the matching
     `FOREGROUND_SERVICE_REMOTE_MESSAGING` permission, declared in the
     module manifest.
   - The service is only ever started from the foreground (launch, or the
     toggle). Android 12+ refuses foreground-service starts from the
     background.
2. **`src/background/background-notification-watcher.ts`**, a module-level
   singleton that owns the host connections while the UI is not on screen
   (`enabled && !uiVisible`). A host has exactly one client. The watcher
   borrows the one the screen holds (or the one parked when Recents destroyed
   the screen), whatever its state, and nudges it when it is not connected
   instead of dialling beside it. Only a host with no client, or with a dead
   parked one that nobody holds (closed first), gets a client of the
   watcher's own, opened with
   `openHostLogicalClient(host, log, { backgroundLink: true })` — a mode that
   never suspends the relay and never probes for a direct return. It
   subscribes to desktop notifications once connected. If the client it
   borrowed is closed or replaced by its holder (a Recents swipe closes an
   entry that is down rather than parking it), `live-host-clients` says so
   and the watcher listens on whatever the host has next, dialling its own
   when there is nothing. When the UI comes
   back, a borrowed client is only unsubscribed. An own client that is still
   alive is parked in `live-host-clients` for the screen to take back, unless
   the screen already holds a client for that host, in which case it is
   closed; a dead one is closed. (Publishing it regardless, as the watcher
   did until 2026-09-27, orphaned one client per hide/show while the screen's
   client was reconnecting: three clients, three reconnect loops and three
   "Authenticated" lines for one desktop on a Pixel.) Switching delivery off
   closes every client the watcher owns.
3. **`index.ts`** is the app entry (`main` in `package.json`). It registers
   the headless task before `expo-router/entry`, because in a headless start
   nothing under `app/` is rendered and a registration in a route module
   would never run.

## Related transport changes in the same release

- Relay idle probe every 30 s (`RELAY_IDLE_PROBE_MS`), two misses = dead.
  The relay previously sent nothing while idle, so a half-open socket was
  invisible until the next foreground. This also keeps the NAT mapping
  alive for the background link.
- A request on a relay session that already failed rejects at once instead
  of waiting out the 30 s timer; `failWhenDisconnected` is honoured on the
  relay path as it always was on the direct path.
- Live input: bytes queued in the same tick share one `terminal.send`, so
  Enter after typed text costs one relay round trip, not two. A control
  frame is skipped when the text frame before it was refused.
- Direct-return probes skip private-LAN addresses while on cellular
  (`directEndpointsPlausibleOnNetwork`).

## Known limits

- Samsung "sleeping apps" / battery optimisation can still stop a foreground
  service; the user can exempt Code UI in Android settings.
- iOS has no equivalent; nothing runs there.
- The persistent row is the price: Android shows it whenever the service
  runs. Turning agent notifications off removes it.

## 2026-09-09: "notifications arrive when I open the app", and delays

Reported on the S23 with "Deliver while the app is closed" on. Checked on the
device: the foreground service was running (`isForeground=true`), the app was
**not** on the battery-optimisation allowlist (`dumpsys deviceidle whitelist`
had no entry), and adaptive battery was enabled.

**Cause.** Doze suspends the app's network access and ignores its wake locks
for every app that is still under battery optimisation. A foreground service
does not lift that; only the exemption does ("Unrestricted" in the app's
battery settings). With the phone idle the relay socket goes silent, nothing
reaches the phone until a Doze maintenance window or the next screen-on, and
the UI's reconnect catch-up (`notifications.getMissedSince`) then delivers the
backlog a few seconds after the app opens. Shorter delays come from the same
mechanism at the edge of Doze, plus the ~40 s it takes the relay liveness
probe (30 s idle, 2 × 4 s missed) to notice a dead socket and reconnect.

**Fix (0.2.85).** The background-link module gained
`isIgnoringBatteryOptimizations` / `requestIgnoreBatteryOptimizations`
(`Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, falling back to the
optimisation list), with `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` declared. The
Notifications screen asks for the exemption the moment background delivery is
switched on and, while it is missing, shows an "Allow unrestricted battery
use" row explaining why. `adviseBackgroundDeliveryPower` decides both.

Not verified on the device yet: the phone was unplugged while this shipped.
To verify: switch the row off/on, grant the dialog, check
`dumpsys deviceidle whitelist | grep codeui`, then leave the phone idle for
30+ minutes with an agent running and confirm the notification arrives before
the screen is touched. Samsung "Sleeping apps" is a separate list; the
exemption normally keeps the app out of it, but check there if it recurs.
