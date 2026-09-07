# Mobile queue controls

Code UI 0.2.43 opens an inline chat editor from an icon-only queue pencil. It contains the
recalled text, Save, Cancel, and Delete message. It no longer switches to the
terminal or displays terminal shortcut instructions. No desktop configuration,
helper scripts, or extra server is required.

The editor reads Orca's `terminal.read` draft field after invoking the agent's
native recall key. Queue previews are never used as replacement payloads. Save
checks the current draft before clearing, observes an empty input before pasting,
checks the replacement, and submits with the agent's native key. Cancel restores
the original input; Delete clears it without submitting or interrupting work.
Codex uses Tab; if work has finished, submitting Enter also requires Orca's
host-side `sendable` guard. Writes fail rather than waiting across a disconnect.

## Compatibility limits

Codex recalls its latest editable queued message. Already-submitted steering
inputs cannot be edited. Claude's newer selector can recall an individual entry;
its older Up behavior recalls the whole queue. Editing a legacy Claude queue
with multiple entries is refused before any key is sent, to avoid merging them.

Orca can expose attachment and collapsed-paste placeholders instead of their full
payloads. Those inputs can be restored unchanged, but replacement/deletion is
refused to avoid destroying hidden attachment state. If the desktop changes the
draft during editing, mobile refuses to overwrite it. Closing after an error or
leaving the session preserves the agent's current input, which may be an unsent
recalled draft. Native keybinding customizations can prevent recall.

## Claude queue visibility

A live Claude Code 2.1.263 test showed the missing-queue cause: Orca removes the
composer placeholder from `tail` and returns `Press up to edit queued messages`
in `draft`. The old mobile reader ignored that field. The parser now restores
that specific hint at the composer row before locating the queue. It also excludes
Claude's right-aligned `Ctrl+Y to paste deleted text` hint from queue captions.
Actual user drafts are not appended to transcript or queue entries.

## Validation

The queue adapter was exercised through stock Orca against isolated Claude Code
2.1.263 and Codex 0.153.4 sessions. Both passed desktop-origin text queue detection,
recall, edit/save, cancel/restore, and delete, with the original task continuing.
The Claude test first reproduced clear-and-paste concatenating the old and new
text; separating those operations and verifying empty input fixed that test.

Automated tests cover both agents, the draft-field queue layout, the optional
Claude selector step, concurrent desktop edits, session changes, hidden payload
protection, legacy multi-entry refusal, and the idle submission guard. UI tests
verify a native chat text field and short actions with no terminal instructions.

Recalled plain-text inputs retire their matching temporary mobile bubble, so
editing or deleting them cannot leave the original text displayed as sent.
Codex's recall hint is recognized across wrapped lines. A missing hint reports
that editing is unavailable, rather than claiming the message was submitted.
Arbitrary entry editing remains unsupported by this release.

## Three-entry verification, 0.2.44

Separate live probes queued three distinct plain-text messages through stock
Orca. Codex 0.153.4 recalled the third message first; pressing recall again
replaced that draft with the second message. It did not provide safe arbitrary
selection while retaining the first recalled draft. Claude Code 2.1.263 recalled
all three messages into one multiline draft, losing the original boundaries.

No per-entry edit pencils were added for these unsupported cases. Reconstructing
the queue from visible captions could lose attachment state, reorder messages,
or race the running agent consuming a message. Reliable arbitrary edits require
an agent/Orca queue operation that identifies and updates entries atomically.
This release does not implement that host integration.

## Queue presentation, 0.2.45

The queue card uses a compact count badge, numbered rows, subtle dividers, and an
icon-only edit action with a 44-point touch target. Long messages wrap within a
bounded, scrollable list. The chat editor uses the app's font and theme, with an
inset text field, a primary Save action, and a distinct Delete action.

The installed Android build (versionCode 47) was inspected on a physical phone
with two desktop-origin Codex queue entries. Both rows and the longer caption
were readable; the pencil recalled the latest entry into the chat editor.
Cancel restored that entry, and a desktop read confirmed both messages remained
queued in their original order. The existing queue tests cover both agents;
this visual change does not extend which entries their native controls can edit.

Validation: 555 test files passed (4,375 tests passed, 3 skipped), TypeScript and
lint passed, and the Android release build succeeded.

## Editor presentation, 0.2.46

The editor now has a compact footer with an icon-only Delete action, Cancel, and
a checkmark Save button. The header close button restores the original queued
input, just like Cancel. The writing area is larger, the sheet respects the
bottom safe area, and its body can scroll independently of the actions. Controls
are disabled during an operation; the header shows its progress indicator.

Mobbin MCP was unavailable in this session, and its public pages did not expose
the requested reference screens. The accessible reference was
[Slack's documented mobile message editor](https://slack.com/help/articles/202395258-Edit-or-delete-messages-Edit-or-delete-messages),
which uses a checkmark to save. This is not a Mobbin-verified design.

The installed versionCode 48 was visually inspected on a physical Android phone
with the keyboard closed and open. The field and all footer actions were visible
above the keyboard. Subsequent save automation stopped at its session/editor
guards after the phone changed state; it is not counted as a completed save test.
All 555 test files passed (4,375 tests, 3 skipped), including the queue operations
and editor action/disabled-state checks. TypeScript, lint, and the Android release
build passed.

## Per-message editing on Claude Code, 0.2.48

Any queued Claude message can now be edited or deleted from the phone, with no
change to the desktop. A pencil sits on every Claude row and addresses the queue
by position. Codex keeps its single pencil on the latest message, which is all
its native recall reaches.

Claude Code 2.1.263 has two queue behaviours, and mobile drives both.

**Whole-queue recall, the stock behaviour.** One Up empties the queue into a
single multiline draft: three messages came back as one input with the
boundaries gone. Mobile splits that draft back apart by matching it word for
word against the captions Claude drew before the recall — a caption's line
breaks are display wrapping, the draft's are the author's, so only the words
line up. Any mismatch refuses before a key is sent. It then clears the input and
retypes the queue message by message, with one entry changed or dropped. Order
is preserved exactly, and each retype is confirmed queued before the next.

**The per-message selector.** A gate on `CLAUDE_CODE_KB_COHESION_FIXES` in the
agent's environment, read out of the 2.1.263 binary and confirmed live, changes
the composer hint and makes Up mark one entry at a time; Enter pops the marked
entry into the composer with its images intact. Mobile walks that selector when
the hint says it exists, verifying each press: the marked caption must still be
the message the user tapped, and the hint must name history only on the oldest
entry. A mismatch sends Escape, which clears the marker without interrupting the
turn. This path is atomic and keeps attachments, but Claude appends the edited
message, so any entry but the last comes back at the end. The editor says so.
No host configuration is required to reach it or to do without it.

### Limits of the retype path

A queue holding an attachment or collapsed paste is refused before any key is
sent: Orca exposes a placeholder, not the payload, so retyping would destroy it.
A caption Claude shortened with an ellipsis — it does that for peer and
task-notification entries, never for a plain typed message — cannot be matched
word for word and is refused the same way.

Between the clear and the last retype the messages exist only on the phone. Each
step is verified, and a failure names the messages that did not make it back
instead of pretending they were sent. If the recall itself cannot be read, the
queue is left as one unsent draft in the desktop input and the error says so.
Leaving the session mid-edit still leaves the agent holding an unsent draft.

### Two defects the live run found

The queue list was unreadable during a selection. Claude drops the marker from
every unmarked row, leaving it at the same four-space indent a wrapped line
uses, so the two cannot be told apart. The old parser merged them into invented
entries. It now refuses to split the block while a selection is active and reads
only the single marked row.

Saving destroyed the message. Orca republishes Claude's composer placeholder in
`draft`, so a cleared input arrived as the queue hint — longer than the text it
replaced. The clear loop read that as the input growing, aborted, and left the
entry already popped out of the queue and nowhere else. A draft showing a queue
hint now counts as empty.

### Validation

Verified against Claude Code 2.1.263 at 80 columns through a tmux harness that
drives `native-queue-editor.ts` with Orca's `terminal.read` shape.

Stock, no environment changes, three queued messages: the middle one was
recalled, edited, and the queue retyped as
`alpha oldest / bravo EDITED WITH ZERO CONFIG / charlie newest` in its original
order; the oldest was then recalled and deleted, leaving the other two in place.

With the selector flag set: the oldest of three was recalled, edited and
re-queued last with the other two untouched, then the middle one was recalled
and deleted. Both agree with the unit tests, whose fixtures are captured
screens rather than paraphrases.
