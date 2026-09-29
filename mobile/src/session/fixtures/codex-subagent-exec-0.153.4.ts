// A real Codex sub-agent run, captured 2026-09-29 on this Mac with
// codex-cli 0.153.4 (`multi_agent` stable, on), in a scratch directory:
//
//   codex exec --json --skip-git-repo-check -s read-only -C <scratch> \
//     "Use your spawn_agent tool to start exactly one sub-agent. Its task: run
//      the shell command 'sleep 45' and then reply with the words 'sub-agent
//      done'. Do not wait for the sub-agent and do not check on it. Right
//      after spawning it, reply with exactly the words 'lead done' and end
//      your turn."
//
// The records below are copied verbatim, one object per rollout line, from the
// two rollouts it wrote (the lead's and the sub-agent's), keeping the lines
// that carry the turn and the sub-agent's lifecycle; the rest are prompts,
// reasoning, token counts and the encrypted spawn message. What they show:
//
// - The lead records the spawn as an `item_completed` event whose item is a
//   `SubAgentActivity` (`kind: "started"`), not the `sub_agent_activity` event
//   Orca's rollout reader looks for (vendored codex-subagent-transcript.ts;
//   the 1.4.216 app.asar has the one and not the other).
// - The lead's turn completes (`task_complete`, "lead done") at 18:05:42.771
//   while the sub-agent's own turn, started at 18:05:39.417, is still running.
// - `codex exec` then exits and aborts the sub-agent 109 ms later
//   (`turn_aborted`, "interrupted"): in exec a sub-agent never outlives its
//   lead's turn. Only the interactive TUI keeps one running.

export const CODEX_LEAD_THREAD = '01a0ee57-e8fd-7c20-a7a8-2159ced42f7c'
export const CODEX_SUBAGENT_THREAD = '01a0ee57-fed0-7e32-a53c-46ad52c9aa39'
export const CODEX_LEAD_ROLLOUT_NAME = `rollout-2026-09-29T20-05-33-${CODEX_LEAD_THREAD}.jsonl`
export const CODEX_SUBAGENT_ROLLOUT_NAME = `rollout-2026-09-29T20-05-39-${CODEX_SUBAGENT_THREAD}.jsonl`

export const CODEX_LEAD_RECORDS: readonly object[] = [
  { timestamp: '2026-09-29T18:05:33.924Z', ordinal: 1, type: 'event_msg', payload: { type: 'task_started', turn_id: '01a0ee57-e961-7ee1-8197-5ef8917970de', started_at: 1790705133, model_context_window: 258400, collaboration_mode_kind: 'default' } },
  { timestamp: '2026-09-29T18:05:39.415Z', ordinal: 13, type: 'event_msg', payload: { type: 'item_completed', thread_id: CODEX_LEAD_THREAD, turn_id: '01a0ee57-e961-7ee1-8197-5ef8917970de', item: { type: 'SubAgentActivity', id: 'call_Py2785pj7yhOPnzq7rpQ0LRE', kind: 'started', agent_thread_id: CODEX_SUBAGENT_THREAD, agent_path: '/root/sleep_task' }, started_at_ms: 1790705139415, completed_at_ms: 1790705139415 } },
  { timestamp: '2026-09-29T18:05:42.708Z', ordinal: 18, type: 'event_msg', payload: { type: 'item_completed', thread_id: CODEX_LEAD_THREAD, turn_id: '01a0ee57-e961-7ee1-8197-5ef8917970de', item: { type: 'AgentMessage', id: 'msg_0af5edbe568588a2016abbfdf68ee087d2a688530b812161b3', content: [{ type: 'Text', text: 'lead done' }], phase: 'final_answer' }, started_at_ms: 1790705142591, completed_at_ms: 1790705142708 } },
  { timestamp: '2026-09-29T18:05:42.771Z', ordinal: 22, type: 'event_msg', payload: { type: 'task_complete', turn_id: '01a0ee57-e961-7ee1-8197-5ef8917970de', last_agent_message: 'lead done', started_at: 1790705133, completed_at: 1790705142, duration_ms: 8848, time_to_first_token_ms: 4640 } }
]

export const CODEX_SUBAGENT_RECORDS: readonly object[] = [
  { timestamp: '2026-09-29T18:05:39.417Z', ordinal: 10, type: 'event_msg', payload: { type: 'task_started', turn_id: '01a0ee57-fed7-79b1-847e-4469ac6941bf', started_at: 1790705139, model_context_window: 258400, collaboration_mode_kind: 'default' } },
  { timestamp: '2026-09-29T18:05:42.880Z', ordinal: 12, type: 'event_msg', payload: { type: 'turn_aborted', turn_id: '01a0ee57-fed7-79b1-847e-4469ac6941bf', reason: 'interrupted', started_at: 1790705139, completed_at: 1790705142, duration_ms: 3463 } }
]
