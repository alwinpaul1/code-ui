# Claude app parity: gaps and batches

The user's instruction (2026-10-11): "copy everything from the Claude mobile
app, even the input box, everything, also regarding how they use Claude Code in
mobile", and then: "check how Claude mobile sends the message and how it lands,
and add that to Code UI."

**Source.** The Claude Android app **1.261009.20**, decompiled with jadx in a
scratch directory, read but never run. It is compared with Code UI `main` on
2026-10-11. Behaviour is described in words. No decompiled code is in this repo.
Class names are R8 pointers that change every release. `ccr_*` string names are
stable. Companion docs:

- `claude-app-typography.md`: fonts, type scales, colour tokens.
- `claude-app-implementation-notes.md`: tool-run row, shimmer, ↓ button,
  thumbnails, viewers, markup, composer shell, queue, status line, Background
  tasks sheet, hand-backs, chat list build.
- `claude-app-parity.md`: the screenshot-driven parity items 1–17.

**The constraint that shapes every row below.** The Claude app drives a session
through Anthropic's servers: an HTTP events API and an SSE stream, with typed
control requests. Code UI talks only to Orca on the user's desktop. It types into
Claude Code's terminal through `terminal.send`, and reads three things back: the
screen, the transcript through `nativeChat.*`, and the agent's status through
`session.tabs.subscribe` and the invisible HUD beacon. Nothing may be installed
or drawn on the desktop (root `CLAUDE.md`). So "the same behaviour" often means
the same thing seen by the user, reached by keys and screen reads, with refusal
whenever the screen is ambiguous.

**Classification used below**

- **Match**: same behaviour and look.
- **Differs**: present, but not the same; the cell says how.
- **Missing**: not built, and buildable.
- **Impossible via Orca**: needs Anthropic's servers or a desktop change.
- **In progress**: already being worked on (see the list below).

**Already in progress, not re-planned here**

- Typography and colours.
- Composer look and the queue.
- Thumbnails and markup.
- The running-row shimmer and the ↓ arrow's threshold.
- The Background tasks sheet's titles and its Stop button.

Where a gap below touches one of these, it is marked **in progress** and only
the extra behaviour is listed.

---

## 1. How a message is sent and how it lands (priority section)

### 1.1 The Claude app, step by step

Sources: `rs8` (screen ViewModel: `F4` normal send, `G4` send with a priority,
`h6` the local queue), `o9a` (pending-send state), `sessions.store.a` (send
dispatcher), `hju` (session controller), `y2v` (REST), `qhu` (transcript
reducer), `ujw`/`lvu` (SSE loop and parser).

**1. The send action**

- The composer's send lambda picks one of three paths:
  - a **steering** send, behind the flag `code_steering_messages`, used while a
    turn is active (and not in an edit or bash mode);
  - a **normal** send (`F4`);
  - while busy without steering: a **server "post later"** send (flag
    `ccr_queued_send_post_at_later`), or else the **local queue**.
- If the chosen path accepts the send, the composer is cleared in one edit
  transaction.
- `F4` **refuses and leaves the text in the composer** in these cases:
  - a send is already in flight;
  - a retry is being held for this session;
  - a bash-mode prompt is pending;
  - the text is empty and there are no uploaded attachments.
- While the remote-control computer is offline it also refuses, showing "Remote
  control session is offline. Reconnect or run /remote-control to start a new
  session."
- Editing an earlier message sends a rewind first, then the message (see 2.1).

**2. The request**

- **Client message id.** `UUID.randomUUID()` is minted before anything is sent.
  There is **no idempotency header**. The event's `uuid` is the only dedupe key.
- **Endpoint.** **POST `v1/code/sessions/{cse_id}/events`**. The `session_…`
  id is rewritten to `cse_…` in both the path and the body.
- **Body.** `{session_id, events: [ClientEventEnvelope]}`. Each envelope is
  `{payload, device_attestation?, user_declared_urls?}`.
- **The user payload** has these fields:
  - `type: "user"`;
  - `uuid`;
  - `message: {role: "user", content: "<plain string>"}`;
  - `file_attachments: [{file_uuid, file_name, is_image}]`;
  - `priority`, set to `"next"` (steering) or `"later"` (post-later), and absent
    on a normal send;
  - `seeded_kind` / `seeded_summon`, used for artifact comments.
- **Pasted long-content chips** are appended to the text after `\n\n---\n\n`.
- **Settings ride in the same batch.** A pending model change goes as a
  `control_request` (`set_model`) before the user event, and a pending mode
  change as `set_permission_mode`. So the setting and the message land together,
  in order.
- **Attachments are never inline.** Each is uploaded when it is attached (POST
  `{org}/upload`, multipart part `file`), and only chips that have **finished
  uploading** are referenced, by `file_uuid`.
- **Response.** It carries no message id. It holds only
  `attestation_feedback`, and **a 2xx is the whole ack**.

**3. Optimistic display, then confirmation.** Two optimistic layers share the
client uuid:

- **The `pending_message` row** (the bottom-most list item after the queue).
  - While the send is unconfirmed it is drawn at **50% alpha** with the label
    **"Sending"** (`ccr_send_unconfirmed`).
  - The Send button shows a 24 dp progress ring, stroke 2, in the same state.
- **An optimistic transcript row** inserted by the reducer, with the same uuid
  and a local, monotonically increasing sequence number.

The send then confirms in two steps:

- **The HTTP ack** clears the in-flight state, which takes the "Sending" label
  off the transcript row. It does **not** remove the pending row.
- **The echo** arrives on the SSE stream (`GET …/events/stream?from_sequence_num=N`)
  as a `client_event` with `source: "client"` and `payload.uuid` as the row id.
  It clears the pending row **by uuid match, never by text**. One exception: a
  plain user echo with no `origin` (or from the team lead) clears the pending
  row whatever its uuid, because only one send can be pending.
- **A failure that raced its echo** counts as a **success**: the POST failed,
  but the echo for that uuid was already seen.
- **Delivery states.** `delivery_update` frames (RECEIVED / PROCESSING /
  PROCESSED) mark when the agent picked an event up.

**4. Failure, timeout and retry**

- **Retry is off by default.** The remote flag `claudeai_code_send_retry` turns
  it on. Its defaults:

  | Field | Default |
  |---|---|
  | `max_attempts` | 0 |
  | `initial_delay_ms` | 500 |
  | multiplier | ×2 |
  | `max_delay_ms` | 10 000 |
  | `retry_on_io_exception` | false |
  | `retry_on_http_codes` | [] |
  | `wait_for_network_ms` | 0 |
  | `send_deadline_ms` | none |

- **Every retry re-posts the same events list**, so the same uuid. While a retry
  is held, further sends are refused.
- **Held records live in memory only.**
- **The failure UI in a Code session:**
  - the optimistic row is removed;
  - **the text, and any pasted chips, go back into the composer**;
  - the error reads "The Internet connection appears to be offline." or "Unknown
    error" (with the server's message where it gave one);
  - a **snackbar offers Retry**, which re-sends the restored text;
  - a mode change bundled with the send is reverted, with "Couldn't change mode.
    Try again."
- **"Failed to send. Tap to retry." is not used in Code sessions.** That row,
  and "Failed to send." with Dismiss, belong to the project-channel timeline.

**5. Sending while Claude is busy**

| Mode | Where the text lives | When it is delivered |
|---|---|---|
| Steering (`code_steering_messages`) | server | at once, `priority: "next"` |
| Post later (`ccr_queued_send_post_at_later`) | server | sent at once with `priority: "later"`. The server holds it, inferred until the turn ends; `delivery_update` PROCESSING then marks the pickup. Not available for slash commands, a new session, or when a local queue already exists |
| Local queue (fallback) | **one in-memory string** on the ViewModel; a further send is appended after a blank line | at turn end, as an ordinary send (see below) |

- **Turn end, local queue.** The queue is sent as an ordinary send if nothing
  blocks it. Otherwise it is **moved back into the composer**. Blockers:
  - a permission prompt;
  - bash mode;
  - a draft in the composer;
  - attachments;
  - pasted chips;
  - an edit in progress.
- **Leaving the session screen** with a queue left posts it as a `"later"`
  message with a fresh uuid.
- **Look.** 80% width, 12 dp radius, 15 sp italic muted text, and an "x" ("Edit
  queued message"). A tap anywhere moves the text back to the composer.

**6. Offline and background**

- **There is no offline queue and nothing is written to disk.**
- With no session attached, a send fails at once ("Not connected to a session")
  and the text returns to the composer.
- Sends run on the session store's coroutine scope. Inferred: they survive
  navigation but not process death.
- **No WorkManager job or foreground service sends messages.** The only
  WorkManager job in the session code handles permission actions from
  notifications.

**7. Ordering**

- **Exactly one send in flight.** A second tap is refused, not queued.
- There is no client mutex and no client sequence number. The server's
  `sequence_num` orders the transcript, and within one POST the batch is ordered:
  control requests first, then the message.

### 1.2 Code UI today

Sources: `mobile/src/session/use-mobile-native-chat-message-send.ts`,
`mobile-native-chat-send-write.ts` (`writeChatSend`),
`mobile-native-chat-submit-verify.ts`, `native-chat-outbox-*.ts`,
`mobile/src/storage/native-chat-outbox.ts`, `docs/mobile-chat-outbox.md`.

**1. The send action**

- One send per composer at a time: Send stays grey until the send settles,
  verify step included.
- A per-terminal write lock refuses a second sequence: "Another input is still
  being sent. Try again."
- Each tap gets a **15 s budget**. No write starts with under 2 s left.

**2. The write**

- **Clear first, verified.** It counts the input's rows on screen and sends
  Ctrl+U/K, under 64 bytes. It settles 150 ms, looks again, makes at most 2
  passes, and refuses if text is still there.
- **Then the body.** `terminal.send {text, enter: true}`. Enter comes from the
  host flag; there is no bracketed paste for the body.
- **Photos.** They are uploaded first through `clipboard.*Upload` to a desktop
  temp path, pasted as bracketed paths, and the `[Image #N]` chips are polled
  for (250 ms, up to 6 s) before the text goes.

**3. The optimistic row and how it lands**

- **Drawn at once.** The echo is drawn the moment the box empties. Its id is
  `pending-outbox-send-<ts>-<uuid12>`, a client id that never leaves the phone.
- **No "Sending" label.** It was removed on 2026-10-10.
- **Retired only by a transcript row**, matched by **normalised text plus an
  occurrence count after a baseline**. The baseline is the transcript's tail and
  how many times the same words already appear.
- **The delivery-on-record rule.** Claude's own record proves the send arrived:
  - the beacon's `up=` field;
  - Orca's `agentStatus.prompt`;
  - a drawn `❯` prompt or queue row;
  - the transcript row.

  The first three only stop the "unconfirmed" clock. The bubble retires on the
  transcript row.
- **Persistence.** The echoes are stored in AsyncStorage
  `orca:chatPendingEchoes:*` for 24 h.

**4. Verify (Claude only)**

- It settles 300 ms, then checks for 4.5 s.
- If Claude says it removed invisible characters, the result is **not-sent**,
  and the draft goes back.
- If the words are still typed at the end, it presses Enter **once more**, but
  only after two looks 600 ms apart show exactly those words.

**5. Failure and retry: the outbox**

- **When the entry is written.** Before the composer empties, chat sends only
  (`orca:chatOutbox`, pruned after 7 days).
- **An `unknown` ack** (the ack was lost or the client cut over) is held for
  **20 s of foreground time**, then handed to the drainer or the chat recovery.
- **The drainer**, mounted at the app root:
  - backoff **2, 5, 15, 30, 60 s** (the last repeats);
  - **3** terminal tries, **8** structured tries;
  - gives up after **24 h**;
  - never dials; it waits for a live link.
- **The chat recovery**, while the chat is open:
  - waits for **2 s** of unbroken idle before typing;
  - **1** automatic terminal resend;
  - gives the message back after 10 min busy.
- **Dedupe on the terminal**
  - With no id, it types again **only on evidence the message did not land**:
    the tab and session are unchanged, `agentStatus.prompt` was not changed to
    these words, no transcript row exists after the baseline, the composer is
    live, and the queue does not hold it.
  - On the structured lane it reuses `clientOperationId`.
- **Failure UI.** "Not sent · Retry · Edit" under the bubble, plus give-back
  notices. A failed photo entry has no Retry.

**6. Busy**

- It types into **Claude Code's own queue**. The placeholder becomes "Queue a
  message…".
- The phone reads the queue box from the screen. Per-message edit and
  send-now (Ctrl+X Ctrl+S) are driven by keys.

**7. Offline**

- The send gate waits for a re-dial inside the 15 s budget, else refuses with
  "Message not sent: …" and gives the words back.
- **Known gap:** a send refused at the gate never enters the outbox, because the
  entry is written after the gate.
- An entry already on disk survives an app kill and drains on the next start.

### 1.3 What Code UI can adopt, and what it cannot

| Claude app mechanism | Adopt? | How, in Code UI's terms |
|---|---|---|
| A client uuid minted before the send and carried end to end | **Partly.** There is no wire field on the terminal lane, so the id cannot travel with the text. | Already minted (`newOutboxSendId`). The gain is to key **every** artifact of one send by it: echo, outbox entry, verify, queue-row binding, retirement. Today the echo id comes from `acceptSend` on some paths and from the outbox on others. Note that the structured lane already sends it as `clientOperationId`. |
| Echo matching by uuid | **No** for the terminal lane: Claude Code writes its own uuid into the transcript, and the phone cannot set it. | Keep text plus occurrence matching. But record the **transcript uuid of the row that retired the echo** on the outbox entry, so a later recount (a reload, a cut screen) cannot hand the same row to a second identical send. This is the documented "same words twice" limit. |
| "A failure that raced the echo is a success" | **Yes.** | Before a send is marked failed (`rejected` / `unknown` → hold), check whether a transcript row or `agentStatus.prompt` for it has already arrived. Today the hold does this at release time. Doing it at failure time too avoids a "Not sent" flash. |
| Two-stage confirmation: ack clears "Sending", echo clears the pending row | **Yes.** | Bring back a **"Sending" state at 50% alpha** until the `terminal.send` ack (or until verify passes, for Claude), then full opacity until the transcript row retires the echo. "Sending" was removed on 2026-10-10 because it lingered; with the ack as its end it lasts one round trip, as in the Claude app. Confirm with the user first, since they asked for the removal. |
| Send button becomes a 24 dp progress ring, stroke 2, while sending | **Yes.** | Composer button state; composer look is in progress, so hand this to that batch. |
| Retry with backoff 500 ms ×2 up to 10 s, same uuid | **No** for the terminal: a blind retype can duplicate, which is why the outbox demands evidence of non-delivery first. | Keep the outbox's evidence gate and its 2/5/15/30/60 s ladder. The Claude app's numbers are a remote-config default with retry **off**, so there is nothing faster to copy safely. |
| One send in flight; a second tap is refused, not queued | **Already matches** (the composer guard and the write lock). | Keep it. The Claude app shows no message on a refused tap; Code UI shows "Another input is still being sent". Keep Code UI's message, because it is a diagnostic. |
| Failure: text back into the composer, snackbar with Retry | **Differs on purpose.** | Code UI keeps the bubble with "Not sent · Retry · Edit", which never loses the words and survives a restart. Adopt one piece: the **snackbar with Retry** for a send refused **before** any write (gate timeout or offline), where the words already go back to the composer. Today that case only shows the notice text. |
| Offline: nothing persisted | **Code UI is ahead.** | Keep the outbox. Close the gap where a gate refusal never enters the outbox: record the entry before the gate, and retire it on a pre-write refusal only when the words went back into the composer. |
| Local queue: one string joined by a blank line, sent at turn end, moved back to the composer when blocked | **No.** Typing into Claude Code's own queue is the native equivalent, and the agent then decides when to take it, so mid-turn steering works. | Keep Claude Code's queue as the store. What can be copied is the **look** (80% width, italic, muted, tap to edit; in progress) and the **turn-end hand-back rule**: if the agent drops a queued message (a permission prompt opened, the turn errored), put the text back in the composer instead of losing it. Verify how Claude Code 2.1.29x treats its queue on an error ending first. |
| `priority: "next"` (steering) vs `"later"` | **Implicit.** | Claude Code takes queued input between tool calls, which is steering. "Later" (hold until turn end) has no terminal key. Leave it. |
| Model or mode change bundled with the next message | **Partly.** | Code UI applies them at once (`/model`, Shift+Tab stepping). Equivalent outcome; nothing to do unless a change made while busy must wait for the turn to end. |
| `delivery_update` PROCESSING (the agent picked it up) | **Yes, by proxy.** | The beacon `up=` and `agentStatus.prompt` are exactly the "picked up" signal. Draw it: the bubble goes from "Sending" (dimmed) to normal at pickup, not only at the transcript row. |
| Leaving the screen with a queued message posts it as "later" | **N/A.** | Claude Code's queue lives in the agent, and survives the phone leaving. |

**Batch S (send path) gaps.** S1 to S6 are in the table in section 4.

### 1.4 The Anthropic send lane (2026-10-15)

The user asked for sends "from anthropic api for that session transcript like
remote control, not from terminal". A Claude tab whose chat is matched to its
Remote Control session (or is still being matched) now sends its composer's
text-only messages as the Claude app does: POST `v1/code/sessions/{cse}/events`
with a client uuid, into the session of the tab's own profile, with that
account's sign-in (`ccrSendTargetForTab`, `use-ccr-composer-send.ts`).

- Refused, words left in the composer, nothing typed into the terminal: no
  target for the tab's profile (unknown profile, unmatched, another account's
  copy, an unconfirmed match), the session's `connection_status` is
  `disconnected` (the app's `ccr_remote_control_offline_error`), or a send is
  in flight.
- The bubble dims until the 2xx and goes when the stream echoes its uuid. A
  failed POST puts the words back with Retry and a `[ccr-send]` log line.
- While Claude works the words wait in the phone's one-string queue, drawn as
  the app's `hb20.e` bubble, sent at the turn's end or moved back to the
  composer when something blocks it. The queue belongs to the tab it was typed
  on and to the session that tab sent to then (`use-ccr-tab-queues.ts`): drawn
  only on that tab, sent only into that session, and only once the user is
  back on that tab and it is idle (the phone cannot see another tab's turn end
  while it shows this one). Leaving the chat posts it as `priority: "later"`
  into its own session, or puts it back in that tab's stored draft.
- **Typed slash commands are unverified over Remote Control.** Whether Claude
  Code runs a `/command` that arrives as a Remote Control user event, or takes
  it as prompt text, has not been observed. Until it is, a typed line-leading
  `/token` on this lane goes the way it went before the lane: the terminal
  path (`classifyMobileNativeChatSend`, `claude-composer-send-route.ts`), never
  posted and never queued as text. To settle it, the user can run
  `node p11-slash-command.cjs "<session title>" [/command]` from
  `/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/211c47c2-7a42-4c86-9a59-eaa0905d39e6/scratchpad/probe/`.
  **It posts one message** (default `/cost`) into the Remote Control session
  the user names, and nothing without a name; it prints no tokens and no
  message text, only event types and a verdict: `RAN` (a local-command record
  followed), `TEXT` (Claude answered it as a prompt) or `UNKNOWN`. Not run yet.
- **Still typed into the terminal:** photo and file sends while the switch in
  §1.5 is off (it is, until probe P13 passes), slash commands
  (typed, or driven from pickers: model, effort, mode), Stop, permission and
  question answers, and every non-Claude tab and Claude tab with nothing on
  Anthropic.

### 1.5 Attachments through Anthropic (2026-10-15, behind a switch, off)

The user asked for attachments to be "directly uploaded to anthropic same like
claude mobile does not to desktop terminal".

**What the Claude app does** (1.261009.20, decompiled):

- **Upload on attach.** `qnv` ("SessionUploader") POSTs each file to
  `https://claude.ai/api/{org}/upload` (`sv5.a`, base `hw0.a`), multipart part
  `file`, as soon as it is picked (`n50` case 25, `u49.a` → `zy30.p`), one
  coroutine per chip. Auth is the app's claude.ai cookie (`sessionKey`,
  `a22.java:12`), not a bearer token. The reply (`sul`, `"image"`/`"document"`)
  gives `file_uuid`; `is_image` is `image/*` (`qnv.java:44-48`).
- **Chip states** (`sj4`): uploading `rj4`, done `oj4(w7v)`, failed `pj4`, too
  large `qj4`. The cap is `mobile_upload_config.max_file_size_bytes`, default
  31 457 280 (`yy00`, checked in `y5k.java:118-119`); no type allow-list.
  Failure toasts "Upload failed" (`ccr_upload_failed`); no automatic retry and
  no tap-to-retry on a Code chip.
- **Send** (`su8`): one user event with `file_attachments:
  [{file_uuid, file_name, is_image}]` (`phx`/`rhx`, `u7v`/`w7v`), built from
  done chips only. Any failed chip disables Send (`u49.d()`); a chip still
  uploading at send is cleared with the rest (`u49.j`), so its file is lost.
- **On the desktop**, Claude Code 2.1.300 downloads each `file_uuid` with its
  own token from `/api/oauth/files/{id}/content` (35 MiB cap, 20 files without
  a digest) and writes "[attachment did not arrive]" when it cannot.

**Endpoint decision.** The phone holds each account's Claude Code OAuth token,
not the app's claude.ai cookie, so `{org}/upload` is out of reach. The one
upload that token can make is the Files API: POST `/v1/files`, part `file`,
`purpose=user_data`, `anthropic-beta: files-api-2025-04-14,oauth-2025-04-20`,
which Claude Code itself uses. Probe P2 (2026-10-15) got a 200 and an id of the
shape `file_…` (not a uuid), and a session event carrying it was accepted. **Not
yet shown:** that the desktop's `/api/oauth/files/{id}/content` serves a Files
API id, i.e. that Claude actually reads the file. Until it is, the lane would
risk sending a message whose attachment silently does not arrive.

**What is built** (`mobile/src/session/`):

- `ccr-file-upload.ts`: the switch `CCR_ATTACHMENTS_THROUGH_ANTHROPIC`
  (**false**), the request, the app's 30 MB cap and words ("File size exceeds
  30 MB limit", "Upload failed"), a 0-byte refusal, 401 → one fresh token,
  413 → too large. Always the tab session's own account.
- `ccr-file-upload-device.ts`: multipart through expo-file-system from a cache
  file deleted afterwards.
- `use-ccr-attachment-lane.ts`: with the switch on and a Claude tab on the
  Anthropic lane, picks upload to Anthropic and never touch the desktop;
  otherwise (switch off, Codex, any other tab) the desktop path, unchanged.
- `ccr-attachment-send.ts`, `use-native-chat-anthropic-send.ts`,
  `native-chat-send-route.ts`, `use-ccr-composer-send.ts`: words and finished
  chips in one event with `file_attachments`; a bare attachment with no words
  is allowed.
- `MobileNativeChatAttachmentChips.tsx`: the chip as the app draws it (§3.4).

**Where it departs from the app, on purpose:**

- Send **waits** for uploads ("Waiting for attachments to upload", the app's
  `chat_input_send_button_waiting_for_uploads`) instead of dropping a chip
  still uploading.
- A failed chip keeps a **retry** (the red disc), since the lane can upload
  it again; the app only offers remove.
- Sends with files go out at once, never into the phone's text queue, and
  are not recorded in the outbox. Words already queued on the tab are posted
  just ahead of them, so the session gets them in the order typed (the app's
  local queue would go as an ordinary send before anything sent after it). A
  send with files tapped while the turn-end queue is going out is refused as
  a send in flight; words typed then wait behind the queue.
- The picker still caps documents at the host path's 18 MB before the lane
  sees them; the pending bubble shows image previews only; photos carry no
  extension badge.

**To turn it on.** The user runs, from
`/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/211c47c2-7a42-4c86-9a59-eaa0905d39e6/scratchpad/probe/`:
`node p13-attachments.cjs upload "<session title>"` (uploads a 2×1 PNG and a
one-line text file, reads each back through the desktop's route, posts
nothing), then `node p13-attachments.cjs post "<session title>"`, which **posts
one message** into that session asking Claude for the colours and the line.
Flip the switch only if the CLI route returns 200 with the same bytes and the
reply names red, blue and the line. Neither prints a token.

---

## 2. How the Claude app drives a Claude Code session, and Code UI's path

### 2.1 Channel API shape (Claude app) and the Orca equivalent

Every control action is a `control_request` `{type, uuid, request_id,
request: {subtype…}}` posted to the same events endpoint. Replies arrive on the
SSE stream as `control_response` with the same `request_id`.

| Action | Claude app wire | Code UI via Orca | Parity without Anthropic's servers? |
|---|---|---|---|
| Send a prompt | POST events, `user` event (1.1) | `terminal.send` with Enter after a verified clear | Yes, done (section 1) |
| Attachments | upload to `{org}/upload`, referenced by `file_uuid` | `clipboard.*Upload` to a desktop temp file, pasted as a bracketed path; the Files API lane (§1.5) is built behind a switch, off until probe P13 | Yes, done |
| Stop | `interrupt`, no reply awaited; failure "Couldn't stop the session. Try again." | Escape twice, 80 ms apart (`use-mobile-native-chat-stop.ts`); structured lane `agentSession.cancel` | Yes. Done 2026-10-14 (G24): a Stop that failed, or an agent still working 10 s after it, says "Couldn't stop the session. Try again." on both lanes and Stop is live again; the cause is one `[stop] …` log line. An ack lost after the Escape went keeps "Stop unconfirmed — check chat before retrying", because it may have worked |
| Allow once / Always allow / Deny | `control_response` with `behavior`, `updatedInput`, `updatedPermissions`, `message: "Denied by user"` | the option's digit key after a screen re-read (`mobile-native-chat-permission-send.ts`) | Yes, done |
| Deny with comment | deny with `message` (notification inline reply) | Done 2026-10-14: typed into the dialog's "No" row with its own keys, Claude Code only | Yes (gap G21) |
| AskUserQuestion | allow with `updatedInput.answers` | paced key groups (`mobile-native-chat-answer-stepping.ts`) | Yes, done |
| Plan approve / approve & auto / suggest edits | allow plus `setMode`; deny with feedback | the plan permission card's digit keys; "Send back" | Yes (gap G11 is the look) |
| Model | `set_model`, 30 s | `/model <id>` typed | Yes, done |
| Effort | `apply_flag_settings {effortLevel, fastMode}`, 45 s | `/effort <v>` typed | Yes, done |
| Permission mode | `set_permission_mode`, 30 s | Shift+Tab stepping, verified on the footer | Yes, done |
| Rewind / edit an earlier message | `rewind_conversation {target_message_uuid}`, 15 s; prefill into the composer | structured lane only | Partly: Claude Code's Esc-Esc rewind menu could be driven by keys, but choosing a row from a rendered list breaks the "never reconstruct agent state from a preview" rule unless the row is matched exactly (gap G30) |
| Stop a background task | `stop_task {task_id}` | keys into Claude's Background dialog (`claude-background-task-stop.ts`) | Yes, in progress |
| Background shell output | `get_task_output {task_id}`, 10 s | none | Possibly, if Orca's file read reaches the task's output file. Otherwise impossible (gap G27) |
| Read a file ("Load full file") | `read_file {path, max_bytes}` | `files.read` exists | Yes (gap G19) |
| Context usage | `get_context_usage` → the Context window card | beacon context figures, and the categories of a `/context` table once one has been on the screen (G25, done 2026-10-14) | Totals yes; per-category (MCP tools, memory files, agents) only from `/context` output on screen, which the phone does not run itself |
| Workspace diff | `get_workspace_diff` | source-control routes (git through Orca) | Yes, done by another path |
| Transcript stream | SSE `…/events/stream?from_sequence_num`, reconnect 1/3/7/15/31 s, then "Connection lost" | `nativeChat.subscribe` (snapshot/append), `nativeChat.readSession` for pages, `session.tabs.subscribe`, beacon, screen poll; relay reconnect plus `useLastConnectedAt` refetch | Yes |
| History load | newest first, pages of 200, backfill pages of 500 (×10) | first page 40 (ladder 40/12/4), then earlier pages | Yes |
| Session create | POST `v1/code/sessions` with an `idempotency_key` | `session.tabs.createTerminal` / new worktree | Yes, by another path. Cloud environments: impossible |
| Archive / delete / rename / share / feedback / move to cloud / mark read / presence | `v1/code/sessions/{id}/…` | close tab; rename tab; no archive | Share, feedback, move to cloud, presence: impossible (Anthropic's servers). Archive: maps to closing a tab |
| Notifications | FCM push from Anthropic, one per session | Orca `notifications.subscribe` plus relay push | Yes, by another path |

---

## 3. Surface by surface

File paths are under `mobile/` unless shown in full. Claude app values come from
`claude-app-implementation-notes.md` or from this audit's scratch notes.

### 3.1 Session list and home

| Claude app | Code UI | Class |
|---|---|---|
| **Rows**: 24 dp radius, 16 dp padding, a 16 dp leading state mark. States in priority order: Waiting (amber dot `#FAB219`), Working (grey dot pulsing 1.0↔0.3 over 600 ms), Failed (icon), New (blue dot `#2A78D6`), Quiet (1.5 dp ring). Title 15/400, trailing relative time, a second line with status, repo and branch or PR state | Worktree rows (`src/components/WorktreeListRow.tsx`, `AgentSpinner.tsx`) with a spinning ring, a bell for unread, and per-agent rows | **Differs**. `AgentSpinner.tsx` also uses **hardcoded hex** (`#eab308`, `#10b981`, `#ef4444`), against the light/dark rule |
| **Filter**: All, Working, Needs input, Ready for review, Completed, Archived; plus a text filter | Filter / Sort / Group / Search (`src/host-screen/host-screen-header.tsx`) | Differs |
| **Long-press menu**: Copy branch, Share, Rename, project, Archive, Delete | the tab long-press sheet (`src/session/mobile-terminal-action-sheet-actions.ts`) | Differs |
| Empty states, "Load more sessions" | `src/home/MobileHomeEmptyState.tsx` | Differs (a different model) |
| **Starter screen** "Let's start coding" (Serif 28) and the new-session composer | "New Tab" sheet (`src/session/MobileSessionSheets.tsx`), `NewWorktreeModal*` | Differs. Environment and repo rows are cloud-only, so impossible |
| Devices / Remote control / `claude rc` | host pairing (`app/pair*.tsx`) | Differs by design |
| Launcher widget "Code shortcuts" (New session, Search) | none | **Missing** (P3) |

### 3.2 Session header and menu

| Claude app | Code UI | Class |
|---|---|---|
| **Title** 15/550, one line; subtitle 13 sp `#898781`: repo · branch · destination | `src/session/MobileSessionHeader.tsx`: worktree name; subline with status dot, tab count and model pill | **Differs** |
| **Context ring** in the header: 18 dp, 2 dp stroke, blue <75%, amber 75–89%, red ≥90%; opens Usage | ring in the composer row (`MobileNativeChatComposer.tsx`), opens `MobileContextWindowSheet.tsx` | **Differs** (place and colour thresholds) |
| Open pull request button | Checks in the "…" sheet | Differs |
| **Menu**: Copy branch, Continue in cloud, Background tasks, Share, Rename, Archive, Feedback, (internal) Copy session ID | "…" sheet (`MobileSessionHeaderMoreActionsSheet.tsx`): Agent History, Checks, MCP Servers, Permission Rules, Project Memory | **Missing**: Copy branch, Background tasks entry, Rename here, Copy session ID. **Impossible**: Continue in cloud, Share, Feedback |
| Connection row: "Connected" (green) / "Disconnected" · "Reconnect from <host>" | subline label plus "— tap to retry" (`use-mobile-session-presentation.ts`) | Differs (wording) |
| Session bar above the composer: **"Open diff" pill** (+A −R) and **todo pill** "N/M tasks" with a 16 dp ring | none | **Missing** |

### 3.3 Chat transcript

| Row | Claude app | Code UI | Class |
|---|---|---|---|
| User card | 12 dp radius, fill `pl7.w0`, hairline, 12×14 padding, 15 sp | `mobile-native-chat-message-styles.ts` | **In progress** (typography and colours) |
| Assistant prose | `zv.d` 17/400/1.5, Anthropic Sans | `MobileNativeChatProse.tsx`, 15/22 | **In progress** |
| Assistant action row | Copy, Read aloud, thumbs; 36 dp icons in `pl7.Q`; Copy becomes a check tinted `ad5.K` (300 ms tween, back after 2000 ms; `fa20.a`) | one Copy per turn, resting in `pl7.Q` (`composerPlaceholder`), a check tinted `codeBlockCopied` for 2 s with the 300 ms tween, a 40 dp touch target (2026-10-14). **The size stays the user's: a 14 icon in a padding of 4, fixed in dp (2026-10-11)**, and the row stays under the words while work runs | **Differs** (size by the user's choice; no read aloud: G31) |
| Hold on a message (Code timeline) | Re-read in 1.261013.20 (implementation notes §10). A hold on **Claude's words** selects in place: each text block of a message is drawn in the app's SelectionContainer (`gy30.j` → `t8i.o` → `z530.k`), so the word under the finger is selected with clay handles and Android's Copy / Select all bar, and no menu opens. A hold on **the user's own prompt** (`gy30.d`, no SelectionContainer) buzzes and drops Material 3's dropdown card from the bubble's bottom-end corner, no gap, right edges aligned (`qs30.a` → `oxb.a`, filled by `gy30.e`; 12 dp corners, surfaceContainer #FFFFFF / #20201F, 3 dp shadow, no border, no scrim; 48 dp rows, 20 dp glyphs; with no room below, its bottom sits on the bubble's bottom; scale 0.8 → 1 and fade on fast springs): **Copy message**, **Select text**, each with the row's text as it arrived; Copy message adds no confirmation of its own from Android 13 (the "Copied." pill is the system's); Select text opens a "Select text" sheet with that text in a SelectionContainer (implementation notes §11). Tool rows and thoughts select nothing and get no menu | A reply's words select in place (`ProseRun` in `MobileNativeChatMessage.tsx`; SelectionCopyRootView: Copy and Select all, clay handles and highlight from the theme in light and dark); the scroll guard is the document root's `holdSelects`. A sent prompt keeps the card (`MobileNativeChatMessageMenu.tsx`, 2026-10-15): Copy message and Select text with the words as drawn (the user's choice), the app's placement, sizes, colours, glyphs and springs, no buzz or tint on copy, Undo send first on a waiting message; its hold is cancelled by the touch slop, a scroll beginning during it, or a press that stopped a fling (`chat-message-hold.ts`). **No Reply or Edit** (no Claude Code action) | **Match**, except that one RN selection spans one native Text where the app's spans a whole text block: a code fence, table or picture between paragraphs breaks it |
| Thinking | a row like a finished tool run: `extendedThinking` icon + "Thought process" (15/400, muted); a tap opens a sheet with the text as Markdown; **never inline** | inline text with a side rail, folded past 600 characters (`MobileNativeChatReasoningNote.tsx`); terminal Claude tabs get none (Orca role bug) | **Differs** (G1). Terminal tabs: **impossible** until Orca emits `reasoning` |
| Tool-run row | sentence, shimmer, pill, chevron | `MobileNativeChatToolRun*.tsx` | Match; shimmer **in progress** |
| Run sheet | sentence title, child rows | `MobileNativeChatRunSheet.tsx` | Match |
| Per-call sheet | 13/550 labels, `pl7.s` boxes, 12 dp padding; Prettify for JSON only; Read: **line-numbered viewer, "Showing N of M lines (truncated)", "Load full file"**, "Render" for .md; Write: line-numbered; Edit: diff; generic "Inputs" key/value mono | `MobileNativeChatToolDetailSheet.tsx`, `mobile-native-chat-tool-detail-sections.ts`; Prettify/Raw; output capped at 400 lines | **Differs**: no Read viewer, no Load full file, no Render (G19) |
| Turn edits card | "Edited X" / "Created X" + pill + **Review**; 3 files, then "Show N more". Drawn only with three server flags on (`fq6.java` case 16: `claudeai_hub_cowork_session_chat`, `claudeai_hub_code_session_chat`, `ccr_turn_edits_card`); off on the user's app (2026-10-15) | `MobileNativeChatTurnEditsCard.tsx`, off behind `TURN_EDITS_CARD_SHOWN` | **Match** (not drawn, as the user's app) |
| Diff screen | "No changes yet" / "Loading changes…" / "Unable to load changes" | `MobileDiffReviewRouteScreen.tsx`, source control | Match by another path; entry from the "Open diff" pill missing (G6) |
| Todos | pill + card ("N/M tasks complete"); done = blue-tint circle and check, struck through; in progress = a one-third ring | inline checklist (`MobileNativeChatTaskList.tsx`) | **Differs** (G6, G13) |
| Plan | "Proposed plan" row; Plan sheet; buttons above the composer: **Approve Plan** (or **Approve & auto mode**) + **Suggest Edits**; the placeholder becomes "Describe what you'd like changed…" | the permission card with "Plan file:" and "Send back" (`claude-plan-permission.ts`) | **Differs** (G11) |
| Permission card | 24 dp radius, fill `ad5.O`, 16 dp padding; "Allow Claude to <verb> <target>?"; raw input shows 6 arguments, then "Show full input" (cap 360 dp); Edit/Write get a diff face; 40 dp buttons: Allow once (filled ink), Always allow…, Deny (outline) | `MobileNativeChatPermission.tsx`; Allow once / the agent's own rule label / Deny / Send back | **Differs** (G10). The remembered-rule label keeps the agent's wording on purpose (2026-09-27) |
| AskUserQuestion | pager "1 of N", option rows, "Something else" field (options dim to 0.4 over 150 ms once typed), Next/Submit 48 dp, **Skip**; an answered summary ("Skipped" for blanks) | wizard `MobileNativeChatAsk.tsx` with tabs, Next/Submit, Cancel, "Other…" | **Differs** (G14) |
| Images | 96 dp thumbnails; assistant images full width ≤400 dp, Fit | `MobileNativeChatImageStrip.tsx` | **In progress** |
| API errors / result rows | `result` rows ("Session interrupted"); refusal "Session paused" notices with "Edit and retry"; "Switched to X · Why?" | API error drawn as prose (`claude-api-error-text.ts` only ends the turn) | **Missing** (G15) |
| Rate-limit banner | 16 dp radius, `pl7.s`: "Approaching limit" / "Limit reached" / "Now using usage credits", "Resets at …", "View usage" | `MobileNativeChatRateLimitBanner.tsx`, fed by the beacon's `h5` / `d7` or the host's `accounts.subscribe` windows | **Done** for approaching and reached (G16); "Now using usage credits" is built and has no source (see G16) |
| Connection row | the status row says "Connecting..." / "Connection lost..." in clay while a turn runs and the live connection is down (`au8` case 0, `nl7.b`; the app strips a trailing ellipsis and draws three ASCII dots) | `MobileNativeChatConnectionRow.tsx`, from the phone's own connection verdict | **Done** 2026-10-14; beside the status line's "Working", which is left as it is |
| Context cleared / compacted | centred 11 sp at 30% ink between rules; "Compacted conversation · saved N tokens" | "Context compacted" / "Context cleared" (`MobileNativeChatNoticeRow.tsx`) | **Differs** (wording; style in progress) (G17) |
| Context window card (`/context`) | expandable card: segmented bar, "X of Y tokens", MCP tools / Memory files / Custom agents | the context sheet draws the table Claude Code printed for `/context`, once the user has run it (`MobileContextCategories.tsx`) | **Done** for Claude Code, only after a `/context` has been on the screen; Codex prints no table (G25) |
| Peer message | "Received message from <name>" row; a sheet "Message", "From: <name>"; names checked against spoofing | folded "Message from <agent>" (`MobileNativeChatAgentMessageRow.tsx`) | **Differs** (G26) |
| Subagent hand-back | nothing drawn | nothing drawn | Match |
| Init / resume card | cloud container steps | n/a | **Impossible** (cloud only) |
| Next-prompt suggestion | ghost text in the empty composer plus a caret pill; a tap fills | none | **Missing** (G28). Readable only if Claude Code paints it in the TUI input |
| Code block | 12 dp clip; header at least 40 sp in `pl7.s`, label (fence language, first letter capital, else "Code") in mono, Copy then Expand (36 sp buttons, 20 sp glyphs, 40 dp targets); body `pl7.r`, 16 dp, one line per source line, no numbers; Expand opens a sheet (close cross, "Code" / "Python code", Copy; the code full width); wrap per setting (default off) | `MobileMarkdownCodeBlock.tsx`, `MobileMarkdownCodeHeader.tsx`, `MobileMarkdownCodeSheet.tsx`, numbers in `code-block-spec.ts` | **Match** (2026-10-14), except wrap has no setting yet (G8) |
| Inline file links | file-path code becomes a link; long-press: path header over Open / Copy file name / Copy relative path (`xt20`, `dqh`); a tap on a file Claude sent asks "Open %1$s?", on a file not on the device says "%1$s isn't on this device. Ask Claude to send the file to open it here." (`g94`, `yv8`) | tap opens the file from the desktop (links existed already). The menu is built (`MobileNativeChatFileLinkSheet.tsx`) and reachable from the chip that names a picture the phone cannot show. **Not reachable from a reply's own links:** the chat draws a reply's prose in one native TextView (`modules/orca-native-prose`) whose only link event is a tap, and a hold on a link in a selectable Text starts Android's own selection, so a JS hold handler there needs a Kotlin `onLinkLongPress` and a phone check. The app's "Open?" dialog and "isn't on this device" line are for a cloud session's files and are not adopted: a path that will not open already says why (`mobile-file-tap-failure.ts`) | **Partly** (G20) |
| Artifacts | cards and chips | n/a | **Impossible** (claude.ai artifacts) |
| Pending row | 50% alpha + "Sending" until the ack | full opacity, no label | **Differs** (S2) |
| Queued row | 80% width, italic, tap moves it back | queue box from the screen (`MobileNativeChatQueue.tsx`) | **In progress** |

### Transcript motion (2026-10-14)

The Claude app's numbers for the transcript's motion are pinned in `session/claude-motion-spec.ts`
(each with its source line) and tested in `claude-motion-spec.test.ts`. Easing is `k8d.a`,
cubic-bezier(0.4, 0, 0.2, 1), the default of every `hay.E` tween that names none. Two of the
plan's motions were read from the wrong class first and are recorded here under what they are.

| Motion | Claude (1.261009.20) | Code UI |
|---|---|---|
| Agent pulse | alpha 1.0 to 0.55, tween 1200 ms, Reverse, five pulses shared by every cell, pulse i started `i * -240` ms after the first: `uts.java:22-30` plays position `elapsed + offset` and holds at the start while that is not positive, so a negative offset is a **delay** (`cu2.java:1071`) | the workflow card's status dot, pulse 0 (`use-agent-pulse-style.ts`). The other four are in the spec for the agent grid (G32) |
| Copy glyph | colour tween 300 ms to `ad5.K`, check held 2000 ms (`fa20.java:266`, `l82`) | the action row and the code block, one `CodeCopyGlyph` |
| Fade 150 ms, snap out | the alpha of the **scroll-to-bottom button** that sits beside the to-do pill (`yfy.java:3873`, drawn by `yfy.r`, `generic_button_scroll_to_bottom`). It was first read as the todo pill's own fade | not applied: the ↓ button is the G23 work (`mobile-native-chat-list-edges.tsx`). The todo pill itself does not animate in the app |
| Expand + fade 250 ms, exit none | `AnimatedVisibility` of the **queued-message area** (`bv20.java:2259`, its content is `jiz`, `Queued(...)`). It was first read as the turn edits card's "Show N more"; that class (`h130`) calls no animation at all | not applied: the queue box is `MobileNativeChatQueue.tsx`. The turn edits rows do not animate in the app |
| Stream smoothing | `StreamSmoothingConfig` defaults: tick 33 ms, 800-char markdown groups, fade-in off (200 ms), catch-up lag 250 ms at 80 to 600 chars/s, rate easing 250 ms, reveal within 450 ms; remote flag `android_chat_stream_smoothing` (`c0x.java`) | **not applied.** The structured lane re-parses a growing reply's Markdown on every change; a 33 ms tick would do that thirty times a second on the main thread, and there is no way to measure the frame cost off the phone (`mobile-markdown-streaming-cost.test.ts` guards the same cost). The numbers are in the spec for a pass that can measure |

Sheets keep the 0.9.139 motion the user chose (`sheet-motion-0-9-139.test.tsx`); row enter animations
match the app's (none). The one self-starting motion above reads `useReducedMotion` and is listed in
`ui/reduced-motion-sites.test.ts`.

### 3.4 Composer

| Claude app | Code UI | Class |
|---|---|---|
| Shell, text field, button row | `MobileNativeChatComposer.tsx` | **Match** (2026-10-14, the spec table below); one-row collapse still missing |
| Placeholder "Type / for commands" (idle), "Queue a message…" (busy) | the same (`use-mobile-native-chat-input-lock.ts`) | **Match** (2026-10-14) |
| **Stop** in the trailing slot, replacing Send (`pl7.x0` fill, `stop` outline in `pl7.O`; a 36 dp ring stroke 1 in the content colour while stopping) | the same (`MobileNativeChatSendSlot.tsx`) | **Match** (2026-10-14) |
| Closed or ended session: the composer gives way to "This session can't take new messages." (`ccr_session_closed_composer_notice`) | none. Nothing Code UI holds says a session ended: a tab's agent type outlives its process by about 30 minutes (`mobile-native-chat-send-claim.ts`), a dead PTY is dropped from the stream and the composer reads "Waiting for terminal…", and the structured wire has no ended state | **Not drawn, by design** (checked 2026-10-14): a guess would hide a working composer. Needs a signal from the host (the tab gone from the snapshot, or the PTY's exit) |
| **Mode chip** in the leading group: a pill with an icon (Manual = hand, Accept edits = code, Plan = scroll, Auto = lightning) and a label (`x030.c`) | none. The user chose the + sheet's "Permission" row over a composer chip (2026-10-14, over screenshots): the chip (`MobileNativeChatModeChip.tsx`, commit 19259499e, 0.9.144) was removed the same day, with its mount and tests. The + sheet's row names the mode and opens the Select mode sheet; its glyph is the current mode's, in the mode's colour (`permission-mode-appearance.ts`) | **Not drawn, by choice** (G4, 2026-10-14). The Claude app itself draws the chip; the leading group is the + and the model pill alone here. Not a gap to close without asking the user |
| Model chip: model name + effort, a 36 dp pill, 16 dp sides, ≤220 dp, 13 / 400, no chevron; the effort in `pl7.P` | model pill (`MobileNativeChatSessionOptionRows.tsx` `Pill`) | **Match** (2026-10-14: the agent's stated effort is a nested Text in `composerIcon`, `pl7.P`, after the name in `composerPillText`) |
| Attach sheet "Add context": Camera / Photos / Files tiles (12 dp, `pl7.q`, 1 dp border); a limit line | `MobileNativeChatAttachSheet.tsx` with the same three | Match |
| Select mode: Manual, Accept edits, Plan, Auto with descriptions and per-mode colours; **Bypass never listed**; "Not available for the selected model". Each row's glyph is 24 dp (`tzh.e` default, `au0.Large`): Manual a hand in `pl7.P` (`ky20.i`, z8.java:365-377), Accept edits code in `pl7.n0` `#9747FF`, Plan a scroll in `pl7.m0` `#006666`, Auto a lightning bolt in `pl7.e` clay (`ky20.h`, ky20.java:344-424); a refused row falls back to the plain content colour (`rrh`, rrh.java:52-59). The selected row is not marked with a check there: `lut.c` colours its text `ad5.C0()` link blue and sets the title in `jn7.C` (17 / 550) | `MobilePermissionModeSheet.tsx`: glyph and tint per mode from `permission-mode-appearance.ts` and the `modeManual` / `modeAcceptEdits` / `modePlan` / `modeAuto` theme tokens; rows, descriptions and Bypass match | **Match** for glyphs, colours and rows (2026-10-14; not yet seen on a device). **Differs** in two ways left as they were: the selected row keeps `ActionSheetContent`'s trailing accent check instead of the app's blue 550 title, and Plan's `#006666` is the app's one hex for both schemes, so it reads 2.4:1 on the dark sheet panel |
| Model sheet with an **Effort row** inside, "Update Claude Code…" for models too new for the CLI. Two pickers exist in 1.261009.20: the Code section's (`n330.a`) lists the older models inline under an "Other models" header (`ccr_model_overflow_header`); the chat picker (`pij`, destinations "Select model", "More models", "Effort") puts them behind a "More models" row. Which models are older is the server's `model_selector_config[key].models[].section` (MAIN, OVERFLOW, DEPRECATED; DEPRECATED rows are dropped). | `MobileNativeChatSessionOptionPickers.tsx`: the chat picker's tap-through ("More models" row naming the running older model, a page titled "More models"), by the user's request 2026-10-14. Claude Code's `list_models` carries no section, so `model-sheet-layout.ts` stands in: the newest row of each family is first-page, the rest are older. | **Match** (chat picker; the Code section's inline header is not used) |
| Slash popup: CLI commands plus the app's own; "/name" mono 15 in link blue; description `jn7.H` muted; ≤240 dp, 12 dp radius, hairline, 3 dp shadow, 150 ms size animation | `MobileNativeChatComposerSuggestions.tsx` | **Differs** (G7) |
| @ mention: members only; **no @file in Code** | @files supported | **Code UI is ahead**: keep it |
| Attachment chips 96 dp (`l7f.d`, `cxe.c`): photo square cropped at radius 16, document card with extension badge and base name (no icon, no size); 32 dp ring in `pl7.e`, no scrim; red failed disc (`pl7.A`, 0.8); 18 dp remove disc 4 dp in; strip 12 apart (`l7s.a`); reorder | `MobileNativeChatAttachmentChips.tsx` | Match (2026-10-15), plus a retry on the failed disc; Code UI's own type sizes |
| Voice: mic, hold-to-talk behind a flag, waveform, "Transcribing…" | `src/dictation/*`, toggle or hold in `app/voice-settings.tsx` | Match-ish |
| Key strip | none in the Claude app | Code UI extra (needed for a TUI) |


#### G37 composer spec (2026-10-14)

Claude Android 1.261009.20. "Decompiled" cites jadx sources; "measured" is the
user's screen recording of the app (`vid2/rec.mp4`, 1080 × 2316, dark, keyboard
up), at 2.8125 px/dp: the 36 dp buttons measure 100 to 101 px. Video
compression costs about ±0.5 dp. Pinned in light and dark by
`MobileNativeChatComposer.claude-geometry.test.tsx`.

| Part | Claude | Source | Code UI before | Code UI now |
|---|---|---|---|---|
| Card to screen sides | 16 dp | measured 45 px | 12 (`space.md`) | 16 (`space.lg`) |
| Card to keyboard top | 16 dp | measured 46 px | 12 | 16 |
| Corner radius | 24 dp | `o530` `en7.b(..).j`; measured | 24 | 24 |
| Hairline | 0.5 dp `pl7.x` | `p54.K` | 1 dp | 0.5 dp |
| Fill | `pl7.p` at 96% | `p54.M` | same | same |
| Shadow | blur 8, black 10%, y 2 | `p54.L` → `an7.c` | none | `boxShadow: 0px 2px 8px rgba(0,0,0,0.1)` |
| Text | 17 / 400 / 1.4 | `aj1`; caret measured 67 px = 23.8 dp | 16 / 22 | 17 / 24 |
| Text inset | 13 dp sides | `aj1`; measured 37 px to the caret | 16 | 13 |
| Card top to first line | 16 dp (8 shell + 8 field) | `o530` `rrb.Q(.., 8)`; measured 46 px | 1 + 12 | 0.5 + 16 |
| Last line to buttons | 16 dp | measured 46 px (the decompile read gave 11) | 9 + 2 = 11 | 8 + 8 = 16 |
| Lines | 1 to 6, then scrolls | `aj1` | same | same (cap 168 dp) |
| Buttons to card sides and foot | 8 dp | `ai9` `N0(8)`; measured 22 to 23 px | 8 sides, 10 foot | 8 |
| Gap between buttons | 8 dp | measured 23 px (+ to pill, mic to Stop) | 4 (8 before Send) | 8 |
| Button | 36 dp circle, 48 dp touch | `yg9` `ixv.p(36)`, `ixv.k(48)` | 36, no touch slop | 36, `hitSlop` 6 on every side for 48 (2026-10-14; `composer-touch-target.ts`) |
| + glyph | 12.8 dp across, `pl7.P` | measured; `yg9.e` colour | lucide 20, `textSecondary` | lucide 22, `composerIcon` |
| Mic glyph | 20 dp `microphone`, `pl7.P` (#383835 / #C3C2B7) | `yg9.e` → `d(.., P, 20)`; measured 12 × 16.4 dp | 19, `textSecondary` | 20, `composerIcon` |
| + / mic fill | `pl7.x0` | measured 47 on the 30 card | `composerControl` | same |
| Send fill | `pl7.e` #C6613F / #D97757 | `yg9.f` (`bb8:162`); `r59.b`, `r59.a` | `accent` #C96442 / #D9825F | `composerSend` |
| Send arrow | `pl7.H` white, about 11 dp | `yg9.f`, `f83` case 3; measured | 19, `onAccent` (dark #1A1917) | 18, `composerSendGlyph` #FFFFFF |
| Send disabled | fill and arrow each at 40% | `yg9.f` `hb10.n(.., 0.4)` | whole button at opacity 0.4 | `composerSendDisabled`, `composerSendGlyphDisabled` |
| Stop | `pl7.x0` fill, `stop` outline in `pl7.O`, 14 dp square | `yg9.g` (`bb8:209`), `sg4`; measured | filled red square 14 | outline `Square` 17, stroke 2, `text` |
| Stopping ring | 36 dp, stroke 1, content colour | `sg4` `khp.a(36, .., 1)` | `danger` | `text` |
| Model chip | 36 tall, 16 sides, ≤220, 13 / 400, no chevron, `pl7.x0` | `md6.a`; measured 116 dp wide, 16.7 dp to the text | 30 tall, 10 sides, ≤190, 12 semibold, chevron, dark #545452 | 36, 16, ≤220, 13 regular, no chevron, dark `pl7.x0` |
| Placeholder | "Type / for commands"; "Queue a message…" while working | `ccr_input_placeholder_existing_session(_queue)` | "Reply, @files, /commands" | the Claude strings |

Still differs: the one-row collapse; Anthropic Sans is Instrument Sans here. The
recording row (`MobileNativeChatDictationRow.tsx`) takes the action row's 8 dp
padding on all sides and Send's colours.

### 3.5 Status line, tasks, subagents

| Claude app | Code UI | Class |
|---|---|---|
| Status line: a 16 dp clay spinner; **"12s · 1,234 tokens · N running tasks · thinking…"**; the thinking word escalates at 15/30/45/60 s; "thought for Ns" for 2 s; without timing, a random verb that changes after 3 s, 4 s, then every 6 s | "✳ Working · N running tasks · <thinking>…" (`MobileNativeChatStatusLine.tsx`); no elapsed time or tokens, **at the user's earlier request** | **Differs on purpose** (G3: needs the user's decision, since "copy everything" may overrule it) |
| Background tasks sheet | `MobileBackgroundTasksSheet.tsx` | **In progress** (titles, Stop) |
| Finished shell row → "Show output" sheet (Loading / No output captured / Output truncated / Retry) | none | **Missing** (G27) |
| "View transcript" opens the Agent call's tool sheet with its nested "Tool calls (N)" | removed from the card 2026-10-10; `MobileSubagentTranscriptModal.tsx` from run-sheet agent rows | **Differs** (G29) |
| Workflow card with an agent grid (≤24 squares, 8 dp) and phases | the card exists with phases; its status dot pulses while the workflow runs as the app's does (alpha 1.0 to 0.55, 1200 ms, `claude-motion-spec.ts`, 2026-10-14). No grid: the app draws its cells under each phase and the phone is never told which agent is in which | **Differs** (P3, G32) |
| ↓ button | `mobile-native-chat-list-edges.tsx` | **In progress** (threshold) |

### 3.6 Settings

| Claude app | Code UI | Class |
|---|---|---|
| Transcript text size Small 0.85 / Medium 1.0 / Large 1.15 | Done 2026-10-14: the three sizes, persisted, where the transcript's pinch (0.8-1.8) starts (G8) | Match |
| Transcript font Anthropic Sans / System; code font JetBrains Mono / System | Done 2026-10-14: Instrument Sans / System, and System / JetBrains Mono, each option drawn in its own face (G8) | Match (Instrument Sans for Anthropic Sans) |
| "Wrap long lines" (default off) | Done 2026-10-14 (G8) | Match |
| Notification toggles "Code updates" / "Code permission requests" | Done 2026-10-14: both, under the one "Agent notifications" switch (G22) | Match |
| Auto mode opt-in dialog | none | **Missing** (P3, G33) |

### 3.7 Notifications

| Claude app | Code UI | Class |
|---|---|---|
| Channel "Code sessions", importance HIGH; one notification per session; MessagingStyle keeps the last 25 | `src/notifications/*`; the channel is named "Code sessions" since 2026-10-14 (same id, so settings are kept) | Match-ish |
| An inline **Reply** on an ordinary notification ("Reply to Claude") | Done 2026-10-14: through the outbox, terminal tabs (G21) | Match |
| Permission notification: a monospace body (8 lines, `$ ` for Bash); Approve / Deny / **Deny with comment** ("Tell Claude what to do instead"); Approve withheld for AskUserQuestion, ExitPlanMode and destructive tools; ongoing, 24 h timeout | Done 2026-10-14 except the monospace body, ongoing and the 24 h timeout: Approve / Deny / Deny with comment (Claude Code), Approve withheld for a plan, a question, an unknown tool and a destructive command or MCP tool (G21) | Partly matches |
| Question notification | option buttons plus "Answer" / "Other…" | Code UI extra |

### 3.8 Viewer and markup

All **in progress** (thumbnails and markup). The values are in
`claude-app-implementation-notes.md` §3.

### 3.9 Start, resume, stop

| Claude app | Code UI | Class |
|---|---|---|
| Start: snackbar "Session started in a new worktree at …" | New Tab / New worktree | Differs (a different model) |
| Stop: no confirmation; on failure Stop re-enables and "Couldn't stop the session. Try again." | Escape ×2; the failure and the still-working case say the Claude words (2026-10-14) | **Match** (G24) |
| Archive (with a dialog) / Delete (with a dialog) / Rename (a dialog) | Close tab; Rename | Differs |
| Rewind: edit and retry | structured lane only | **Differs** (G30) |
| Resume a past session | Agent History (`src/agent-history/*`) | Match by another path |

---

## 4. Prioritised gaps

Size: **S** under a day, **M** 1–3 days, **L** more. Priority: **P1** visible
on every screen, **P2** common flows, **P3** rare. "Batch" refers to section 5.

| ID | P | Gap | Class | Size | Batch | Status |
|---|---|---|---|---|---|---|
| S1 | P1 | One id per send, keyed through echo, outbox, verify, queue binding and retirement; store the transcript uuid that retired each echo, so an identical later send cannot claim the same row | Differs | M | S | |
| S2 | P1 | Two-stage pending row: 50% alpha + "Sending" until the `terminal.send` ack or verify, normal at pickup (`up=` / `agentStatus.prompt`), retired at the transcript row. **Ask the user**, since "Sending" was removed on 2026-10-10 | Differs | S | S | |
| S3 | P2 | A failure that raced its echo is a success: check the record at failure time, not only at release | Differs | S | S | |
| S4 | P2 | Record the outbox entry **before** the send gate, so a gate or offline refusal is still recoverable | Missing | S | S | |
| S5 | P2 | Snackbar with **Retry** when a send is refused before any write (the words are already back in the composer) | Missing | S | S | |
| S6 | P2 | Turn-end hand-back: a queued message the agent dropped (permission prompt, error ending) goes back into the composer | Missing | M | S | |
| G1 | P1 | Thinking as a "Thought process" row that opens a Markdown sheet, never inline | Differs | M | B | |
| G2 | P1 | Typography and colours of every row | — | — | — | in progress |
| G3 | P1 | Status line: elapsed · tokens · thinking word escalation · "thought for Ns" · rotating verb. **Needs the user's decision**: they asked for "Working" only. Tokens and elapsed time come from the beacon (Claude's status-line payload carries `cost.total_duration_ms` and token totals) | Differs | M | D | |
| G4 | P1 | Mode chip in the composer's leading group (icon + label) | Dropped by the user 2026-10-14: the + sheet's Permission row stays instead | S | — | `MobileNativeChatAttachSheet.tsx` (the row) |
| G5 | P2 | Mode sheet icons, colours and descriptions; drop Bypass from the list; Effort row inside the model sheet; "Not available for the selected model" | Mode sheet: done 2026-10-14 (coloured glyphs, descriptions, no Bypass row; the + sheet row takes the current mode's glyph and colour). Effort row: differs | S | C | `permission-mode-appearance.ts` |
| G6 | P1 | Session bar above the composer: "Open diff" pill (+A −R, opens review) and todo pill "N/M tasks" with a ring | Missing | M | C | |
| G7 | P2 | Slash popup look (mono 15 link-blue names, ≤240 dp, hairline, 150 ms animation) | Differs | S | C | |
| G8 | P2 | Reading settings: transcript text size S/M/L (0.85/1.0/1.15), transcript font, code font, wrap long lines | Done 2026-10-14 | M | E | `src/settings/chat-reading-settings.ts`; screen in `app/native-chat-settings.tsx`. Text size is where the pinch starts (the pinch still works from it); the two fonts reach the transcript's Markdown, its code spans and block, and a sent prompt, and no other Markdown surface; Wrap long lines moves the code card and its Expand sheet from a sideways scroller to a wrap (`MobileMarkdownCodeScroller.tsx`). Anthropic Sans is Instrument Sans here, and the code face defaults to JetBrains Mono, so the defaults are today's look |
| G9 | P1 | Header: 15/550 title; repo · branch subtitle; the context ring moves to the header with blue/amber/red at 75/90 % | Differs | M | A | |
| G10 | P2 | Permission card: 24 dp card, 40 dp buttons, a filled primary; raw input to 6 arguments then "Show full input" (360 dp cap); a diff face for Edit/Write | Differs | M | B | |
| G11 | P2 | Plan approval buttons above the composer: Approve Plan / Approve & auto mode / Suggest Edits; Plan sheet; "Describe what you'd like changed…" placeholder | Differs | M | B | |
| G12 | P2 | Turn edits card: "Edited X" + pill + Review; 3 files, then "Show N more" | Differs | M | B | |
| G13 | P2 | Todo card from the pill: blue-tint done circle, one-third ring for in progress, struck-through text | Differs | S | C | |
| G14 | P2 | AskUserQuestion: "1 of N" pager, Skip, options dim when "Something else" is typed, answered summary row | Differs | M | B | |
| G15 | P2 | Error rows: API error and "Session interrupted" result rows styled in the danger colour, not as prose | Missing | S | B | |
| G16 | P3 | Rate-limit banner in the chat ("Approaching limit", "Resets at …"), from beacon rate limits | Done 2026-10-14 | S | D | Source: the beacon's `h5` / `d7` (already written by the launch script, so no field was added and the 64-byte and splice rules are untouched), else the host's feed, which is the only source for Codex and for a Claude tab with no beacon (a Claude beacon with no `rate_limits`, an API-key session, decides alone: the feed is for Orca's own login). "Approaching" is each agent's own rule, not a guess: Claude Code 2.1.296's `Zw` tiers (90% of the 5 hours by 72% of the time; 75% of the week by 60%) with its 70% display floor, Codex 0.153.4's 75% first tier. "Reached" is 100%. A window whose reset has passed is not read. Left: "Now using usage credits" (needs `isUsingOverage` from the sessions API's `rate_limit_event`, Batch 8), "Upgrade to Pro" in place of "View usage" on a free plan (no plan field), and the usage card's cost and time (the beacon writer sends no `cost` field; adding one changes the launch flag, which is the user's call) |
| G17 | P2 | Compacted marker wording "Compacted conversation · saved N tokens" when the figure is known | Differs | S | B | |
| G18 | P2 | Code block: Expand action, 40 dp header, wrap that follows the setting | Done 2026-10-14 | S | E | done 2026-10-14: the card, its Copy (check for 2 s, glyph tint 300 ms) and Expand, and the sheet (spec and sources in `code-block-spec.ts`). Wrap follows the G8 setting. The line-number gutter on the card is gone (the app draws none); the file reader keeps its own |
| G19 | P2 | Read sheet: line-numbered viewer, "Showing N of M lines (truncated)", **Load full file** via `files.read`, Render for .md | Differs | M | F | |
| G20 | P2 | Inline file links: tap opens the file viewer; long-press Open / Copy file name / Copy relative path | Partly 2026-10-14 | M | E | menu and its names in `MobileNativeChatFileLinkSheet.tsx`, `mobile-native-chat-file-link.ts`; mounted on the picture chip. Left: a reply's own links (native prose: needs a Kotlin `onLinkLongPress` and a phone check) |
| G21 | P2 | Notifications: inline **Reply** on a finished notification (through the outbox send path); **Deny with comment** on a permission notification (the TUI's "No, and tell Claude what to do differently" option); withhold Approve for AskUserQuestion, ExitPlanMode and destructive tools | Done 2026-10-14 | M | G | Reply: `session-reply-*.ts` (written to the chat outbox first, the drainer sends it; a lost link keeps the words; terminal tabs only). Deny with comment: `claude-permission-comment-send.ts`, Claude Code only (Down to the No row, Tab, the words, Enter, each read back; frames in `fixtures/claude-screen-permission-amend-2.1.299.txt`). Approve withheld: `permission-notification-approve-gate.ts`. Left: the comment for a plan review and for Codex; a structured session's Reply |
| G22 | P3 | Two notification toggles (updates vs permission requests) | Done 2026-10-14 | S | G | `notification-categories.ts`, rows on `app/notifications.tsx` |
| G23 | P1 | ↓ arrow threshold, running-row shimmer | — | — | — | in progress |
| G24 | P2 | Stop failure: re-enable Stop and say "Couldn't stop the session. Try again." when the agent is still working after Escape | Done 2026-10-14 | S | D | |
| G25 | P3 | Context window card in the transcript for `/context` output (categories, MCP tools, memory files, agents) | Done 2026-10-14 (in the context sheet) | M | F | `claude-context-report.ts` reads the table off the screen (Claude Code 2.1.300, at 130, 110, 80 and 48 columns and `/context all`; refuses a table that is cut or does not add up), `use-held-context-report.ts` keeps it for the session after it scrolls away, `context-card-model.ts` and `MobileContextCategories.tsx` draw the app's card. The phone never runs `/context`: that would draw in the user's terminal. Left: memory-file rows (2.1.300 paints the category and no section for it), the sessions API's `get_context_usage` (Batch 8), and a card in the transcript itself |
| G26 | P3 | Peer message row "Received message from <name>" plus a "Message" sheet ("From: <name>"); reject spoofed names | Differs | S | B | |
| G27 | P3 | Background shell "Show output" sheet. Needs proof that Orca's file read reaches the task output file; otherwise impossible | Missing | M | F | |
| G28 | P3 | Next-prompt suggestion chip, only if Claude Code paints the suggestion in its input (verify on 2.1.29x) | Missing | M | C | |
| G29 | P3 | "View transcript" on an agent task opens that Agent call's sheet with "Tool calls (N)" | Differs | S | F | |
| G30 | P3 | Edit an earlier message / rewind on terminal tabs via Claude Code's rewind menu, matched exactly or refused | Differs | L | H | |
| G31 | P3 | Read aloud under assistant messages, with on-device TTS (the Claude app uses Anthropic's voice service) | Missing | M | E | |
| G32 | P3 | Workflow card with an agent grid and phases | Differs | L | F | phases and the pulsing dot exist; the grid needs per-agent phase data the phone is not given |
| G33 | P3 | Auto mode opt-in dialog the first time Auto is picked | Missing | S | C | |
| G34 | P2 | Session list rows: state mark (Waiting amber / Working pulsing / Failed / New blue / Quiet ring), status second line, trailing time, state filter; **replace the hardcoded hex in `AgentSpinner.tsx` with theme tokens** | Differs | L | I | |
| G35 | P2 | Header menu: Copy branch, Background tasks, Rename, Copy session ID | Missing | S | A | |
| G36 | P3 | Launcher widget "Code shortcuts" (New session, Search) | Missing | M | I | |
| G37 | P1 | Composer look, Stop placement, one-row collapse, placeholder, queue look | Look, Stop and placeholder match (2026-10-14, spec below); one-row collapse and queue look open | — | — | in progress |
| G38 | P2 | Thumbnails, viewer, markup | — | — | — | in progress |
| G39 | P2 | Background tasks titles and Stop | — | — | — | in progress |
| G40 | P1 | One bottom-sheet LOOK: 44 dp top corners, `chatBg` ground (`pl7.q`), 36×5 hairline grabber (`pl7.x`) only on sheets with a partial stop, black 32% scrim. Both families (BottomDrawer, DraggableDetailSheet) and the queue editor read `src/components/sheet-spec.ts`; `sheet-spec.test.tsx` ratchets new sheets onto it. **Motion deliberately differs**: Claude's M3 springs were ported and rejected by the user on 2026-10-14 ("We need it smooth same as we have in latest release"), so every sheet moves exactly as in 0.9.139 (180 ms timed open, 150 ms hide, DRAWER_SPRING settle, scrim riding the open), pinned by `sheet-motion-0-9-139.test.tsx`. Also differs: the Android elevation shadow; no 640 dp max width. Spec in implementation notes §8 | Look match, motion differs by choice | M | — | done 2026-10-14 (Phase 1) |

### Top 10 by impact

1. **S1** One id per send, plus the retiring row's uuid kept (P1, M). It closes the "same words twice" duplicate.
2. **S2** The two-stage pending row (P1, S). The user sees whether the desktop took it. Ask about "Sending" first.
3. **G1** Thinking as a "Thought process" row (P1, M).
4. **G9** Header title, subtitle and context ring (P1, M).
5. **G6** The "Open diff" and todo pills above the composer (P1, M).
6. **G3** Status line elapsed, tokens and thinking words (P1, M). Needs a decision.
7. **G11** Plan approval buttons and Plan sheet (P2, M).
8. **G10** Permission card look and "Show full input" (P2, M).
9. **G8** Reading settings: text size, fonts, wrap (P2, M).
10. **S4 + S5** Outbox before the gate, and the Retry snackbar (P2, S each).

---

## 5. Implementation batches (disjoint files, can run in parallel)

Each batch lists the files it owns. No file appears in two batches. The
in-progress work owns `MobileNativeChatComposer.tsx`, `MobileNativeChatQueue.tsx`,
`MobileNativeChatChromeRow.tsx`, the theme tokens, `MobileNativeChatImageStrip.tsx`,
`ImagePreviewModal.tsx`, `MobileImageMarkupEditor.tsx`,
`MobileNativeChatShimmerText.tsx`, `mobile-native-chat-list-edges.tsx`, and the
Background tasks sheet files. None of the batches below touches them.

| Batch | Gaps | Files owned (under `mobile/src/session/` unless shown) |
|---|---|---|
| **S: send path** | S1–S6 | `use-mobile-native-chat-message-send.ts`, `mobile-native-chat-send-write.ts`, `mobile-native-chat-submit-verify.ts`, `native-chat-outbox-*.ts`, `mobile-native-chat-pending-retirement.ts`, `mobile-native-chat-outbox-drafts.ts`, `mobile-native-chat-unconfirmed-hold.ts`, `MobileNativeChatOutboxStatus.tsx`, `mobile-native-chat-beacon-confirm.ts`, `use-queued-own-sends.ts`, `src/storage/native-chat-outbox.ts`, `src/storage/native-chat-pending-echoes.ts`, `docs/mobile-chat-outbox.md`. S2's dimming is drawn through a prop that `MobileNativeChatMessage.tsx` reads; hand that one-line change to batch B, or sequence it after B |
| **A: header** | G9, G35 | `MobileSessionHeader.tsx`, `MobileSessionHeaderMoreActionsSheet.tsx`, `use-mobile-session-presentation.ts`, `MobileContextWindowSheet.tsx` (the ring moves; the composer drops it in the in-progress composer batch, so coordinate one handover commit) |
| **B: transcript rows** | G1, G10, G11, G12, G14, G15, G17, G26 | `MobileNativeChatReasoningNote.tsx`, `MobileNativeChatPermission.tsx`, `claude-plan-permission.ts`, `MobileNativeChatAsk.tsx`, `MobileNativeChatDiffCard.tsx`, `MobileNativeChatFileCard.tsx`, a new `MobileNativeChatTurnEditsCard.tsx`, `MobileNativeChatNoticeRow.tsx`, `MobileNativeChatAgentMessageRow.tsx`, `MobileNativeChatMessage.tsx`, a new `MobileNativeChatThinkingSheet.tsx`, a new `MobileNativeChatPlanSheet.tsx`. It can split into B1 (thinking, notices, errors, peer) and B2 (permission, plan, ask, edits) |
| **C: composer satellites** | G5, G6, G7, G13, G28, G33 | `MobilePermissionModeSheet.tsx`, `MobileNativeChatSessionOptionPickers.tsx`, `MobileNativeChatSessionOptionRows.tsx`, `MobileNativeChatComposerSuggestions.tsx`, a new `MobileNativeChatSessionBar.tsx` (diff and todo pills, mounted by the overlay), `MobileNativeChatTaskList.tsx`, `mobile-native-chat-task-list-rows.ts`, `MobileNativeChatOverlay.tsx` (mount only) |
| **D: status and stop** | G3 (after the decision), G16, G24 | `MobileNativeChatStatusLine.tsx`, `mobile-terminal-spinner-line.ts`, `use-mobile-native-chat-stop.ts`, `agent-hud-beacon.ts` (read-side fields only), a new `MobileNativeChatRateLimitBanner.tsx` (mounted through C's session-bar slot, so it never edits `MobileNativeChatOverlay.tsx` itself). A new beacon field means a change to the launch-flag command in `agent-hud-launch-args.ts`; that is still phone-side, but re-check the 64-byte and splice rules in `docs/mobile-agent-hud.md` |
| **E: reading** | G8, G18, G20, G31 | `app/native-chat-settings.tsx`, a new `src/settings/chat-reading-settings.ts`, `src/components/MobileMarkdown.tsx`, `MobileMarkdownCodeBlock.tsx`, `MobileMarkdownCodeHeader.tsx`, `src/components/mobile-markdown-prose-scale.ts` (scale factor only; the typography batch owns the values, so land it after that batch), `MobileNativeChatProse.tsx` (file-link spans), `use-mobile-native-chat-pinch-gesture.ts` |
| **F: tool sheets** | G19, G25, G27, G29, G32 | `MobileNativeChatToolDetailSheet.tsx`, `mobile-native-chat-tool-detail-sections.ts`, a new `MobileNativeChatReadViewer.tsx`, a new `MobileNativeChatContextCard.tsx`, `MobileSubagentTranscriptModal.tsx`, `mobile-subagent-transcript.ts`, a new `MobileBackgroundShellOutputSheet.tsx` (mounted from the tasks sheet after that batch lands) |
| **G: notifications** | G21, G22 | `src/notifications/*`, `app/notifications.tsx` |
| **H: rewind** | G30 | a new `claude-rewind-*.ts`; touches the message tap handler in `MobileNativeChatMessage.tsx`, so sequence it after B |
| **I: home** | G34, G36 | `src/components/WorktreeListRow.tsx`, `AgentSpinner.tsx`, `WorktreeAgentRow.tsx`, `src/worktree/agent-row-display.ts`, `src/host-screen/host-workspace-list.tsx`, `host-screen-header.tsx`; the widget is native (`modules/`) |

Order of dependency:

- B before H.
- The typography batch before E's scale factor.
- The composer batch hands the ring to A.
- The tasks-sheet batch before F mounts the shell output sheet.

Each batch carries the project's bar:

- a failing-first test from the real screen;
- both agents, where a parser is touched;
- light and dark checked on the phone;
- the full gate:

  ```
  cd mobile && npx tsc --noEmit && pnpm test && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs
  ```

---

## 6. Impossible via Orca, and why

| Item | Why |
|---|---|
| Echo matching by the client uuid | Claude Code writes its own uuid into the transcript. The terminal lane has no field to carry the phone's. Text plus occurrence matching stays, hardened by S1 |
| Server "post later" (`priority: "later"`) | No terminal key holds a message until the turn ends. Claude Code's own queue delivers between tool calls instead |
| Cloud sessions: init card, environments, Continue in cloud, runners | Anthropic's cloud |
| Share, Feedback to Anthropic, session presence, mark read across devices | Anthropic's servers |
| Artifacts and the artifact viewer | claude.ai artifacts |
| Usage card **cost** across devices / extra-usage credits | account data from Anthropic. A per-session cost from the beacon is possible, if a field is added (D) |
| Thinking rows on terminal Claude tabs | Orca's `claudeMessageRole()` returns `assistant` for thinking-only messages (`claude-app-parity.md` item 1). This is an upstream Orca fix, not a phone one |
| Read aloud with Anthropic's voice | the Claude app streams server TTS. Only on-device TTS is possible (G31) |
| Project threads, members, @member mentions, reactions | the claude.ai project channel |
| Remote-control device list and `claude rc` | a different pairing model. Code UI's host pairing replaces it |

## 7. Not determined

- **Server queue timing.** Whether the server echoes a `"later"` message at once
  or at turn end.
- **Double row.** How the Claude app avoids drawing both the pending row and the
  optimistic transcript row.
- **Retry values.** The production values of `claudeai_code_send_retry`. The
  defaults mean no retry.
- **Model and limits.** The effort level names (server-supplied), the attachment
  limit (remote config), and the exact slash-trigger rule.
- **Notification wording.** Finished vs needs-input comes from the push payload,
  not the APK.
- **Deny with comment.** Which in-app flow, if any, sends it for ordinary tools.
  Only the notification and the plan path were seen.
- **Claude Code's side, on 2.1.29x:**
  - whether it paints prompt suggestions in the TUI input (G28);
  - what happens to its queue when a turn ends in an error (S6).
