# Android chat flicker investigation

Measured on the connected Samsung phone with ADB screen recording and temporary native scroll instrumentation, using a live Codex conversation through Orca.

## Reproduction and cause

The pre-fix recording showed older text briefly replacing the current viewport during incoming replies. Header, queue, and composer stayed in place.

Android traces captured the content height changing from 24,059 px to 23,567 px. `ReactScrollView.onLayoutChange` clamped the offset from 22,947 px to 22,455 px; the app then scrolled back down. The same cycle repeated. Message IDs remained present while native row offsets changed: variable-height list cells caused estimated off-screen spacing to be revised as the newest reply grew.

Using native `scrollToEnd` instead of FlatList's estimated end, and disabling history anchoring at the live edge, did not fully eliminate the recorded flicker.

## Change

The shared chat list is inverted with newest-first data, keeping its live edge at offset zero. Message contents still read normally from top to bottom. Older history is at the list footer. History loading requires the reader to scroll back; it no longer starts from the initial live-edge position. Anchoring remains enabled while reading history.

Removed delayed bottom retries and the initial hidden-list timer. Separately, delivered streaming previews stay retired after later transcript rows arrive, including batched replies.

## Device verification

- Before the list change: a 30-second recording detected six groups of transient frame changes; native logs confirmed backward layout clamps.
- With the inverted list: a 40-second recording including a new paragraph and tool updates detected zero transient frame changes, with no large native scroll corrections.
- A second 30-second recording after scrolling into history detected zero transient frame changes. Incoming updates stayed below the reading position, with the jump-to-latest control visible.
- The final clean 0.2.41 build was installed and recorded for another 30 seconds, including a new paragraph and tool updates: zero transient frame changes detected.

Frame comparison sampled the chat viewport at 30 fps and checked for brief changes that reverted within adjacent frames. Recordings were also inspected visually. This detects the reproduced flicker pattern; it is not a guarantee against every rendering problem. These device recordings used Codex; Claude uses the same list implementation but was not separately recorded in this check.

Temporary native and JavaScript diagnostics were removed before the release build. Regression tests cover the fixed live edge, reader-controlled following, inverted history pagination, and streaming-preview retirement.

Release checks: 553 test files passed; 4,342 tests passed and 3 skipped. Lint, TypeScript, and Android release build passed. Installed version: 0.2.41, versionCode 43.

## Send transition follow-up, 0.2.43

Removed the delayed animated send scroll and moved the confirmed queue into the
inverted list header, so adding a queue does not resize the list viewport itself.
The connected phone recording still shows a send-time transition as the keyboard
closes and an optimistic bubble becomes a confirmed queue entry. This issue is
not confirmed resolved. The earlier zero-transient measurements cover incoming
streaming updates, not this send transition.

The phone harness inadvertently sent two harmless test prompts into the active
development chat after its tab changed. Its final assertion targeted the isolated
session and failed; it is not counted as a passed phone end-to-end test. Separate
adapter tests through Orca passed recall, save, cancel, and delete on isolated
Claude and Codex sessions.

## Keyboard-closed send follow-up, 0.2.44

The keyboard-open checks did not cover the reported remaining bug. A new ADB
recording explicitly typed a short prompt, closed the keyboard, waited for it to
settle, and tapped Send in an isolated Claude session. Existing messages moved
downward before jumping upward when the new bubble arrived. Temporary traces
showed content height collapsing from 10,493 to 848 logical pixels, then
recovering, with the live-edge scroll offset still zero. The transcript count
increased normally. This isolates a list layout transition, not lost messages
or relay reconnection.

The chat now uses FlashList 2.3.2 measured layouts with the existing inverted
live edge. Recycling is disabled for off-screen message state; virtualization
remains enabled. Reader anchoring, history pagination, and the queue header are
preserved. Send no longer forces history readers to the live edge or dismisses
the keyboard. A keyboard already closed stays closed.

Candidate release recordings `codeui-044-closed1.mp4` (Claude) and
`codeui-044-closed2.mp4` (Codex) showed the new message and reply without the
reproduced backward jump. The harness verified the selected isolated tab,
desktop delivery, and unchanged composer bounds. Claude's send transition was
also inspected at 20 frames per second. These are observations on this phone,
not a guarantee for every device or message shape. The earlier coarse transient
frame metric did not catch this send reversal and is not used as proof here.

A diagnostic long-prompt run failed the fixed-composer-bounds assertion because
a two-line draft became an empty one-line composer. That result is not counted
as a passing flicker check. Attempts with a different active tab or another app
in the foreground stopped before typing.

The full suite passed: 555 test files, 4,375 tests passed and 3 skipped. TypeScript
and lint passed. Temporary list tracing was removed from the clean build.

The same release renders inaccessible macOS `orca-paste` image paths as a
non-clickable “Image on Desktop” label. It does not claim to retrieve desktop
clipboard bytes. Loadable preview URIs retain thumbnails and full-screen
previews. A regression test verifies that tapping the unavailable fallback
cannot invoke the file-open error path.

Final history testing caught a candidate integration regression: the native
pinch/scroll gesture was attached to FlashList's measurement wrapper, preventing
dragging. The gesture now wraps the actual scroll component with a stable
forwarded-ref component. A regression test checks that attachment and preserves
the component identity across message updates.

On the clean installed release, three ADB swipes in the active development chat
revealed older messages and the jump control. The unavailable desktop-image
label was visible and disabled; tapping it produced no file-open error. The
jump animation also needed a guard: its momentum event was being treated as a
new reader drag, re-enabling anchoring before reaching the end. A failing test
reproduced that state transition and passes with the explicit-jump guard.
