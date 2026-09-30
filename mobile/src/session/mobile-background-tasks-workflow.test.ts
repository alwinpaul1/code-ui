import { describe, expect, it } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import { readClaudeBackgroundAgentTasks } from '../../../src/shared/claude-background-task-inventory'
import {
  claudeRosterToSnapshots,
  foldClaudeBackgroundTasksIntoRoster,
  stopClaudeSubagent,
  upsertWorkingClaudeSubagent,
  type ClaudeSubagentRoster
} from '../../../src/shared/claude-subagent-roster'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countRunningBackgroundTasks,
  deriveBackgroundTasks,
  type BackgroundTaskDeriveOptions
} from './mobile-background-tasks'
import {
  WORKFLOW_LAUNCHED_AT,
  WORKFLOW_LAUNCH_RESULT,
  WORKFLOW_SCRIPT,
  WORKFLOW_TASK_ID,
  workflowFinishedMessage,
  workflowLaunchMessages
} from './fixtures/claude-workflow-2.1.284'

// A Workflow is one task, not a swarm of agents. Every transcript record here
// is a Claude Code 2.1.284 record (fixtures/claude-workflow-2.1.284.ts). The
// roster rows are built the way Orca builds them for a workflow lane in
// production, through the vendored roster (src/shared/claude-subagent-roster):
// SubagentStart carries only agent_id and agent_type, the runner runs its
// agents inline and never lists them in the Stop payload's `background_tasks`,
// so a lane never has a description or a phase, and every lead Stop clears
// the roster (the inventory holds no agent-typed task) until the lane's next
// tool event puts it back.
const NOW = WORKFLOW_LAUNCHED_AT + 61 * 60_000 + 44_000
/** The script's real head followed by enough body to pass the wire's cap. */
const WORKFLOW_SCRIPT_FULL_LENGTH_PAD = WORKFLOW_SCRIPT + 'await agent("review")\n'.repeat(400)
const LANE_STARTED = WORKFLOW_LAUNCHED_AT + 5_000

/** What the Stop hook's beacon says is running: the workflow, nothing else. */
const BEACON_NAMES_ONLY_THE_WORKFLOW = { stopRunningTaskIds: [WORKFLOW_TASK_ID], stopRunningTaskIdsAt: WORKFLOW_LAUNCHED_AT + 60_000 }

function startLanes(roster: ClaudeSubagentRoster, count: number, from = 0): void {
  for (let index = from; index < from + count; index += 1) {
    upsertWorkingClaudeSubagent(roster, `a${index.toString(16).padStart(16, '0')}`, { agentType: 'workflow-subagent' }, LANE_STARTED + index)
  }
}

/** A lead Stop while the workflow runs: its inventory names the workflow (not
 *  an agent-typed task), so the roster is cleared. */
function leadStop(roster: ClaudeSubagentRoster): void {
  const { tasks } = readClaudeBackgroundAgentTasks({
    background_tasks: [{ type: 'local_workflow', id: WORKFLOW_TASK_ID, status: 'running' }]
  })
  foldClaudeBackgroundTasksIntoRoster(roster, tasks, NOW)
}

function derive(
  messages: NativeChatMessage[],
  subagents?: AgentSubagentSnapshot[],
  options: BackgroundTaskDeriveOptions = BEACON_NAMES_ONLY_THE_WORKFLOW
) {
  return deriveBackgroundTasks(messages, NOW, subagents ? { state: 'working', subagents } : null, options)
}

function lanesOf(roster: ClaudeSubagentRoster) {
  return derive(workflowLaunchMessages(), claudeRosterToSnapshots(roster)).running[0]?.workflow?.lanes ?? null
}

describe('a Workflow launch in the lead transcript', () => {
  it('lists the workflow by its meta name, with its description, phases and the time since launch', () => {
    const { running, finished } = derive(workflowLaunchMessages())
    expect(finished).toEqual([])
    expect(running).toHaveLength(1)
    const [task] = running
    expect(task).toMatchObject({
      id: WORKFLOW_TASK_ID,
      kind: 'workflow',
      title: 'pre-release-review-sweep',
      status: 'running',
      startedAt: WORKFLOW_LAUNCHED_AT,
      elapsedMs: 61 * 60_000 + 44_000
    })
    expect(task?.workflow?.description).toContain('Parallel Sonnet reviewers')
    expect(task?.workflow?.phases?.map((phase) => phase.title)).toEqual(['Review', 'Triage', 'Fix', 'Integrate', 'Re-review'])
    expect(task?.workflow?.usage).toBeNull()
  })

  it('with a script that will not parse: no phases, the name from the launch result\'s Script file line, the description from Summary', () => {
    const { running } = derive(workflowLaunchMessages('export const meta = buildMeta()\nawait agent("x")'))
    expect(running[0]).toMatchObject({ kind: 'workflow', title: 'pre-release-review-sweep' })
    expect(running[0]?.workflow?.phases).toBeNull()
    expect(running[0]?.workflow?.description).toBe(
      'Parallel Sonnet reviewers find proven bugs across Code UI; Opus triages, fixes in worktrees, integrates; Sonnet re-reviews'
    )
  })

  it('a resume by scriptPath carries no script: the name still comes from the Script file line', () => {
    const [call, answer] = workflowLaunchMessages()
    const rerun: NativeChatMessage = {
      ...call!,
      blocks: [{ type: 'tool-call', name: 'Workflow', input: { scriptPath: '/x/workflows/scripts/pre-release-review-sweep-wf_8c808671-dd5.js', resumeFromRunId: 'wf_8c808671-dd5' } }]
    }
    const { running } = derive([rerun, answer!])
    expect(running[0]?.title).toBe('pre-release-review-sweep')
    expect(running[0]?.workflow?.phases).toBeNull()
  })

  it('with neither a readable meta nor a Script file line the title is just "Workflow"', () => {
    const [call, answer] = workflowLaunchMessages('nothing to read')
    const bare: NativeChatMessage = {
      ...answer!,
      blocks: [{ type: 'tool-result', output: 'Workflow launched in background. Task ID: wxyz12345\nRun ID: wf_1' }]
    }
    const { running } = derive([call!, bare], undefined, {})
    expect(running[0]).toMatchObject({ id: 'wxyz12345', title: 'Workflow' })
    expect(running[0]?.workflow?.description).toBeNull()
  })

  // Orca's wire cuts a tool input string at ~4000 characters and ends it with
  // `… (truncated)`, adding a `…` key (the shape mobile-native-chat-created-file
  // -running-work.test.ts pins). The real script's meta sits in its first 1 KB.
  it('reads the meta of a real script whose tail the wire cut', () => {
    const [call, answer] = workflowLaunchMessages()
    const input = { script: `${WORKFLOW_SCRIPT_FULL_LENGTH_PAD.slice(0, 3960)}… (truncated)`, args: '{}', '…': 'truncated' }
    const cut: NativeChatMessage = { ...call!, blocks: [{ type: 'tool-call', name: 'Workflow', input }] }
    const { running } = derive([cut, answer!])
    expect(running[0]?.title).toBe('pre-release-review-sweep')
    expect(running[0]?.workflow?.phases?.map((phase) => phase.title)).toEqual(['Review', 'Triage', 'Fix', 'Integrate', 'Re-review'])
  })

  it('a launch whose result never says a task id launched nothing', () => {
    const messages = workflowLaunchMessages()
    const failed: NativeChatMessage = {
      ...messages[1]!,
      blocks: [{ type: 'tool-result', output: 'Workflow script failed to compile: unexpected token', isError: true }]
    }
    expect(derive([messages[0]!, failed]).running).toEqual([])
  })

  it('a finished workflow moves to Finished with the totals Claude states in its notification', () => {
    const { running, finished } = derive([...workflowLaunchMessages(), workflowFinishedMessage()])
    expect(running).toEqual([])
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ id: WORKFLOW_TASK_ID, kind: 'workflow', title: 'pre-release-review-sweep', status: 'completed' })
    expect(finished[0]?.workflow?.usage).toEqual({ agents: 37, tokens: 4_853_603, durationMs: 5_057_662, failed: 0, skipped: 0 })
  })

  it('a failed workflow is drawn as failed, and one whose notification has no usage block has no totals', () => {
    const notification = workflowFinishedMessage()
    const block = notification.blocks[0]
    const text = block?.type === 'text' ? block.text : ''
    const bare: NativeChatMessage = {
      ...notification,
      blocks: [{ type: 'text', text: text.replace('<status>completed</status>', '<status>failed</status>').replace(/<usage>[\s\S]*<\/usage>/, '') }]
    }
    const { finished } = derive([...workflowLaunchMessages(), bare])
    expect(finished[0]?.status).toBe('failed')
    expect(finished[0]?.workflow?.usage).toBeNull()
  })

  it('reads the usage block after the result, not one the model-written result quotes', () => {
    const notification = workflowFinishedMessage()
    const block = notification.blocks[0]
    const text = block?.type === 'text' ? block.text : ''
    const quoting = text.replace(
      /<result>[\s\S]*?<\/result>/,
      '<result>The last run printed <usage><agent_count>99</agent_count><agents_error>7</agents_error><subagent_tokens>1</subagent_tokens><duration_ms>5</duration_ms></usage> and stopped.</result>'
    )
    expect(quoting).toContain('<agent_count>99</agent_count>')
    const { finished } = derive([...workflowLaunchMessages(), { ...notification, blocks: [{ type: 'text', text: quoting }] }])
    expect(finished[0]?.workflow?.usage).toMatchObject({ agents: 37, tokens: 4_853_603, durationMs: 5_057_662, failed: 0 })
  })

  it('a notification cut inside the result has no usage to read, and one that only quotes it has none either', () => {
    const notification = workflowFinishedMessage()
    const block = notification.blocks[0]
    const text = block?.type === 'text' ? block.text : ''
    const cutInside = text.slice(0, text.indexOf('</result>')).replace('<result>', '<result>quoted <usage><agent_count>99</agent_count></usage> ')
    const { finished } = derive([...workflowLaunchMessages(), { ...notification, blocks: [{ type: 'text', text: cutInside }] }])
    expect(finished[0]?.workflow?.usage).toBeNull()
  })

  it('carries the failed and skipped agents the usage block counts, and no failure when it counts none', () => {
    const notification = workflowFinishedMessage()
    const block = notification.blocks[0]
    const text = block?.type === 'text' ? block.text : ''
    const withFailures = text.replace('<agents_error>0</agents_error>', '<agents_error>3</agents_error>').replace('<agents_skipped>0</agents_skipped>', '<agents_skipped>2</agents_skipped>')
    const failed = derive([...workflowLaunchMessages(), { ...notification, blocks: [{ type: 'text', text: withFailures }] }])
    expect(failed.finished[0]?.workflow?.usage).toMatchObject({ failed: 3, skipped: 2 })
    expect(derive([...workflowLaunchMessages(), notification]).finished[0]?.workflow?.usage).toMatchObject({ failed: 0, skipped: 0 })
  })

  it('a launch result whose id has no notification yet, on a done pane, is not left running', () => {
    const { running, finished } = deriveBackgroundTasks(workflowLaunchMessages(), NOW, { state: 'done' })
    expect(running).toEqual([])
    expect(finished[0]?.kind).toBe('workflow')
  })

  it('the launch sentence is read from the real result and nothing else', () => {
    expect(WORKFLOW_LAUNCH_RESULT.startsWith('Workflow launched in background. Task ID: whnsp6sli')).toBe(true)
    expect(WORKFLOW_SCRIPT.startsWith('export const meta')).toBe(true)
  })
})

describe("a workflow's lanes", () => {
  it('are counted on the card, not listed beside it as raw "workflow-subagent" rows, and not counted again', () => {
    const roster: ClaudeSubagentRoster = new Map()
    startLanes(roster, 3)
    const snapshots = claudeRosterToSnapshots(roster)
    expect(snapshots?.every((row) => row.description === undefined)).toBe(true)
    const { running } = derive(workflowLaunchMessages(), snapshots)
    expect(running.map((task) => task.kind)).toEqual(['workflow'])
    expect(running[0]?.workflow?.lanes).toEqual({ count: 3, atLeast: false })
    expect(countRunningBackgroundTasks(workflowLaunchMessages(), { state: 'working', subagents: snapshots }, BEACON_NAMES_ONLY_THE_WORKFLOW, NOW)).toBe(1)
  })

  it('carry no phase and no label, so the card names phases only from the meta and holds no agent rows', () => {
    const roster: ClaudeSubagentRoster = new Map()
    startLanes(roster, 2)
    const detail = derive(workflowLaunchMessages(), claudeRosterToSnapshots(roster)).running[0]?.workflow
    expect(detail?.phases).toEqual([
      { title: 'Review', detail: 'Sonnet reviewers, one per app area, prove each finding with a scratch test' },
      { title: 'Triage', detail: 'Opus orchestrator dedups, plans non-overlapping fix batches' },
      { title: 'Fix', detail: 'Opus fixers, one worktree per batch, failing-first tests' },
      { title: 'Integrate', detail: 'Opus integrator merges fix branches and runs the full gate' },
      { title: 'Re-review', detail: 'Sonnet reviewers check the integrated branch for regressions and leftovers' }
    ])
    expect(Object.keys(detail ?? {}).sort()).toEqual(['description', 'lanes', 'phases', 'usage'])
  })

  it('are counted even when the lead transcript never launched them', () => {
    const roster: ClaudeSubagentRoster = new Map()
    startLanes(roster, 1)
    const { running } = deriveBackgroundTasks(
      workflowLaunchMessages(),
      NOW,
      { state: 'working', subagents: claudeRosterToSnapshots(roster) },
      { ...BEACON_NAMES_ONLY_THE_WORKFLOW, agentProvenance: { ownAgentIds: [], preexistingAgentIds: [] } }
    )
    expect(running.map((task) => task.kind)).toEqual(['workflow'])
    expect(running[0]?.workflow?.lanes).toEqual({ count: 1, atLeast: false })
  })

  it('give no count when there are none: no zero, and a roster a lead Stop just cleared reads as none', () => {
    const roster: ClaudeSubagentRoster = new Map()
    expect(lanesOf(roster)).toBeNull()
    startLanes(roster, 4)
    expect(lanesOf(roster)).toEqual({ count: 4, atLeast: false })
    // A lead Stop clears the roster mid-workflow; Orca then has no rows at all.
    leadStop(roster)
    expect(claudeRosterToSnapshots(roster)).toBeUndefined()
    expect(lanesOf(roster)).toBeNull()
    // The lanes' next tool events put them back, with new starts.
    startLanes(roster, 2, 10)
    expect(lanesOf(roster)).toEqual({ count: 2, atLeast: false })
  })

  it('a lane that finished is off the roster and is not counted', () => {
    const roster: ClaudeSubagentRoster = new Map()
    startLanes(roster, 2)
    stopClaudeSubagent(roster, `a${(0).toString(16).padStart(16, '0')}`)
    expect(lanesOf(roster)).toEqual({ count: 1, atLeast: false })
  })

  it('at the roster cap the count is a floor: "32+", never a number that may be short', () => {
    const roster: ClaudeSubagentRoster = new Map()
    startLanes(roster, 40)
    expect(roster.size).toBe(32)
    expect(lanesOf(roster)).toEqual({ count: 32, atLeast: true })
  })

  it('at the cap with another agent among the rows, the lanes are a floor too', () => {
    const roster: ClaudeSubagentRoster = new Map()
    upsertWorkingClaudeSubagent(roster, 'a0000000000000fff', { agentType: 'general-purpose' }, LANE_STARTED)
    startLanes(roster, 40)
    expect(roster.size).toBe(32)
    expect(lanesOf(roster)).toEqual({ count: 31, atLeast: true })
  })

  it('an idle row is not running work', () => {
    const idle: AgentSubagentSnapshot = { id: 'a1', agentType: 'workflow-subagent', state: 'idle', startedAt: LANE_STARTED }
    expect(derive(workflowLaunchMessages(), [idle]).running[0]?.workflow?.lanes).toBeNull()
  })

  it('with no workflow in the loaded window they stay ordinary agent rows', () => {
    const roster: ClaudeSubagentRoster = new Map()
    startLanes(roster, 1)
    const { running } = derive([], claudeRosterToSnapshots(roster))
    expect(running.map((task) => [task.kind, task.title])).toEqual([['agent', 'workflow-subagent']])
  })

  it('an agent that is not a workflow lane stays an agent row beside the workflow', () => {
    const roster: ClaudeSubagentRoster = new Map()
    startLanes(roster, 2)
    upsertWorkingClaudeSubagent(roster, 'a9', { agentType: 'general-purpose', description: 'Explore' }, LANE_STARTED)
    const { running } = derive(workflowLaunchMessages(), claudeRosterToSnapshots(roster))
    expect(running.map((task) => task.kind).sort()).toEqual(['agent', 'workflow'])
    expect(running.find((task) => task.kind === 'workflow')?.workflow?.lanes).toEqual({ count: 2, atLeast: false })
  })
})

// A lane row names no workflow, so a lane is put on a card only when nothing
// says it could be another workflow's. Where that cannot be shown the lanes are
// left as they were (an ordinary agent row): refusing beats a wrong card.
describe('a lane that could belong to another workflow', () => {
  function oneLane(startedAt = LANE_STARTED): AgentSubagentSnapshot[] {
    return [{ id: 'a7f3c19d20be4a611', agentType: 'workflow-subagent', state: 'working', startedAt }]
  }
  const kinds = (result: ReturnType<typeof derive>) => result.running.map((task) => task.kind).sort()

  it('is not folded when a second workflow is running', () => {
    const second = workflowLaunchMessages("export const meta = { name: 'docs-pass', phases: [{ title: 'Draft' }] }").map((message, index) => ({
      ...message,
      id: `second-${index}`,
      blocks: message.blocks.map((block) =>
        block.type === 'tool-result' ? { ...block, output: block.output.replace(WORKFLOW_TASK_ID, 'wdocs0001') } : block
      )
    }))
    const result = derive([...workflowLaunchMessages(), ...second], oneLane(), { ...BEACON_NAMES_ONLY_THE_WORKFLOW, stopRunningTaskIds: [WORKFLOW_TASK_ID, 'wdocs0001'] })
    expect(kinds(result)).toEqual(['agent', 'workflow', 'workflow'])
    expect(result.running.filter((task) => task.kind === 'workflow').every((task) => task.workflow?.lanes === null)).toBe(true)
  })

  it('is not folded when the agent has not said what is running (no beacon list yet)', () => {
    const result = derive(workflowLaunchMessages(), oneLane(), {})
    expect(kinds(result)).toEqual(['agent', 'workflow'])
    expect(result.running.find((task) => task.kind === 'workflow')?.workflow?.lanes).toBeNull()
  })

  it('is not folded when the beacon names a running task the loaded window never showed (a workflow launched above it)', () => {
    const result = derive(workflowLaunchMessages(), oneLane(), { ...BEACON_NAMES_ONLY_THE_WORKFLOW, stopRunningTaskIds: [WORKFLOW_TASK_ID, 'wabove0001'] })
    expect(kinds(result)).toEqual(['agent', 'workflow'])
  })

  it('is not folded when it started before this workflow was launched', () => {
    const result = derive(workflowLaunchMessages(), oneLane(WORKFLOW_LAUNCHED_AT - 60_000))
    expect(kinds(result)).toEqual(['agent', 'workflow'])
    expect(result.running.find((task) => task.kind === 'workflow')?.workflow?.lanes).toBeNull()
  })

  it('is not folded into a workflow that has finished', () => {
    const result = derive([...workflowLaunchMessages(), workflowFinishedMessage()], oneLane(), { ...BEACON_NAMES_ONLY_THE_WORKFLOW, stopRunningTaskIds: [] })
    expect(result.finished[0]?.workflow?.lanes).toBeNull()
    expect(kinds(result)).toEqual(['agent'])
  })

  it('is not folded when the host says the pane is done', () => {
    const result = deriveBackgroundTasks(workflowLaunchMessages(), NOW, { state: 'done', subagents: oneLane() }, BEACON_NAMES_ONLY_THE_WORKFLOW)
    expect(result.finished[0]?.workflow?.lanes).toBeNull()
  })

  it('is folded when exactly one workflow runs, the beacon names nothing the window did not show, and the lane started after the launch', () => {
    const result = derive(workflowLaunchMessages(), oneLane())
    expect(kinds(result)).toEqual(['workflow'])
    expect(result.running[0]?.workflow?.lanes).toEqual({ count: 1, atLeast: false })
  })
})
