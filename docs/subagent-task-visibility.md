# Subagent task visibility (2026-10-10)

The Claude Android app shows each background agent's latest step ("Running
cd /private/...") and the shells its subagents start ("Shell 1m 20s"). On a
terminal-driven Code UI tab the Background tasks sheet showed neither: agent
rows carry the spawn description, and a shell started inside a subagent was
not listed at all. This note records what stock Orca and Claude Code actually
hand the phone, measured against real data, and what was built from it.

Verified against **Claude Code 2.1.296** (`claude --version`), Orca upstream
`stablyai/orca` at `5c7c4930` (2026-10-10), Orca 1.4.223 on this Mac.

## How it was measured

A throwaway Claude Code session in a scratch directory, in its own tmux server
(`tmux -L cuiprobe`, 110×50), started with a clean environment (`env -i`, so no
`ORCA_*` variables and Orca's hooks had nowhere to post) and a `--settings` file
from the scratch directory that dumped every `PreToolUse`, `PostToolUse`,
`SubagentStart`, `SubagentStop` and `Stop` payload, and every status-line
payload, to files. Nothing was written to the user's configuration; the tmux
server was killed afterwards.

Three scenarios:

1. The lead launches two background agents ("Sleep probe A", "Sleep probe B");
   each runs `sleep 150` with `run_in_background` and then a foreground
   `sleep 20`. The lead starts no shell.
2. The lead runs `sleep 100` in the background and launches agent "Probe C",
   which runs `sleep 101` in the background.
3. After the lead's shell reported, the lead launches agent "Probe D", which
   runs `sleep 120` in the background and then a 45 s foreground `ping`.

The two screens the tests replay are committed byte for byte:
`mobile/src/session/fixtures/claude-screen-two-subagent-shells-2.1.296.txt`
(scenario 1) and `claude-screen-subagent-shell-after-lead-shell-2.1.296.txt`
(scenario 3), with the lead's transcript records in
`fixtures/claude-subagent-shells-2.1.296.ts`.

## 1. Claude Code's own screen

**The footer counts every shell in the process, a subagent's included.**
Scenario 1, while both agents ran, the lead with no shell of its own
(`repr()` of the captured rows; `\xa0` is the composer's no-break space):

```
'❯\xa0'
'──────…──────'
'  probe-status'
'  ⏵⏵ auto mode on · 2 shells · ← for agents'
'  ⏺ main'
'  ◯ general-purpose  Sleep probe A                                                      24s · ↓ 47.2k tokens'
'  ◯ general-purpose  Sleep probe B                                                      24s · ↓ 46.9k tokens'
```

(`probe-status` is the probe's own status line.) Scenario 2 painted the same
`· 2 shells` for one lead shell plus one subagent shell. Scenario 3, with only
D's shell running: `'  ⏵⏵ auto mode on · 1 shell · ← for agents'`, singular,
and for its first seconds `'  ⏵⏵ auto mode on · 1 shell · /tasks to see subagents · ← for agents'`.

The existing reader (`claude-footer-shell-count.ts`, `/[·•]\s*(\d+)\s+shells?\b/`)
reads all three forms; the new test reads it off the committed screens.

Other wording seen, none of it new information:

- The turn summary keeps a live count and is repainted as shells end:
  `'✻ Cogitated for 32s · done 6:24 PM · 2 shells still running'`, later
  `'✻ Brewed for 12s · done 6:27 PM · 1 shell still running'`.
- `'✻ Waiting for 2 background agents to finish'` while agents run. Claude
  counts an agent whose own shell still runs as a background agent: after
  Probe C handed back, the line still read 2 agents while C's `sleep 101` ran,
  and `'⏺ Agent "Probe C" finished · 1m 45s'` came a second time when the shell
  ended.
- The launch: `'⏺ 2 background agents launched (↓ to manage)'` with
  `'   ├ Sleep probe A'` / `'   └ Sleep probe B'`.

**The agent panel under the footer shows no step.** Each row is
`◯ <agentType>  <description>  <elapsed> · ↓ <tokens> tokens`. Probe D's row
read `'  ◯ general-purpose  Probe D   37s · ↓ 47.2k tokens'` while it was inside
its 45 s foreground ping: no tool name, no command. The screen never names a
subagent's shell or what it runs; it gives a count.

## 2. Orca's hook-fed `agentStatus`

Claude Code does tell hooks everything. A subagent's `PreToolUse` carries its
`agent_id`, `agent_type` and the full `tool_input`:

```json
{"agent_id":"a77334b4f00353b46","agent_type":"general-purpose","hook_event_name":"PreToolUse",
 "tool_name":"Bash","tool_input":{"command":"sleep 150","description":"Sleep 150 seconds in background","run_in_background":true}}
```

and the lead's `Stop` (and every `SubagentStop`) lists the subagents' shells in
`background_tasks`, with their commands, but without saying whose they are:

```json
"background_tasks":[{"id":"bnfnms6tt","type":"shell","status":"running","description":"Sleep 150 seconds in background","command":"sleep 150"},
                    {"id":"b3yu9dyve","type":"shell","status":"running","description":"Sleep 150 seconds in background","command":"sleep 150"}]
```

**Orca drops both on purpose.** In upstream
`src/shared/agent-hook-listener/providers/claude-events.ts`, an event with
`agent_id` only marks that subagent's roster row live
(`upsertWorkingClaudeSubagent`, agent type only) and returns the LEAD's cached
status: "child tool activity keeps its row live but must not become the lead's
state or overwrite its tool/prompt caches". So `agentStatus.toolName` /
`toolInput` are always the lead's. The roster row
(`AgentSubagentSnapshot`, vendored in `src/shared/agent-status-types.ts`) is
`{ id, agentType?, model?, description?, state, startedAt }`: no tool, no step,
no command. `background_tasks` is read only for its agent-typed entries
(`claude-background-task-inventory.ts`, "Read the agent-typed entries"); its
shells reach the phone only as the pane staying `working`.

So nothing on the session-tab snapshot carries a subagent's latest step or any
subagent shell, and no stock-Orca field can be made to.

## 3. The beacon and the status-line payload

The status-line JSON in 2.1.296 has these keys and no others: `context_window`,
`cost`, `cwd`, `effort`, `exceeds_200k_tokens`, `fast_mode`, `model`,
`output_style`, `prompt_cache`, `prompt_id`, `rate_limits`, `scratchpad_dir`,
`session_id`, `session_name`, `thinking`, `transcript_path`, `version`,
`workspace`. **No background task count**, no task list.

The phone's own Stop hook (`CLAUDE_HUD_STOP_HOOK_SCRIPT`) already beacons every
running `background_tasks` id except teammates, so its `run=` does name the
subagents' shell ids (`bnfnms6tt`, `b3yu9dyve` above). The reader lists a
`run=` id only when a launch record shows it, and a subagent's launch is in the
subagent's transcript, so those ids are, correctly, not listed. They are only
ids, and only as fresh as the last Stop.

## What was built

The footer count holds up, so the sheet now says how many shells run inside
subagents, as a count and nothing more:

- `shellsOutsideLead` (`mobile-background-task-footer.ts`): after the named
  list is fitted to the footer, the footer's count less the lead's shells.
  While no subagent runs the fit already pads the lead up to the footer, so the
  figure is zero; it is zero too when the footer is off screen (a held count is
  not used) and while a monitor runs (the pill's wording is then unknown).
- `deriveBackgroundTasks` returns it as `shellsInSubagents`, only when above
  zero. The structured lane never sets it.
- The sheet's Running section draws one muted caption under the rows:
  "+2 shells in subagents" (`subagentShellsLabel`). It takes the place of
  "Nothing running." when it is the only thing running. The pill's
  "N running tasks" count is unchanged.

Tests, fed the captured screens and the lead's real transcript records:
`mobile-background-tasks-subagent-shells.test.ts` (both scenarios, footer off
screen, no subagent running, a zero count, an empty window, and real Codex
0.158 screens, which paint no shell count) and
`MobileBackgroundTasksSheet.subagent-shells.test.tsx` (the line, its absence,
and its muted colour in light and dark).

Known limit: while a subagent runs and the phone has no lead-only reading, a
lead shell the phone cannot name (launched above the beacon's tail on a huge
session) is counted in this figure rather than as a lead row. The footer
cannot tell the two apart.

## What is impossible without changing Orca (or reading subagent transcripts)

- **An agent row's latest step ("Running cd …").** Claude sends it to hooks;
  Orca deliberately keeps it off the lead's status and off the roster row. The
  screen does not paint it. The status line does not carry it.
- **A subagent's shells by name and elapsed time ("Shell 1m 20s").** The phone
  sees how many, from the footer; which ones, what they run and since when are
  only in the subagent's transcript and in hook payloads Orca does not forward.

Two routes that would work, neither taken here:

1. **Orca forwarding it**: a `toolName`/`toolInput` on `AgentSubagentSnapshot`,
   filled from the child `PreToolUse` it already handles. An upstream change.
2. **Reading the subagent's transcript through stock Orca.** The phone already
   can: `nativeChat.readSession` / `subscribe` with the subagent's
   `transcriptPath` (`<session>/subagents/agent-<id>.jsonl`, session id
   `agent-<id>`) is how the sheet's "View transcript" viewer works
   (`mobile-subagent-transcript.ts`), with no file written and no terminal.
   Subscribing to each running agent's file would give its last tool call and
   its background shells. Left out because this task ruled subagent transcripts
   out as a source, and "View transcript" is being removed from the sheet in
   parallel; it is the one route to the Claude app's rows with no Orca change.

A third, partial one: the phone's own Stop hook could beacon each running
shell's `description` alongside its id (`background_tasks` carries it), and a
SubagentStop hook on the phone's launch flag would refresh it when an agent
ends. That names subagent shells only at turn and agent boundaries, not live,
and still not which agent owns which shell.
