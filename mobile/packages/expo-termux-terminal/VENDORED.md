# Vendored from termux-app

Source: https://github.com/termux/termux-app, branch `master`, commit
`084d709fbf23` (2026-09-16). Licence GPL-3.0 (`android/src/main/java/com/termux/LICENSE.md`).

- `com/termux/terminal/*` ← `terminal-emulator/src/main/java/com/termux/terminal/`, minus
  `TerminalSession.java` and `JNI.java` (the PTY-bound session and its `libtermux` JNI; the
  desktop owns the PTY here).
- `com/termux/view/*` ← `terminal-view/src/main/java/com/termux/view/`, plus `res/drawable`
  and `res/values/strings.xml` for the selection handles and menu.

The JitPack `terminal-emulator:v0.118.3` AAR was tried first and dropped: it predates the
view's sixel and top-row APIs, so the two halves must come from one commit.

## Local edits (grep `CODE UI`)

| File | Edit |
| --- | --- |
| `terminal/TerminalSessionClient.java` | Methods that name `TerminalSession` removed; only the emulator's cursor and log callbacks remain. |
| `terminal/TerminalEmulator.java` | Public `isBracketedPasteModeActive`, `isMouseButtonEventTrackingActive`, `isSgrMouseProtocolActive` (the DECSET bits are private) for the app's mode mirror. |
| `view/TerminalView.java` | `TerminalSession` typed `TerminalViewSession` (field, `attachSession`, `getCurrentSession`); `final` dropped so `HostedTerminalView` can refuse focus. |
| `view/TerminalViewSession.java` | New: the four things the view needs from a session, so it no longer depends on `TerminalSession`. |
| `view/TerminalViewClient.java` | `TerminalSession` parameters typed `TerminalViewSession`. |
| `view/TerminalViewCells.java` | New: package-private renderer metrics for the host's tap-to-cell mapping. |
| `view/textselection/*` | `import expo.modules.termuxterminal.R`; the "More" and "Paste" menu items removed (More opened a context menu this host does not register; Paste wrote the clipboard to the PTY through the session, which the app's own paste path owns). |

To re-vendor: fetch the two directories at the new commit, re-apply the rows above, and
update the commit here.

## Known leftovers

- `view/TerminalView.java` still pastes the clipboard to the PTY on a physical mouse's middle
  button (`SOURCE_MOUSE` only); the app's gesture gate drops those bytes. Unreachable by touch.
