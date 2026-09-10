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

## Already solved here

| Commit | What | Evidence |
|---|---|---|
| c300913f9 #17731 | double-scaled commit timestamps | Code UI accepts both units, for older hosts too |
| 1dae024ab #19380 | xmldom security patch | the fixed versions are already pinned through workspace overrides |

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

## Pending

Grouped so each batch can be one agent without fighting another over the same files.

**Chat content rendering** — 5a1acfec1 #18712, 172aa1ac3 #18765, 20eea184c #19130,
9f044031f #19228, d0506bf5d #19226, f7d521601 #19055, 0252fe5c3 #18773, dda103d2c #19832.

**Shared-path performance** — ef6ad2243 #19364, 6a9c5d8ce #19496, 44eb95fc6 #19468,
063c1caa6 #19469, 2c5cd845a #19465, 0b60b0dcb #19841.

**Assess before porting** — f4c282116 #18652 moves the journal onto SQLite, which is host
storage; confirm nothing mobile depends on the old shape before touching it.

## Known gaps left behind

- The background-task roster has **not been watched arriving from a live host**. The
  contract and the projection are tested; no real desktop has published one to this phone.
  The fallback is the safe direction — a host that publishes nothing leaves the tab on the
  transcript reader.
- The wire's per-task `totalTokens` is read by the equality check and then dropped; the
  phone sheet has nowhere to render it.
- `structured-agent-session-reducer.ts` still lacks upstream's `activity` (f7d521601 #19055)
  and its `retainedItemLimit` head trim. Both belong to other batches.
