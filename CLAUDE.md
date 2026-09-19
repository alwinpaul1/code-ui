# Code UI

Android companion for stock Orca. The desktop is the source of truth; this repo
is the phone client only. `src/shared/` is vendored Orca code — re-vendor it,
never edit it here.

## Every bug fix ships with a regression test

**A fix without a test that fails before it and passes after it is not a fix.**
The bug is allowed to come back the moment the only thing stopping it is the
diff you happened to write today.

So, for every reported bug:

1. **Write the failing test first**, from the real symptom, in the same commit,
   and **watch it fail on the unfixed code**. "Fails" means you saw it go red,
   not that you believe it would. If the test came after the fix, revert the fix
   — stash it, comment the lines out, copy the old file to /tmp, whatever is
   quickest — run the test, see red, restore, see green. Say so in the commit:
   "reverting X fails test Y" is one line and it is the whole difference between
   a test and a comment. A test written after a fix and never run against the
   broken code asserts what the code does today, which is true by construction,
   and it will keep passing when someone reintroduces the bug beside it.
2. **Feed it the real screen, not a paraphrase.** Terminal parsers break on
   the exact bytes an agent paints: the indent, the wrap column, the marker
   glyph, the hint wording. Capture a real screen (`tmux capture-pane -p`
   against a live agent) and paste those lines into the fixture. Invented
   fixtures agree with the invented parser and both stay wrong.
3. **Name the test after the symptom**, not the function — "keeps the queue
   readable while an entry is selected", not "parses lines".
4. **Cover both agents** when a change touches the queue, permission, or HUD
   parsers. Claude Code and Codex paint different screens and regress
   separately.
5. **Cover light and dark** when a change touches UI. Both are required
   states; a hardcoded colour passes every automated check and still ships
   the wrong theme.
6. **Pin the actual defect, not a proxy near it.** Ask what SHAPE the bug has,
   then pick the instrument that can see that shape. A wrong value or branch is
   an ordinary unit test. But a defect of STRUCTURE — which module mounts what,
   which of two sources a value is read from, whether a rule sits inside a
   component where nothing can reach it — often has no behavioural handle at
   all, and a source-reading test is then the only instrument, not a cop-out.
   `active-handle-render-purity.test.ts` and the RPC port-inventory ratchet are
   both this kind and both have caught real defects. A source-reading test must
   match code, not commentary: these files carry long "why" comments, and a bare
   `includes()` will find the prose above the code every time.
7. **Test the FAILURE path, not just the happy one.** Anything added to a
   working path must be proven unable to break it. The phone is full of
   fail-open contracts — an unreadable store means no warm start, a failed write
   costs the next launch its cache, a beacon that will not parse is ignored.
   Drive the genuine failure (an absent file, a rejected RPC, a malformed
   payload), not a stub that returns empty.
8. **Test the DEGENERATE size, not just the typical one.** Everything here that
   positions, folds, anchors, bounds or slices a list has a boundary where first
   and last are the same row, or there are none. That is where it breaks, and a
   fixture with seven messages never visits it. For anything indexed, add the
   one-element and empty cases by default; they cost a line each and that is
   where the off-by-one lives.
9. **Fix the diagnostic, not just the defect.** If a failure announced itself
   with a message that named a symptom but not its cause, that message is part
   of the bug. Ask: if this happens again while nobody is watching, does the one
   line it leaves behind say where to look? A send that fails silently is the
   same defect as a send that fails — the card re-enables either way and a dead
   button is indistinguishable from a slow one.
10. **A comment that names a value the code just changed is part of the diff.**
   When a change moves a literal — a cap, a timeout, a colour, a count, a
   version an observation was verified against — grep the feature for that
   literal in PROSE before committing, the same way you grep for the defect's
   shape. Reviewers read the comment first; a wrong one costs more than none.
11. **When a check comes back clean, ask what it does not cover.** A green suite
   clears the floor, not the bar. The suite was green while five functions in
   the echo system had no test at all, and green again while the `Image on
   Desktop` placeholder silently broke the key those echoes are retired by —
   because nothing crossed the two.

## Every change is diffed against current code and regression-checked

Before calling any change done: **diff it against the current code** (`git
diff`, and for a port, upstream's parent against this fork's file) and read
what actually changed, not what you meant to change. Then **run the
regression suite** (`cd mobile && npx tsc --noEmit && npx vitest run && npx
oxlint`) and, for anything that touched ordering, parsing, or a pinned
contract, have a second reviewer (an Opus or Sonnet agent) hunt the diff for
regressions. **A reported regression is confirmed or disproved with a test,
never by re-reading the diff**: reproduce it, and if it is real, fix it with
its own failing-first test in the same pass. Only a green gate plus a
confirmed-clear review means done. (2026-09-14: a hold-guard fix routed a
re-pin through the follow gate and silently broke dock re-pins; two
independent reviews caught it, a failing-first test proved it, and it was
fixed before shipping. That is the bar.)

## The second time you fix one shape of bug, sweep for the rest

Fixing the same kind of defect twice means it is a habit, not an incident.
Stop, write the grep that matches the defect's shape, run it over the whole
feature, and fix every hit in that pass. Reading the diff again does not find
these — each instance already passed review, types, and tests.

## Agent screen parsing

Anything that reads an agent's terminal screen (`mobile/src/session/*-terminal-*.ts`)
depends on undocumented TUI rendering that changes between agent releases:

- **Record which agent build a behaviour was verified against**, in the test or
  in `docs/`. "Claude Code 2.1.263" is a fact; "recent Claude" rots.
- **Prefer refusing over guessing.** When the screen is ambiguous, return
  nothing and say why. A wrong queue rewrite loses the user's messages; a
  missing pencil only annoys them.
- **Never reconstruct agent-owned state from a rendered preview.** Captions are
  wrapped, truncated, and re-ordered by the agent. Drive the agent's own
  native keys and read back what it says its input is.

## The user sets up nothing on their desktop

Someone using Code UI configures **nothing** on the machine it talks to. No
status line, no plugin, no settings change, no upstream Orca change — and no
code written to their host either. The phone does all of it.

**"Zero configuration" is not "zero execution", and neither is the bar.** A
script saved to their disk is a change to their machine whatever it cleans up
afterwards. A command that reads what the agents already write for themselves
is not. If a design needs the user to install or run something first, it has
failed the requirement — find another way or say plainly that there isn't one.

**Nothing may be drawn in the user's terminal.** Not a status row, not a
footer item, not one extra line. A status line the user never asked for was
tried on 2026-09-09 and withdrawn the same day, and that verdict stands: a
visible row is a change to their screen, which is a change to their machine.

The HUD reads the agents' own state instead, on an **invisible OSC beacon**
they write to their own PTY. Launch flags (Claude Code `--settings`, Codex
`-c notify`) make each agent run a small `sh` command that emits
`ESC ] 7777 ; … BEL` to `/dev/<its tty>`; terminals draw nothing for an unknown
OSC, the phone already receives those bytes, and it strips them before xterm
ever sees them. Claude's command also runs the user's own status line and
prints its output verbatim, so a user with one keeps exactly their bar, and a
user without one still gets no row. The flag also sets
`statusLine.refreshInterval` (5 s; 15 s on Windows), so Claude re-runs the
command on a timer while its status line is mounted (not under a dialog or a
picker), and while it works the beacon is a heartbeat the phone can time
(2026-09-18: a rule timed on the agent WORKING with no heartbeat behind it
blanked a live pill 30 s into any tool call, because the status line does not
repaint during one). A user's own bar repaints on that beat too; that is their
bar, not a row of ours. Windows takes a different route: hook
children there sit in a hidden console, so both agents get a PowerShell script
that attaches to the agent's console via P/Invoke and writes there. It runs
for real under PowerShell 7 in tests but **has not run on a Windows machine**
— do not report it as working. The design, the verified field
shapes and what is still unproven are in `docs/mobile-agent-hud.md`; the code
is `mobile/src/session/agent-hud-*`. Orca's hooks (`agentStatus.model`) and
`accounts.subscribe` remain the fallback sources, and the screen still owns the
permission mode.

When a figure is not on the beacon and not on screen, show nothing rather than
a number from anywhere else. A reader that opened a host terminal to read
transcript files was removed on 2026-09-09, and a second one — a `tail -F`
on the session transcript in a background host terminal, opened for parity
with the VS Code extension on hand-started sessions — lived for one day on
2026-09-19 and was removed the same day: Orca has no hidden terminal, so the
tab showed on the desktop, and the user did not want it. **What replaced it
needs no terminal at all: Orca installs its own Claude Code hooks for every
session on the machine (`~/.claude/settings.json`, `UserPromptSubmit` and the
rest post to the runtime's hook port), and the session-tab snapshot the phone
already subscribes to carries the result as `agentStatus.prompt` — the last
prompt the session took, from whichever client sent it.** The phone reads
mid-turn messages from the desktop and the Claude app there
(`mobile/src/session/agent-status-prompts.ts`), for hand-started sessions too.
Its limits: the field is capped at 200 characters (a longer prompt is drawn
cut), and the queue is not in it, so the queue box reads the screen alone. No
terminal may be opened to read files, and the HUD figures still come only from
the beacon and the screen.

**When a figure genuinely cannot be known, show what is known and say the rest
is unknown.** Never invent a denominator. Claude Code's TRANSCRIPT never
records its context-window size, and a 1M session logs an unmarked
`claude-opus-5`: guessing from the name called a 493k session 246% full, and
"smallest size that fits" called it 99% full while it was half empty. Derive it
from evidence the session itself provides, or report the tokens with no
percentage. (The beacon is such evidence — Claude Code states
`context_window_size` in its own status-line payload, and Codex states
`model_context_window` in its rollout. That is the agent telling us, not us
guessing from a model name. With tokens and no window, still show no ring.)

## Nothing stays stale once the relay connects

**A screen opened before the connection came up must refresh itself when it
does.** Not on a tap, not on a tab switch: by itself. Someone opens the app,
taps a project and a file while the relay is still dialling, the read fails, and
the tab then says "Couldn't load" over a connection that has been healthy for
minutes. That is the app lying about the current state of the world, and the
user has no way to know a retry would now succeed (reported 2026-09-15).

So any surface that can hold a FAILED load owns a refetch keyed to
`useLastConnectedAt(hostId)`, through
`shouldRefetchAfterReconnect` in `mobile/src/transport/stale-after-reconnect.ts`.
The rule it enforces is one refetch per NEW connection, never one per render —
an effect that sees its own failure and retries immediately will spin for as
long as the host is down. The first sighting of an error only records which
connection it happened on; the retry comes when that value changes.

**A manual Retry button is not this.** Several screens already had one and
still sat stale, because a button is the user doing the app's job for it. Keep
the button for the case where the connection is fine and the read failed anyway.

## Never bump the version until asked

**Install the current build on the phone WITHOUT bumping, and wait.** The user
verifies the fix on the device first; only then does the version move. A bump is
how a build becomes the one everybody gets, and bumping before the fix is
confirmed spends a version number on a guess — and on a bad day publishes it.
Build, install over adb, say what to look at, and stop. (2026-09-15: four
versions went out in an afternoon, several of them for fixes that turned out to
be the wrong diagnosis.)

## Every shipped version gets a tag and a release

Bumping `mobile/app.json` is not shipping. Push the
`mobile-android-v<version>` tag — the workflow runs the whole gate itself and
publishes the signed APK, so the release carries a build that passed, not a
local one.

**Releases falling behind `main` is a bug, not untidiness.** The in-app update
card reads the published release, so a user on an old build has no way to reach
the new one. If several versions have landed untagged, tag the current one; the
notes are generated from commit subjects since the previous tag and will cover
the gap.

**Never move a published tag.** Someone may already have that APK. Go forward
to the next version instead.

## Checks before calling work done

```
cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint
```
