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
  it imports `agent-session-rewind.ts`, vendored only since the v1.4.217..v1.4.219
  chat chain below) and
  `hostExecutionOwned` from 1c1cb7115, which is the orchestration-worker feature
  this fork does not implement. `AgentSessionStatusSummary.backgroundTasks` from
  2bf298d1d is deliberately NOT taken: it feeds a session list this app has no
  surface for. Orca #19695 (2626e2eca) added `hostNow` on the history page and
  on every subscribe frame, hand-applied here; the same commit moved the
  refusal codes into `agent-session-wire-refusals.ts`. That module was not
  vendored while `agent-session-rewind.ts` was not, so the codes stayed inline
  here. Both are vendored now (the v1.4.217..v1.4.219 chat chain below), and this
  file carries upstream's `export * from './agent-session-wire-refusals'` in place
  of the inline block; every importer still reads the codes from here.
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
  `AGENT_SESSION_PROMPT_CANCEL_RUNTIME_CAPABILITY` (f55b7ba68, #20601; no longer defined in this
  file: since #24301 it lives in `agent-session-stop-capabilities.ts`, which this file re-exports
  and spreads into `RUNTIME_CAPABILITIES`, see the #24301 entry below) and
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
  in `agent-session-wire.ts`) are NOT taken. They needed `AgentJournalTurnOutcome`, which
  predates v1.4.209 and which this fork's `agent-session-journal-types.ts` lacked when this was
  written; it has it now (the v1.4.211..v1.4.217 and #23467 entries below), but nothing on the
  phone reads this stream either way. The file
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
  subagent-roster fold, which reads `isSubagentGroupBlock`. The block type is
  vendored since #26125 (see the end of this file), but the fold is still not
  taken: it moves later tool calls above a roster row, a reordering of its own
  to port and pin. A roster mid-turn therefore still splits the tool run, as its
  sentence did before. Both hunks are marked
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
  which nothing on the phone reads. The refusal code list was still inline then (upstream had moved
  it to `agent-session-wire-refusals.ts`, which imports `agent-session-rewind.ts`; both are vendored
  since the v1.4.217..v1.4.219 chat chain, and the inline block is gone), and the new
  `agent_session_owner_restart_failed` code (#22364, 6ae6ed08bb) is added to the inline list by
  hand, marked `CODE UI HAND-APPLIED UPSTREAM HUNK` in the source.
  The same file's inline `AgentSessionWireRefusal` also takes `ownerVerdict?: AgentSessionOwnerVerdict`
  (`'live' | 'unverifiable' | 'exited'`, #22364) by hand: on a durably failed create, `exited`
  proves nothing runs. `classifyCreateRefusal` in `mobile-structured-agent-session-launch.ts` reads it.
  (Both hand-applied pieces now come from the vendored `agent-session-wire-refusals.ts`, whose
  v1.4.220 copy has the code and the verdict, so neither is a local hunk any more.)
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

## The v1.4.219..v1.4.220 shared halves, mobile shell and contracts (Orca v1.4.220, 7e66229dfd)

Twelve files taken whole and byte-equal to v1.4.220 (two new: `orchestration-caller-status.ts`
and `telemetry-ssh-runtime-event-schemas.ts`). Eight merged 3-way (this copy, upstream v1.4.219,
upstream v1.4.220) because their older pins lag v1.4.219 in unrelated fields, so each carries only
the range's change on top of everything the entries above record. Nothing on the phone sends or
reads any of it:

- `rpc-contract/files-params.ts` — `FileOpenTab` with the optional `navigation` target (#24244);
  `FileOpenDiff` now extends it. The phone's `files.open` calls send no `navigation`, which the
  host treats as the original behaviour.
- `rpc-contract/rpc-params-catalog.generated.ts` — `files.open` is `FileOpenTab` (#24244);
  `orchestration.callerShow` and `orchestration.sessionAddress` are new rows (#22636, CLI methods,
  not on the mobile allowlist). The rows the entries above leave out are still left out.
- `runtime-session-contracts.ts` — the optional `caller` (`CliStatusCaller`, #22636).
- `runtime-terminal-contracts.ts` — `recordedPaneKey` on orphaned terminal rows (#24458).
- `ssh-types.ts` — the net of #24129, #24133 and #24147 after #24559 reverted #24453 and #24463:
  `SshRemoteRuntime`, `SshRemoteRuntimeRung`, `SshRemoteRuntimeResolution`, `SshPlainSshMode` and
  their constants. The v1.4.219 `SshTargetSummary` additions are still not taken.
- `telemetry-event-registry.ts` — the `ssh_remote_runtime_resolved` row and its import (#24133).
- `persisted-ui-state-types.ts`, `ui-chrome-types.ts` — the `'host'` worktree-card property and its
  one-shot backfill flag (#24299).

`tui-agent-config.ts` is NOT taken (#24589): its only change edits the `dsh` entry, and this copy
never vendored `dsh` (#22468).

## The v1.4.219..v1.4.220 chat-lane shared halves (Orca v1.4.220)

This fork's chat-lane shared files sit at v1.4.217 plus local hunks; the v1.4.217..v1.4.219 chat
work (the failure-fact family `agent-session-failure*.ts` and `agent-session-refusal-notice.ts`,
queue delivery and `structured-agent-session-draft-hand-off.ts`, `agent-main-agent-verdict.ts`,
`structured-agent-session-latest-request.ts`) was never taken. The v1.4.220 changes are therefore
taken as hunks on the older base, not by re-vendoring, and the ones that build on those missing
modules are not taken at all (see the port rows). The failure-fact family and
`agent-main-agent-verdict.ts` were taken afterwards, in the v1.4.217..v1.4.219 chat chain at the
end of this file; queue delivery and `structured-agent-session-latest-request.ts` are still not.

- `agent-turn-outcome.ts`, `main-agent-status.ts`, `agent-hook-listener/main-agent-turn-state.ts`,
  `plugins/plugin-events.ts`, `notification-settings-types.ts`, `runtime-worktree-contracts.ts` —
  taken whole at v1.4.220 (#23467, #23837). The fork's copies of the first four equalled v1.4.219;
  the last two equalled v1.4.217, so v1.4.220 also brought #22944's (85067494a1) hunks in them:
  `mainAgent` on `RuntimeWorktreeAgentRow` (#23467 does not touch that file), which the phone
  reads, and `agentInterrupted` → `agentTurnOutcome` on `NotificationDispatchRequest`, which
  nothing on the phone reads. #22944's mobile half reads `mainAgent`: the verdict, mark and dot
  in `agent-row-display.ts` and the `failed` dot (with #23467), `agentRowTimeAt` and its use in
  `WorktreeAgentRow.tsx`, and `areMainAgentsEqual` in `worktree-list-snapshot.ts`. Its parity
  test against `agentMainAgentVerdict` came with the chat chain, once `agent-main-agent-verdict.ts`
  was vendored.
- `agent-session-journal-types.ts`, `agent-session-journal-schemas.ts`,
  `agent-session-turn-record.ts` — `outcome` on a turn lifecycle row (open string in the schema,
  both carriers) and `readAgentJournalTurnOutcome`, by hand from v1.4.217. #23467's
  `agentTurnVerdict` reads it: without it a user's Stop (state `interrupted`, outcome
  `cancellation`) would read as a crash.
- `agent-status-types.ts`, `agent-session-wire.ts` — `AgentTurnOutcome` / `isAgentTurnOutcome`
  in place of the journal-only type (#23467), by hand.
- `native-chat-turn-status.ts`, `structured-agent-session-turn-timing.ts` — the verdict hunks of
  #23467 on top of the fork's `thinking` row; upstream's queue-until hunk in the timing file is
  not taken (no queue delivery here).
- `protocol-version.ts` — hand-applied, never re-vendored whole: this copy is what the phone
  advertises and compares, and a whole v1.4.220 file would also list capabilities the phone does not
  implement (accepted send, queued messages, keyboard, rewind, ...). The net v1.4.219..v1.4.220 diff,
  taken a PR at a time: `WORKTREE_BACKGROUND_REMOVAL_RUNTIME_CAPABILITY` (#23837), not advertised by
  the phone, so a host answers its `worktree.rm` on acceptance and leaves a `removing` row out of its
  listings. `worktree/types.ts` and `worktree/create-types.ts` carry the matching `removing?: true`;
  `create-types.ts` does not take the neighbouring `archiveHookOverride` (#19334 is not ported).
  #24203 (757736628f): `STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY` (constant and host
  list entry), not advertised by the phone, which keeps asking `agentSession.createSupport` to pick
  a launch's mode, as a phone released before `agent.launch` does. `ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES`
  moves to `electron-remote-runtime-client-capabilities.ts`; this copy of that file lists only the
  four entries the fork's old list had (v1.4.220 also lists accepted-send and retirement-proof-delta
  constants this protocol-version does not define), marked `CODE UI LOCAL HUNK`. Nothing on the phone
  reads the list.
- `agent-process-presence.ts` — new at 24540300f0 (#23947) and copied from it, except that
  `AGENT_TYPE_MAX_LENGTH` is imported from `agent-status-types.ts`: v1.4.218..v1.4.219 moved the
  constant to `agent-status-field-normalization.ts`, which this fork's copy does not carry. Marked
  `CODE UI LOCAL HUNK`; a re-vendor of the normalization file makes it redundant. Only the type
  `AgentProcessPresence` is reached (from `listener-event.ts` and `agent-hook-relay.ts`); the probe,
  transition and listener halves of #23947 are desktop/host code and are not taken.
  #22614 (0b79720c2e): `AGENT_SESSION_BACKGROUND_TASK_CHILD_VIEWS_CAPABILITY` (new one-constant module,
  taken whole; the import and host list entry here). The phone does not advertise it, so a host keeps
  sending the legacy `tasks` / `settledTasks` roster. The rest of #22614 (the child-work view codec,
  `children` on the background-task state and the status summary, the reducer's admission step) is
  not taken: nothing on the phone would read a `children` field without a roster UI for it, and
  upstream's mobile app is unchanged by that PR.
  #24301 (7176648759): the stop capabilities move to `agent-session-stop-capabilities.ts`
  (taken whole; `AGENT_SESSION_PROMPT_CANCEL_RUNTIME_CAPABILITY` is no longer defined inline,
  `export *` re-exports it with `AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY` and
  `AGENT_SESSION_REPEATED_STOP_RUNTIME_CAPABILITY`, and `RUNTIME_CAPABILITIES` spreads the set).
  The phone did not read the two new constants at first (it joined an in-flight Stop itself,
  whatever the host). Since the v1.4.217..v1.4.219 chat chain it reads
  `AGENT_SESSION_REPEATED_STOP_RUNTIME_CAPABILITY` from the status probe: against a host advertising
  it, each Stop press is its own and /clear, /compact and rewind mint a fresh id per press; against
  any other host the join and the id replay stay. `AGENT_SESSION_CONVERSATION_STOP_RUNTIME_CAPABILITY`
  is still not read.

## The v1.4.217..v1.4.219 chat chain (taken for #23674, #23684 and the #24301 remainder)

The three v1.4.220 chat fixes the port above left blocked need modules the v1.4.217..v1.4.219
range introduced. Only what they need is taken; queue delivery (#23726, #23731, #23736) and the
rest of that range's chat work stay pending (`docs/upstream-port-inventory.md`).

- The failure-fact family, new files taken whole at their v1.4.220 state (`UPSTREAM.txt` names
  each pin): `agent-session-failure.ts`, `-failure-words.ts`, `-failure-copy.ts`,
  `-refusal-details.ts`, `-refusal-notice.ts`, `-write-notice-copy.ts`, `-write-failure.ts`,
  `-wire-refusals.ts`, `-rewind.ts`, `sentence-joining.ts`, with the upstream tests of
  `agent-session-failure`, `-write-failure` and `-wire-refusals`. The v1.4.220 state also carries
  #24333's host wording (the stop-unconfirmed sentences), which nothing on the phone reads. Two
  upstream tests are left out because they import v1.4.219 APIs this fork's older copies lack:
  `agent-session-failure-words.test.ts` (`classifyDispatchRejection`) and
  `agent-session-refusal-notice.test.ts` (`structuredAgentSessionRejectionParts`,
  `DISPATCH_REJECTED_NOT_DELIVERED`).
- `structured-agent-session-dispatch-rejection.ts` is NOT re-vendored: its v1.4.220 copy drops
  `dispatchRejectionWasTransportWriteFailure` and `dispatchRejectionReasonIsInternal`, which this
  fork's v1.4.217-based `structured-agent-session-send-disposition.ts` still calls.
  `agent-session-failure-words.ts` imports only the four `DISPATCH_REJECTED_*` constants, which
  this copy has.
- `agent-session-wire.ts` — the inline refusal block is replaced by upstream's
  `export * from './agent-session-wire-refusals'` (see the entry for this file above).
  `AgentSessionWireRefusal` is upstream's per-code union with optional `details` now.
- `agent-session-journal-schemas.ts` — hand-applied from v1.4.220, each marked in the source:
  `FailureFact` and `failure` on a status row, `isAgentJournalResolution` (#23116), and the
  `AgentJournalTurnScopeSchema` export the vendored `agent-session-rewind.ts` reads (#23059). The
  render item's `turnScope` and the submission's `rejection` beside them are not taken.
- `agent-session-journal-types.ts` — `failure?: UnreadAgentSessionFailureFact` on
  `AgentJournalStatusItem`, one optional member. Upstream splits the type into a plain row and a
  failure row typed by `AgentSessionFailureRowWords`; this client reads rows, it never writes one.
- Codex retry rows (#23684): `structured-agent-session-status-block.ts` (#23116) and
  `native-chat-provider-retry-runs.ts` (#23684) taken whole; `agent-session-journal-producer.ts`
  whole at e8e144bf3c (#23605's `agentJournalItemSubagentId`). Hand-applied, each marked in the
  source: `failure?` on `NativeChatTextBlock` and `AgentJournalProducerLinkage` on
  `NativeChatMessage` (`native-chat-types.ts`); in `structured-agent-session-projection.ts` the
  status row goes through `structuredAgentSessionStatusBlock` and a projected row carries its
  producer linkage (#23605's projection hunk). #23684's hunk in
  `structured-agent-session-message-projection.ts` (`collapseProviderRetryRuns` over the delivered
  rows) is NOT taken: upstream keeps a run's latest row, which drops the id of every earlier
  attempt, and the phone anchors a send on the last row's id (`captureSendBoundary` and the echo
  readers), so a send made on a retry row never landed. The phone collapses each agent's run in
  place instead (`mobile/src/session/mobile-structured-transcript.ts`: the first attempt's id and
  place, the latest attempt's words), pinned to the vendored rule by
  `mobile-structured-transcript.test.ts`. A retry run is per agent, as upstream's: the phone draws
  every agent's rows in one list (#23752's subagent sections are not ported), so another agent's
  row between two attempts does not split the run, and two agents retrying at once each keep one
  row. Not taken from #23605: `native-chat-subagent-attribution.ts`, the tool-fold and turn-fold
  hunks, and how a subagent's words are drawn.
- `agent-main-agent-verdict.ts` and its test, taken whole at 24edf0f64b (#22944, then #23467). The
  phone keeps reading the verdict through its own mirror in `mobile/src/worktree/agent-row-display.ts`,
  as upstream's phone does; #22944's parity test (in `agent-row-display.test.ts`) pins the mirror to
  this module over every row. The tab pill (`tabPillDotState`, `mobile/src/session/session-tab-activity.ts`)
  no longer strips the legacy `interrupted` flag, so it draws the verdict the desktop tab draws.

## Inline chat visuals (Orca #26103's shared half, taken for the phone's #26071, 1617ff32ef)

- `native-chat-visual-directive.ts`, `native-chat-visual-shell.ts`,
  `native-chat-visual-height-governor.ts` and their tests, and
  `rpc-contract/agent-session-visual-params.ts`, taken whole at 1617ff32ef (the #26071 merge;
  #26103 added them). `rpc-contract/structured-agent-session-identifiers.ts` is taken whole at the
  same commit because the params module imports `SessionId` from it; its schemas are the ones
  `structured-agent-session-params.ts` already defines here.
- `rpc-contract/rpc-params-catalog.generated.ts` — the `agentSession.readVisual` row and its
  `ReadVisualParams` import, hand-kept from 1617ff32ef (marked `CODE UI HAND-KEPT`). The phone sends
  it from `mobile/src/session/mobile-native-chat-visual-read.ts`; a 1.4.205 host's mobile gate
  refuses it, which the read latches per client (orca-mobile-rpc-allowlist.test.ts, `fails-open`).

## Subagent groups in the transcript (taken for the phone's Orca #26125, 2460068883)

- `native-chat-subagent-summary.ts` and `native-chat-subagent-group-header.ts` and their tests,
  taken whole at 2460068883 (the #26125 merge).
- `native-chat-types.ts` — #18773's roster block (`NATIVE_CHAT_SUBAGENT_STATES`,
  `NativeChatSubagentState`, `NativeChatSubagentEntry`, `NativeChatSubagentGroupBlock`, its
  member of `NativeChatBlock`, `isSubagentGroupBlock`), hand-applied at its 2460068883 form and
  marked in the source. Upstream's `background-task` block beside it is not taken.
  `agent-session-journal-schemas.ts` is NOT changed: the phone does not validate journal rows
  against it (only the host does), so the roster stays an admissible unknown type there, and the
  phone drops a malformed roster itself (`mobile/src/session/mobile-native-chat-subagent-group-blocks.ts`).

## Provider free-text dialogs (the phone half of Orca #25851, c71601f51c)

- `agent-session-question-answer.ts` taken whole at c71601f51c, and its new test
  `agent-session-question-free-text.test.ts` with it. Taking it whole also brings
  `AGENT_SESSION_RESPONSE_OPTION_ID_MAX_LENGTH` (an earlier upstream export nothing here reads).
- `agent-session-journal-types.ts` — `AgentJournalFreeTextInput` and `freeTextInput?` on a question
  and on a question item, hand-applied and marked in the source. `agent-session-journal-schemas.ts`
  is NOT changed: the phone does not validate journal rows against it (only the host does).
- Not taken: `PI_STRUCTURED_DIALOGS_RUNTIME_CAPABILITY` and its home
  `structured-agent-session-surface-capabilities.ts`. A host sends Pi's dialogs only to a client that
  advertises it, and only Pi chats carry them; Pi reaches a client only through the registered-agents
  reader (`agent-session.structured.registered-agents.v1`), which this phone does not have. So the
  phone does not advertise it, and the input shape stays latent until it does.

## Sign-in guidance for every native chat agent (Orca #26544, ff4a51c872)

- `agent-session-sign-in.ts` taken whole (each agent's login command, Pi's `/login`).
- `agent-session-failure-copy.ts` — `notSignedIn` loses "for the selected account"; new
  `claudeSystemNotSignedIn`, `codexSystemNotSignedIn`, `agentCommandNotSignedIn`,
  `interactiveAgentNotSignedIn`, `agentNotSignedIn`, `thenSendAgain`, and the `loginCommand` /
  `slashCommand` values. Hand-applied and marked. The managed-account sentences are not taken.
- `agent-session-failure-words.ts` — `notSignedIn` now uses upstream's `notSignedInSentence` and
  `agentSessionSignInCopyId`, folded into this file without `fact.account` (this build's fact has
  none), plus `messageSubmitted?` on the words context. Marked in the source. Upstream's
  `agent-session-availability.ts` and `agent-session-availability-sentences.ts` are not vendored:
  both read `fact.account` and `AgentSessionAccountKind`, which arrive with the account-fact PRs
  this fork never took.
- `structured-agent-session-status-block.ts` — reads the row's fact with
  `readWholeAgentSessionFailureFact`, so a newer host's fact (one naming an `account`) is not
  re-worded here and the row keeps the host's sentence.
- `agent-session-journal-types.ts` — `rejection?: UnreadAgentSessionFailureFact` on
  `AgentJournalSubmission` (from upstream's type at ff4a51c872), which the phone reads for the
  sign-in banner. Marked in the source.
- Upstream's `agent-session-visible-failures.ts` is not vendored: its `sameAgentSessionFailureFact`
  compares `account`. The phone's banner compares the remaining fields itself
  (`mobile/src/session/use-mobile-native-chat-send-error.ts`).

## Every agent's structured picker (Orca #26407, 6ba86414bf), partial

- `structured-agent-session-seed-catalog.ts` taken whole: the one fallback rule for every agent's
  structured picker (a built-in list for the handle providers, the live-only empty catalog for the
  rest), which the phone's options hook now reads.
- Not taken: #26407's re-vendor of `structured-agent-session-options.ts` (the `builtin` catalog
  source, the host-catalog application with `newLaunch`, the provider-default placeholder),
  `structured-agent-session-option-view.ts`, the `agentSession.modelCatalog` wire and params changes
  (`savedOnly`, `waitForListing`, `listingNamesConfiguredModel`, `defaultHoldsInEveryWorkspace`) and
  the catalog-types field. All of it serves the host model-catalog read, which this phone has never
  ported (deferred since the v1.4.217 notes in docs/upstream-port-inventory.md).
