# Code UI

Android companion for stock Orca. The desktop is the source of truth; this repo
is the phone client only. `src/shared/` is vendored Orca code — re-vendor it,
never edit it here.

## Every bug fix ships with a regression test

**A fix without a test that fails before it and passes after it is not a fix.**
The bug is allowed to come back the moment the only thing stopping it is the
diff you happened to write today.

So, for every reported bug:

1. **Write the failing test first**, from the real symptom, in the same commit.
   Run it and watch it fail. A test that passes before the fix is testing
   something else.
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

## Checks before calling work done

```
cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint
```
