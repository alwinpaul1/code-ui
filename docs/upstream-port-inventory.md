# Upstream port inventory

Every Orca commit since the vendor base (`ef428d879e09a02daa3bb9ed977a7802d89da289`)
that can reach the phone, and what was done about it. "Reaches the phone" means it
changes a file under `mobile/`, or a file under `src/shared/` that `mobile/` imports.
143 commits touch shared or mobile code; 69 of them reach the phone. The rest are
desktop and host work whose code this repo does not vendor.

Regenerate the candidate list with the script in `docs/upstream-port-inventory.sh`.

Status values: **done** landed here; **already** Code UI solved it independently
before the port; **skip** with a reason; **in flight** an agent is on it now;
**pending** queued.

## Landed

| Commit | What | Note |
|---|---|---|
| a65332a8b #18560 | Claude structured chat onto the Agent SDK | one line taken: the tab contract's agent union |
| cc07249e7 #18697 | definitive-refusal allowlist | came in with the structured port |
| d07c47593 #18741 | structured native Claude chat | the core port |
| 546fd9b21 #19147 | remember structured model and effort picks | eleven shared files moved with it |
| 09ee4c1b1 #18926 | stop host streams after a cancelled relay subscription | |
| 992360f12 #18940 | cancel direct probes when their owner stops | Code UI had the abort half; the stop fence was missing |
| 61b09b7a0 #18959 | fail a dead direct probe fast | mobile half; the rest is relay-server code |
| e9d9d42cc #18914 | Markdown placeholder prefixes in one scan | |
| 4e8e14424 #18919 | stop splitting every path in file autocomplete | mobile half only |
| ddc5b75ac #18760 | label a Codex tool row by what it did | summary half; the icon half has nothing to attach to here |
| 53852c9ca #18126 | configurable terminal contrast floor | mobile mirror; found and fixed a theme-equality bug on the way |
| e89deb63c #18757, f8780a2c8 #18807, 5868fdc9e #19346, 2bf298d1d #19311 | background tasks over the wire | shared contract hand-applied; the structured lane now reads the host's roster and the transcript reader keeps terminal tabs. `#18757`'s journal-unchanged short-circuit came with it |
| b0c67eaf8 #18761 (remainder) | the chat lane wiring out of the controller | the extraction skipped when the rest of #18761 landed; taken verbatim for the room |
| 2f828e446 #19822 (working half) | a structured send reads as working before the provider echoes it, and Stop waits for a turn | the optimistic-bubble half stays unported; see `scratchpad/19822-assessment.md` |
| 172aa1ac3 #18765 | agent file edits as inline diff cards | upstream shipped it desktop-only; the five shared edit modules are vendored verbatim and the phone got its own card. `native-chat-types.ts` and `structured-agent-session-projection.ts` took hand-applied hunks |
| 6a9c5d8ce #19496, 44eb95fc6 #19468, 063c1caa6 #19469, 2c5cd845a #19465 | the shared-path allocation work | one commit; pure refactors, guarded rather than test-first. `native-chat-tool-fold.ts` took hand-applied hunks (whole-file would drag in unported #18773). Upstream's own tests are vendored but never run here, so the running guards live under `mobile/src/` |
| dda103d2c #19832 | one `/` picker for every agent, anywhere in the prompt | mobile already had the grouped menu and the draft-leading dispatch rule; the mid-prompt trigger was the real gap. `native-chat-agent-profiles.ts` re-vendored to drop `groupedSlash`, which nothing here read |
| d0506bf5d #19226 | execution details and tool row identity | the shared half plus a mobile annotations row. Unblocked the `mcpIdentity` field `native-chat-tool-summary.ts` had been dropping, so that file and its test went back to a clean c1e15c400. The `src/main/` Codex translation that fills `exitCode`/`durationMs` is not vendored — the host supplies those |
| 9f044031f #19228 | a compaction, a plan and a toned line drawn as what they are | landed in 8d80263 as the `presentation`/`tone` hints, which is what LOCAL-FILES.md records; the rest of #19228 is `src/main/` |
| f2d5711b2 #19845 | an older page that no longer touches the transcript is refused, not merged | landed in 8f7bbaf. The mobile half came over whole; the reducer carries local hunks, so its two changes were hand-applied. Covers the structured lane only — a terminal-driven tab is a different path, so it is not yet an answer to the missing-replies report |
| d15a6df22 #19230 | task checklists with update diffs, and a composer progress panel | **the checklist, not the composer panel.** Both agents' plans do reach the phone — Claude Code's `TodoWrite`, Codex's `update_plan` — and the phone was drawing them as the raw JSON of the tool input: one truncated line collapsed, pretty-printed open. `native-chat-task-list.ts` vendored (mobile imports it) and `native-chat-tool-icon.ts` re-vendored for the one `update_plan` row word. The mobile surface is `MobileNativeChatTaskList.tsx` plus its styles and a row builder, in both themes. The composer progress panel is NOT ported: see the skip table |
| e80fae0c4 #19229 | summarize turn file changes and preserve resolved prompt receipts | **the shared half only, and it changes nothing the phone draws.** Both visible halves — the turn diff rollup and the resolution receipt — are `src/renderer/` components this fork does not vendor, and `summarizeUnifiedPatch` exists only to feed the rollup. What the phone does get is the per-item render cache in `structured-agent-session-projection.ts`: mobile re-projects the WHOLE transcript on every stream frame, and unchanged rows now come back as the same objects. `native-chat-edit-normalize.ts` and `native-chat-unified-patch.ts` re-vendored at e80fae0c4, `native-chat-edit-patch-files.ts` vendored new (`native-chat-edit-normalize.ts` imports it, so mobile typechecks it). The extraction is behaviour-preserving and was proved so: upstream's own 50 pre-extraction `native-chat-edit-normalize.test.ts` cases, vendored here at 172aa1ac3, all pass against the extracted code |

**This table is behind `main` for work outside the chat-rendering and
shared-path batches.** It was last rewritten at 588b199, and several ports have
landed since without adding a row — the pins in `UPSTREAM.txt` for
`native-chat-tool-activity.ts` (c1e15c400), `native-chat-turn-status.ts`
(b0c67eaf8), `structured-agent-session-*` (1ae7aa8bb, f1d854502) and the
per-session `/` catalog (bf4e27050) all name commits no row here mentions.
Whoever owns those batches should fill them in; they are not guessed at here.

## Already solved here

| Commit | What | Evidence |
|---|---|---|
| c300913f9 #17731 | double-scaled commit timestamps | Code UI accepts both units, for older hosts too |
| 1dae024ab #19380 | xmldom security patch | the fixed versions are already pinned through workspace overrides |
| 5a1acfec1 #18712 | clickable document paths and links in chat | `mobile/src/components/markdown-file-path-detection.ts` (241 lines, 312 lines of test) already turns bare paths in prose and path-shaped code spans into tappable text, and `markdown-href-routing.ts` already routes a markdown link through `routeNativeChatHref` — file targets to the viewer, web and mailto to the system handler. Upstream's shared delta is only `createNativeChatFileHref` and its decode loop, an encoding internal to desktop's remark pipeline. Mobile has its own parser and no remark, so porting it would add an unreachable export to a vendored file |

## Skipped, with the reason

| Commit(s) | Why |
|---|---|
| 3160b54c6 #18554, reverted by d53cbed43 #19203 | upstream pulled its own push-notification feature |
| 23df74d85, e628090ad, c37413271, ceafdcad2, 83b1558ec, 0ba7f8dc8, 643571def | the relay speed pass, reverted upstream by d74f8cb78 and d936d8da8 pending a smaller re-land. Code UI already has the dial-stage timing and the network-type gate |
| b51bbf3fc #12772, 4b4acf26a #19769 | iOS only; this app is Android |
| 821c8b7df, da48ad2b4, 2265fce59, 36d209f51 | version bumps and repo chores |
| 06a607a1d, 8f78c2824, 12f53da54, 852495d35, 1c1cb7115 | Orca's orchestration-worker feature, which this app does not implement |
| 51eed5a1b, 14e0d40e0, da836faee | host-side agent and terminal bookkeeping with no mobile surface |
| 2513e2139 #18776, c7bcfa750 #19137 | the host-published status feed for the DESKTOP sidebar. Its wire type (`AgentSessionStatusSummary`) and its capability are already vendored, because `agent-session-wire.ts` is pinned at f1d854502 and `protocol-version.ts` at d07c47593 — both later than these commits. What is left is `projectStructuredAgentSessionStatusSummary`, which nothing on the phone reads: mobile learns a structured tab's status from `sessionTabs` and from its own subscribe |
| fa5ef9988 #19122 | host-side restart settlement (`adjudicateAgentSessionRestart`). The symptom — a turn stranded working after a desktop restart — is mobile-visible, but the phone reads the journal and the host writes the settlement. `agent-session-lease-adjudication.ts` has no mobile importer |
| 39cbc68f1 #19040 | desktop launch routing. Its shared half (`resolveStructuredLaunchSeedOptions`, and the `agent-session-record.ts` line) is already vendored at 546fd9b21 / f1d854502; the phone builds its own create params and has no persisted launch seed |
| cb7f7dd11 #18756 | host-side fallback that retitles a structured tab for a client which does NOT advertise `agent-session.structured.v1`. Code UI advertises it, so it never sees the row. Its `protocol-version.ts` half is already vendored at d07c47593 |
| 6494f2a4f #18933 | resume from the desktop's Agent Session History panel, which this app does not have. The `reveal` capability and `isAgentSessionWireRefusalCode` are already vendored at d07c47593 / f1d854502 |
| ce4a3a418 #19235 | the rewind backend, by its own commit title. Entirely host and renderer; vendoring `agent-session-rewind.ts` with no phone surface would be half-building it |
| 20eea184c #19130 | the link-action popover. Entirely desktop renderer: the popover component, `http-link-destinations.ts` and the chat link owner all live under `src/renderer/`, and the one `src/shared/` line is a doc-comment on `terminalLinkActionPopoverEnabled` — a setting `mobile/` never imports. The phone has no link-routing preference and no popover; giving it one is a Code UI product decision, not a port |
| 0252fe5c3 #18773 | Codex subagent activity. Upstream designed this so a client without a roster renderer needs nothing: the host freezes a plain-text twin (`Ran 3 subagents (1 failed)`) into the journal beside the block, and `native-chat-subagent-summary.ts` says in its own header that mobile shows exactly that sentence. So the phone already reads a new host correctly. The producer is ~1,400 lines of `src/main/codex/` this fork does not vendor, and `worker-transcript-text.ts` belongs to the orchestration-worker feature already skipped above. **Residual:** without #18773's `native-chat-tool-fold.ts` hunk, a roster row landing mid-turn ends the tool run it sits inside, so one run draws as two. Cosmetic, and the fix is that hunk plus the `subagent-group` block type |
| d15a6df22 #19230 (composer half) | the desktop composer keeps a collapsible **Tasks 2/5** panel above its input. The phone's composer already carries attachment chips, suggestions, the key strip and the send row on a screen a fraction of the width, and the panel would need the newest plan threaded from the session hook down to the composer — new plumbing, not a port. The inline checklist is where the phone was actually showing raw JSON, and that is what landed. Giving the composer a progress panel is a Code UI product decision |
| d15a6df22 #19230 (`update_plan` icon, in effect) | the one-line `native-chat-tool-icon.ts` map entry is vendored so the pin moves, but it draws nothing here. Mobile imports only `isShellActivityToolCall` from that file and picks between a terminal and a wrench; it never calls `nativeChatToolCategory` or `nativeChatToolRunIconName`, and the new entry does not change `isShellActivityToolCall`. The checklist's own `list-checks` glyph comes from the mobile component, not from the category map |
| ef6ad2243 #19364, 0b60b0dcb #19841 | the two shared-path perf commits that are not in the batch above. #19364 is renderer work plus one line in `structured-agent-session-message-projection.ts`; #19841 is `structured-agent-session-reducer.ts` alone. Both files belong to the structured-session batch |

## Pending

**Blocked on one pass, not deferred** — f7d521601 #19055, provider activity in
chat turn tails. Every shared file it needs belongs to the structured-session
batch: the wire shape, the reducer that carries it, the coalescer that merges
it across a batch. Its producer is host code this repo does not vendor. Port it
with that batch in one pass, or two agents edit the reducer twice.

**Assess before porting** — f4c282116 #18652 moves the session journal onto
SQLite. That is host storage; confirm nothing on the phone depends on the old
shape before touching it. The #19822 verdict lives in
`scratchpad/19822-assessment.md`; its working-state half is already ported.

## Known gaps left behind

- The background-task roster has **not been watched arriving from a live host**.
  The contract and the projection are tested; no real desktop has published one
  to this phone. The fallback is the safe direction: a host that publishes
  nothing leaves the tab on the transcript reader.
- The wire's per-task `totalTokens` is read by the equality check and then
  dropped, because the sheet has nowhere to show it.
- `structured-agent-session-reducer.ts` still lacks upstream's `activity`
  (#19055) and its `retainedItemLimit` head trim. Both belong to batches above.
- The Windows status line and Stop hook run for real under PowerShell 7 in
  tests, and have never run on Windows.
- A tool run's **header** still prints the first 28 characters of a plan call's
  JSON — `1× TodoWrite {"todos":[{"content":"Read t`. That comes from the
  vendored `toolRunSummaryMembers` / `briefToolArg`, which desktop reads the
  same way, and fixing it on the phone alone would mean re-walking the blocks
  mobile-side to realign members with pairs — vendored logic duplicated, which
  is exactly what rots. The tool LINE under it, which is what #19230 owns, now
  says `1/3 · Writing the test`.
- The checklist's update diff only reaches back to the start of its own tool
  run. That is where a turn's repeated plan calls land once `foldToolMessages`
  has run, so it covers the case; a plan revised across two turns shows its
  full list again rather than what changed. Upstream reaches further with a
  renderer-side walk of the whole message list.
