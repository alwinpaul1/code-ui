# Code UI's own files inside src/shared

`src/shared/` is vendored Orca code: re-vendor it, never edit it here. These files
are the exceptions — Code UI authored them and they have no upstream counterpart at
any commit. A re-vendor must not delete them and must not be surprised by them.

- `native-chat-pasted-image-paths.ts` — imported by `native-chat-image-transcript-markers.ts`
  and by three files under `mobile/src/session/`. It belongs in `mobile/src/session/`;
  moving it also edits the vendored importer, so that is its own commit, not a
  side effect of a port.

Everything else under `src/shared/` came from upstream. When a file is re-vendored
past the base commit in `UPSTREAM.txt`, record its own commit there.

## Vendored files carrying a forward-ported hunk

These sit at their recorded commit plus one hunk lifted from a LATER upstream
commit, because re-vendoring the whole file at that commit would drag in
changes this fork cannot compile. A re-vendor past that commit makes the hunk
redundant — check before re-applying it.

- `native-chat-types.ts`, `agent-session-journal-types.ts`,
  `agent-session-journal-schemas.ts` and
  `structured-agent-session-projection.ts` all carry the optional
  `presentation` / `tone` display hints from Orca #19228 (9f044031), so a
  compaction notice, a plan document or a toned line survives the journey from
  the host's journal to the phone's transcript. The rest of 9f044031 lives in
  `src/main/`, which this fork does not vendor. (`native-chat-tool-identity.ts`
  IS vendored now — Orca #19226 landed — so that is no longer what blocks a
  whole-file re-vendor of `agent-session-journal-types.ts`; the #19228 hints
  are.)

## Vendored files carrying a local hunk

These came from upstream and were then edited here. A re-vendor must
re-apply the hunk, not drop it. Both fix behaviour upstream does not have.

- `native-chat-session-option-snapshot.ts` — an unlisted tracked model (a
  release newer than the catalog) keeps the catalog's fallback effort rows,
  so the sheet is not model-name-only. It also carries Orca #20506's
  (c287a5d9b) boolean-descriptor hunk by 3-way merge: `currentValue` always
  resolves to `values[id] ?? defaultValue`, so a switch never renders `false`
  for "nobody said"; provenance stays on `valueSource`.
- `native-chat-session-option-state.ts` — when the agent reports a different
  model than the one the user picked, the user's own non-reported picks are
  carried onto the reported model instead of being dropped.
- `native-chat-slash-commands.ts` (and its test) — Code UI enumerated Claude
  Code 2.1.261's and Codex 0.153.4's real command tables in place of upstream's
  five-entry catalogs, and added `opensOverlay`, `isSlashCommandToken` and
  `slashCommandOpensOverlay`. Upstream has none of it. A whole-file re-vendor
  would delete the catalogs the `/` menu is built from.

## Vendored files carrying a hand-applied upstream hunk

Not a clean copy of any upstream commit: an upstream change was applied by hand
because the file had diverged, or because the surrounding upstream commit is not
vendored here. Re-vendoring one of these at a later commit is fine and drops the
entry; re-vendoring it at an EARLIER one silently reverts the hunk.

- `structured-agent-session-reducer.ts`, `structured-agent-session-coalescer.ts`
  — the per-session `/` command catalog from bf4e27050, plus the background-task
  half of e89deb63c (#18757), f8780a2c8 (#18807), 5868fdc9e (#19346) and
  2bf298d1d (#19311): `backgroundTasks` in the reducer's state, the roster
  equality that guards it, the journal-unchanged short-circuit that arrived with
  it, and the coalescer's roster merge. Neither file can be re-vendored at
  2bf298d1d: the same range adds `activity` (f7d521601, #19055) and
  `retainedItemLimit` (0b60b0dcb, #19841), both now hand-applied. The reducer
  is no longer missing an upstream hunk.
  (An earlier note here credited the short-circuit to #19147; it is #18757's,
  and it arrived with the background-task handling for exactly that reason — a
  task edge rides a batch whose journal delta is empty.)

- `agent-session-wire.ts` — the background-task fields from the same four
  commits, on top of its f1d854502 pin: `AgentSessionBackgroundTaskRunState`,
  `name`/`state`/`startedAt`/`totalTokens` on a task, `settledTasks`,
  `supportsStopAll`, and `agentSessionBackgroundTasksEqual`. Since Orca #19705
  (f2af92b2f) those definitions live in `agent-session-background-task-wire.ts`,
  which IS vendored whole (it adds `stoppable` on a task), and this file carries
  #19705's re-export hunk instead of the inline block. A whole-file
  re-vendor at 2bf298d1d would drag in the rewind surface (ce4a3a418, #19235 —
  it imports `agent-session-rewind.ts`, not vendored here) and
  `hostExecutionOwned` from 1c1cb7115, which is the orchestration-worker feature
  this fork does not implement. `AgentSessionStatusSummary.backgroundTasks` from
  2bf298d1d is deliberately NOT taken: it feeds a session list this app has no
  surface for. Orca #19695 (2626e2eca) added `hostNow` on the history page and
  on every subscribe frame, hand-applied here; the same commit moved the
  refusal codes into `agent-session-wire-refusals.ts`, which is NOT vendored
  because it imports `agent-session-rewind.ts` — the codes stay inline in this
  file, and every importer reads them from here as before.
- `native-chat-slash-commands.ts` — `sessionSlashCommandSuggestions` and
  `sessionReportedSkillNames` from bf4e27050, on top of the local catalogs above;
  and from Orca #19928 (9b83f976f) the `argumentHint` field plus a reported
  `description` winning over the curated one. Its test took #19928's two cases
  by 3-way merge.
- `agent-session-wire.ts` also carries #19928's optional `description` /
  `argumentHint` on `AgentSessionSlashCommand`, and #20506's (c287a5d9b) Fast
  mode fields: `supportsFastMode` on a model, `AgentSessionFastModeState`,
  `AgentSessionFastModeSupport`, `fastModeSupport` on the options result and
  `fastMode` / `fastModeState` on its `current`; and #20601's (f55b7ba68)
  `AGENT_SESSION_ID_MAX_LENGTH`, which the re-vendored
  `rpc-contract/structured-agent-session-params.ts` imports.
- `protocol-version.ts` — `STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY`
  from 1ae7aa8bb, and `AGENT_SESSION_BACKGROUND_TASK_STOP_CAPABILITY` (5868fdc9e,
  #19346), `AGENT_SESSION_BACKGROUND_TASK_ROW_STOP_CAPABILITY` (f2af92b2f,
  #19705), `AGENT_SESSION_TURN_ITEM_CAPABILITY` (2626e2eca, #19695) and
  `AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY` (027acb4ef, #19863) and
  `AGENT_SESSION_PROMPT_CANCEL_RUNTIME_CAPABILITY` (f55b7ba68, #20601), all in
  `RUNTIME_CAPABILITIES` too — the phone advertises them through
  `remote-runtime-client-capabilities.ts`, which is re-vendored whole at 2626e2eca.
  The file otherwise sits at its d07c47593 pin: upstream later added
  `NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY`,
  `NOTIFICATION_DELIVERY_PREFERENCES_CAPABILITY` and the rewind and status-feed
  constants, which are NOT vendored here, so a whole-file re-vendor would drag in an
  unported change.
- `structured-agent-session-projection.ts`, `agent-session-journal-types.ts`,
  `agent-session-journal-schemas.ts` — the working-state half of 2f828e446
  (#19822): `hasUnansweredStructuredAgentSessionDispatch`, the optional
  `submissions`/`currentFence` arguments on
  `projectStructuredAgentSessionStatus`, and `recovered?: true` on a
  submission. The optimistic-bubble half is deliberately NOT taken — this fork
  calls the message projection with an empty outbox and leaves pending bubbles
  to its own pending-echo system, so upstream's would draw a second one.
  `scratchpad/19822-assessment.md` records the reasoning. The projection cannot
  be re-vendored at 2f828e446: its base-to-there delta also brings
  `projectStructuredAgentSessionStatusSummary` (#18776/#19137), which is the
  desktop sidebar's feed and has no reader here.
- `native-chat-types.ts` and `structured-agent-session-projection.ts` also carry
  hunks from Orca #18765 (172aa1ac3): the `NativeChatEditPatch` shapes plus the
  `editPatch` field on a tool-result block, and `stripBoundedTextMarker`, which
  `native-chat-edit-normalize.ts` imports. Neither file can be re-vendored whole
  at that commit, because both also carry the forward-ported #19228 hints above.
  Both hunks are marked `CODE UI HAND-APPLIED UPSTREAM HUNK` in the source.
- `native-chat-types.ts`, `agent-session-journal-types.ts`,
  `agent-session-journal-schemas.ts` and
  `structured-agent-session-projection.ts` also carry hunks from Orca #19226
  (d0506bf5d): `NativeChatToolMetadata` on a tool call, the same fields on the
  journal item and its zod shape, and the projection carrying them onto the
  block. The rest of #19226 is `src/main/` translation code this fork does not
  vendor. No file here can be re-vendored whole at d0506bf5d, because all four
  also carry the forward-ported #19228 hints above. Every hunk is marked
  `CODE UI HAND-APPLIED UPSTREAM HUNK` in the source.
- `agent-session-journal-types.ts`, `agent-session-journal-schemas.ts`,
  `structured-agent-session-projection.ts` and
  `structured-agent-session-reducer.ts` also carry Orca #19695 (2626e2eca), the
  durable turn record, by 3-way merge onto the hunks above: the typed `turn`
  item (`AgentJournalTurnItem`, `AgentJournalTurnLifecycle` with
  `userItemId`/`startedAt`/`completedAt`/`durationMs`, schema version 3 and
  `journalRowSchemaVersion`), its zod shape, the projection painting a turn
  record — and any kind this build does not know — as no message, and the
  reducer's `hostClock` sample, `receivedAt` argument and submission retention
  keyed to loaded user messages. None of the four can be re-vendored whole at
  2626e2eca for the reasons the entries above give; every hunk merged clean
  except the reducer's snapshot arm, which differed only by line wrapping.
  The reducer also carries Orca #20581 (a4c11f188): the `tail-page` action and
  its cursor-moving branch are gone, `history-page` replaces the page whole,
  and `shouldAdvanceStructuredResumeCursor` is deleted. The phone never
  dispatched `tail-page` (its only history read is `older-page`), so this is
  alignment, not a fix here; the vendored reducer test is NOT updated for it
  (seven conflicting hunks on a file that is never collected), so it still
  names `tail-page`. `agent-session-journal-types.ts` carries #20518's
  (4634d2c03) `userItemId` doc comment.

- `structured-agent-session-projection.ts` also carries the per-item render
  cache from Orca #19229 (e80fae0c4): the `projectedItems` WeakMap, and
  `projectStructuredItemsToNativeChat` delegating to the single-item
  projection rather than the other way round. It is safe only because the
  reducer replaces journal items instead of mutating them, and because
  `native-chat-tool-fold.ts` clones a message before pushing into its blocks —
  check both before re-vendoring anything in that path. The rest of #19229 is
  `src/renderer/`. The file still cannot be re-vendored whole at e80fae0c4:
  the same delta brings `projectStructuredAgentSessionStatusSummary`
  (#18776/#19137), which has no reader here. The hunk is marked
  `CODE UI HAND-APPLIED UPSTREAM HUNK` in the source.

- `native-chat-tool-fold.ts` — the allocation work from Orca #19468
  (44eb95fc6), in `dropUnattributableToolResults` and `pairToolBlocks`. The file
  cannot be re-vendored whole at that commit: the same range carries #18773's
  subagent-roster fold, which reads `isSubagentGroupBlock` from a block type
  this fork does not vendor. Both hunks are marked
  `CODE UI HAND-APPLIED UPSTREAM HUNK` in the source, and both are byte-equal to
  upstream's — the file differs from 44eb95fc6 only by the absent #18773 code
  and those two markers.

`native-chat-tool-summary.ts` and its test used to sit here for dropping
upstream's `mcpIdentity` field. #19226 landed, so both were re-vendored whole at
their c1e15c400 pin and the field is back; the entry is gone.


- `structured-agent-session-live-turn.ts` and its test used to sit here as a
  partial port of Orca #19977 (fab78c766), because they read the turn record
  through `readAgentJournalTurn` and the typed `turn` item did not exist here.
  Orca #19695 (2626e2eca) landed on 2026-09-19 and brought both, so the file
  and its test are now vendored whole at fab78c766, and
  `structured-agent-session-projection.ts` re-exports
  `activeStructuredAgentSessionTurnId` / `activeStructuredAgentSessionToolCall`
  from it, exactly as upstream's projection does. The entry is gone.
