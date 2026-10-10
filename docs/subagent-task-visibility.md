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

## Reading the subagents' own transcripts (built 2026-10-10, later)

Route 2 above, taken. While the Background tasks sheet is open on a
terminal-driven Claude tab, the phone subscribes to each RUNNING agent's own
transcript (`nativeChat.subscribe`, session `agent-<id>`, path
`<session>/subagents/agent-<id>.jsonl`), at most six at once, through the same
data layer the removed "View transcript" viewer used. Nothing is written on the
host and no terminal is opened. A read starts when the sheet opens or an agent
starts, and stops when the sheet closes, unmounts, or the agent leaves the
roster. A finished agent is never read. The reads are not kept in the chats'
warm-start cache (twelve entries), so they never push a chat out of it.

Pieces: `mobile-subagent-activity.ts` (pure: targets, the step label, the
merge), `subagent-activity-store.ts` (the sheet's request and the reads'
results), `MobileSubagentActivityFeeds.tsx` (mounted by the session content,
one `useMobileNativeChatSession` per target), `use-subagent-activity-watch.ts`
(the sheet's side). Not used on a structured tab, which has the provider's own
roster, nor on a Codex tab.

What the rows show, verified against a second throwaway run (**Claude Code
2.1.296**, `tmux -L cuisub`, session 59454ec6; agents "Sleep probe A" and
"Sleep probe B", records in `fixtures/claude-subagent-transcript-probe-*-2.1.296.json`):

- **An agent's title is its latest tool call.** For a shell call, "Running"
  and the command's first line ("Running cd /private/tmp && ls | head -3");
  for any other tool, the chat's running-call words ("Running ToolSearch
  select:TaskStop"), without a JSON preview ("Running TaskStop"). The spawn
  description stays as the screen reader's label and on the Stop. Before the
  agent's first call, or when the read is refused or fails (an older host),
  the row keeps the description and nothing says an error.
- **A subagent's background shells are rows** ("Start a 120-second background
  sleep", "Shell  1m 20s"), timed from the launching record. They carry no
  Stop: a terminal tab has no stop path at all (the Stop is offered only where
  the structured host says `supportsTaskStop`), so a button would be dead.
- **The "+N shells in subagents" line** takes the listed running ones out, and
  is dropped when every shell the footer counts outside the lead is listed.
  The pill's "N running tasks" count is unchanged.

**The finding that shapes the shell rows.** A subagent's shell completion is
delivered to the SUBAGENT (Claude resumes it with the notification), and
2.1.296 writes that `<task-notification>` as a `user` record with
`isMeta: true` in the subagent's file. Orca's reader keeps only the tool results
of an isMeta user record (confirmed in the installed Orca 1.4.224 bundle:
`` isMeta===!0||…isSynthetic===!0||…isCompactSummary===!0)?…:d.filter(e=>e.type===`tool-result`) ``),
so the completion never reaches the phone. B's `sleep 30` ended at 18:45:46,
after its hand-back; A's `sleep 120` ended at 18:47:16, a minute and a half
after A handed back, and resumed A (the lead's second "Agent finished" line).
So a subagent shell is moved to Finished only by evidence that does arrive:

1. a `TaskStop` the subagent made, once its answer says it went through
   (B's `bnj50z9e4`);
2. the lead's Stop-hook `run=` list (every task in the process), once it
   postdates the launch and no longer names the shell;
3. the footer counting fewer shells outside the lead than are listed: the
   oldest go first, as `finished` (over, outcome unseen), never one launched in
   the last 10 s, the same rule the lead's own fit uses. While a dialog covers
   the footer, its last reading still caps the shells launched before it, so
   a retired shell does not come back as running under the dialog.

A read that answered and then fails or re-reads (a reconnect) keeps what it
last said, so the rows do not blink back to the description. Only the session
screen in focus reads, so a session screen left mounted under a pushed one
does not read the same agents again on its own host's connection.

**Limits.** A subagent shell that ends with none of those (the footer paints
no count at zero, so the LAST shell's end is never seen there) stays a running
row until its agent finishes, when the read stops and the row leaves; the
footer count line then covers it as before. A shell launched before the first
window the read gets (40 records) is not listed. A shell that outlives its
agent (A's) is not listed once the agent finishes, since finished agents are
not read; the count line still counts it. Shells of an agent's own nested
agents are not read.

## The last subagent shell's end (2026-10-10, later still)

The limit above, a subagent's last shell staying "running" until its agent
finishes, had a route with stock Orca and no new flag: **Claude Code records
every background task's completion in the LEAD's transcript the moment it
ends, whoever launched it**, and the phone's status line already reads that.
The phone simply never applied those ids to subagent shells.

Verified against **Claude Code 2.1.296**, Orca upstream `stablyai/orca` at
`4f03c237` (main, 2026-10-10) and tag `v1.4.224` (`2bb20586`); the 19 files on
the paths below are byte-identical between the two.

### How it was measured

Two throwaway sessions in a scratch directory, in their own tmux server
(`tmux -L cuifinish`, 110×50), `env -i`, a scratch `--settings` that appended
every hook payload (PreToolUse, PostToolUse, PostToolUseFailure,
PostToolBatch, Notification, UserPromptSubmit, SessionStart, SessionEnd, Stop,
StopFailure, SubagentStart, SubagentStop, TaskCreated, TaskCompleted,
TeammateIdle) and every status-line payload to a file, plus a 1 s watcher of
the lead and subagent transcripts and of the screen. The second session ran
the phone's real `--settings` (built by `buildClaudeHudSettingsJson('darwin')`)
with those logging hooks added and `CUIHUD_TTY` pointed at a scratch file, so
the beacon frames it wrote were captured byte for byte. Nothing was written
to the user's configuration; the tmux server was killed afterwards.

1. Session d602731a: agents "Finish probe A" (`sleep 20` in the background,
   then a foreground `sleep 60`, which the harness refused, so A handed back
   at once) and "Finish probe B" (`sleep 25` in the background, then four
   foreground `sleep 10`).
2. Session 3a763800: agents "Finish probe C" (`sleep 15` in the background,
   blrzd991j, then a 40 s foreground `ping`) and "Finish probe D" (`sleep 20`,
   bchgdtvqt, then a 50 s `ping`). Both shells end inside the pings.

### Where the completion lands, and when

Session 3a763800 (epoch seconds, `…63` prefix dropped):

| time | what |
|---|---|
| 055.56 | C's PostToolUse: `"backgroundTaskId":"blrzd991j"` |
| 070.88 | lead transcript gains `<task-id>blrzd991j</task-id>`; footer `· 2 shells` → `· 1 shell` |
| 074.10 | lead transcript gains bchgdtvqt; footer drops the count entirely |
| next 5 s tick | beacon `done=blrzd991j`, then `done=blrzd991j,bchgdtvqt` |
| 095.64 | C's own file gains blrzd991j (its ping returned at 095.04) |
| 107.44 | D's own file gains bchgdtvqt (its ping returned at 107.32) |

The lead's records are `queue-operation` enqueues, written within half a
second of the shell's end (fixture
`mobile/src/session/fixtures/claude-subagent-shell-finish-2.1.296/3a763800-….jsonl`):

```json
{"type":"queue-operation","operation":"enqueue","timestamp":"2026-10-10T20:11:10.526Z","sessionId":"3a763800-2942-4c7b-8951-6525fd388abc",
 "content":"<task-notification>\n<task-id>blrzd991j</task-id>\n…<status>completed</status>\n<summary>Background command \"Sleep 15 seconds in background\" completed (exit code 0)</summary>\n</task-notification>"}
```

Session d602731a shows the same for both delivery cases: B's bd38s001c was
enqueued in the lead at 20:03:01.944 while B sat in a foreground `sleep 10`
(and `remove`d at 20:03:12.868 when B took it); A's blm04hqbv, which ended
after A had handed back, was enqueued at 20:02:56.917 and resumed A.

The subagent's own file gets the notice in one of two shapes, neither of which
Orca's reader decodes:

- **subagent busy** (B, C, D): an `attachment` record, written only when the
  current tool call returns, but stamped with the enqueue time:
  `{"type":"attachment","attachment":{"type":"queued_command","prompt":"<task-notification>\n<task-id>bd38s001c</task-id>…","commandMode":"task-notification","origin":{"kind":"task-notification","producer":"session-task"},…,"timestamp":"2026-10-10T20:03:01.944Z"}}`
  (B's file did not contain it until 20:03:13.9);
- **subagent idle or handed back** (A): a `user` record with `"isMeta":true`
  and `"origin":{"kind":"task-notification"}`, written at once as it resumes
  the agent.

The beacon frame, as written by the unchanged status line at the first tick
after bchgdtvqt ended (decoded from the captured bytes):

```
CUIHUD1 agent=claude hk=1 hb=5 sid=3a763800-2942-4c7b-8951-6525fd388abc model=claude-opus-5-5 name=Opus%205.5 effort=medium used=60919 win=1000000 pct=6 h5=5:1791678000 d7=69:1791997200 done=blrzd991j,bchgdtvqt live=
```

The status line's scan (`grep -F "<status>"` over the lead's last 4 MiB,
skipping assistant records) was written for the lead's own shells; it matches
a `queue-operation` record just as well. `done=` keeps an id the lead did not
launch only while it is among the last 32 finished, and the phone remembers
every id it has seen named for the session (`mobile-finished-task-id-memory.ts`,
512), so one tick is enough.

### Each path to the phone

| path | carries a subagent shell's end? | field, latency |
|---|---|---|
| Orca native-chat reader (`transcript-line-decoders-claude.ts`, `decodeClaudeTranscriptLine`) | **No.** Only `user`/`assistant` records are decoded (`if (role !== 'user' && role !== 'assistant') return null`), so `attachment` and `queue-operation` records never are; an `isMeta`/`isSynthetic`/`isCompactSummary` user record keeps only tool results. A subagent file can be read (`nativeChat.readSession`/`subscribe` with its `transcriptPath`), with the notice dropped. | none |
| Orca hook server (`/hook/claude`, `claude-events.ts`, `claude-lifecycle-events.ts`, `claude-background-task-inventory.ts`) | **No.** `background_tasks` is read only from a main-agent Stop (`eventAgentId === undefined`); SubagentStop goes to the lifecycle normalizer, which never reads it. Shell ids stay in Orca (`claudeRunningNonAgentTask`, a boolean, is stripped by `pickParsedAgentStatusPayload`); `AgentSubagentSnapshot` is agents only. A shell end resumes a handed-back agent, which flips its roster row back to `working`, indistinguishable from any other resume. `Notification` is not an installed event. | none (the pane's `working`/`monitoring` state at best) |
| Orca status-line route (`/statusline/claude`) | **No.** Posts only payloads containing `rate_limits`, to the rate-limit service. | none |
| Terminal stream (`terminal.subscribe`/`multiplex`) | **Only as painted**: the footer count and the beacon bytes. | footer ≤ 1 s, but no count at zero; beacon ≤ 5 s |
| `agentSession.*` | Structured sessions only; a terminal-driven tab is not one. | n/a |
| Mobile RPC allowlist | No hook-inventory or `background_tasks` method. | n/a |
| **Phone's status line (beacon)** | **Yes**: `done=<shell id>` from the lead's `queue-operation` record. | one heartbeat (5 s) after the end |
| Phone's Stop hook | `run=` from `background_tasks`, which lists subagent shells, but only at the lead's turn end. | turn end |

### Hook events in 2.1.296

The hook list in the binary is: PreToolUse, PostToolUse, PostToolUseFailure,
PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion,
SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop,
PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, PermissionRequest,
PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted,
Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove,
InstructionsLoaded, CwdChanged, FileChanged, DirectoryAdded, MessageDisplay.

Only **Stop** and **SubagentStop** carry `background_tasks` ("In-flight
background work (running/pending + backgrounded) registered in this
session"). No hook fires when a background shell ends: in session 3a763800
nothing at all fired between D's PreToolUse for its ping (057.02) and the
next SubagentStop at 081.91 (a side agent). `TaskCreated`/`TaskCompleted` are the task-list
tool's (`task_subject`), not background tasks.

SubagentStop does fire mid-turn for Claude Code's own side agents (the auto
mode classifier, prompt suggestions: ids such as `ac7bb13252763963e` that no
Agent call launched), each with a fresh `background_tasks`: in session
d602731a, `ac7bb…` at 582.64 no longer listed bd38s001c, which ended at 582.
Those fire only when auto mode or suggestions run, so they are not a clock
to build on. A SubagentStop hook on the phone's flag was therefore not
added: the status line already says it sooner and on a fixed beat.

The status-line payload still has no task field.

### The screen

The footer drops the count when the last shell ends, at once, but paints
nothing in its place (`'  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'`
with both agents still listed under it; fixture `screen-no-shell-count.txt`).
"No count" is also what a footer under a narrow width or another hint looks
like, so the phone does not read it as zero. The turn summary's
"N shells still running" and "Waiting for N background agents" lines are
repainted only around the lead's turns.

### What was built

The phone applies the `done=` ids it already remembers to subagent shells:
`mergeSubagentActivity` takes `finishedTaskIds` and passes them to the same
`deriveBackgroundTasks` call that judges each subagent's shells, and
`useSubagentActivityWatch` hands it the tab report's `finishedTaskIds`. A
named shell moves to Finished as `completed`. No beacon, flag or Orca change.

Tests: `mobile-subagent-shell-finish.test.ts` (the real status-line script
under sh, bash and dash over the real lead records, the real frame, the real
subagent records as Orca serves them, the real footer-less screen, one shell
then two, an empty `done=`, a Codex beacon), plus cases in
`mobile-subagent-activity.test.ts` and
`MobileBackgroundTasksSheet.subagent-activity.test.tsx` (the wiring).

**Limits.** Up to one heartbeat (5 s) late, and only while the status line is
mounted: under a dialog or picker Claude does not run it, so the row moves
when the dialog closes. A lead transcript growing more than 4 MiB between the
shell's end and the next tick would push the record out of the scan; the
Stop hook's `run=` still corrects it at the turn end. Windows hosts get no
flag at all, as before. If a future Claude Code stops enqueueing subagent
notifications in the lead's file, the fixture test still passes (it replays
2.1.296's records), so re-check this against a live session after an update.
