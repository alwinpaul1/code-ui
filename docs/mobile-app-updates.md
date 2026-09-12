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

## Verified

- `phaseFromUpdaterState` and `planBackgroundUpdateCheck` are unit-tested.
- 0.5.7 → 0.5.8 on a Galaxy S23 (Android 16), 2026-09-12: "Update now",
  DownloadManager job 4846 finished in 16 s, the receiver committed the
  session, `PackageInstallerSession: Session installed` with no
  confirmation sheet, `installerPackageName=com.alwinpaul.codeui`, app
  back on 0.5.8. That build installed on completion; 0.5.10 changed it to
  ask first. The ask-on-open flow with the app killed mid-download: see
  the git log after this line for the 0.5.10 → 0.5.11 run.

## Not done

- No Wi‑Fi-only gate on the download; DownloadManager's default allows
  mobile data. Add `setAllowedOverMetered(false)` if that becomes a cost.
- The confirmation Intent for the non-silent path does not survive a
  process death; the dialog re-commits the session instead.
