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
   - The service is started from the foreground (launch, a return to the
     foreground, or the toggle), because Android 12+ refuses
     foreground-service starts from the background. Two exceptions: the
     boot receiver, and the pause handler (2026-09-27, below), which both
     try anyway and swallow or log the refusal. An app with the
     battery-optimisation exemption is allowed the start.
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

## 2026-09-27: the service died seconds after every open

Reported from a Pixel on 0.9.54 (battery unrestricted): every hour overnight
the connection log said "Android paused the app — Nothing ran for 1h 0m … On
waking: background service not running".

**Cause.** The hourly wake was the WorkManager update check
(`background-update-check.ts`). expo-task-manager runs a headless JS task for
each run of it, and React Native's `HeadlessJsTaskContext.finishTask` reports
every finished task to every listener. `BackgroundLinkService` cleared its
`taskStarted` flag for any finished task, so the next open (`heal()`) started a
second `CodeUIBackgroundLink` task. The second park released the first, the
first task's `finally` then released whatever was parked (the second), both
tasks ended, and the service stopped itself with nothing left running. From
then until the next open, only the hourly check woke the app.

**Fix.**
- The service starts its own task and keeps the id `startTask` returns, and
  ignores every other task's finish. It no longer calls the base class's
  finish handler, whose task set is now empty and would stop the service on
  any id.
- Each park hands back its own release, and the task's `finally` ends only its
  own park.
- The service writes when and why it stopped (SharedPreferences, from
  `onDestroy`; the swipe time from `onTaskRemoved`), and `lastStop()` adds the
  last `ApplicationExitInfo` (Android 11+) for a process killed without
  `onDestroy`. The pause line now reads "not running (stopped at 12:53: its task
  ended)" or "(stop reason unknown)".
- When a pause is noticed with the app in the background, delivery on and the
  service dead, `app-pause-handler.ts` starts it and logs "Restarted the
  background service", or "Could not restart the background service" with
  Android's refusal.

**Known limit.** The restart only happens in a process that lived through the
pause. A process that was killed and then started fresh by WorkManager has no
pause to notice, so nothing restarts the service there until the app is
opened, unless Android restarts it itself (`START_REDELIVER_INTENT`).

**Local builds.** Gradle compiles the pnpm copy of this package under
`mobile/node_modules/.pnpm`, not `mobile/packages/`, and on 2026-09-27 the two
were no longer hardlinked. Run `pnpm install --offline` in `mobile/` after
pulling a Kotlin change, and `cmp` the two copies of `BackgroundLinkService.kt`
before building. A build without the Kotlin half still looks fixed on a quick
check, because the JS half alone stops the two tasks ending each other.
