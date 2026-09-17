# App updates on Android (background download, silent install)

Shipped 2026-09-12 in 0.5.7. Code UI is sideloaded from GitHub Releases,
so it carries its own updater. The goal set by the user: an update should
behave like a system software update — noticed without opening the app,
downloaded in the background, and installed even if the app is closed
mid-way, with no confirmation tap where Android allows it.

## The pieces

1. **Foreground check** (`src/app-update/app-update-store.ts`, unchanged):
   Home focus and every return to the foreground poll GitHub Releases,
   throttled to 30 minutes. A newer `mobile-android-v*` tag shows the
   update dialog with release notes.

2. **Background check** (`src/app-update/background-update-check.ts`):
   an `expo-background-task` job on WorkManager, hourly floor, that runs the
   same check with the app closed and posts one local notification per
   version ("Code UI 0.5.7 is available"). A tap opens Home, where the
   dialog is already showing. On by default; toggle in About → "Check for
   updates in the background". It does not download: the APK is ~170 MB
   and the person should choose when that moves.

3. **Background download, then ask** (`packages/expo-apk-updater`, a local
   Kotlin Expo module): "Update now" hands the APK URL to Android's
   `DownloadManager`. The system carries the transfer, shows a progress-only
   notification, and finishes it whether or not the app is alive. A
   manifest `BroadcastReceiver` for `ACTION_DOWNLOAD_COMPLETE` — delivered
   to a dead process too — records "downloaded" and posts Code UI's own
   notification, "Code UI 0.5.9 downloaded — tap to install". It does not
   install on its own: the user asked to be asked ("when I open the app it
   should ask to install that downloaded update"), and an install restarts
   the app, which must not happen under someone's thumb.

   On the next open (or the notification tap) the dialog reads the stored
   phase and shows "Update downloaded — Install". Install commits a
   `PackageInstaller` session on the file. With
   `UPDATE_PACKAGES_WITHOUT_USER_ACTION` declared and the session marked
   `USER_ACTION_NOT_REQUIRED`, Android 12+ installs an app that is
   **updating itself** with no confirmation sheet (AOSP
   `PackageInstaller.SessionParams.setRequireUserAction` javadoc lists
   "Updating itself" as qualifying; same signing key — CI's keystore — and
   targetSdk 36). The process is then replaced by the new build. When the
   system still wants a tap (`STATUS_PENDING_USER_ACTION`), the Intent it
   hands back is launched right there. State that must outlive the process
   (download id, file, phase) lives in SharedPreferences (`UpdaterStore.kt`);
   a successful install deletes the file and clears it.

Without the native module (iOS, tests, older shells) the store falls back
to the in-process download and `ACTION_VIEW` installer it used before.

## The dialog

Rebuilt 2026-09-17 to a UIAlertController spec, by way of BitChord's
`UpdateAvailableDialog.kt`. The machinery above is untouched; this is
presentation (`src/app-update/AppUpdateDialog.tsx`, `AppUpdateDialogBody.tsx`,
`AppUpdateReleaseNotes.tsx`, and the reusable card in `src/ui/alert/`).

- A fixed 270-wide card with a 14 corner, never full-bleed, on a flat black
  28% scrim in both schemes (`alertScrim`). The card is a translucent
  material (`alertMaterial`, the panel colour at 94%); there is no backdrop
  blur, because React Native core has none and `expo-blur` on Android is
  a new native dependency with its own jank. Text contrast is proven against
  the composite of material over scrim over page, light AND dark, in
  `mobile-theme-contrast.test.ts`.
- Actions are full-width 44 rows under the message, separated by hairlines
  (`AlertActionRow`). The preferred action is semibold; the way out is last.
  A row highlights the moment it is pressed and clears on drag-away.
- Tapping the scrim, and hardware back, is "Later" wherever the card has a
  Later / Not now / Done / OK row. Both do nothing while checking or
  installing, and nothing on "Update downloaded", where Later throws the
  downloaded APK away. The copy of "You're up to date" (Done) and "Could not
  check for updates" (OK), the two states About → Check for updates shows,
  is the copy that shipped before the rebuild, pinned in the test.
- The card is never taller than the screen (`maxHeight: '100%'`); the notes
  or a long failure message scroll in a region capped at 220 that also
  shrinks first, so the rows stay reachable at any font size. Rows have a
  minimum height of 44 and grow with the label.
- The release body renders as **markdown** through `MobileMarkdown`, the
  renderer the .md tab and the chat use, in a scroller capped at 220.
  `release-notes-markdown.ts` reshapes it first: headings become bold lines,
  the "by @user in <PR>" tails go, "**Full Changelog**" becomes a short
  link, and a bare "Release x.y.z" bump line is dropped.
- Motion: the card materialises on a critically damped spring (Apple's
  default UI spring, damping ratio 1, response 0.35 s), scale 1.1 → 1 and
  opacity on the same value, native driver. Under reduced motion it
  cross-fades in 160 ms with no scale. **There is no exit animation**, on
  purpose: a card fading out over the About list was recorded reading as a
  press on the row beneath it (Galaxy S23, 0.3.2), and animated opacity on
  a window-filling view let a held press fall through the Modal (0.3.0).
  Both are pinned in `use-app-update-touch-shield.test.ts`.

Not yet verified on a device: the new card has only been exercised under
vitest. Check on the S23 in both appearance settings before tagging.

## Verified

- `phaseFromUpdaterState` and `planBackgroundUpdateCheck` are unit-tested;
  the store test pins that a Check for updates tap overrides Later.
- Galaxy S23 (Android 16), 2026-09-12, 0.5.11 → 0.5.12 with "Deliver
  while the app is closed" switched off so the process could actually die:
  Update now, HOME, `am kill` (pid gone), DownloadManager job 4850 finished
  6 s later, `ActivityManager: Start proc … for broadcast
  ApkDownloadReceiver` — Android cold-started the app just to deliver the
  completion — notification "Code UI 0.5.12 downloaded — Tap to install"
  posted, version still 0.5.11. Tapping the notification opened the app on
  "Update downloaded — Install"; Install: `PackageInstallerSession: Session
  installed`, no confirmation sheet, app back on 0.5.12, notification and
  file gone.
- Earlier the same day, 0.5.7 → 0.5.8 proved the silent self-update
  itself (that build still installed on completion).
- With the background-delivery foreground service ON, the process never
  dies on a swipe, so the receiver runs in the live process; same outcome.

## Not done

- No Wi‑Fi-only gate on the download; DownloadManager's default allows
  mobile data. Add `setAllowedOverMetered(false)` if that becomes a cost.
- The confirmation Intent for the non-silent path does not survive a
  process death; the dialog re-commits the session instead.
- `am force-stop` (not a swipe) puts the app in the stopped state, where
  the completion broadcast is not delivered; the download still finishes,
  and the next open would need the poller to notice `STATUS_SUCCESSFUL`
  itself. Not handled; no normal user gesture does this.
