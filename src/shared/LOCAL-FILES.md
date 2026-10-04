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

- `agent-session-record.ts` — carries `rewind?: AgentSessionRewindRecord` and
  `conversationName?: string` on `AgentSessionRecord`, plus the matching
  conjuncts in `isAgentSessionRecord`. Hand-written from upstream's
  `agent-session-rewind.ts` / the `AgentSessionRecord` shape at ce4a3a418
  #19235 rather than copied by re-vendoring this file wholesale, because
  `agent-session-record.ts` itself cannot be re-vendored past f1d854502 (see
  "Vendored files carrying a hand-applied upstream hunk" below re:
  `agent-session-wire.ts`, which this file's own type chain touches).
  Upstream's own `agent-session-record.ts` at HEAD has neither field. Noted
  2026-09-19 while re-pinning this file for #20785's `shapeValid` ->
  `fieldsValid` rename, found undocumented until now.
- `native-chat-session-option-snapshot.ts` — an unlisted tracked model (a
  release newer than the catalog) keeps the catalog's fallback effort rows,
  so the sheet is not model-name-only. It also carries Orca #20506's
  (c287a5d9b) boolean-descriptor hunk by 3-way merge: `currentValue` always
  resolves to `values[id] ?? defaultValue`, so a switch never renders `false`
  for "nobody said"; provenance stays on `valueSource`.
- `native-chat-session-option-state.ts` — when the agent reports a different
  model than the one the user picked, the user's own non-reported picks are
  carried onto the reported model instead of being dropped. (Re-vendored at
  ae9c06c94 for Orca #20612 by 3-way merge; the local hunk is still the only
  difference.)
- `native-chat-slash-commands.ts` (and its test) — Code UI enumerated Claude
  Code 2.1.261's and Codex 0.153.4's real command tables in place of upstream's
  five-entry catalogs, and added `opensOverlay`, `isSlashCommandToken` and
  `slashCommandOpensOverlay`. Upstream has none of it. A whole-file re-vendor
  would delete the catalogs the `/` menu is built from.
- `native-chat-tool-summary.ts` — on its 91e6e1f355 pin (#22029, v1.4.209..v1.4.210
  shared halves), except that `countToolCalls` stays in its c1e15c400 form,
  `blocks.filter(isToolCallBlock).length`, marked `CODE UI KEPT AT c1e15c400` in the
  source. Upstream's #20328 rewrote it as a `forEach` counter so it builds no array,
  and #22029 left that form alone. It is not taken: nothing in `mobile/` or
  `src/shared/` calls `countToolCalls`, and both forms return the same count. Recorded here 2026-09-24; before
  that the exception was only in UPSTREAM.txt.
- `structured-agent-session-tool-call-block.ts` — copied from 8757e40063 (#22349). It once lacked
  upstream's `callId` line because this fork's journal item and block had no `callId` (it arrived
  with #19869, not ported). Orca #22619 (cb363444f3) pairs a tool result with the call it names,
  so the field is needed: `callId?` is back on `AgentJournalToolCallItem`, on
  `NativeChatToolCallBlock`, and in `agent-session-journal-schemas.ts` (`ProviderCallId`, on the
  block and on the journal body), hand-applied from v1.4.217, and the line here is upstream's.
  The block is now byte-equal to v1.4.220's; the three other files keep their older base.

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
  by 3-way merge. Also Orca #20672's (f1a901e97) `OMP_COMMANDS` catalog,
  hand-applied, with one local difference: the ten entries upstream describes
  as "in Terminal" carry `opensOverlay: true`, the flag this fork's Codex
  catalog uses so the phone shows the terminal for a selector the chat cannot
  drive. `native-chat-slash-commands.omp.test.ts` is vendored at f1a901e97.
- `agent-session-wire.ts` also carries #19928's optional `description` /
  `argumentHint` on `AgentSessionSlashCommand`, and #20506's (c287a5d9b) Fast
  mode fields: `supportsFastMode` on a model, `AgentSessionFastModeState`,
  `AgentSessionFastModeSupport`, `fastModeSupport` on the options result and
  `fastMode` / `fastModeState` on its `current`; and #20601's (f55b7ba68)
  `AGENT_SESSION_ID_MAX_LENGTH`, which the re-vendored
  `rpc-contract/structured-agent-session-params.ts` imports.
- `agent-status-types.ts` — Orca #20612's (ae9c06c94) `modelSwitchCommand`
  on the status entry and payload, the pick and the normalizer, hand-applied.
  The file otherwise sits at the vendor base and cannot be re-vendored whole:
  the base→ae9c06c94 delta also carries #19807 and #19645 (both skipped, see
  the inventory) and the orchestration fleet `attention` field. The commit's
  `agent-hook-listener/providers/pi-family-events.ts` half — the producer that
  stamps the field — is host-side and not vendored.
- `protocol-version.ts` — `STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY`
  from 1ae7aa8bb; `AGENT_SESSION_BACKGROUND_TASK_STOP_CAPABILITY` (5868fdc9e,
  #19346), `AGENT_SESSION_BACKGROUND_TASK_ROW_STOP_CAPABILITY` (f2af92b2f,
  #19705), `AGENT_SESSION_TURN_ITEM_CAPABILITY` (2626e2eca, #19695),
  `AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY` (027acb4ef, #19863) and
  `AGENT_SESSION_PROMPT_CANCEL_RUNTIME_CAPABILITY` (f55b7ba68, #20601) and
  `AGENT_SESSION_OPENCODE2_RESUME_RUNTIME_CAPABILITY` (ee354a35d, #21418) and
  `ANTIGRAVITY_CONFIGURED_MODEL_RUNTIME_CAPABILITY` (253f0e394, #21606; its entry only,
  not the `'files.pathsExist'` beside it upstream, which this copy never took), all in
  `RUNTIME_CAPABILITIES` too — the phone advertises the first two through
  `remote-runtime-client-capabilities.ts`, which is re-vendored whole at 2626e2eca,
  and the rest from `mobile-runtime-client-capabilities.ts`;
  `SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY` (the
  constant and its `RUNTIME_CAPABILITIES` entry) from 5287c5cdb (#20069), and
  `AGENT_LAUNCH_RUNTIME_CAPABILITY` (the constant, its doc comment, and its entries in
  `NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES` and `RUNTIME_CAPABILITIES`) from
  6da72383d (#19849), at its 4b87bc718 (#20999) value `agent.launch.v2`, and
  `AGENT_LAUNCH_REPLAY_RUNTIME_CAPABILITY` (constant plus `RUNTIME_CAPABILITIES` entry)
  from 0bf815a48 (#21106), with its comment and the sibling
  `AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY` from abc8386e1 (#21137), and
  `AGENT_SESSION_MUSE_RESUME_RUNTIME_CAPABILITY` (constant plus `RUNTIME_CAPABILITIES`
  entry) from ebed0964a2 (#22216, v1.4.210..v1.4.211 shared halves), and
  `AGENT_SESSION_TURN_COMPLETION_RUNTIME_CAPABILITY` (constant, its doc comment, and its
  `RUNTIME_CAPABILITIES` entry) from 2739246058 (#21924, v1.4.209..v1.4.210 shared
  halves) — its entry only; the wire types it gates
  (`AgentSessionTurnCompletion`/`AgentSessionTurnCompletionEvent`/`agentSessionTurnCompletionKey`
  in `agent-session-wire.ts`) are NOT taken, because they need `AgentJournalTurnOutcome`,
  which predates v1.4.209 and was never forward-ported into this fork's
  `agent-session-journal-types.ts` (itself already six hand-applied hunks deep, see
  below); nothing on the phone reads this stream either way. The file
  otherwise sits at its d07c47593 pin: upstream later added
  `NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY`,
  `NOTIFICATION_DELIVERY_PREFERENCES_CAPABILITY` and the rewind and status-feed
  constants, which are NOT vendored here, so a whole-file re-vendor would drag in an
  unported change.
- `rpc-contract/rpc-params-catalog.generated.ts` — on its eedd35645 pin plus the
  `agent.launch` row and its `AgentLaunch` import from 97aa5ff19 (#19850; #19849 had
  first listed the method under `RPC_METHODS_WITHOUT_SHARED_PARAMS`, #19850 moved it
  into the catalog, and the net of the two is what is here), and the
  `agent.launchReplay` row from abc8386e1 (#21137). A whole-file re-vendor
  would drag in the `aiVault.search*` rows and `FilePathsExist`, whose schemas this
  fork does not vendor, and the `agentSession.restart*` rows from 434365d2d (#21096),
  which the phone never calls.
  It also carries the two `mobileWeb.bundle.*` rows and their import from 9641a1b54
  (#21348, OTA phase A 3/5); this fork cannot run the generator, so the rows are
  hand-kept until the catalog is re-vendored at or past 9641a1b54. The
  `mobileWeb.bundle.range` row from 996f9cc306 (#22381) is hand-kept for the same reason;
  it reuses the chunk's params schema, so the import did not change. It also carries the
  `agentSession.subscribeTurnCompletions: null` row from 2739246058 (#21924,
  v1.4.209..v1.4.210 shared halves), hand-kept for the same reason, and the
  `agentSession.threadGoal` row with its `ThreadGoalParams` import from 563dd5487f
  (#22377, v1.4.210..v1.4.211 shared halves); nothing on the phone calls it yet.
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
  (4634d2c03) `userItemId` doc comment, and both it and
  `agent-session-journal-schemas.ts` carry #21086's (533b0bd02) optional
  `requestedAt` on the turn lifecycle — the host clock at the send that opened
  the turn — by 3-way merge, and #21087's (aad41b1a4) approval presentation
  fields (`displayName`, `description`, `decisionReason`, `blockedPath`,
  `matchedAskRule`, and the `AgentJournalApprovalMatchedAskRule` type) the
  same way, and #21090's (e42f7c00b) typed plan `subject` on an approval.

- `agent-session-journal-types.ts`, `agent-session-journal-schemas.ts` and its test,
  `native-chat-types.ts`, `agent-session-wire.ts`, `structured-agent-session-projection.ts`
  and `structured-agent-session-reducer.ts` also carry the v1.4.210..v1.4.211 shared
  halves, applied by hand because every one of them sits on the hunks above:
  - Orca #22299 (9ece273056): `AgentJournalProducerKind` and `AgentJournalProducerLinkage`
    on every render item, and the zod `AgentJournalProducerLinkageFields` spread into
    `AgentJournalRenderItemSchema`. The projection takes only the two "Deliberately NOT
    scoped by producer" notes: the root-row scoping in `latestStructuredAgentSession*`
    lives in functions this fork's projection does not have.
  - Orca #22377 (563dd5487f): the thread goal. `AGENT_JOURNAL_MESSAGE_SEND_MODES`,
    `sentAs` on a journal message and on `NativeChatMessage`, the goal status and state
    types, `threadGoal` on a status item, their zod shapes, the projection copying a
    known `sentAs` onto its message, and in the wire file
    `AGENT_SESSION_THREAD_GOAL_OBJECTIVE_MAX_LENGTH`, `AgentSessionThreadGoalChange`,
    `AgentSessionThreadGoalResult` and `threadGoal` on the options result. The reducer
    takes its `liveItemsWithinWindow`: while older rows remain on the host, a live
    revision of a row older than the loaded window is left out, so it cannot become the
    load-older anchor and make the next page skip every row in between.
  - Orca #22349 (8757e40063): the projection's tool-call and diff arms build their
    block through `structured-agent-session-tool-call-block.ts` (see the local hunk
    above), and the wire file's `toolName` doc comment. The status summary's
    `statusStructuredAgentSessionToolCall` is not taken, because
    `projectStructuredAgentSessionStatusSummary` is not here.
  The schemas test takes both commits' new cases by hand; it sits 176 lines short of
  upstream's v1.4.210 copy, so the range patch does not apply.
- `constants.test.ts` — #22216's (ebed0964a2) `muse: '--yolo'` expectation, by hand. The
  file cannot be taken whole: upstream's copy also has #14929's `minimaxEndpoint` case,
  which needs a `default-global-settings.ts` field this fork's copy does not have.

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
  `activeStructuredAgentSessionTurnId` from it, as upstream's projection does.
  (It also re-exported `activeStructuredAgentSessionToolCall` until the
  v1.4.210..v1.4.211 shared halves, when #22349 dropped that reader from the
  live-turn module.) The entry is gone.

## The v1.4.211..v1.4.217 shared halves (Orca v1.4.217, b11a88dc84)

147 files taken whole and byte-equal to v1.4.217 (127 already here, 20 new), 12 merged by
hand, 3 deleted (#22783 removed the unused terminal handoff: `agent-session-pty-write-admission.ts`,
its test and `agent-session-pty-write-refusal-copy.ts`). The 12 were merged 3-way (this copy,
upstream v1.4.211, upstream v1.4.217), so each carries only the v1.4.211..v1.4.217 change on top
of everything the entries above already record:

- `agent-session-wire.ts` — the terminal handoff types go (#22783: `AgentSessionHandoffDirection`,
  `Mode`, `Action`, `Request`, `Result`, and the `handoff` field on `snapshot`, `event` and `reset`
  frames; `AgentSessionHandoffStatus` stays as upstream's narrowed `owner: 'native' | 'none'`
  reply). `contextUsage` on the options result, `tabId` on the attach result, `statusStartedAt`,
  `AgentSessionModelCatalogResult` come in whole. `turnOutcome` on `AgentSessionStatusSummary`
  is taken by hand (its `AgentJournalTurnOutcome` type exists here now, through
  `agent-turn-outcome.ts`). NOT taken, for the reasons the entries above give:
  `hostExecutionOwned` / `hostExecutionPhase`, `backgroundTasks` on the status summary, and the
  turn-completion feed types (`AgentSessionTurnCompletion*`, `agentSessionTurnCompletionKey`),
  which nothing on the phone reads. The refusal code list is still inline: upstream moved it to
  `agent-session-wire-refusals.ts` (imports `agent-session-rewind.ts`, not vendored), and the new
  `agent_session_owner_restart_failed` code (#22364, 6ae6ed08bb) is added to the inline list by
  hand, marked `CODE UI HAND-APPLIED UPSTREAM HUNK` in the source.
  The same file's inline `AgentSessionWireRefusal` also takes `ownerVerdict?: AgentSessionOwnerVerdict`
  (`'live' | 'unverifiable' | 'exited'`, #22364) by hand: on a durably failed create, `exited`
  proves nothing runs. `classifyCreateRefusal` in `mobile-structured-agent-session-launch.ts` reads it.
- `agent-session-record.ts` — the launch-args check moves to `agent-session-launch-args.ts` and
  the lease decode goes through `agent-session-legacy-handoff-lease.ts` (`isPersistedAgentSessionRecord`
  replaces `isAgentSessionRecord`; both new files are vendored whole). This copy's own
  `rewind` / `conversationName` conjuncts stay as hand-written above, so upstream's imports of
  `agent-session-rewind.ts` and `agent-session-conversation-name.ts` are still left out.
- `agent-status-types.ts` — `mainAgent` (`AgentMainAgentStatus`, #22452) on the row and payload with
  its normalizer, `stateObservedAt`, `isAgentStatusState`, and `AgentStateHistoryEntry` moved into
  `agent-state-history.ts`. The `OrchestrationFleetAttention` import stays out, as before.
- `agent-session-journal-types.ts`, `agent-session-journal-schemas.ts` — `answers` on a resolution,
  `contextUsage` on a turn, `recoveredAt` on a recovered row. `AgentJournalTurnOutcome` now comes
  from `agent-turn-outcome.ts` and is re-exported here, so the earlier note that this file has no
  `AgentJournalTurnOutcome` is out of date. Journal-types' import block keeps the local
  `presentation` / `tone` comment line beside upstream's new imports.
- `protocol-version.ts` — `AGENT_SESSION_CONVERSATION_OUTLINE_RUNTIME_CAPABILITY` (constant and
  `RUNTIME_CAPABILITIES` entry), `AGENT_SESSION_QUESTION_ANSWERS_RUNTIME_CAPABILITY`,
  `AGENT_SESSION_ZCODE_RESUME_RUNTIME_CAPABILITY`, `AGENT_SESSION_CREATE_TAB_ID_RUNTIME_CAPABILITY`.
  `AGENT_SESSION_REWIND_RUNTIME_CAPABILITY` is still not taken.
- `rpc-contract/rpc-params-catalog.generated.ts` — `agentSession.conversationOutline`,
  `agentSession.modelCatalog` and `agentSession.respondToQuestion` (now `RespondToQuestionParams`);
  `agentSession.requestHandoff` and its `HandoffParams` import go. The `agentSession.restart*`
  rows are still not listed, as before.
- `agent-session-operation-ledger.ts`, `structured-agent-session-outbox.ts`,
  `structured-agent-session-reducer.ts` (the `handoff` state is gone, `unloadedTurnRevisions`
  is new), `structured-agent-session-turn-timing.test.ts` and
  `native-chat-session-option-snapshot.ts` — the range's own hunks on top of their older pins.

Vendored files the range changed that are NOT taken, because a whole take would drag unported
desktop settings, catalog or rewind code in behind them and nothing on the phone reads the change:
`structured-agent-session-projection.ts` (the range's hunks are all in the status summary,
`projectStructuredAgentSessionStatusSummary`, which this copy does not have) and its test,
`agent-session-lease-adjudication.ts` and test (imports `agent-session-wire-refusals.ts`),
`default-global-settings.ts`, `global-settings-types.ts`, `rate-limit-types.ts` and test
(Cursor account fields), `worktree/types.ts` and `worktree/create-types.ts` (the
`catalogVersion` and archive-hook types), `workspace-session-schema.ts` and its two tests,
`tui-agent-detection-commands.ts`, `project-groups.ts`, `text-search.ts` and
`text-search-glob-patterns.ts`, `growing-byte-buffer.ts` and test, `cli-argument-boundary.ts`,
`ephemeral-vm-recipe-process.ts`, `git-binary-compatibility.test.ts`,
`browser-network-tunnel-stream-framing.test.ts`, `child-process/*` (four files and two
fixtures), `agent-status-types.test.ts` and
`agent-hook-listener-extraction-characterization.test.ts`. None of them is imported by production code under
`mobile/`.
