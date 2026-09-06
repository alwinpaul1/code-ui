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
