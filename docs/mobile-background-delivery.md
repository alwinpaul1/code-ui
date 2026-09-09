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

Behind **Settings → Notifications → "Deliver while the app is closed"**
(off by default, Android only):

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
   (`enabled && !uiVisible`). It opens one client per paired host with
   `openHostLogicalClient(host, log, { backgroundLink: true })` — a mode that
   never suspends the relay and never probes for a direct return — and
   subscribes to desktop notifications once connected. When the UI comes
   back it closes everything; the UI's own reconnect catch-up covers the
   seam.
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
- iOS has no equivalent. The toggle is hidden there.
- The persistent row is the price: Android shows it whenever the service
  runs. Turning the toggle off removes it.
