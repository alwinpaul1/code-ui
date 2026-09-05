# Code UI

An Android companion for [Orca](https://github.com/stablyai/orca) that shows the
agents and terminals running on your desktop as a phone-first chat UI, in the
spirit of the Claude and Codex mobile apps. It reuses Orca's relay, pairing,
end-to-end encryption, terminal engine and native-chat transcript protocol
unchanged; only the presentation layer is new.

The desktop Orca app stays the source of truth. Code UI is a remote control for
it: it never runs an agent itself.

## Layout

```
mobile/        the Expo / React Native app (forked from orca/mobile)
src/shared/    Orca's shared protocol types and pure helpers, vendored verbatim
config/        oxlint plugins the mobile lint config extends
UPSTREAM.txt   the Orca commit this fork was taken from
```

The two directories mirror the upstream monorepo so the `../../../src/shared`
imports and future rebases keep working. Everything under `src/shared` is
upstream code; do not edit it here, re-vendor it from Orca instead.

## What changed from Orca mobile

- **Design system.** `mobile/src/theme/` holds light and dark tokens (warm cream
  and ink, terracotta accent), Instrument Sans as the only UI face, and a
  `useTheme()` provider with a Light / Dark / System setting under
  Settings → Appearance. Screens never use literal colours.
- **Screens.** Home, workspace list, session header and tab strip, terminal
  dock, Chat UI (transcript, tool runs, thinking disclosure, composer, ask,
  permission and question cards, model picker), pairing, settings, about and
  every shared sheet and modal were rewritten on the new tokens.
- **Chat UI additions.** The terminal accessory keys (Esc, Tab, Shift+Tab,
  arrows, Ctrl+C and custom shortcuts) appear above the composer so TUI menus
  stay operable without leaving the chat. The `/` menu lists the agent's
  commands and the skills and plugin commands installed on the desktop
  (`skills.discover`). The session header shows the active model.

### Orca mobile issues fixed in this fork

| Issue | Fix |
| --- | --- |
| [#9959](https://github.com/stablyai/orca/issues/9959) light mode | Full light and dark themes, user selectable. |
| [#11638](https://github.com/stablyai/orca/issues/11638) chat auto-scroll fights the reader | The transcript follows the live edge only while the reader is at it; dragging stops following on the same frame and a Jump-to-latest button returns. |
| [#12251](https://github.com/stablyai/orca/issues/12251) accessory swipe types into the terminal | Repeatable keys no longer send on press-in. A tap sends on release, a hold repeats after the delay, a swipe sends nothing. |
| [#15219](https://github.com/stablyai/orca/issues/15219) closing a tab jumps to the leftmost tab | The phone keeps its own visit history and returns to the previously viewed tab, else the newest remaining one. |
| [#15494](https://github.com/stablyai/orca/issues/15494) pinned workspaces duplicated | The list follows the desktop `showPinnedWorktreesInGroups` setting; off by default. |
| [#17567](https://github.com/stablyai/orca/issues/17567) terminal theme reassigned every snapshot | The WebView skips identical theme payloads. |
| [#17579](https://github.com/stablyai/orca/issues/17579) reasoning floods the transcript | Reasoning turns fold into a Thinking disclosure with a one-line preview. |
| [#17729](https://github.com/stablyai/orca/issues/17729) every commit shows "just now" | Commit timestamps are treated as epoch milliseconds, as the desktop sends them. |
| [#18568](https://github.com/stablyai/orca/issues/18568) no visible model | The session header shows the active model as a chip. |

Screens that were not restyled yet keep Orca's dark palette in both modes:
diff review, source control, file browser and preview, pull request panel,
tasks, accounts, agent history, terminal, browser, voice and notification
settings, troubleshooting and the connection log. They read from the legacy
static palette in `mobile/src/theme/mobile-theme.ts`, which was retuned to the
warm dark tokens so they blend in dark mode.

## Releases and in-app updates

Code UI ships as an APK on GitHub Releases, the way Orca Mobile does, and the
installed app checks for a newer one by itself.

- **Versioning.** `mobile/app.json` is the only source of truth: `expo.version`
  is the marketing version and `android.versionCode` is the monotonic build id
  Android compares on install. Bump both in one commit.
- **Cutting a release.** Push a tag that matches the committed version:

  ```sh
  git tag mobile-android-v0.2.0 && git push origin mobile-android-v0.2.0
  ```

  `.github/workflows/mobile-android-release.yml` lints, typechecks, runs the
  unit tests, prebuilds, builds `assembleRelease`, names the file
  `code-ui-android-v<version>-<versionCode>.apk` and publishes a GitHub Release
  with generated notes. `scripts/prepare-android-release.mjs` refuses a tag
  that disagrees with `app.json`. The workflow can also be started by hand from
  the Actions tab (`workflow_dispatch`).
- **Signing.** Release builds are signed with the Expo template debug keystore
  that `expo prebuild` generates, on CI and on a laptop alike, so a CI build
  installs over a local one. Swap in a real keystore before any store listing.
- **In-app update.** Once a day on Home focus, and on About → Check for
  updates, the app reads the newest `mobile-android-v*` release from the
  GitHub API (`mobile/src/app-update/`). A newer version shows a card at the
  bottom of Home and About that morphs from release notes → download progress
  → "ready to install", then hands the APK to Android's package installer.
  "Later" hides that exact version until the next one. The card mirrors Orca
  desktop's UpdateCard; the check logic is ported from Orca Mobile's Android
  update check.

## Run it

Requirements: Node 24+, pnpm, Android Studio SDK (the emulator image
`Pixel_9_Pro` and API 35 were used), a running Orca desktop.

```bash
cd mobile
pnpm install
pnpm start                 # Metro
pnpm exec expo run:android # debug build on the connected device or emulator
```

Release APK with the JavaScript bundled:

```bash
cd mobile
pnpm exec expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Pair from Orca desktop → Settings → Mobile, then scan the QR code or paste the
pairing code. Relay pairing needs both sides signed in to the same Orca account;
LAN pairing needs the phone and desktop on the same network.

## Checks

```bash
cd mobile
pnpm exec tsc --noEmit
pnpm lint
pnpm test
```

Two upstream test files are handled specially in this fork: the pull request
creation test is excluded because it imports a desktop renderer module the fork
does not vendor, and the session route parity test was re-pinned to the new
session chrome.

## Keeping model and effort in sync with the desktop

Code UI's chat pickers dispatch `/model` and `/effort` into the Claude Code session, so a
pick on the phone switches the desktop. For the other direction the phone reads the
terminal's status line, because that is the only place Claude Code states both the model
and the effort it is running. Any status line that prints a `[<model name> … <effort>]`
badge works (claude-hud with `showEffortLevel` does). If you don't run one, install the
minimal one shipped here, once per Claude profile:

```
/statusline
```

and point it at `mobile/scripts/code-ui-statusline.sh`, or add to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "sh /absolute/path/to/mobile/scripts/code-ui-statusline.sh" }
```

It prints `[Fable 5.1 · effort high] ctx 54% 537.2k/1M ~/project`. The phone polls the
terminal screen every 5 s while Chat UI is open and mirrors the badge into the pickers; the
`ctx` figure feeds the context-window ring next to the model pill (tap it for the detail).
claude-hud's `78% (776k/1.0M)` meter is read the same way.

Orca installs a status line of its own when you have none. It prints nothing (so the phone
has nothing to read) and only forwards Claude Code's `rate_limits` to the desktop for the
usage bars. Code UI's scripts do that same forwarding, so switching to them keeps the
desktop bars live and adds the badge and context figure for the phone.

One script per platform, all printing the same badge; pick the one that matches the
machine running Claude Code:

| Host | `statusLine.command` |
|---|---|
| macOS / Linux | `sh /path/to/mobile/scripts/code-ui-statusline.sh` (python3 if present, plain `sed` otherwise) |
| Windows (cmd or PowerShell) | `C:\\path\\to\\mobile\\scripts\\code-ui-statusline.cmd` (wraps the `.ps1`; PowerShell ships with Windows) |
| Any OS with Node | `node /path/to/mobile/scripts/code-ui-statusline.mjs` |

Orca on Windows works the same as on macOS for everything else: pair the phone from the
Orca desktop app, and Orca installs its Claude Code hooks into `%USERPROFILE%\.claude`
itself. Sessions started with a different `CLAUDE_CONFIG_DIR` need those hooks copied
into that profile's `settings.json` or they open as a terminal, not Chat UI.
