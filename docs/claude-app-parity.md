# Claude app parity

The user's standing request (2026-09-24): whatever the Claude mobile app shows
for a Claude Code session, Code UI shows the same way, nothing missing. Each
item below comes from a screenshot or recording the user sent, compared with
Code UI on the same session. Evidence first; an item is done when it has a
failing-first test and has been checked on the phone in light and dark.

| # | What the Claude app shows | Code UI today | Status |
|---|---|---|---|
| 1 | Claude's thinking text with a thin, low-contrast line down its left edge | The same paragraphs, with a heavier line | open |
| 2 | Tool-run labels: a single command by its description ("Ran Count K*_F changes in section3 accountings"), "Ran skill", a SendMessage as "Messaged @agent <summary>", a new file as "created a file" | "Ran a command" for every single command; no skill or message wording | open |
| 3 | A green/red line-count chip on runs that create or edit files ("+292 −0") | No chip | open |
| 4 | Tapping a tool row opens a sheet: title, status ("Completed"), each input by name, the output with a Prettify toggle for JSON. It opens at a default height, drags up to full screen, and scrolls | The run expands inline | open |
| 5 | No bubble when a subagent this session launched hands its report back | Drew the peer boilerplate off the screen row | done (c9fd70c6) |
| 6 | An animated "N running tasks" row in the conversation; a Background tasks sheet with Running (name, kind, elapsed, stop, "View transcript") and "Finished N" (name, kind, Completed, chevron) | Has a background-task sheet and a subagent transcript modal; gaps not yet listed | open |
| 7 | After an API error ends the turn, no "Working" and no Stop | Still showed "Working ••• " and Stop under the error | open |
| 8 | A message with images or video leaves the composer text and media together | The text leaves first, the media lingers, then both reappear pinned together after a refresh | open |
| 9 | A sent message with an image and a video shows the image thumbnail and a file card ("MP4", the file name) | Showed only the video's path text, `@"/Users/…/….mp4"`, and no image | open |
| 10 | Screenshot markup: draw on a screenshot with a pen, undo and redo, "Discard markup?" on close, attach it with an edit pencil | Not present | open |
| 11 | A queued message stays queued while Claude Code 2.1.281 draws the queue above its spinner | Drew it as already sent | done (acac520b) |
| 12 | A reply written just before a phone send stays above the message | Drew it below | done (3ed09620) |

## Evidence notes

- **Thinking (1).** Both apps draw the transcript's `thinking` blocks with the
  side line; the paragraphs read as rephrasings of the visible reply because
  they are Claude's own reasoning summary, not the reply.
- **Hand-backs (5).** Since Claude Code 2.1.272 every subagent report is a
  `queued_command` with `origin.kind: "peer"` and `handback: true`; the
  user's own mid-turn messages are `origin.kind: "human"`. Orca's reader drops
  both attachment kinds.
- **Queue (11).** The 2.1.281 layout is in the test fixture beside
  `mobile-terminal-queued-messages.ts`.
</content>
</invoke>
<invoke name="Bash">
<parameter name="command">cd "/Users/alwinpaul/Desktop/Project/Code UI" && git add docs/claude-app-parity.md && git commit -q -m "List what the Claude app shows that Code UI does not yet" && git log --oneline -1