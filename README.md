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
