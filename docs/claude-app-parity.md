# Claude app parity

The user's standing request (2026-09-24): whatever the Claude mobile app shows
for a Claude Code session, Code UI shows the same way, nothing missing. Each
item below comes from a screenshot or recording the user sent, compared with
Code UI on the same session. Evidence first; an item is done when it has a
failing-first test and has been checked on the phone in light and dark.

| # | What the Claude app shows | Code UI today | Status |
|---|---|---|---|
| 1 | Claude's thinking text with a thin, low-contrast line down its left edge; notes between tools have none | Both drawn under a heavier line | line weight done (afc62100). The line now goes only beside a `reasoning` message, drawn as its text, and no assistant prose has one (2026-09-26). A terminal Claude tab gets no line at all until Orca marks thinking (below); the structured lane, Codex and Grok already do |
| 2 | Tool-run labels: a single command by its description ("Ran Count K*_F changes in section3 accountings"), "Ran skill", a SendMessage as "Messaged @agent <summary>", a new file as "created a file"; a described command beside other work as "ran a command" ("Created a file, ran a command", 2026-09-26) | "Ran a command" for every single command; no skill or message wording; then a described command named by its description beside an edit too | done (7816f8c5); the mixed run's wording fixed after the 2026-09-26 screenshot |
| 3 | A green/red line-count chip on runs that create or edit files ("+292 −0"; "Created a file, ran a command +93 −0", "Edited a file, ran a command +14 −2", 2026-09-26) | No chip; then a chip counting only what survived the wire ("+61 −0" for the +93) | done (7816f8c5); a count the wire cut draws no chip and no card count (below). A created file the wire cut, 39% of creates on this machine, is counted from the file on the desktop when that is provably the file the Write made, and draws no count otherwise (below) |
| 4 | Tapping a tool row opens a sheet: title, status ("Completed"), each input by name, the output with a Prettify toggle for JSON. It opens at a default height, drags up to full screen, and scrolls | The run expands inline | merged (0c89c146); a single-call row or a call inside a run opens the sheet, plan, diff and web-search rows keep their inline cards. The sheet caps each input and the output at the inline row's `MAX_TOOL_DETAIL_LENGTH`, so a huge output cannot stall text layout; the Tools toggle no longer expands a row that opens the sheet, which the user chose to keep (2026-09-24; the Claude app has no such toggle). Drag feel needs a phone check |
| 5 | No bubble when a subagent this session launched hands its report back | Drew the peer boilerplate off the screen row | done (c9fd70c6) |
| 6 | "Running agent ›" (moving highlight) for a run of agents, with a "Ran N agents" sheet; "✳ Cooking… · 5 running tasks" above the composer; a Background tasks sheet that opens part way and drags to full screen, with Running (name, kind, elapsed, stop, "View transcript") and "Finished N" (name, kind, Completed, chevron) | All drawn, from the phone's own reader; the highlight is a breathing label; parallel agents re-paired by description. Gaps below | built, not yet checked on the phone |
| 7 | After an API error ends the turn, no "Working" and no Stop; the same after a normal finish while an agent runs in the background | Still showed "Working ••• " and Stop under the ended turn | fixed (85ee85d0, and the active tab's pill in e9df676a), not yet checked on the phone; an inactive tab's pill still follows the desktop, which the phone holds no transcript for |
| 8 | A message with images or video leaves the composer text and media together | The text leaves first, the media lingers, then both reappear pinned together after a refresh | merged (3248a41b); phone check pending |
| 9 | A sent message with an image and a video shows the image thumbnail and a file card ("MP4", the file name) | Showed only the video's path text, `@"/Users/…/….mp4"`, and no image | file card merged (ddfb8945). A message sent from the Claude app gets one "Image on Desktop" chip per photo, the chip a desktop-pasted image already had, Claude Code paints above it (`[Image #N]`, 2.1.281), read while that message is on the terminal screen and kept after; the picture itself arrives inline and Orca's reader drops it (below) |
| 10 | Screenshot markup: draw on a screenshot with a pen, undo and redo, "Discard markup?" on close, attach it with an edit pencil | Not present | merged (cb571619). No pencil over the composer photo (2026-09-24). A tap on it opens the full-screen preview first, like the Claude app, and markup is the pencil there, top left, with the X top right (2026-09-26, bfed7943; from 360ef269, 2026-09-24, a tap went straight into markup). After Done the chip shows the marks under the loading ring until the host has them, and a send tapped then waits for them and sends the marked photo; it used to paste the photo without its marks, and the marked copy went with the next message (2026-09-26). A photo still uploading from a pick is waited for the same way, so Send is no longer greyed while one uploads; a wait that runs out (about 11 s, the send's budget less its write reserve) or an upload that fails sends nothing, keeps the text and the photos, and says why. Send tapped again with the same text, trailing spaces aside, while it waits (a chat that remounted draws Send live) is the same send, not a second one; a different message tapped then, or one with a photo added since, is not sent and says "the last message is still waiting for a photo", and the different text or the added photo stays in the composer. Drawing feel and the flattened image need a phone check |
| 11 | A queued message stays queued while Claude Code 2.1.281 draws the queue above its spinner | Drew it as already sent | done (acac520b) |
| 12 | A reply written just before a phone send stays above the message | Drew it below | done (3ed09620) |
| 13 | A quote of several paragraphs has one bar down its whole height, text indented beside it | A bar stub on each paragraph's first line, a lone bar on each blank `>` line, wrapped lines with none | done (60322f4a) |
| 14 | Where a mid-turn message sits among the rows around it: its own sends where it sent them, a message sent elsewhere where the agent took it (below) | A phone text send gave way to the hook's copy and drew under rows written after it | phone sends fixed, not yet checked on the phone; a Claude app send reaches the phone as the hook's text only (below); a Claude app or desktop send keeps rows written just after it below it (f2b2a5ca). A phone send Claude took mid-turn drew as the last row, under the reply that ended the turn, when the chat's read settled late or the chat came back after the turn, and a later send of its text drew twice (fixed 2026-09-25, not yet checked on the phone; records below) |

## New in Claude Code 2.1.283, not yet compared with the Claude app

These come from the 2.1.283 release notes and its binary (2026-09-26), not from
a screenshot, so none is a parity item until the Claude app is seen showing it.
Nothing here is built.

- **Compaction progress.** 2.1.283 times "Compacting conversation…" from the
  start of the compaction and counts the summary's tokens on that line; 2.1.282
  drew a bar under it. Code UI's spinner reader takes a one-word verb only, so
  it reads nothing off that line on either build. The phone never shows the
  compaction, its time or its tokens; what its status line says meanwhile
  follows the pane status Orca reports, which has not been checked.
- **Images from MCP tools.** 2.1.283 also saves each one to a file and puts a
  line after it in the tool result: `[Image: source: <path>]`, the same with
  ", original WxH, displayed at wxh. …" before the `]` when it resized the
  picture, or `[Image source: <path>]` when it knows no size (none when the
  save fails). Orca's reader keeps
  an image only with a path or URL (item 9), so on the phone that line would
  be the tool output's only trace of the picture, drawn as text. Neither that
  nor whether the phone may read the saved file has been checked.
- **Cut messages from other sessions.** In fullscreen mode 2.1.283 opens a
  truncated one with a click. The row itself is unchanged ("(ctrl+o to
  expand)"); Code UI has no way to open a row it only saw cut.

## Evidence notes

- **Thinking (1).** The Claude app draws only `thinking` blocks with the side
  line; the paragraphs read as rephrasings of the visible reply because they
  are Claude's reasoning summary. Its notes between tools, and its answers,
  have no line (2026-09-25, the same session side by side; the phone had drawn
  one beside every note but the newest). So the phone draws the line beside a
  `reasoning` message and nothing else, and folds a thought past 600
  characters behind Show more (#17579). On a terminal Claude tab thinking still
  reaches the phone as ordinary prose, so it gets no line. That is a refusal,
  not a miss: the phone does not guess thinking from the words. The cause is
  in Orca (origin/main 8d6fec597b, 2026-09-23): `claudeMessageRole()` in
  `src/main/native-chat/transcript-line-decoders-claude.ts` returns
  `assistant` for a message made only of `thinking` blocks, though its own
  comment says such a message should surface as `reasoning`, and
  `transcript-record-blocks.ts` turns each `thinking` block into a plain text
  block. The structured lane, Codex and Grok send `reasoning` today, and a
  terminal tab will too as soon as Orca returns the role its comment
  promises (`mobile-native-chat-side-rail.test.tsx`). Codex's decoder does,
  but all 12 Codex rollouts on this machine carry their 1,213 reasoning items
  encrypted, with no summary text, so a Codex tab shows no thought here today
  either. Claude Code 2.1.282 still writes
  `thinking` blocks: 1,245 in this machine's transcripts, of which 201 carry
  text (the rest only a signature), the longest 414 characters. A block with
  no text draws nothing, so when the role arrives most of them add no row. A
  thought past 600 characters folds at the last word before the cut, never
  back at an earlier paragraph, so a streamed one keeps what it showed. No
  2.1.283 transcript existed on this machine to check (2026-09-26).
- **Line counts (3).** Session 76ba8f2f (Claude Code 2.1.282), lines
  4408-4447. The Claude app counts from the full tool input it gets over its
  bridge. The phone gets Orca's mobile payload diet
  (`native-chat-rpc-block-sanitize.ts`, the same 4000-character cap on
  origin/main and the installed 1.4.211), which keeps 4000 characters of a
  tool call's input and ends what it cut with `… (truncated)`. An edit's
  count survives that: Orca attaches the result's `structuredPatch` as
  `editPatch`, and that is not cut, so the Edit's +14 −2 was already right. A
  created file's count does not. A create's `structuredPatch` is empty (3658 of
  3658 creates in this machine's transcripts), its result text names no count,
  and its content is cut (1421 of those 3658; the Write here kept 3896 of 6111
  characters and read "+61 −0"). No RPC the phone may call returns the uncut
  input: `nativeChat.readSession` applies the same diet, `agentSession.history`
  is the structured lane's, and `files.read` gives the file as it is now, not
  as it was written. The phone reads it anyway for a cut create, and takes the
  count only when the file is provably the one the Write made: it still
  starts with every character the wire kept, and no later call in the loaded
  transcript may have changed it (an edit tool naming the same path however
  it spells it, `./`, `..`, `~` or absolute, with `~` read as the home the
  other path is under, and two paths from `~` the same only when all of each
  is; any other call naming the file, as the value glued to a short option
  (`wget -Oname`) too, a command the user ran with `!` among them, except a
  command that only makes it executable, runs it, reads it or stages it,
  where a `~` path is not the file when the other path is absolute and under
  no home, /Users/Shared among them; a call the wire cut, whose dropped part
  may have named it; or a subagent launched or a message sent after it,
  since the agent's own calls are not in this transcript), and no
  background work launched before it was still running when it landed: a
  shell, a monitor, an agent or a teammate that has not reported by then may
  write the file with no call here, and a background agent that did drew
  +125 on a 93-line create in review. That reuses the
  background-task reader's launch and finish records
  (`mobile-native-chat-created-file-work.ts`, tested on that reader's recorded
  sentences: a user-backgrounded shell from Claude Code 2.1.270, agents from
  2.1.281, a teammate from 2.1.283, and SendMessage answers in the shapes
  2.1.228 to 2.1.281 wrote), except where that pairing guesses. It hands a
  failure to the first call waiting and anything else to the first that is
  no Agent call, so among calls waiting together one can take another's
  answer: a background agent beside a Read that failed first lost its launch
  to the Read in review. So a shell, monitor or agent call handed no launch,
  or still waiting when the user interrupted, is read against every answer
  the calls waiting with it took, and runs under any launch of it one names.
  And a stop ends its task unless a failure (a
  `<tool_use_error>`, a turn-down, a cancel, a denial, an answer Orca marks
  as an error, or an interrupt with a call still waiting) landed among the
  answers of the calls waiting with it and none of those answers is
  TaskStop's own word that the task is no longer running: its JSON, or
  `Task <id> is not running (status: completed|failed|killed)` (Claude Code
  2.1.283). So a task that ended where the transcript does not
  say (a mid-turn completion Orca does not surface), a teammate, an agent a
  message woke until its next report, and an Agent call with no answer yet
  all hold the count off. A foreground agent's report is over once it is
  answered, even one long enough for Orca's 4000-character cut to take its
  usage block: a cut answer to an Agent call that asked for no background,
  and opens with no launch sentence and no JSON, is read as that report,
  but only while no other kind of call is waiting for an answer, since a
  command's long output can quote a report, id line and all. Claude Code
  2.1.283's Agent tool answers in four text shapes only (a teammate's spawn,
  a cloud launch, a background launch, and a finished report; any other
  status throws), and every one but the report opens with its sentence, as
  the JSON shape a server flag serves opens with `{`. So
  an agent sent to the background mid-run has no fifth shape to answer in,
  though no record of one exists here. A `!` command is no tool call: Claude Code writes
  it as a user turn, `<bash-input>…</bash-input>`, and its output as the
  next one (136 of them on this machine, Claude Code 2.1.228 to 2.1.282).
  Orca does not filter these out (its Claude decoder drops only meta,
  synthetic and compact-summary turns, at ac675ded6e); the phone hides them
  only when drawing. So the count reads them as Bash calls, and a `!` command
  that went to the background, whose output turn carries the Bash call's own
  sentence (13 of them, 2.1.247 to 2.1.263), runs until its notification the
  same way. The exception for commands is what lets the commonest run, the
  Claude app's "Created a file, ran a command", keep its count, and it is
  narrow (`mobile-native-chat-created-file-commands.ts`): every part of the
  command is `chmod`, `cat`, `head`, `tail`, `wc`, `stat`, `file`, `ls`,
  `cd`, `echo`, `pwd`, `true`, or `less` with no option, a `git add`,
  `diff`, `status`, `log` or `show`, or the file itself run by its path or
  by `bash`, `sh`, `zsh`, `python`, `python3` or `node`, with no redirect but
  `2>&1` or `/dev/null`, no backticks or brackets, no `--output`, and no
  `NAME=value` setting in front (`BASH_ENV` loads code first, and a quoted
  space in one can hide the verb). The verb, every word of a `less` or a
  `git`, and the file an interpreter runs must also read as written: a quote
  inside a word, an escape, a `$`, a glob or a brace list refuses there,
  since `less \-O` and `git diff '--output'=` still write, and a quoted `~`
  is a folder called `~`. A `tee`, a `sed -i`, a `less -O`, a `mv`,
  `cp` or `rm`, a `git commit`, and a command given as an argument list, the
  way Codex sends one, still void the count. The count
  is then the uncut Write's count of that text, through the same pipeline,
  so a small create and a large one agree
  (`mobile-native-chat-created-file-count.ts`). A finished run on screen
  that draws a count asks for it; a run still going, or one folded away in
  focus view, reads nothing. Two reads go out at a time, and only from the
  chat's own settled transcript, never one held over from before it loaded:
  after a reconnect or a move to another worktree the read waits for the
  transcript that connection brings, since the one in hand may lack calls
  made while the phone was away. Each file is read once for the host and
  worktree the chat shows (`files.resolveTerminalPath`, then `files.read`,
  which the host caps at 512 KiB): a verdict, counted or refused, stands
  across reconnects until the chat moves, and holds only for the message it
  was read for, so the same create run again in another session is read
  again. Only a read that failed is asked again, once on each new
  connection, once its transcript is in; if the chat brings none, the count
  stays off. A later call that touches the file still drops its count. A file outside the
  worktree, a binary one, one over the host's cap, or one past the uncut
  Write's own 2000-row or 96,000-character bound gets no number. What this
  cannot see: a command that changed the file without naming it (a glob, a
  directory-wide `sed -i`), a script with the file's name run from another
  folder (a relative name is matched as a suffix, and the shell's working
  folder is not in the transcript), and a change on the desktop that left
  the kept prefix alone. The card keeps "Diff truncated" beside the count, since
  its rows are still the cut ones. Otherwise the chip is left off whenever a
  count cannot be the edit's own: an input the diet cut or a key it dropped, a resolved hunk
  Orca kept only 400 rows of, a patch at Orca's 40-hunk cap, a file the
  journal bounded, or an edit that landed with nothing left to count
  (`mobile-native-chat-edit-wire-cut.ts`). The diff card shows "Diff
  truncated" in place of its count for the same files, and hunk revert
  refuses a hunk the 400-row cut split. Codex: a whole `apply_patch`
  envelope still counts, and a diff that only moved a file adds nothing. An
  envelope cut before `*** End Patch`, whether the `apply_patch` tool's or
  a shell command's, voids its run's chip. Codex 0.153.4 applies every patch
  from inside an `exec` script, as a JavaScript string with escaped
  newlines, which nothing on the phone splits into files, so a run holding
  one draws no chip. A command that edits a file some other way (`sed -i`,
  `cat > file`) is never counted: what it changed is not on the wire.
- **Hand-backs (5).** Since Claude Code 2.1.272 every subagent report is a
  `queued_command` with `origin.kind: "peer"` and `handback: true`; the
  user's own mid-turn messages are `origin.kind: "human"`. Orca's reader drops
  both attachment kinds.
- **What a queued message leaves in the transcript (14).** Two shapes, and
  the phone reads only one. A message still queued when a turn ends is
  dequeued as a `user` row with `promptSource: "queued"`. A message Claude
  takes mid-turn is written as a `queue-operation` enqueue, a remove with
  reason `absorbed_mid_turn`, and a `queued_command` attachment after the next
  tool result, and no `user` row carries it. Counted on this machine on
  2026-09-25 across every build that writes them, Claude Code 2.1.205 to
  2.1.282: 1,998 human prompts written only as the attachment, 378 as a queued
  row, 3,106 `absorbed_mid_turn` removes. On 2.1.280 to 2.1.282 alone: 65, 16
  and 438. Claude Code 2.1.283 (installed 2026-09-25 23:55) keeps both shapes
  by its binary's strings: the same `absorbed_mid_turn` absorption,
  `queued_command` writer and `"queued"` promptSource default; no 2.1.283
  transcript existed yet to read. The phone's code said from 2026-09-14 that a
  queued prompt lands as a queued row "on 2.1.272"; the session it cited
  (63b835a8) holds 190 attachments beside its 20 queued rows, so that was
  never the whole record. The report of 2026-09-25 (session da53d612, 2.1.282,
  lines 3321-3326) was the first shape: a phone send taken 31 s after it was
  queued. The phone now keeps such a send where it was sent and stops waiting
  for a row for it once the queue box lets it go (`isTakenSend`), still
  retiring it if a queued row does land. Codex writes every input as a row: a
  follow-up when it submits it at the end of the turn, a steer when it is
  injected (Codex CLI 0.153.4 rollouts: `response_item` message role `user`
  and `event_msg` item_completed `UserMessage`), so a Codex send always leaves
  on its row. After a remount the hook's copy of such a send is first seen
  timed by the pane's state, which began when the turn ended, so a witness
  seen before the stored echoes are read back is held until they are, and
  dropped then if it copies a stored send (`rememberHeldWitnesses`). The send
  claims that copy unless the copy is timed more than twice a send's 15 s
  budget after it and a user row stamped between them shows the session took a
  newer prompt (`promptTakenBetween`). A row Claude wrote as it dequeued a
  send the box let go goes to that send, not to a later copy of its text.
  Six review rounds on 2026-09-25 drove the same-text cases through the real
  overlay; these stay open, all rare: a message typed at the desk or in the
  Claude app that the phone first sees after the turn draws under the reply
  that ended it (`agent-status-prompts.ts`), since the tab status carries no
  time for a prompt taken mid-turn; the desk repeating a phone send's exact
  text in the same turn, or in a later one whose user row is above the loaded
  page, is taken for the send's own copy and not drawn, and so is one typed in
  a second turn that ended within 30 s of the send; a send whose take the
  phone saw late, with an idle resend of its text landing in that window,
  gives the resend's row to the first (as before these fixes); and a desk
  message seen only while a store read that never returns was out is lost.
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

