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
  the text box. Read from the decompile as about 11 dp (8 dp text padding +
  3 dp), but the user's screen recording (2026-10-14, 1080 px at 2.8125 px/dp)
  measures **16 dp** from the caret's foot to the buttons' top, and 8 dp from
  the buttons to the card's foot. Code UI follows the recording (G37).
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
  so the newest message is item 0 (confirmed 2026-10-15: the call at
  `yv8.java:13366`, `sc4.c`, passes `reverseLayout = true`; section 9). Items are keyed by message id, with
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

## 8. Bottom sheets (Phase 1 of the UI port, 2026-10-14)

Every sheet in the app goes through one wrapper (`xhv.java:1514`) around
Material 3's `ModalBottomSheet` (`ywi.java:1899`). Verified in the
1.261009.20 decompile:

- **Shape**: top corners **44 dp**, `oiv.b = mfs.d(44, 44, 0, 0)`
  (`oiv.java:9`).
- **Colours**: `SheetColors(container, content, grabber, titleBarButton)`
  (`shv.java:38`) built by `oiv.c` (`oiv.java:24-39`): container **`pl7.q`**
  (#F9F9F7 / #151515, Code UI `chatBg`), content **`pl7.O`** (#131313 /
  #F9F9F7, nearest `text`), grabber **`pl7.x`** (#1E1E1D / #E1E0D9 at 15%,
  Code UI `composerBorder`).
- **Grabber**: padding `oiv.h` = 6 dp sides, 5.5 dp top and bottom
  (`oiv.java:15`), then a **36 × 5 dp** bar (`oiv.i`, `oiv.java:16`) clipped
  to a circle, filled with the grabber colour (`wu20.java:928`). It is passed
  only when the sheet state's anchors include **PartiallyExpanded**
  (`okv.e()`, `xhv.java:1469-1477`); a full-only sheet has none.
- **Scrim**: the call passes no scrim, so M3's default applies: the scheme's
  `scrim` at **32%** (`ywi.java:2049`). The app's scheme sets `scrim` to
  black in both modes (`krz.java:4967`, slot 29 = `z49.b`). Code UI token
  `sheetScrim`.
- **Motion** (M3 standard scheme, `syl.java:6-11`): show and drag settle on
  **DefaultSpatial** (ζ 0.9, k 700), hide on **FastEffects** (ζ 1, k 3800)
  (`e230.java:74-91`); the scrim's alpha on **DefaultEffects** (ζ 1, k 1600),
  "ScrimAlphaAnimation" (`ywi.java:2168`). Default max width 640 dp
  (`ywi.java:2054`).

Code UI: `mobile/src/components/sheet-spec.ts` holds the look;
`mounted-bottom-drawer.tsx`, `DraggableDetailSheet.tsx` and
`MobileNativeChatQueueEditor.tsx` read it, and `sheet-spec.test.tsx` pins it
in both schemes and refuses a new sheet that styles its own corners or reaches
for `bgOverlay`.

**Motion is a deliberate deviation.** The M3 springs above were ported on
2026-10-14 and rejected by the user the same day ("Dont do this"; "We need it
smooth same as we have in latest release in git"): a spring from rest showed
nothing on the open's first frame. Every sheet moves exactly as in 0.9.139
(237ce4dca): a 180 ms timed open (ease-out cubic on BottomDrawer, Reanimated's
default on the tool-detail sheet), a 150 ms hide, the `DRAWER_SPRING` settle
(ratio 1, k 400), and a scrim whose opacity rides the open. Reduced motion is
also 0.9.139's: BottomDrawer fades on its open timing, the tool-detail sheet
appears at once. `sheet-motion-0-9-139.test.tsx` and `sheet-spec.test.tsx` pin
all of it.

## 9. Opening a Code session (added 2026-10-15)

Read for the report "the transcript only loads when i open the session and it
starts to populate and scroll down". The app opens a session already at its
newest message and nothing moves.

- **Cache before the first frame.** An in-memory LRU of the last **4**
  sessions (`tdu`, values `sdu` "CachedSession": session, events, model, rate
  limit; events over **16 MB** are stored empty). The view model's constructor
  reads it synchronously (`rs8.<init>` → `rs8.b5`, `rs8.java:897`, `:9265`) and
  applies the events as one `Initialize` with source CacheSeed into a Compose
  snapshot store (`sessions/store/a`). CacheSeed marks events loaded
  (`rs8.J3`, `first_content_source = "cache"`), so the `loading` item
  (`rs8.Y1`, `yv8.java:8694`) is not drawn on a cache hit.
- **List.** `reverseLayout = true` (`yv8.java:13366`, `sc4.c`), state at
  (0, 0) (`rememberLazyListState` defaults). Item order from the bottom:
  `queued_message`, `pending_message`, `loading`, the messages newest first,
  `history_spinner` last (the visual top). No effect scrolls on open; the list
  simply starts at the bottom.
- **Merging.** The connect path reads the newest page(s) (`xjw.b`,
  "loadLatestPageV2": up to **2** pages of **200**, then **500**-event
  backfill pages until a turn boundary, at most **10**) and applies them as ONE
  `Initialize` that replaces the seed wholesale. Stream events after that are
  single inserts or replaces by index.
- **Following new content.** `pc0.a` scrolls to the newest only when the item
  count grew, it was not a history prepend (the newest id unchanged), and the
  first visible index was at most **1** before the change. Scrolls go through
  `gjz.a` → `l030.g`: animate to item 0, then snap.
- **Older pages.** Triggered when the last visible index is within **5** items
  of the end (`wt8` case 0), has older history, no error; at most **6**
  automatic loads in a row. One page of **500** by cursor (`ujw.g` → `m4v.g`),
  applied as `Initialize` with source HistoryPrepend; `history_spinner` shows
  meanwhile.

Code UI: the inverted FlashList is the reversed layout; the kept copy
(`ccr-transcript-persist.ts`) is the seed, read in the first render
(`use-claude-anthropic-transcript.ts`); `CcrSessionLink.catchUp` reads up to 2
newest pages of 200 and lands them in one change before the stream (merged by
key when they reach the held events, replacing them when they do not); and
the composer's height is remembered (`use-mobile-chat-dock.ts`) so the newest
row is clear of the composer in the first frame, where the app's scaffold
inset already is. Not copied: the 4-session LRU (the phone keeps 12, across
restarts), and the older-page trigger stays FlashList's `onEndReached` at half
a viewport rather than 5 items.

## 10. A Code session's transcript loading (added 2026-10-15)

Read for "the loading logo of transcript must be from claude app". The app draws
no spinner and no asset: **Clawd, the Claude Code pixel mascot, dancing**, built
frame by frame in code.

- **When.** The list's `loading` item (`yv8.java:8695`) is added while
  `rs8.Y1()` holds: the session is known, its events are not loaded yet
  (`M0` false), there is no error and no pending send. A cache hit (section 9)
  marks events loaded, so a session held in memory never shows it. It goes the
  moment the first `Initialize` lands. Nothing re-shows it for a reconnect.
- **What.** `mu20.d` draws a Box filling the list's height (`fillParentMaxHeight`),
  centred, holding a column spaced **12 dp** (`lb1(12f)`):
  `oq7.b(nr7.Dancing, …, width 180 dp)`, then the label in `jn7.H` (13 sp) and
  `pl7.O`, centred, 16 dp side padding. The label is `ccr_loading_session`
  "Loading session…" for a Code session (`q09.Code`); a Cowork task gets
  `ccr_loading_task` and a different mark (`mc20.m`), a project
  `ccr_loading_project`.
- **The mark.** `fq7.Dancing` → `tr7.x` ("Dancing") → `rp7` case 8 →
  `ur7.a` → `mz20.k(new ng7(12))`: a timeline of poses (`ClawdPose`, `ns7`)
  rasterised onto a **55 x 37** grid (`hq7` "ClawdFraming(width=55, height=37,
  torsoLeft=18, ground=37)"), one byte per cell, giving **40 frames**. `dz20.a`
  turns each frame into a bitmap (`dz20.r`) with the fixed palette `tq7.b` from
  `gq7`. Dancing uses three colours: Body `o` **#D97757**, Shade `d`
  **#BE684D**, Ink `K` **#141413** (the eyes). The same in both schemes.
- **Size.** The canvas is `aspectRatio(55 / oq7.a)` with `oq7.a = 17`, so
  **180 x 55.6 dp**, and the 55 x 37 bitmap is drawn bottom-aligned at full
  width (`eq7` case 1). Nothing is ever drawn above row 20, so the visible art
  is rows 20 to 36.
- **Timing.** `hr7` "Loop(from=0.1, to=0.9)" plays frames floor(0.1 x 40) = **4**
  to floor(0.9 x 40) - 1 = **35**, then back to 4. The clock is `zx20.u`
  ("rememberLoopingCel", fps **12**). `n1k` waits round(1000 x scale / 12) =
  **83 ms** a frame, where scale is the motion-duration scale.
- **Reduced motion.** `mu20.d` passes `kr7` "Still" when
  `ValueAnimator.areAnimatorsEnabled()` is false. Still holds **frame 0**
  (`hl` case 13, read from the bytecode with `javap`). With a duration scale of
  0, `n1k` also stops advancing.
- **Older history is not this.** The `history_spinner` item (`yv8.t`) is a
  plain Material circular spinner: **20 dp**, stroke 2 dp, `pl7.Q`, in a
  full-width box padded 16 dp.

How the frames were obtained: jadx could not decompile the timeline DSL
cleanly, so the app's own code was run. `mz20.k(new ng7((byte) 12))` was
called through reflection from a small dex (`Dump.java`, built with `d8`) under
`adb shell app_process`, with the 1.261009.20 `base.apk` on the class path, and
each frame was printed as 37 rows of 55 cells. Running it on the desktop JVM
through dex2jar failed: `VerifyError`, and wrong code with verification off.
The 40 frames reduce to 13 distinct poses. They are in
`mobile/src/session/claude-clawd-dancing-frames.ts` as palette-letter strings.

**What Code UI does.** `ClaudeTranscriptLoading.tsx` draws the frames as one
react-native-svg path per colour (a `0 0 55 17` viewBox at 180 dp) and plays
4 to 35 at 83 ms, through `claude-transcript-loading-spec.ts`. The colours are
the theme's `clawd` tokens, the same values in both schemes as in the app. The
label uses Code UI's own `label` text style (13/18) in `text`, per the
keep-own-sizes rule. A Claude tab gets it wherever the chat drew its bare
`ActivityIndicator` before its first rows
(`MobileNativeChatTranscriptLoading`). Other agents keep the spinner. Reduced
motion holds frame 0, and so does a reduced-motion answer not yet known, as
every decorative loop does here. Older history keeps its plain spinner.

**Opening without the loader.** The app keeps a Code session's events only in
the in-memory LRU of **4** (`tdu`, a process-wide singleton, `ja8.java:96`).
The on-disk Room cache (`ConversationCacheDatabase`, tables `snapshot_headers`
and `snapshot_messages`) is keyed by conversation and leaf message, which is
the chat product, not Code sessions. So after the process dies, the app shows
the loader again. Code UI already keeps more: 12 sessions, across restarts
(`ccr-transcript-persist.ts`), a persisted tab-to-session match
(`ccr-session-cache.ts`), the kept copy drawn in the first render, and the link
seeded from it. `claude-transcript-opens-without-loader.test.tsx` pins this:
a kept session never shows the loader, the server's delta merges with no frame
back on it, a session with nothing kept does show it, and a corrupt copy falls
back to it.

## 11. The context ring's Usage sheet (added 2026-10-15)

Tapping the context ring opens a "Usage" sheet: a close cross on the left,
"Usage" centred, a refresh button on the right, then three sections. Each
section is a card of meter rows, and each row has a title, "N% used", a bar and
a caption. The sections are "Context" (Context window), "Plan usage" (Current
session) and "Weekly limits" (All models, and "<Model> only"). The weekly rows
are one card split by a thin gap. The words come from `res/values/strings.xml`
(`usage_*`, `ccr_context_bar_usage_description`).

**The context figure is asked of the live session.** The app posts a
`StdinMessage.ControlRequest` (`jhx.java`, `lhx.java`) to
`v1/code/sessions/{cse}/events`. The body is `{type: "control_request", uuid,
request_id, request: {subtype: "get_context_usage", detail}}`, with `detail`
being "summary" or "full" (`rda.java`, `pda.java`; `g9a.java` and
`tw9.java:40`). Each send gets a fresh uuid and request id
(`j7v.java:683-688`). `j7v.h` waits **45 000 ms** (`j7v.java:1184`) for the
`control_response` whose `response.request_id` matches. That response is an
`SdkControlResponseEvent.Response` (`j7u.java`): `request_id`, `subtype`,
`error`, `response`. The "summary" reply is `ContextUsageTotalsReply`
(`waa.java`): `{totalTokens, rawMaxTokens, percentage?}`. The "full" reply
adds categories, MCP tools, memory files and agents (`aaa.java`), which drive
the chevron's breakdown. Code UI asks for "summary" only, because the user did
not want the breakdown.

The outcomes (`j7v.java:1199-1219`, `taa.java:129-168`, `rr3.java:595-660`)
are:

- An answer: the figure, with "145.5k of 400k tokens".
- A reply that is not a success: the sheet stays as it was.
- No session, a refused POST, or no reply within 45 s: "The session didn’t
  respond. Tap the refresh button to try again."

The percent (`v7a`) is the reply's `percentage` when it gives one. Otherwise
it is round(used × 100 / window), clamped to 0..100. From 75% the row is a
warning, and from 90% it is critical.

When the app asks:

- when the sheet opens;
- when refresh is tapped (`aa6.java:310` → `w530.t`, which re-reads plan usage
  beside it);
- again each time the turn moves while the sheet shows a figure
  (`n0l.java:103-117`).

An answer stands only for the turn it was given in (`taa.g`). After that, the
ring falls back to the session row's `external_metadata.context_usage`
(`SessionContextUsage`, `a3v.java`: `used_tokens`, `max_tokens`,
`after_boundary`) and the newest event that carries one (`v530.g`). That
event's time is the "· Updated <time>" caption.

**Plan usage** is `organizations/{orgId}/usage?skip_spend=1`
(`d310.java:12-16`), `UsageResponse.limits` (`j610.java`). Each `UsageLimit`
(`n510.java`) has `kind`, `group`, `percent`, `severity`, `resets_at`,
`scope{model{display_name}, surface}` and `is_active`. `LimitKind` is
"session", "weekly_all" or "weekly_scoped" (`tw9.java:24`). `group` "session"
goes under "Plan usage" and "weekly" under "Weekly limits" (`t530.java:1830`).
`/api/oauth/usage`, which the phone already calls with each account's own OAuth
token, carries the same `limits` (live 2026-10-15, `scratchpad/probe/p6`). A
failed refresh over rows already shown gives the snackbar "Couldn’t refresh
usage" (`o610.java:190`).

**What Code UI does** (`ccr-context-usage.ts`, `use-ccr-usage-sheet.ts`,
`ccr-usage-sheet-model.ts`, `ClaudeUsageSheet.tsx`):

- It sends the same request through the tab's shared session link. The reply
  is matched on the link's stream, whether it arrives as an `ephemeral_event` or
  a `client_event`.
- It asks on open, on refresh, and at each turn's end while the chat is open,
  so the ring tracks the session itself. Before this the ring read the status
  line: 128k on the phone against 145.5k in the app.
- The answer leads the ring (`ccr-usage-hud.ts`) until the next message, compaction
  or clear lands. Mid-turn the beacon leads again, because it moves with the turn.
  A reply that crosses a turn's end counts for the turn in which it lands.
- A tab with no target and no bound account keeps the old context card, which
  shows the beacon and the host's figures, instead of a sheet stuck on "Loading".
- Every figure is the tab's own: the session and account come from
  `ccrSendTargetForTab`. The plan cards show that account's rows, or the
  config dir's bound account before the match lands. Otherwise they show
  "Loading", never another account's numbers.
- There is no chevron and no breakdown.
- The failed-refresh line sits inline under the cards, where the app uses a
  snackbar.

**Not matched or not determined:**

- The code that chooses between "Resets in 1 hr 38 min" and "Resets Wed 6:59
  pm" did not decompile. Code UI counts down within 24 hours and names the day
  beyond that, which matches both screenshots. The minutes round up.
- The exact format of the "Updated %3$s" time. Code UI writes "5:02 pm".
- Whether `/api/oauth/usage` names the model in `scope.model.display_name` for
  a `weekly_scoped` row. The app's own endpoint does. A scoped row with no
  model is left out rather than given a guessed name. Probe P12 checks this.
- Whether a Remote Control CLI answers `get_context_usage`. Claude Code 2.1.300
  has the handler, plus a "not supported in this context" refusal for hosts
  that do not register it. Probe P12 `--ask` checks this. A refusal leaves the
  ring on its earlier sources.

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
- What sets the app's `snapToBottom` flag on an `Initialize` (`ujw.b` did not
  decompile).
