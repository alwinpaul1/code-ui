# Claude Android app: how the chat behaviours are built

The companion to `claude-app-typography.md`. Same source: the Claude Android
app **1.261009.20** (versionCode 26100920), pulled from the user's phone on
2026-10-11 and decompiled with jadx in a scratch directory. Everything below
describes the app's logic in words, with the numbers it uses. No decompiled
code, fonts or images are in the repo.

Class names are R8-obfuscated and change every release. They are pointers for
re-checking this build. String resource names (`ccr_*`) are stable. "ccr" is
the app's prefix for Claude Code remote sessions. Colour tokens (`pl7.*`,
`ad5.*`) are resolved to hex in the typography doc.

Some items are marked *inferred*. There the decompiler output was damaged or
the logic was read from data tables rather than a clean method.

## 1. The tool-run summary row

Classes: `zx20` builds the sentence, `h330` picks the label, `da20` draws the
row, `hu20`/`jqv` do the shimmer, `ra20` draws the line-count pill.

### Grouping

- A **run** (`q39`) is a consecutive stretch of tool calls in a turn. Its
  calls are bucketed by category **in the order each category first
  appears**. Categories (`lwy`): Read, Edit, NotebookEdit, Write, Bash, Grep,
  Glob, Web, Todo, Task (agent), ExitPlanMode, Other.
- Within a category, calls are **de-duplicated** by a key such as the file
  path, else by call id. Reading the same file twice counts as one read.
- Each bucket counts its distinct calls and its failed ones. Call status is
  Pending, Completed or Failed (`rvy`).
- **At most three categories are named.** With more than three, categories
  that have failures are taken first, then the rest, then the first three of
  that list are shown, in their original order.

### Wording

- Each part is a plural string expanded with the count: `ccr_summary_bash`
  "Ran a command" / "Ran ^1 commands", `ccr_summary_read` "Read a file",
  `ccr_summary_edit` "Edited a file", `ccr_summary_write` "Created a file",
  `ccr_summary_notebook_edit`, `ccr_summary_grep` "Searched code",
  `ccr_summary_glob` "Found files", `ccr_summary_web` "Browsed the web",
  `ccr_summary_todo` "Updated todos", `ccr_summary_task` "Ran an agent" /
  "Ran ^1 agents", `ccr_summary_proposed_plan` "Proposed a plan",
  `ccr_summary_other` "Used a tool" / "Used ^1 tools".
- Parts after the first get a **lower-case first letter** and are joined
  with ", ": "Ran 2 commands, read a file".
- Partial failure: `ccr_summary_with_failed` "Ran 3 commands (1 failed)".
  When **every** call in a category failed, that part's verb (or the whole
  part) is drawn in the danger colour `ad5.u()`.
- Peer messages that arrived during the run add "received N messages"
  (`ccr_summary_received`), at the end, or first when the run holds an
  unacknowledged peer item.
- Empty result: `ccr_collapsed_steps_title` "Steps".

### Which label a finished run shows (`h330.i`), in order

1. **A single call with a detail**: the verb, a space, the detail. A file
   detail is drawn in the primary colour in the code font; any other detail is
   muted.
2. **The run carries a server summary** (`q39.c`): that text, with the run's
   own file names matched inside it and drawn primary plus mono.
3. **The run holds a described Agent call**: `ccr_summary_agent_described_more`
   "Ran agent: <description> (+N tools)", N = calls in the run − 1, in
   `#898781`.
4. Otherwise the grouped sentence.

### The live label (`h330.b`)

- If any call is Pending, the label describes the **last pending call**:
  `ccr_verb_running_agent_described` "Running agent: <desc>" when that call's
  agent description is known, otherwise its present-tense verb from the verb
  table ("Running", "Reading", "Editing", "Running agent", "Running skill",
  "Searching web", "Messaging @name", …; anything unknown is
  `ccr_verb_used_named` "Using %s"). **No icon.**
- If nothing is pending but background tasks started by this run still run,
  the last one is shown as if pending, **with** a 24 dp icon in `#898781`:
  `commandLinePrompt` when all are shells, `agentSimple` for exactly one
  agent, `agentsSimple` for a workflow or several agents.
- The live row is drawn with the shimmer on; the finished row with a solid
  colour.

### Row geometry

- Full width, clipped to a **12 dp** rounded rect, ripple, tap opens the run
  sheet. Padding **8 dp** left and right, **6 dp** top and bottom (`w55.b`; a
  second variant uses 8/10/8/10).
- Contents: optional icon (24 dp, shifted 2 dp left, 4 dp gap), the label
  (15 / 400 / 1.4, one line, no wrap, ellipsis; **middle ellipsis** when the
  detail is a single path), the optional pill, a 4 dp spacer, a 16 dp
  `caretRight` chevron in the muted colour. The chevron turns ±90° only for an
  inline-expandable row.
- **Line-count pill** (`ra20.a`): 8 dp after the label; two segments "+A" and
  "−R" (a real U+2212 minus) clipped as one shape with a 4.5 sp radius; each
  segment 18 tall with 6 horizontal padding; 11 / 550; green or red text on
  the same colour at 20% alpha.

### Shimmer (`hu20.e` → `jqv.a`)

- A **horizontal linear gradient used as the text brush**: base colour, base
  at **10% alpha**, base. So it is a **dimming** band moving through the muted
  text, not a bright highlight.
- The band is centred on `p · W` with a half-width of `0.25 · W` (W = text
  layout width), so the band spans half the text width, clamped at the ends.
- `p` runs from **−0.25 to 1.25** in an infinite transition,
  **tween 1500 ms, linear easing, restart** (one sweep left to right every
  1.5 s, then it jumps back). *The repeat mode is read as Restart from the
  range; the int behind it was not decoded.*
- The icon does not move; only the label's brush animates.

## 2. The ↓ scroll-to-latest button

Shared composable `gc20.c` (content description
`generic_button_scroll_to_bottom` "Scroll to bottom"). In the Claude Code chat
it is driven from the session screen `yv8` through a small state holder
`gjz` (made by `l030.o`).

- **When it shows.** The list can scroll, no programmatic scroll is in
  flight (a counter in `gjz` is zero), and either the newest item (item 0,
  the list is laid out from the bottom) is not visible, or it is visible but
  has moved more than **48 dp** from its resting offset. The regular chat uses
  a different rule: the last visible item ends past the viewport bottom minus
  an inset.
- **Where.** A Box aligned **bottom centre** of the content area, inside the
  scaffold's padding, so it sits just above the composer.
- **Look.** A 40 dp circle in a 48 dp touch target. Fill `pl7.p` at 96%
  (white / `#20201F`), 0.5 dp border `pl7.x`, shadow blur 8 dp, black at 10%,
  offset 0, 2 dp. A 16 dp `arrowDown` icon in the primary text colour. Bounded
  ripple of radius 20 dp.
- **Animation.** Enter: scale from **0.01** plus fade-in. Exit: scale to 0
  plus fade-out. Both on `spring(dampingRatio = 1.0, stiffness = 400)`, so it
  settles with no overshoot in roughly 250–300 ms.
- **Tap.** Increments the in-flight counter (which hides the button). If the
  newest item is off screen, `animateScrollToItem(0, 0)`. If it is on screen
  but offset, `animateScrollBy(offset)` on `spring(damping 1, stiffness 1500)`,
  then a snap `scrollToItem(0, 0)` if it has not settled. Then decrements the
  counter.

## 3. Images in the chat

### Thumbnails

- **In a user message** (`m330`; same shape in `b80`): **96 × 96 dp**,
  **12 dp** radius, **Crop**. One horizontally scrolling row with **8 dp**
  gaps. Phone-uploaded attachment tiles (`g330.c`, also 96 dp, with upload
  progress, failure and video-duration states) come first, then inline images.
  The row gets **8 dp bottom padding only when the message also has text**.
- **Loading and error.** No shimmer, no spinner. The tile is filled with
  `pl7.q` (the screen background: `#F9F9F7` / `#151515`) behind the image, and
  no error painter is set, so a failed image stays an empty tile.
- Tap opens the preview (`ccr_preview_attachment_a11y` "Preview image").
- **In assistant or tool content** (`y030.s`): full width, height capped at
  **400 dp**, 12 dp radius, **Fit**, tile `pl7.s`, 8 dp from the surrounding
  text.

### How the image bytes arrive

- Inline user images (the base64 image blocks in the message) are decoded on
  the phone (`w33` → `t33`). No network request.
- **SendUserFile / SendUserMessage attachments.** The tool result carries a
  list of attachments (`uju`: file_uuid, file_name, is_image, mime_type,
  size_bytes). The tool row's detail is the first file name plus " +N".
- URL shapes (`ob20`): an image preview is
  `{base}/api/{org}/files/{file_uuid}/preview`; downloads and non-images use
  `{base}/api/organizations/{org}/files/{file_uuid}/contents`.
- In a session that has a channel, the image model is
  `ChannelAttachmentImage(channelId, fileUuid, uploaderUrl, copyMayLagSince)`
  (`mg5`), loaded by a custom Coil fetcher (`vg5`) as
  **GET `v1/code/channels/{channel_id}/attachments/{file_id}/content`**,
  capped at **8 MiB**. Because the uploaded copy can lag behind the message,
  it **retries with backoff**: 720 ms first, ×1.8 each time, at most 7558 ms
  between tries, within a **90 s** window. Cache key
  `channel-attachment/{channelId}/{fileUuid}`; without a channel the preview
  URL is the key.
- All of this goes through the signed-in API client. No token is put in a
  URL.
- *Not traced:* whether the `/preview` URL (carried as `uploaderUrl`) is a
  fallback when the channel fetch fails, and how Read-tool image results
  (`ToolResultImage(file_uuid)`) are drawn.

### Full-screen viewers

There are two.

- **Claude Code image preview** (`u920` pager, zoom in `yy20.y`): a pager over
  the message's images, title "Image preview". Close at the leading edge.
  Actions at the trailing edge, 8 dp apart: **Edit** (pencil,
  `image_markup_edit`) and **Share**; another toolbar variant has Edit and
  **Save image** (`ccr_picture_viewer_save`).
  - Max zoom = 6 ÷ the fit scale (when that is above 1), else 5×.
  - Pinch can undershoot to 0.9× and springs back.
  - **Double-tap** toggles between 1× and a target: the fill-screen ratio if
    it is above 1.02, else 2.5×, never past the max.
  - At 1× a horizontal drag goes to the pager. When zoomed, a mostly
    horizontal drag (|dx|/|dy| > 3) at the pan edge also goes to the pager.
- **Chat image gallery** (`lfh`): black background, 8 dp between pages,
  overlays fade over **100 ms**, scrim black at 40%. Pinch to **5×**, no
  double-tap zoom. **Drag to dismiss** past **120 dp** or on a fling faster
  than **1200 px/s**, otherwise it springs back. White spinner while loading;
  on error "Something went wrong" in white at 70%, 15 sp.

### The markup (pencil) editor

Classes `jgh` (screen), `fgh` (layout), `dgh` (canvas and bar), `pgh`
(state), `q130`/`fl` (compositor).

- Full-screen black surface with the image centred. Top bar under the status
  bar inset, items 8 dp apart: close, **Undo** and **Redo** (44 dp touch
  targets, 24 dp icons, 20 dp apart, dimmed when their stack is empty), a
  flexible spacer, **Done** (check icon). Title "Mark up image"
  (`image_markup_title`); while saving, "Saving…" and the screen cannot be
  dismissed.
- **One tool, a pen.** No colour picker, no width choice, no eraser.
  - Colour **#B93535**.
  - Width **8 dp** at the on-screen size, stored as a fraction of the
    displayed image width, so it scales with the output resolution.
  - Points are stored normalised to 0..1 of the image; the path is smoothed
    with quadratic curves through the midpoints; round caps and joins.
- **Undo/redo**: two stacks; a new stroke clears redo.
- **Closing with strokes** asks "Discard markup?"
  (`image_markup_discard_title`) with "Discard" and the default cancel.
- **Done** works only with at least one stroke and none in progress. Then:
  - the strokes are drawn into a copy of the bitmap, **longest side capped at
    2000 px**;
  - saved as **PNG (quality 100)** when the source has alpha and is not a
    JPEG, otherwise **JPEG at quality 85**;
  - in a Code session written to the cache as
    `code_markup/markup_<id>/<original name>-markup.<ext>`;
  - **added to the composer as a new attachment**.
- It tracks where the image came from: STAGED (already in the composer) or
  TRANSCRIPT (from the chat). A chat image is never changed in place; the
  marked copy goes to the composer. *That marking up a staged attachment
  replaces it is likely but not confirmed.*
- Animated images are refused: "Editing isn't available for animated images".

## 4. The composer

Chain: the session screen `yv8` → composer `x030.b` → surface `o530.b`, text
field `aj1`, placeholder `ib8`, custom measure policies `ai9` (button row) and
`di9` (text-versus-buttons layout), buttons in `yg9`/`bb8`.

- **Shell**: 24 dp radius, fill `pl7.p` at 96%, 0.5 dp border `pl7.x`, shadow
  blur 8 / black 10% / offset y 2, 8 dp vertical padding inside, none
  horizontal at this level.
- **Text field**: 17 / 400 / 1.4 Anthropic Sans, colour and caret `pl7.O`.
  Padding works out to **13 dp horizontal, 8 dp vertical**. **1 to 6 lines**,
  then it scrolls inside itself (about 143 dp of text). Sentence
  capitalisation. The placeholder uses the same style in the muted colour and
  shows only while the field is empty.
- **Button row**: 8 dp in from both edges; a leading group (attach and mode
  chip), a flexible middle, a trailing group (model chip, mic, Send/Stop) at
  least 8 dp from the middle. Row height = tallest child (36 dp) + 6 = 42 dp.
- **Gap between text and buttons**: no spacer. The buttons sit straight under
  the text box, so the visible gap is about **11 dp** (8 dp text padding +
  3 dp).
- **Buttons**: 36 dp, 48 dp touch target, 20 dp icons.
  - Send: clay fill, white `arrowUp`; disabled at 40%; while sending
    ("Sending") the icon becomes a 24 dp progress ring, stroke 2.
  - Stop: fill `pl7.x0`, `stop` icon in the text colour; while stopping a
    36 dp ring, stroke 1, around it.
  - Mic: plain icon button, `microphone` in `pl7.P`.
  - Model chip: a 36 dp pill, 16 dp side padding, at most 220 dp wide
    (scaled by font scale).
- **One-row (collapsed) mode**: in Code sessions the composer is set to
  collapse "WhenIdle" (`xk9`). Collapsed, the text slides inline between the
  button groups on one row. The change is an animated 0..1 fraction. It is
  tied to the keyboard insets and orientation. *That it collapses exactly when
  the keyboard is hidden and the field is empty is inferred.* The claude.ai
  input's collapsed height is max(36, one line) + 16 = 52 dp.
- **Placeholders** (`yv8.L`): idle Code session "Type / for commands"; busy
  **"Queue a message…"** (`ccr_input_placeholder_existing_session_queue`);
  busy with the `code_steering_messages` flag on, still "Type / for
  commands"; a new session "Describe a task or ask a question…".
- **Dictation**: the mic starts speech input. Hold-to-talk is behind the
  `claudeai_walkie_talkie` flag (hint "Reply or hold to talk", hold target
  grows to 1.2×). While recording: a waveform, "Transcribing…", release hints
  ("Release to send", "to stop", "to cancel"), Cancel, Stop dictation and
  Send dictation buttons.
- **Caret**: after a send the field is cleared in one edit transaction.
  Nothing further was traced.

### Sending while Claude works (the queue)

- With the `code_steering_messages` flag on and a turn active (and no
  permission prompt or pending tool in the way), a send goes out **at once as
  a steering message**.
- Otherwise, while busy:
  - with the `ccr_queued_send_post_at_later` flag, it first asks the server
    to send the text later;
  - else, or if that fails, or a local queue already exists, it is **queued
    locally**. The local queue is **one string**: a further send is appended
    to it after a blank line ("\n\n"), and the composer is cleared.
- **At turn end** the queued text is sent automatically when the session can
  take it. If something blocks it (not connected, a permission pending, a
  draft in the composer, attachments, a bash-mode message) it is **moved back
  into the composer** instead.
- **Drawn as** (`hb20.e`): 20 dp above, **80% width**, aligned like a user
  message, 12 dp radius, fill `pl7.s`, 12 dp padding, 15 sp **italic** text
  in the muted colour, a 14 dp "x" at the top end ("Edit queued message").
  **Tapping anywhere moves the text back into the composer** and clears the
  queue. There is no separate delete.
- The ordinary chat's waiting user bubble breathes in alpha 0.65 ↔ 0.9 over
  1400 ms (cubic 0.4, 0, 0.2, 1), holding at 0.7 under reduced motion.

## 5. The status line and the Background tasks sheet

### Status line above the composer (`au8` → `nl7.b`)

- A row with 16 dp vertical padding: a **16 dp** clay spinner sprite
  (`cc_spinner_sprite`), 8 dp gap while working, then 15 / 400 / 1.4 text,
  parts joined by " · " (`ccr_spark_segment_separator`).
- **Working, with timing data**: "12s · 1,234 tokens" in the muted colour
  (elapsed as "%ds" or "%dm %ds"; the token count animates upward), then
  " · N running tasks" as a **tappable link** (`ad5.C0()`, `#184F95` /
  `#6DA7EC`), then " · thinking…", one line, ellipsised.
  - The thinking word changes with time: under 15 s "thinking…", then "still
    thinking…" (15 s), "thinking more…" (30 s), "thinking some more…" (45 s),
    "almost done thinking…" (60 s). When thinking ends, "thought for Ns"
    stays for **2 s**.
- **Working, without timing data**: a random verb plus "..." in clay, chosen
  from 20 (Clauding, Cogitating, Computing, Contemplating, Cooking,
  Deliberating, Generating, Imagining, Musing, Noodling, Pondering,
  Processing, Scheming, Synthesizing, Thinking, Tinkering, Working,
  Ruminating, Percolating, Brewing). It changes after **3 s, then 4 s, then
  every 6 s**, and does not change under reduced motion.
- **Idle with tasks still running**: only "N running tasks"
  (`ccr_workflow_running_tasks`) in the link colour, at least 48 dp tall,
  labelled "Background tasks" for screen readers.
- Tapping the row (while tasks exist) opens the sheet.

### Background tasks sheet

- Destination `BackgroundTasksDetail`, title "Background tasks"
  (`ccr_workflow_background_tasks`). Opens at a **partial height**
  (`expandOnEntry = false`), content scrolls, drags up. Also reachable from
  the session menu.
- Two collapsible sections, **"Running"** and **"Finished N"**: 13 sp headers
  in `#898781` with a caret (down when open, right when closed). Empty state
  "No background tasks".
- **Row card** (`cu2.b`): full width, **16 dp** radius, fill `pl7.r`,
  **16 dp** padding, 12 dp between icon and text.
  - Icon: shell `codeBlock`, agent `agentSimple`, workflow `agentsSimple`,
    small, tinted `pl7.P`.
  - **Title**: the task's `description` from Claude Code's `task_started`
    event. If it is blank or equal to the task id, the kind label
    (`ccr_background_tasks_kind_shell` "Shell", `_kind_agent` "Agent",
    "Workflow"). 15 / 550, primary colour, **at most 2 lines**.
  - Meta row, 4 dp below, items 12 dp apart: the kind label (only when there
    is a real title), then the state: elapsed time while running,
    "Stopping…", or "Completed" / "Stopped" (muted) / "Failed" (red
    `pl7.A`).
  - A third line when known, hidden while running: "N tokens · N tool uses",
    plus **"View transcript"** as a link when an agent transcript exists.
  - **Stop**: running rows have a `stopCircle` icon button in a 40 dp box
    ("Stop task"), disabled while stopping. **No confirmation**: a tap calls
    stop directly. Failure shows the snackbar "Couldn't stop the task. Try
    again."
  - Finished shell rows are tappable ("Show output") with a trailing chevron.

## 6. Subagent and agent hand-back messages

- Before user text is drawn, about 40 envelope tags are **removed with their
  contents** (`g2a.c`), including `system-reminder`, `task-notification`,
  `agent-notification`, `bash-notification`, `teammate-message`,
  `channel-message`, `local-command-caveat`, `local-command-stdout/stderr`,
  `command-message`, `thinking`, `persisted-output`,
  `available-deferred-tools`. `command-args` keeps its contents. **A message
  that is blank after stripping is not drawn.** The "[Request interrupted by
  user…]" markers are recognised separately.
- Each user entry's origin (kind, subkind, sender) decides how it is drawn
  (`alt`, `rhu`; *partly mis-decompiled, read from its branch tables*):
  - **A subagent finishing** (a task notification) is **never a user turn**.
    Its `<task-id>` and `<status>` are parsed and fed into the background
    tasks list, together with the system events task_started,
    task_progress, task_updated, task_notification and
    background_tasks_changed.
  - Other machine kinds (auto-continuation, observer, slack-ping, plugin,
    channel, unclassified) are not drawn as user turns either.
  - **A message from a peer agent or the team lead**: if a tool run is open,
    it is **folded into that run** and only counted in the sentence
    ("received a message"). Otherwise it gets its own row, "Received message
    from <name>" (`ccr_received_message_from`; also "…from another session",
    "…from team lead"), the name in `ad5.u0()`. Tapping it opens a sheet
    titled "Message", headed "From: <name>".
- **Sender names are checked against spoofing**: NFKC-normalised,
  lower-cased, and rejected if they come out as "team lead", "a teammate",
  "subagent", "another session" or "unknown sender" (`dc20.u`).

## 7. How the chat list is built

- One `LazyColumn` in the session screen `yv8`, **laid out from the bottom**
  so the newest message is item 0 (*inferred from the key order and the scroll
  logic, not read from the call itself*). Items are keyed by message id, with
  `fallback_<i>` when an id is missing. Virtualisation is the plain lazy list
  with stable keys; nothing custom.
- Bottom-most extra items, in order: `queued_message` (the queued text),
  `pending_message` (the optimistic send), `loading`, an optional banner,
  then the messages.
- **Item kinds** (`pe7.q`): message (user or assistant text), tool run (the
  collapsed row), "focus fold" (a collapsed group), a single inline tool
  call, refusal notices, and two boundaries: context cleared, and context
  compacted ("Compacted conversation · saved N tokens"). Three more kinds were
  not identified.
- **Turn separators**: none. The two boundaries are the only dividers.
- **Spacing**: every item has 16 dp horizontal padding; most rows add
  **12 dp above**; tool runs, focus folds and notices add a further 8 dp each
  side (24 dp from the screen edge). Inline tool calls stack in a column with
  8 dp gaps, with 12 dp above only when they start a group (the screen looks
  ahead to see whether the next item continues it).
- **Content padding**: the scaffold's insets (the composer at the bottom),
  plus at the top 64 dp for the floating header and an animated extra (0,
  36 dp, or a measured banner height).

## Not determined

- The fallback use of the `/preview` URL, and how Read-tool images are drawn.
- Whether the markup bar hides while drawing, and whether marking up a staged
  attachment replaces it.
- The attach (+) button composable, and the exact one-row composer trigger.
- The spinner sprite's frame count and timing.
- How far up the Background tasks sheet opens.
- The meaning of three chat-list item kinds.
- The shimmer's repeat-mode int, which was read from its −0.25 → 1.25 range
  rather than decoded.
