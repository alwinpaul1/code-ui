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
