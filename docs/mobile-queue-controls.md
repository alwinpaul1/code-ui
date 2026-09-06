# Mobile queue controls

Code UI 0.2.42 adds a pencil to the visible queue card for Claude Code and Codex.
It opens the existing Orca terminal with queue-editing shortcut keys. Messages
can originate on desktop or mobile; this path does not depend on the phone's
pending-message cache and requires no host configuration.

## Agent behavior

- Codex's default Alt+Up restores its latest editable queued message, including
  its original attachment state. Start with an empty input to avoid replacing a
  draft. Tab queues the edited input while work continues. Remove the recalled
  text and attachments to discard that message. Other entries remain queued.
- Newer Claude versions offer Up to select a queued entry, then Enter to edit.
  Older versions recall the queue together from the first input line; submitting
  the edited input merges it into one entry. Follow the hint in the agent input.
- The controls send explicit key presses only. Opening the editor and pressing
  Done do not recall, submit, cancel, or interrupt anything. Done returns to chat.
- Ctrl+U clears before the cursor on the current line, not the entire input or
  every attachment. Backspace and the terminal keyboard remain available.
- Customized agent key bindings still apply; the displayed native hint wins.

This is access to the native editor, not arbitrary per-entry Edit/Delete RPCs.
The inspected stock Orca transport does not expose those operations. In
particular, Codex preview sections for already-submitted steering input are not
equivalent to an editable pending queue. Do not rebuild either agent's queue
from terminal preview strings: they can be truncated, omit off-screen entries,
and omit attachment data.

## Missing Claude queue diagnosis

The old parser recognized only `Press up to edit queued messages`. The installed
Claude executable also contains these hints:

- `Press up to select a queued message, then Enter to edit it`
- `Press up to select a queued message to edit, or Enter to send them now`

The parser now recognizes both families, including wrapped hints. Regression
tests reproduced an empty mobile queue for the newer wording before the fix.
HUD integration tests exercise a desktop-origin queue and its removal when
consumed. Terminal reads explicitly marked as stream fallbacks are excluded
from queue and approval detection, because accumulated repaints are not a
current screen.

The reported live Claude queue had already been consumed when inspected, so its
exact displayed hint was not captured. The format compatibility bug is confirmed;
it is not proof that every missing-queue report has the same cause. Polling can
also miss queues consumed between screen reads. The final release was not used
to edit or delete messages in the user's active research sessions as a test.

## Validation

Tests cover both pencil controls with desktop-only entries, draft-write settling,
tab/terminal changes and unmount during editor opening, agent-specific key bytes,
no automatic writes on open/Done, and disabled controls while disconnected.
Existing queue/image and scrolling tests remain in the release suite.

Agent references: [Claude interactive mode](https://code.claude.com/docs/en/interactive-mode),
[Codex queue restoration](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/input_restore.rs),
[Codex keyboard handling](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/interaction.rs).
