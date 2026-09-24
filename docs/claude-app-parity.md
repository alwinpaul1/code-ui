# Claude app parity

The user's standing request (2026-09-24): whatever the Claude mobile app shows
for a Claude Code session, Code UI shows the same way, nothing missing. Each
item below comes from a screenshot or recording the user sent, compared with
Code UI on the same session. Evidence first; an item is done when it has a
failing-first test and has been checked on the phone in light and dark.

| # | What the Claude app shows | Code UI today | Status |
|---|---|---|---|
| 1 | Claude's thinking text with a thin, low-contrast line down its left edge; notes between tools have none | Both drawn under a heavier line | line weight done (afc62100); telling thinking from notes needs the desktop to mark it (below) |
| 2 | Tool-run labels: a single command by its description ("Ran Count K*_F changes in section3 accountings"), "Ran skill", a SendMessage as "Messaged @agent <summary>", a new file as "created a file" | "Ran a command" for every single command; no skill or message wording | done (7816f8c5) |
| 3 | A green/red line-count chip on runs that create or edit files ("+292 −0") | No chip | done (7816f8c5) |
| 4 | Tapping a tool row opens a sheet: title, status ("Completed"), each input by name, the output with a Prettify toggle for JSON. It opens at a default height, drags up to full screen, and scrolls | The run expands inline | open |
| 5 | No bubble when a subagent this session launched hands its report back | Drew the peer boilerplate off the screen row | done (c9fd70c6) |
| 6 | An animated "N running tasks" row in the conversation; a Background tasks sheet with Running (name, kind, elapsed, stop, "View transcript") and "Finished N" (name, kind, Completed, chevron) | Has a background-task sheet and a subagent transcript modal; gaps not yet listed | open |
| 7 | After an API error ends the turn, no "Working" and no Stop | Still showed "Working ••• " and Stop under the error | open |
| 8 | A message with images or video leaves the composer text and media together | The text leaves first, the media lingers, then both reappear pinned together after a refresh | merged (3248a41b); phone check pending |
| 9 | A sent message with an image and a video shows the image thumbnail and a file card ("MP4", the file name) | Showed only the video's path text, `@"/Users/…/….mp4"`, and no image | open |
| 10 | Screenshot markup: draw on a screenshot with a pen, undo and redo, "Discard markup?" on close, attach it with an edit pencil | Not present | open |
| 11 | A queued message stays queued while Claude Code 2.1.281 draws the queue above its spinner | Drew it as already sent | done (acac520b) |
| 12 | A reply written just before a phone send stays above the message | Drew it below | done (3ed09620) |
| 13 | A quote of several paragraphs has one bar down its whole height, text indented beside it | A bar stub on each paragraph's first line, a lone bar on each blank `>` line, wrapped lines with none | done (60322f4a) |
| 14 | Where a mid-turn message sits among the rows around it | Two Claude app screenshots disagree under every rule Claude Code's records allow (below) | investigating |

## Evidence notes

- **Thinking (1).** The Claude app draws only `thinking` blocks with the side
  line; the paragraphs read as rephrasings of the visible reply because they
  are Claude's reasoning summary. Orca's reader turns a Claude `thinking`
  block into a text block under the plain `assistant` role
  (transcript-record-blocks.ts, claudeMessageRole), so the phone cannot tell
  thinking from a note written between tools, and draws both under the note
  line. Only an Orca change could mark them apart.
- **Hand-backs (5).** Since Claude Code 2.1.272 every subagent report is a
  `queued_command` with `origin.kind: "peer"` and `handback: true`; the
  user's own mid-turn messages are `origin.kind: "human"`. Orca's reader drops
  both attachment kinds.
- **Queue (11).** The 2.1.281 layout is in the test fixture beside
  `mobile-terminal-queued-messages.ts`.
- **Mid-turn placement (14).** Session 967668df. "Red." (stamped 22:15:15,
  written after a 22:15:23.873 enqueue) drew ABOVE the message, and so did
  the tool call stamped after the send: the Claude app matched the take
  (`queued_command`, written after the tool result). The "mahdi" message
  (enqueued 23:19:27.671) drew ABOVE a thinking block and tool call stamped
  0.2 s before the send but written after it: the Claude app matched the
  enqueue, not the take. The rule that fits both reports is the user's own
  choice, "where I sent it", for the phone's own sends (3ed09620 draws a row
  stamped at least the measured clock slack before the send above it). What
  broke the mahdi case is which copy was drawn: the Code UI bubble had NO
  images while the Claude app's had three, so the phone's own echo was not
  the one on screen. A text-only witness of the same message (the hook's
  prompt, reported when Claude Code takes it, or the queue box's release)
  replaced it and sat at the take. Fix: for a message the phone sent, keep
  the phone's echo, with its images and its send-time place, and retire the
  hook and queue copies against it, never the other way round. This is also
  half of item 9 (images missing from the bubble).

