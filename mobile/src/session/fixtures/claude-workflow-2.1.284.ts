import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// ─── A Workflow launch, as Claude Code 2.1.284 wrote it ──────────────────────
//
// Copied from the lead transcript of session 790eafa8, 2026-09-29/30 (three
// records: the assistant `Workflow` tool_use, its tool_result, and the
// completion <task-notification> the lead received 84 minutes later). Left out
// on purpose: the script body after `export const meta`, which is 20 KB of
// prompts nobody reads off a card, and the notification's `<result>`, which is
// the workflow's return value (81 KB, cut in the transcript itself). The meta
// literal, the result sentence and the notification's tags and `<usage>` block
// are verbatim.

export const WORKFLOW_META_HEAD = "export const meta = {\n  name: 'pre-release-review-sweep',\n  description: 'Parallel Sonnet reviewers find proven bugs across Code UI; Opus triages, fixes in worktrees, integrates; Sonnet re-reviews',\n  phases: [\n    { title: 'Review', detail: 'Sonnet reviewers, one per app area, prove each finding with a scratch test', model: 'sonnet' },\n    { title: 'Triage', detail: 'Opus orchestrator dedups, plans non-overlapping fix batches', model: 'opus' },\n    { title: 'Fix', detail: 'Opus fixers, one worktree per batch, failing-first tests', model: 'opus' },\n    { title: 'Integrate', detail: 'Opus integrator merges fix branches and runs the full gate', model: 'opus' },\n    { title: 'Re-review', detail: 'Sonnet reviewers check the integrated branch for regressions and leftovers', model: 'sonnet' },\n  ],\n}\n\n"

/** A script cut anywhere after the meta literal still has the whole literal. */
export const WORKFLOW_SCRIPT = WORKFLOW_META_HEAD + "\nconst REPO = args.repo\nconst MAIN = args.mainSha\n"

export const WORKFLOW_LAUNCH_RESULT = "Workflow launched in background. Task ID: whnsp6sli\nSummary: Parallel Sonnet reviewers find proven bugs across Code UI; Opus triages, fixes in worktrees, integrates; Sonnet re-reviews\nTranscript dir: /Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/subagents/workflows/wf_8c808671-dd5\nScript file: /Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/workflows/scripts/pre-release-review-sweep-wf_8c808671-dd5.js\n(Edit this file with Write/Edit and re-invoke Workflow with {scriptPath: \"/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/workflows/scripts/pre-release-review-sweep-wf_8c808671-dd5.js\"} to iterate without resending the script.)\nRun ID: wf_8c808671-dd5\nTo resume after editing the script: Workflow({scriptPath: \"/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/workflows/scripts/pre-release-review-sweep-wf_8c808671-dd5.js\", resumeFromRunId: \"wf_8c808671-dd5\"}) \u2014 completed agents return cached results (cached results may themselves be empty \u2014 inspect journal.jsonl before assuming there is something to recover).\n\nYou will be notified when it completes. Use /workflows to watch live progress."

export const WORKFLOW_TASK_ID = 'whnsp6sli'

export const WORKFLOW_NOTIFICATION = "<task-notification>\n<task-id>whnsp6sli</task-id>\n<tool-use-id>toolu_01BCefd5RHBvwWiRsdpknb6h</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/tasks/whnsp6sli.output</output-file>\n<status>completed</status>\n<summary>Dynamic workflow \"Parallel Sonnet reviewers find proven bugs across Code UI; Opus triages, fixes in worktrees, integrates; Sonnet re-reviews\" completed</summary>\n" + '<result>{"integration":{"head":"9723e05d"}}</result>\n' + "<usage><agent_count>37</agent_count><agents_done>37</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>4853603</subagent_tokens><tool_uses>1567</tool_uses><duration_ms>5057662</duration_ms></usage>\n</task-notification>"

export const WORKFLOW_LAUNCHED_AT = Date.parse("2026-09-29T22:47:56.330Z")
export const WORKFLOW_ENDED_AT = Date.parse("2026-09-30T00:12:15.344Z")

export function workflowLaunchMessages(script: string = WORKFLOW_SCRIPT): NativeChatMessage[] {
  return [
    {
      id: 'workflow-call',
      role: 'assistant',
      timestamp: WORKFLOW_LAUNCHED_AT,
      source: 'transcript',
      blocks: [{ type: 'tool-call', name: 'Workflow', input: { script, args: '{"repo": "/Users/alwinpaul/Desktop/Project/Code UI", "mainSha": "034946e6"}' } }]
    },
    {
      id: 'workflow-result',
      role: 'user',
      timestamp: WORKFLOW_LAUNCHED_AT + 1_400,
      source: 'transcript',
      blocks: [{ type: 'tool-result', output: WORKFLOW_LAUNCH_RESULT }]
    }
  ]
}

export function workflowFinishedMessage(): NativeChatMessage {
  return {
    id: 'workflow-done',
    role: 'user',
    timestamp: WORKFLOW_ENDED_AT,
    source: 'transcript',
    blocks: [{ type: 'text', text: WORKFLOW_NOTIFICATION }]
  }
}
