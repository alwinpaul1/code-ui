import { describe, expect, it } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { countRunningBackgroundTasks, deriveBackgroundTasks } from './mobile-background-tasks'
import {
  WORKFLOW_LAUNCHED_AT,
  WORKFLOW_LAUNCH_RESULT,
  WORKFLOW_SCRIPT,
  WORKFLOW_TASK_ID,
  workflowFinishedMessage,
  workflowLaunchMessages
} from './fixtures/claude-workflow-2.1.284'

// A Workflow is one background task, not a swarm of agents. Every record here
// is a Claude Code 2.1.284 record (fixtures/claude-workflow-2.1.284.ts); the
// roster rows are the shape Orca's hooks give a workflow lane: agentType
// `workflow-subagent`, the label as `description` once Claude's inventory has
// named it, no phase and no workflow id on the row.
const NOW = WORKFLOW_LAUNCHED_AT + 61 * 60_000 + 44_000
/** The script's real head followed by enough body to pass the wire's cap. */
const WORKFLOW_SCRIPT_FULL_LENGTH_PAD = WORKFLOW_SCRIPT + 'await agent("review")\n'.repeat(400)

function lane(id: string, description: string | undefined, state: AgentSubagentSnapshot['state'] = 'working'): AgentSubagentSnapshot {
  return {
    id,
    agentType: 'workflow-subagent',
    ...(description === undefined ? {} : { description }),
    state,
    startedAt: WORKFLOW_LAUNCHED_AT + 5_000
  }
}

function derive(messages: NativeChatMessage[], subagents?: AgentSubagentSnapshot[]) {
  return deriveBackgroundTasks(messages, NOW, subagents ? { state: 'working', subagents } : null)
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
    const { running } = derive([call!, bare])
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
    expect(finished[0]?.workflow?.usage).toEqual({ agents: 37, tokens: 4_853_603, durationMs: 5_057_662 })
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

describe("a workflow's own agents", () => {
  it('sit inside the workflow, not beside it as raw "workflow-subagent" rows, and are not counted again', () => {
    const roster = [lane('a1', 'review:markdown'), lane('a2', 'review:chat-ui'), lane('a3', 'fix:r1:b1-pr-rich-markdown')]
    const { running } = derive(workflowLaunchMessages(), roster)
    expect(running.map((task) => task.kind)).toEqual(['workflow'])
    expect(countRunningBackgroundTasks(workflowLaunchMessages(), { state: 'working', subagents: roster }, {}, NOW)).toBe(1)
    const phases = running[0]?.workflow?.phases ?? []
    expect(phases.find((phase) => phase.title === 'Review')?.agents.map((agent) => agent.label)).toEqual(['review:markdown', 'review:chat-ui'])
    expect(phases.find((phase) => phase.title === 'Fix')?.agents.map((agent) => agent.label)).toEqual(['fix:r1:b1-pr-rich-markdown'])
    expect(phases.find((phase) => phase.title === 'Triage')?.agents).toEqual([])
  })

  it('are listed even when the lead transcript never launched them (only a lead-started agent is otherwise counted)', () => {
    const { running } = deriveBackgroundTasks(
      workflowLaunchMessages(),
      NOW,
      { state: 'working', subagents: [lane('a1', 'review:markdown')] },
      { agentProvenance: { ownAgentIds: [], preexistingAgentIds: [] } }
    )
    expect(running.map((task) => task.kind)).toEqual(['workflow'])
    expect(running[0]?.workflow?.phases?.[0]?.agents).toHaveLength(1)
  })

  it('one agent: one row in its phase; none: no agent rows and no invented count', () => {
    const one = derive(workflowLaunchMessages(), [lane('a1', 'triage:round-1')])
    expect(one.running[0]?.workflow?.phases?.find((phase) => phase.title === 'Triage')?.agents).toEqual([{ id: 'a1', label: 'triage:round-1' }])
    const none = derive(workflowLaunchMessages(), [])
    expect(none.running[0]?.workflow?.phases?.every((phase) => phase.agents.length === 0)).toBe(true)
    expect(none.running[0]?.workflow?.otherAgents).toEqual([])
  })

  it('an agent whose label names no phase is kept, unplaced, and so is every agent when the meta would not parse', () => {
    const stray = derive(workflowLaunchMessages(), [lane('a1', 'lint the docs'), lane('a2', undefined)])
    expect(stray.running[0]?.workflow?.otherAgents).toEqual([
      { id: 'a1', label: 'lint the docs' },
      { id: 'a2', label: null }
    ])
    const noMeta = derive(workflowLaunchMessages('export const meta = compute()'), [lane('a1', 'review:markdown')])
    expect(noMeta.running[0]?.workflow?.otherAgents).toEqual([{ id: 'a1', label: 'review:markdown' }])
  })

  it('an idle lane is not running work and is left out', () => {
    const { running } = derive(workflowLaunchMessages(), [lane('a1', 'review:markdown', 'idle')])
    expect(running[0]?.workflow?.phases?.[0]?.agents).toEqual([])
  })

  it('with no workflow in the loaded window they stay ordinary agent rows', () => {
    const { running } = derive([], [lane('a1', 'review:markdown')])
    expect(running.map((task) => [task.kind, task.title])).toEqual([['agent', 'review:markdown']])
  })

  it('an agent that is not a workflow lane stays an agent row beside the workflow', () => {
    const other: AgentSubagentSnapshot = { id: 'a9', agentType: 'general-purpose', description: 'Explore', state: 'working', startedAt: WORKFLOW_LAUNCHED_AT }
    const { running } = derive(workflowLaunchMessages(), [lane('a1', 'review:markdown'), other])
    expect(running.map((task) => task.kind).sort()).toEqual(['agent', 'workflow'])
  })

  it('two workflows at once: a lane is placed only where exactly one workflow has its phase, else left as an agent row', () => {
    const second = workflowLaunchMessages(
      "export const meta = { name: 'docs-pass', description: 'Rewrite docs', phases: [{ title: 'Draft' }, { title: 'Review' }] }"
    ).map((message, index) => ({
      ...message,
      id: `second-${index}`,
      blocks: message.blocks.map((block) =>
        block.type === 'tool-result' ? { ...block, output: block.output.replace(WORKFLOW_TASK_ID, 'wdocs0001') } : block
      )
    }))
    const roster = [lane('a1', 'draft:intro'), lane('a2', 'review:markdown'), lane('a3', 'fix:r1:b1'), lane('a4', 'mystery')]
    const { running } = derive([...workflowLaunchMessages(), ...second], roster)
    const workflows = running.filter((task) => task.kind === 'workflow')
    expect(workflows.map((task) => task.title)).toEqual(['pre-release-review-sweep', 'docs-pass'])
    const bySweep = workflows[0]?.workflow
    const byDocs = workflows[1]?.workflow
    // `draft:` is only the second's phase, `fix:` only the first's.
    expect(byDocs?.phases?.find((phase) => phase.title === 'Draft')?.agents.map((agent) => agent.id)).toEqual(['a1'])
    expect(bySweep?.phases?.find((phase) => phase.title === 'Fix')?.agents.map((agent) => agent.id)).toEqual(['a3'])
    // `review:` is in both and `mystery` in neither: nothing says whose, so they stay agent rows.
    expect(running.filter((task) => task.kind === 'agent').map((task) => task.id).sort()).toEqual(['a2', 'a4'])
    expect(bySweep?.phases?.find((phase) => phase.title === 'Review')?.agents).toEqual([])
    expect(byDocs?.phases?.find((phase) => phase.title === 'Review')?.agents).toEqual([])
  })
})
