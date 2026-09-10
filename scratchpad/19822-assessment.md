# Orca #19822 (`2f828e446`) — should Code UI port it?

*"show Claude working from the send, not the provider echo", 2026-09-09.
Assessed 2026-09-10 against Code UI at `c8eadce` plus this batch's four ports.
No code was changed for it.*

## Verdict in one line

**Port the working-state half. Do not port the optimistic-bubble half.** Code
UI does **not** already achieve the user-visible result: a structured Claude
chat here reads idle for the whole 3.4s-median (18s p90) wait between the send
and the SDK echo, exactly the bug #19822 fixes. But the half of #19822 that
draws the pending send as a bubble is already solved here by a different,
larger system, and taking upstream's would give the user two bubbles.

## What upstream changed

Two independent things travel in one commit.

1. **A journalled submission counts as work.** A new shared predicate,
   `hasUnansweredStructuredAgentSessionDispatch(submissions, currentFence)`,
   says a session is working when the host has journalled a send the provider
   has neither opened a turn for nor refused. `projectStructuredAgentSessionStatus`
   and `projectStructuredAgentSessionStatusSummary` both consult it, and the
   mobile hook's `isWorking` ORs it in. `pending` counts; so does a live
   `unknown`, because the ack budget elapsing answers *delivery*, not whether
   work is owed. A *recovered* `unknown` does not — it outlived the host
   generation that sent it.
2. **Stop is decoupled from working.** `nativeChatCanStop` is added to the
   controller contract: on the structured lane a turn can only be cancelled
   once the provider has opened one, so Stop stays hidden for the window where
   the row says "working" but there is nothing to interrupt. Straight
   consequence of (1) — without it, a Stop button appears that cannot work.

Everything else in the 29-file diff is host-side (`src/main/agent-session-journal`,
`src/main/agent-session-wire`) or renderer, neither vendored here.

## Where Code UI stands today

- `mobile/src/session/use-mobile-structured-agent-session.ts:260`
  `isWorking: activeStructuredAgentSessionTurnId(state.items) !== null` — the
  exact pre-#19822 line. The gap is present.
- `state.submissions` and `state.fence` are **already** in that hook's state
  and already passed to `projectStructuredAgentSessionMessages`. The inputs the
  predicate needs are in hand.
- `src/shared/structured-agent-session-projection.ts` sits at the vendor base,
  so `hasUnansweredStructuredAgentSessionDispatch` does not exist here.
- **This batch made the gap more visible, not less.** #18761 gives every turn a
  status row gated on `agentWorking`. On Claude the row now appears seconds
  after the send rather than at it, so the silence has a shape.

## Where the collision actually is — and where it isn't

The parent's warning is right about *a* collision, but it is narrower than
"head-on".

Code UI carries its own optimistic-echo system —
`mobile-native-chat-pending-echo.ts`, `mobile-native-chat-pending-baseline.ts`,
`mobile-native-chat-pending-retirement.ts` — reached through
`useMobileNativeChatDrafts`, which runs on **both** lanes. It reconciles a sent
bubble against the transcript by normalized text and occurrence, because the
bridge lane's transport writes keystrokes into a TUI and carries no message id.

Upstream's structured lane instead draws pending sends from the journal:
`projectStructuredAgentSessionMessages(items, outbox, submissions)` emits a
`user` row per unreconciled outbox entry. **Code UI calls that function with an
empty outbox** (`use-mobile-structured-agent-session.ts:237`), deliberately
leaving the bubbles to the phone's own system. That is the divergence.

But **#19822 does not touch the outbox or the bubbles.** Its shared change is a
`boolean` about whether work is owed; it reads `submissions`, which Code UI
already has, and writes nothing into the message list. The two systems answer
different questions — "is a bubble on screen for this send" versus "is the
agent working" — and #19822 only touches the second.

The real overlap is subtler and worth stating plainly: with the phone's
pending-echo bubble already on screen from the moment of the send, the user is
not staring at *nothing* during the wait. They are staring at their own message
with no sign the agent received it. That is a smaller bug than upstream's, and
it is why this is worth doing but not urgent.

## Cost of porting the working half

Small, and mostly in files another worktree is editing.

| File | Change | On the avoid list |
| --- | --- | --- |
| `src/shared/structured-agent-session-projection.ts` | +30 (the predicate, and the two projections consulting it) | **yes** |
| `src/shared/agent-session-journal-types.ts` | +4 (`recovered?: true` on the submission) | **yes** |
| `src/shared/agent-session-journal-schemas.ts` | +1 (admit it) | **yes** |
| `mobile/src/session/use-mobile-structured-agent-session.ts` | +5 (OR it into `isWorking`) | no |
| `mobile/src/session/use-mobile-native-chat-controller.ts` | +3 (`nativeChatCanStop`) | **yes**, and it is at its `max-lines` ceiling |
| `mobile/src/session/mobile-native-chat-controller-contract.ts` | +1 | no |
| `mobile/src/session/MobileNativeChatOverlay.tsx` | +1 | no |
| `mobile/src/session/MobileNativeChatChromeRow.tsx` | Stop gated on `canStop`, not `agentWorking` | no |

Three complications, none fatal:

1. **`recovered` on a submission has to be forward-ported by hand**, the same
   way this batch handled #19228's `presentation`/`tone`.
   `agent-session-journal-types.ts` cannot be re-vendored at `2f828e446`,
   because the range between its pin and that commit makes
   `AgentJournalToolCallItem` extend `NativeChatToolMetadata` from
   `native-chat-tool-identity.ts` — a module this fork does not vendor
   (#19226). Same story for the projection: its base-to-`2f828e446` delta is
   far larger than #19822's own hunks.
2. **The host has to be writing submissions Code UI can read.** The predicate
   is only as good as `state.submissions`, which comes off the wire from the
   desktop. Worth confirming against a live host before trusting the fix,
   because a fork that never sees a `pending` submission gets a no-op that
   looks like a port.
3. **The controller is one line under its bespoke `max-lines` ceiling** (452,
   raised from 451 by this batch for exactly one field). `nativeChatCanStop`
   pushes it over again. Either raise it a second time — which is a ladder, and
   the second rung is the one that should stop you — or port
   `use-mobile-native-chat-session-lane.ts` from #18761, which this batch
   skipped and which removes ~20 lines from that file. The extraction is the
   right answer if anything else ever needs to go in there.

## Recommendation

Port items (1) and (2) as **one commit of their own**, once the other
worktree's edits to the controller and the structured-session files have
landed. Leave the outbox alone: keep `projectStructuredAgentSessionMessages`
called with an empty outbox, and keep the phone's pending-echo system as the
sole source of optimistic bubbles on both lanes.

The regression test writes itself from the symptom, and should be a mobile test
so it actually runs (`src/shared/*.test.ts` is not collected — vitest is rooted
at `mobile/`): *a structured Claude send shows the turn working before the
provider echoes it, and offers no Stop until there is a turn to stop.*
