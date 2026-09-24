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
| 4 | Tapping a tool row opens a sheet: title, status ("Completed"), each input by name, the output with a Prettify toggle for JSON. It opens at a default height, drags up to full screen, and scrolls | The run expands inline | merged (0c89c146); a single-call row or a call inside a run opens the sheet, plan, diff and web-search rows keep their inline cards. The sheet caps each input and the output at the inline row's `MAX_TOOL_DETAIL_LENGTH`, so a huge output cannot stall text layout; the Tools toggle no longer expands a row that opens the sheet, which the user chose to keep (2026-09-24; the Claude app has no such toggle). Drag feel needs a phone check |
| 5 | No bubble when a subagent this session launched hands its report back | Drew the peer boilerplate off the screen row | done (c9fd70c6) |
| 6 | "Running agent ›" (moving highlight) for a run of agents, with a "Ran N agents" sheet; "✳ Cooking… · 5 running tasks" above the composer; a Background tasks sheet that opens part way and drags to full screen, with Running (name, kind, elapsed, stop, "View transcript") and "Finished N" (name, kind, Completed, chevron) | All drawn, from the phone's own reader; the highlight is a breathing label; parallel agents re-paired by description. Gaps below | built, not yet checked on the phone |
| 7 | After an API error ends the turn, no "Working" and no Stop; the same after a normal finish while an agent runs in the background | Still showed "Working ••• " and Stop under the ended turn | fixed (85ee85d0, and the active tab's pill in e9df676a), not yet checked on the phone; an inactive tab's pill still follows the desktop, which the phone holds no transcript for |
| 8 | A message with images or video leaves the composer text and media together | The text leaves first, the media lingers, then both reappear pinned together after a refresh | merged (3248a41b); phone check pending |
| 9 | A sent message with an image and a video shows the image thumbnail and a file card ("MP4", the file name) | Showed only the video's path text, `@"/Users/…/….mp4"`, and no image | file card merged (ddfb8945). A message sent from the Claude app gets one "Photo" chip per photo Claude Code paints above it (`[Image #N]`, 2.1.281), read while that message is on the terminal screen and kept after; the picture itself arrives inline and Orca's reader drops it (below) |
| 10 | Screenshot markup: draw on a screenshot with a pen, undo and redo, "Discard markup?" on close, attach it with an edit pencil | Not present | merged (cb571619); drawing feel and the flattened image need a phone check |
| 11 | A queued message stays queued while Claude Code 2.1.281 draws the queue above its spinner | Drew it as already sent | done (acac520b) |
| 12 | A reply written just before a phone send stays above the message | Drew it below | done (3ed09620) |
| 13 | A quote of several paragraphs has one bar down its whole height, text indented beside it | A bar stub on each paragraph's first line, a lone bar on each blank `>` line, wrapped lines with none | done (60322f4a) |
| 14 | Where a mid-turn message sits among the rows around it: its own sends where it sent them, a message sent elsewhere where the agent took it (below) | A phone text send gave way to the hook's copy and drew under rows written after it | phone sends fixed, not yet checked on the phone; a Claude app send reaches the phone as the hook's text only (below); a Claude app or desktop send keeps rows written just after it below it (f2b2a5ca) |

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
- **Background work (6).** Not drawn because the phone cannot know it:
  a finished shell's output (the Claude app's chevron on a Shell card opens
  it; the output file sits outside the worktree `files.read` is jailed to),
  so a finished shell has no chevron; Stop on a terminal tab (no host call
  stops one Claude Code task, and driving its task dialog by keys is not
  verified), so Stop shows only on a structured tab whose host says
  `supportsTaskStop`; the thinking status "almost done thinking", which the
  Claude app showed but Claude Code 2.1.281 does not paint (its words are
  read when they are). Codex's spinner is not read, so a Codex tab says
  "Working…". The drag-to-full-screen sheet and the breathing label have not
  run on the device yet.
- **Working after the turn ended (7).** Session 967668df. Claude Code
  2.1.281 fires StopFailure, not Stop, when a turn's last record is an API
  error (a safeguards refusal is one, with no status code). Orca then holds a
  Claude pane `working` for any subagent or teammate it still counts as
  working, and gives that no `monitoring` mode (`resolveClaudePaneStatus`), so
  the phone read a running background agent as the lead still at work. That
  happened at 23:01:14 and 23:01:48 while reviewer `a77d87fe` ran, and after
  the normal Stop at 21:57:09 while `a8f65c53` ran. The thesis "Paper review
  council" tab reported the same after a normal finish; its transcript was not
  read. The screenshot sent with the report (Request ID `req_011CfMD2X…`,
  23:05:06) was taken after 23:06:22 with the list scrolled up, while the
  "Continue" turn that followed the error was running, so the Working row in
  it was true. The phone now takes the lead's end from the transcript: an API
  error with nothing after it, or the reply the host says the Stop hook
  reported (`claude-lead-turn-ended.ts`). The tab pill still copies the
  desktop's dot, which keeps its spinner in that state.
- **Photos from the Claude app (9).** Session 967668df, lines 8304 and 8372. The Claude app sends a photo inline (`source.type: base64`) and saves a copy in `~/.claude-work/uploads/<session>/`; Orca's reader keeps an image block only with a path or URL (`imageRefBlock`, v1.4.210), so the row reaches the phone as its words alone. The VS Code extension reads the transcript file itself. Claude Code paints `[Image #N]` rows above the message's `❯` row (captured from 2.1.281, fixtures/claude-screen-sent-photos-2.1.281.txt), and the phone reads those (`mobile-terminal-sent-photos.ts`). It links the label to the saved file only for a photo with a paste number, which a Claude-app photo has not, and Orca grants the phone only a path that appeared in the chat or the terminal, so the bytes stay out of reach.
- **Queue (11).** The 2.1.281 layout is in the test fixture beside
  `mobile-terminal-queued-messages.ts`.
- **Mid-turn placement (14).** Session 967668df. "Red." (stamped 22:15:15,
  written after a 22:15:23.873 enqueue) drew ABOVE the message, and so did
  the tool call stamped after the send: the Claude app matched the take
  (`queued_command`, written after the tool result). The "mahdi" message
  (enqueued 23:19:27.671) drew ABOVE a thinking block and tool call stamped
  0.2 s before the send but written after it: the Claude app matched the
  enqueue, not the take. The two agree once it is clear who sent what. "Red."
  was the phone's, typed into the terminal: its `queue-operation` enqueue
  carries the text, and its photos are `[Image #8]`–`[Image #10]`, the
  markers a terminal paste leaves. The mahdi message came from the Claude
  app: its enqueue has no `content`, and its three photos are
  `inlinedImagePaths` in `~/.claude-work/uploads/<session>/`, the Remote
  Control upload folder, where every photo the Claude app sent from 22:58 on
  was saved. The rule that fits both screenshots: the Claude app draws a
  message it sent itself where it sent it, and one sent elsewhere where the
  agent took it. Code UI drew the mahdi
  message from the hook alone (`agentStatus.prompt`, text only), after the
  rows stamped before the hook's time. The hook fires at the submit: the
  2026-09-19 capture in desktop-prompt-own-sends.test.ts is timed at the
  enqueue, 19 s before the take. Code UI never had the photos: Orca's reader
  drops the `queued_command` that carries them, and the phone has no other
  path to the files. The user's rule, "where I sent it", holds for the
  phone's own sends. Before the fix, a text send gave way to the hook's
  timed copy and drew under the thinking and the call written after it. A
  photo send was already kept. Now every phone send with a send time keeps
  its bubble, and the hook's and queue box's copies give way to it. Item 9's
  message (line 8371, a video and a photo) was a Claude app send too, and it
  landed as a user row, so what its bubble lacks comes from how a landed row
  draws, not from the phone's echo.

