# Upstream change for Orca: model, effort and context on agent status

Prepared 2026-09-09 against stablyai/orca `main` (public). Branch
`agent-status-usage`, one commit, **not pushed and no pull request opened**;
the clone lives outside this repo. Code UI 0.2.81 already reads the fields.

## Why

Code UI shows an agent's model, effort and context on the phone. Orca already
holds every one of those figures and drops them:

- Claude Code's hook payload carries `effort` on every event; the listener
  ignores it. Codex's carries `model` and `effort`/`reasoning_effort`.
- On every hook event Orca opens the agent's transcript to pull the last
  assistant text (`transcript-reader.ts`) and discards `message.model`,
  `message.usage` and `compact_boundary` from the same records.

Nothing on a stock host lets a paired phone read those files itself, and any
status line or terminal the phone adds shows up in the user's own terminals.
Forwarding the figures Orca already reads is the one route that works for a
fresh install on every platform with nothing to set up.

## What the branch does

Adds to `AgentStatusEntry` (and its normalizer, client projection, dirty
check and renderer carry-forward): `effort`, `contextUsedTokens`,
`contextWindowTokens`, `contextUpdatedAt`; Claude also gains `model`, which
its status payload never had.

- Claude: newest non-sidechain `assistant` record → `message.model`, top-level
  `effort`, `input + cache_read + cache_creation` tokens; a newer
  `system`/`compact_boundary` record's `compactMetadata.postTokens` wins.
  Window size only when the model id carries `[1m]` (1,000,000); in the 43k
  transcript records on this machine it never does, so in practice Claude
  reports tokens used and no window: clients must not show a percentage.
- Codex: rollout `event_msg` `token_count` → `info.last_token_usage.total_tokens`
  and `info.model_context_window`; `turn_context` → `model`, `effort`.
- The scan runs only on turn boundaries and is cached per pane; `SessionStart`
  clears it. Subagent hooks (`agent_id` present) never set the lead's figures.
- The mobile projection rest-spreads the entry, so no whitelist change was
  needed; the dirty check and equality did need the fields or a turn moving
  only them would not republish.

Field names were confirmed against real files, not the brief: the compact
marker is a `system` record with `subtype: "compact_boundary"` and
`compactMetadata.{preTokens,postTokens}`.

## Verified

`vitest` over src/shared, renderer runtime/store, main agent-hooks/runtime:
2028 files, 20702 tests passed. `tsc` (node and web configs), `oxlint`, the
repo's code-quality audits and max-lines ratchet: clean.

## Not verified

- A live hook payload carrying `effort` (taken from the Claude Code 2.1.266
  binary's field list); the code falls back to the transcript's `effort`.
- An end-to-end run with a paired phone against the patched Orca.
- Whether Codex's `last_token_usage.total_tokens` equals context occupancy in
  every case; it does in the rollouts sampled.

## Next step

Push the branch to a fork and open the pull request, if the owner agrees.
