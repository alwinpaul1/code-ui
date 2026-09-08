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
(Superseded by 0.2.48, which retypes such a queue instead. This paragraph
describes 0.2.43 and is kept as history.)

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
line up. A mismatch refuses — but only after Up has already emptied the queue
into the composer, so the refusal leaves the messages there as one unsent draft
rather than losing them. It then clears the input and
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
word for word and is refused the same way — again after the recall, not before
it. Both refusals could be made before Up is pressed by checking the captions
first; today they are not.

Between the clear and the last retype the messages exist only on the phone. Each
step is verified, and a failure names the messages that did not make it back
instead of pretending they were sent. If the recall itself cannot be read, the
queue is left as one unsent draft in the desktop input and the error says so.
Leaving the session mid-edit still leaves the agent holding an unsent draft.
Mobile records what it left on that terminal so the next send clears all of it —
before 0.2.49 a single Ctrl+U cleared one logical line and the survivors were
submitted glued to the user's next message. That record is in memory, so it does
not survive the app being killed.

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

## Save latency, 0.2.49

Saving an edit took twelve seconds on a phone, with the sheet open and every
control disabled, because the work was measured in relay round trips rather
than keystrokes. Clearing the recalled draft sent one kill key per round trip,
so a multiline queue spent one trip per line; each message was then pasted,
read back, submitted, and read back again, with a further read in between that
only re-checked what the previous read had just seen.

The clear now sends its kill keys in one burst and confirms the input empty
once. A rebuilt message is pasted and submitted in a single write, and the
queue itself is the confirmation — it says what the agent actually took, which
is a stronger check than the draft it was about to take. The redundant
pre-submit read is gone from the single-message path too.

**Only one message may travel per write.** Batching the whole queue into one
write was tried against Claude Code 2.1.263 and is wrong: three paste-and-submit
pairs in a single write came back as one queued message reading
`one alphatwo bravothree charlie`, the submits between them dropped. Per-message
writes stay, and with them per-message verification — which is also what keeps a
half-finished rebuild able to name the messages that did not make it back.

A write whose paste lands but whose submit key does not is now healed by sending
that key on its own, rather than spending the whole verification loop waiting.

### Why the round trips cannot go below two per message

Batching several messages into one write concatenates them. So does issuing two
writes back to back: measured against 2.1.263, separate writes merge at 0 ms,
150 ms and 200 ms spacing, and stay separate at 250 ms and above. The window is
Claude's, not the network's, and the app cannot rely on being slower than it —
it upgrades to a direct LAN connection whose round trip is far shorter (the
upgrade machinery is in `mobile/src/transport/`; the figure was not measured), and
Orca's own call queue runs several foreground calls per selector concurrently,
so two in-flight requests are not even ordered. One message per write, each
confirmed before the next, is therefore the floor. The time was taken out of
the fixed overhead instead: one-pass clear, a settle that subtracts the round
trip already spent, and standing the 1 Hz screen poll aside while the editor is
driving the terminal.

### Measured

Editing the oldest of three queued messages, Claude Code 2.1.263 through the
tmux harness: **34 round trips and 2798 ms originally, 11 and 952 ms after the
first pass, 9 and 730 ms once the clear finished in a single pass** — the last
run with a hard-wrapped URL among the queued messages.

On the device the editor sheet closed **7.3 s after Save, against more than 12 s
before**, measured by polling the view hierarchy about once a second; the
polling itself loads the phone, so the true time is lower.

## Defects the review round found, 0.2.49

Two reviewers read the implementation. Both rejected pipelining for the reason
above. Between them they found these, all fixed and all with tests:

- **A hard-wrapped message could be queued and then reported lost.** Ignoring
  Claude's mid-token wrap was applied to the split but not to the confirmation,
  so exactly the queue the split newly accepted was one the confirmation could
  never match: it pasted, queued, timed out, and named the message as never put
  back. There is now one comparator for "is this drawn row the message I sent",
  used by the split, the confirmation, the delivered check and the duplicate
  count.
- **Ignoring whitespace removed an invariant.** Word matching had enforced for
  free that a boundary between two messages falls on whitespace in the recalled
  draft. Without it a caption cut short would slide every later boundary and
  mis-split in silence. The boundary is now checked explicitly.
- **The queue hint had two definitions**, one stricter than the parser's. A
  hint the parser accepted and the editor did not would clear the composer,
  read the hint as text, and abort with the queue already emptied. One
  predicate now.
- **`submitInput` trusted an unchecked screen**, so a permission dialog or a
  stream fallback could read as a successful save.
- **The heal probe could repeat on every attempt**, spending up to twenty
  extra round trips.
- **A delivered message that wrapped was never recognised**, and the wording
  told the user not to re-send a message that might simply have been lost. It
  now compares the column-zero row as a prefix and hedges.
- **The stand-aside froze the screen poll for the whole time the sheet was
  open**, not just while it was writing, so a desktop permission prompt went
  unseen. It is scoped to the burst.
- **A half-written rebuild left its messages only in an error string.** They
  are now held in state and rendered as selectable rows, so they can be copied
  before closing.

Left alone deliberately: `submitInput` still accepts an empty draft as success
on the selector path, which an idle agent that sent the message immediately
also produces; and the editor strands rather than resuming, because a resume
re-enters the rebuild from the first message and would queue the landed ones
twice.

## Codex Tab on an idle composer, 0.153.4

A review round called the phone's Codex chat send a silent loss: it writes the
text and then Tab, and Tab was assumed to queue only, so an idle Codex would
hold the text unsubmitted while the phone painted a sent bubble.

Measured instead of assumed. Codex 0.153.4, idle at `› Ask Codex to do
anything`, typed `say ok`, sent Tab alone: the composer cleared and Codex
answered. **Tab submits on an idle composer.** The send path is right and needs
no Enter fallback.

The queue editor's `submitInput` still sends Tab first and only then falls back
to `\r` behind Orca's host-side sendable guard. That is not the same case: it
covers Codex finishing a turn *while the editor is open*, where the screen the
phone is holding is a turn old.
