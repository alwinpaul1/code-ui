# Upstream port backlog, v1.4.217..v1.4.219 (2026-10-04)

The inventory taken before porting the chat chain the three blocked v1.4.220 fixes needed. Rows marked done landed with that port (see the "v1.4.217..v1.4.219 chat chain" section of `upstream-port-inventory.md`); everything marked pending is still open.

## The chat chain the v1.4.220 fixes need

Written before porting (agent chat219, branch `port/orca-1.4.219-chat-chain` from 923c48eef).
Range: `git rev-list --cherry-pick --right-only --no-merges v1.4.217...v1.4.219` = 285 commits
(the tags diverge). 85 of them reach the phone (a `mobile/` file, or a `src/shared/` file in
`reached-shared.txt`); list and per-commit reach in `chat219/reach219.txt`.

Method: start from the three blocked v1.4.220 fixes, find the modules each one's phone-visible
effect needs, then the upstream commits that made those modules what they are at v1.4.220.
"already-here" was checked by PR number against `git log --all` (subject and body) and `docs/`,
`UPSTREAM.txt`, `src/shared/LOCAL-FILES.md`.

## What each target actually needs on the phone

| target | phone-visible effect | needs |
|---|---|---|
| #23674 afa81dc3ad | its only mobile hunk is 4 lines in `mobile-structured-queued-message-cards.ts`, a file that exists only with queue delivery (#23726 + #23736, ~4,400 mobile lines). The failure-wording defect that does reach this phone: #23674 makes a host throw a refusal as `runtime_error` whose message is the bare code (`agent_session_journal_unreadable`) with the typed refusal in `error.data`. The fork's rpc either shows the message (a damaged history reads as a raw code) or calls the thrown error "unconfirmed" (a refused Stop reads "Stop unconfirmed"). Upstream's phone words both from the refusal through the shared notice table (`agentSessionReadFailureText`, `agentSessionThrownFailure`). | the notice table and failure facts: `agent-session-refusal-notice.ts`, `-write-failure.ts`, `-write-notice-copy.ts`, `-failure.ts`, `-failure-words.ts`, `-failure-copy.ts`, `-refusal-details.ts`, `-wire-refusals.ts` (+ `agent-session-rewind.ts` for its reason list), `sentence-joining.ts`; the mobile rpc's wording paths |
| #23684 b4b708c2c4 | a Codex retry draws one warning row, the latest attempt, not one per attempt | `failure` on a status row and on `NativeChatTextBlock`, `structured-agent-session-status-block.ts`, `readAgentSessionFailureFact`, `native-chat-provider-retry-runs.ts`, `agentJournalItemSubagentId` and producer linkage on a projected message (the run is per agent) |
| #24301 7176648759 remainder | a second /clear, /compact or rewind press is its own action, not a replay of the last one; a Stop press against a 220 host is its own Stop | a host-capability fact the phone can read: `agent-session.repeated-stop.v1` (`AGENT_SESSION_REPEATED_STOP_RUNTIME_CAPABILITY`, already vendored in `agent-session-stop-capabilities.ts`). The host's "answer a repeated /clear from the committed record" is #24301's own host half, so it is a **220** host behaviour, not 219: the only capability that comes with it is repeated-stop. `structured-agent-session-operation-identity.ts` is DELETED by #24301 itself, so it is not needed. Upstream's `mobile-structured-agent-session-host-support.ts` is the shape; the fork's own capability probe (`use-mobile-session-feedback-capabilities.ts` -> controller -> lane -> session hook, as `promptCancelSupported` flows) carries it |
| follow-up (a) | an out-of-order structured result (Bash a, Edit b, b's failed result first) is paired with its own call in the background-task roster and the run sentence | `pairToolBlocks`' rule (a result naming its call answers that call; one naming none is positional), already in the fork's `native-chat-tool-fold.ts` since #22619; `native-chat-tool-pairing.ts` (at v1.4.217 already, changed by #22619 at 220) is the desktop's view of that loop |
| follow-up (b) | the tab pill draws a legacy-`interrupted` row (no `mainAgent`) as interrupted, as the desktop tab does | `agent-main-agent-verdict.ts` (#22944, then #23467 at 220) |

## Upstream commits the chain pulls in (v1.4.217...v1.4.219 unless marked 220)

| commit | PR | what | needed by | already here? | plan |
|---|---|---|---|---|---|
| da57f47353 | #22999 | refused chat write in plain words: the shared notice table (`agent-session-refusal-notice.ts`), the phone rpc words a returned refusal and a failed request from it, never the host's text | #23674 (phone wording) | no | shared modules at their v1.4.220 state (new files, taken whole); mobile rpc hunks hand-ported. Not taken: its outbox, send-delivery (`structuredAgentSessionRejectionNotice(reason, 'composer-send')` needs the 219 `send-disposition`), desktop |
| a68d62911e | #23116 | the host writes failures for a person with a typed fact beside them: `agent-session-failure.ts`, `-failure-words.ts`, `-refusal-details.ts`, `-wire-refusals.ts` (refusal `details`), `-write-notice-copy.ts`, `-write-failure.ts`, `structured-agent-session-status-block.ts`, `failure` on a status row, `isAgentJournalResolution` | #23674, #23684 | no | modules at 220 whole; `failure?` on `AgentJournalStatusItem` / `NativeChatTextBlock`, `FailureFact` + `isAgentJournalResolution` in journal-schemas, and the status-block call in the projection, by hand. `agent-session-wire.ts`: the inline refusal block (kept there because wire-refusals imported the unvendored rewind) is replaced by upstream's `export * from './agent-session-wire-refusals'`. Not taken: its outbox, dispatch-rejection, conversation-command, operation-ledger, refusal-retry hunks (outbox/queue lane) |
| 9d11a75cd3 | #23608 | each failure says why on the thing that failed: failure words, refusal notice, write-failure | #23674 | no | in the 220 state of those modules. Not taken: outbox/reducer/send-disposition hunks |
| e8e144bf3c | #23605 | a subagent's words are presented as that subagent's: `agentJournalItemSubagentId`, `AgentJournalProducerLinkage` on `NativeChatMessage`, the projection stamps linkage | #23684 (per-agent retry run) | no | `agent-session-journal-producer.ts` whole (fork = 217, 219 = 220); the type and projection linkage hunks by hand. Not taken: `native-chat-subagent-attribution.ts`, tool-fold/turn-fold hunks, the mobile and desktop rendering of attribution (pending) |
| d60f999f94 | #23059 | turn facts from the turn record, /compact as a message; adds `AgentJournalTurnScopeSchema`, touches rewind.ts and the failure family | closure only (`agent-session-rewind.ts` at 220 imports the schema) | no | `AgentJournalTurnScopeSchema` export by hand; the rest pending |
| 134a22077d | #23524 | unfinished /clear or refused Codex rewind no longer locks the chat; rewind.ts and refusal-details/notice | closure only | no | in the 220 state of rewind.ts and the two modules; host behaviour not the phone's |
| 59b746ff3c | #23613 | one journal database per host; refusal-details/notice/write-notice-copy reasons | closure only | no | in the 220 state; the rest host/pending |
| c49388cd33 | #23026 | Stop from the moment a message is sent; failure + failure-words hunks | closure only | no | in the 220 state; the conversation-stop feature itself pending |
| 85067494a1 | #22944 | a request that failed reads as failed: `agent-main-agent-verdict.ts` | follow-up (b) | mobile half yes (8e8d8e4c0, c5b2648e1, a23b1c73a); module and parity test no | module whole at 220 (with #23467), its test, and #22944's parity test; `agentRowVerdict` reads it |
| 24edf0f64b (220) | #23467 | verdict module's 220 state | follow-up (b) | mobile half yes (8e8d8e4c0) | rides in with the module |
| afa81dc3ad (220) | #23674 | target | | partly recorded as blocked | `readWholeAgentSessionFailureFact`, `sentence-joining.ts`, `agent-session-failure-copy.ts`, the failure part of a notice; the mobile thrown-refusal wording. Queued-cards hunk pending with the queue |
| b4b708c2c4 (220) | #23684 | target | | blocked | retry runs + projection hunk; the providerRetrying quoting rides in with failure-words |
| 7176648759 (220) | #24301 | target | Stop half yes (1ee753499) | | gate on repeated-stop: Stop no longer joins on such a host; /clear, /compact, rewind mint a fresh id per press on such a host and keep the replay on an older one |
| fd5804dd6a (220) | #24333 | retry the stop after an unconfirmed exit | rides in | no | its failure-family hunks arrive with the 220 state (host words only); nothing on the phone reads them |
| cb363444f3 (220) | #22619 | `native-chat-tool-pairing.ts` via `pairToolBlocks` | follow-up (a) | shared half yes (7b4986087) | the phone's own two FIFO readers take `pairToolBlocks`' rule; the desktop-only pairing module is not needed |

## Pending: reaches the phone, none of the three needs it

Chat lane (each would be its own port; most build on queue delivery, which this fork does not have):

| commit | PR | what | why pending |
|---|---|---|---|
| 29c49aec31 | #23726 | host-owned queue for mid-turn messages | queue delivery: new capability, protocol, wire, reducer, send-disposition |
| 6b36a2c3fb | #23731 | mid-turn messages as editable cards (desktop + shared) | queue delivery |
| 8a38a7a3e6 | #23736 | mid-turn messages as cards above the phone composer (51 mobile files) | queue delivery; #23674's queued-cards hunk lands with it |
| bfe476f922 | #22821 | a message is accepted, then delivered | outbox / dispatch-rejection / send-disposition rework |
| 21124db4d5 | #23752 | a subagent's rows live in its own section | subagent sections UI; the phone draws one flat list |
| f4068747ac | #23758 | restarted provider continues the subagent roster | journal-types / types hunks for the roster |
| 7a24d3d335 | #22835 | the conversation outlives its agent | host lifecycle + mobile hold/empty-state |
| d60f999f94 | #23059 | turn facts from the turn record; /compact is a message | only the schema export is taken (closure) |
| c49388cd33 | #23026 | Stop from the moment a message is sent | conversation-stop capability + mobile |
| 357a2fed08 | #23671 | group chat rows by the turn that produced them | turn-scope projection + mobile |
| 50a8ef18e4 | #23573 | a turn's bar stays on the prompt that opened it | turn timing |
| 56e691344f | #23537 | "Working for" bar while a turn runs | turn status |
| 5e5f4f6603 | #23502 | Codex ask's questions in order | projection/reducer |
| b283a09688 | #23666 | no "still starting" flash | wire |
| 2dc2693953 | #23456 | a turn a proven crash cut short reads interrupted | record |
| 59b746ff3c | #23613 | one journal database per host | host; only refusal reasons ride in |
| 134a22077d | #23524 | unfinished /clear / refused rewind no longer locks | host; only rewind.ts rides in |
| 4da485cac1 | #22090 | terminal-backed chat through the structured turn status | agent-status types |
| bd133058a9 | #22565 | one subagent row for CLI and structured children | child-work family (`agent-status-child-work-*`) |
| 153d3fd3fa | #22553 | Codex subagents in the host status store | child-work family |
| 707d3dc96b | #23788 | decode Claude pastes, report terminal delivery uncertainty | image transcript markers |
| f72079bd21 | #23458 | typed question answers as structured answers | the fork already sends `answers` (see `mobile-structured-question-response.ts`); unverified against upstream's hunks |
| e8e144bf3c | #23605 | subagent attribution rendering | only the producer/type/projection linkage is taken |
| 9d11a75cd3, a68d62911e, da57f47353 | #23608, #23116, #22999 | their outbox, reducer, send-disposition, dispatch-rejection, conversation-command, ledger halves | outbox/queue lane |

Outside the chat lane (also never ported from 217..219; listed so nothing is lost):
#24217, #24048, #23784, #23948, #22720, #23925, #23929, #23744, #23923, #23683, #18750, #23697,
#23740, #23581, #23567, #22468, #23513, #23520, #23602, #22955, #23423, #18759, #23504, #22929
(shared settings/agents/terminal/telemetry hunks reached through types); mobile #22954, #22762,
#23676, #23110, #23080, #23079, #23070, #22951, #22943, #22945, #23755, #23780, #23673;
test/recorder-only #24132, #24114, #24101, #24077, #23986, #23732, #23976, #23965, #23950, #23949,
#23941, #23829, #23816, #23815, #23720, #23757, #23565, #23535, #23533.
Already here from other lanes: #23943, #22939, #23789 (fork-native), #23006 (mobile half).

## Notes that change the brief's premise

- `structured-agent-session-operation-identity.ts` exists at v1.4.219 only: #24301 deletes it. Nothing to port.
- The host behaviour the #24301 fresh id relies on ("a /clear pressed again after it committed is
  answered with that clear") is in #24301 itself, a v1.4.220 commit; no 219 host has it. The gate is
  therefore `agent-session.repeated-stop.v1`, which only a #24301 host advertises.
- `native-chat-tool-pairing.ts` and `native-chat-turn-activity.ts` already exist at v1.4.217; they are
  desktop modules and not in the 217..219 range except through #22619 (220).
- `structured-agent-session-dispatch-rejection.ts` is NOT re-vendored: its 220 state drops
  `dispatchRejectionWasTransportWriteFailure` / `dispatchRejectionReasonIsInternal`, which the fork's
  217-based `send-disposition` still calls. `agent-session-failure-words.ts` needs only its four
  constants, which the fork's copy has.

## Result (after porting)

Eight commits on `port/orca-1.4.219-chat-chain` (from 923c48eef), rows in `rows-chat219.md`:
c33532924 vendor the failure-fact family at v1.4.220; 54f73304f #23674 phone wording (with #22999,
#23116); d16165b70 #23684 retry rows (with #23116, #23605); 7b4e647dd #24301 remainder; e48f0eb74
tool pairing follow-up; 5aa13bc07 verdict module and the tab pill; then, from the Opus review,
8438fcf9d a thrown refusal read as the returned one (and the launch swept) and e3abb94ff the retry
run collapsed in place in a phone seam instead of the shared projection. Two plan changes against the
table above: `structured-agent-session-dispatch-rejection.ts` stayed at v1.4.217 (see the last
note), and upstream's `mobile-structured-agent-session-host-support.ts` was not taken (the fork's
probe sets one boolean per capability, inside the route-parity ratchet).
