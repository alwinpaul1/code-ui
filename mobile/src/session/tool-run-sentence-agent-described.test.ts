import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolRunSentence, toolRunSentenceShowsFailures } from './mobile-native-chat-tool-sentence'
import { MIXED_RUN_AGENT_DESCRIPTION, mixedRunWithBackgroundAgent } from './fixtures/claude-mixed-tool-run-agent-2026-10-01'

// The Claude app names a run that holds a described Agent call by that agent:
// "Ran agent: <description> (+N tools)", N the run's other calls. Claude
// Android's run label (`h330.i`, read in the 1.261009.20 decompile; the
// plural `ccr_summary_agent_described_more` is unchanged in 1.261013.20) takes
// `z10` "AgentRunLabelInfo(description, otherCallCount)" before the grouped
// sentence, after a lone call's own verb and target. Ours read the grouped
// sentence ("Used a tool, ran 3 commands, ran an agent").

const call = (name: string, input: Record<string, unknown>): NativeChatBlock => ({ type: 'tool-call', name, input })
const ok = (): NativeChatBlock => ({ type: 'tool-result', output: 'ok' })
const failed = (): NativeChatBlock => ({ type: 'tool-result', output: 'exit 1', isError: true })
const agent = (description?: string): NativeChatBlock[] => [
  call('Agent', description === undefined ? { prompt: 'go' } : { description, prompt: 'go' }),
  ok()
]
const bash = (command: string): NativeChatBlock[] => [call('Bash', { command, description: `Run ${command}` }), ok()]

describe('a run that holds a described agent reads by that agent', () => {
  it("reads the 2026-10-01 run (a CronDelete, three commands, an agent) as the app's agent label", () => {
    expect(toolRunSentence(mixedRunWithBackgroundAgent(), 0)).toBe(`Ran agent: ${MIXED_RUN_AGENT_DESCRIPTION} (+4 tools)`)
  })

  it('counts the other calls, one tool in the singular', () => {
    expect(toolRunSentence([...bash('ls'), ...agent('Review: story flow')])).toBe('Ran agent: Review: story flow (+1 tool)')
    expect(toolRunSentence([...agent('Review: story flow'), ...bash('ls'), ...bash('pwd')])).toBe(
      'Ran agent: Review: story flow (+2 tools)'
    )
  })

  it('reads the same for the older Task launcher', () => {
    expect(toolRunSentence([call('Task', { description: 'Audit', prompt: 'x' }), ok(), ...bash('ls')])).toBe(
      'Ran agent: Audit (+1 tool)'
    )
  })

  it('leaves a lone agent call its own verb and target', () => {
    expect(toolRunSentence(agent('Review: story flow'))).toBe('Ran agent Review: story flow')
  })

  it('keeps the grouped sentence for an agent with no description, and for two agents', () => {
    expect(toolRunSentence([...agent(), ...bash('ls')])).toBe('Ran an agent, ran a command')
    expect(toolRunSentence([...agent('A'), ...agent('B'), ...bash('ls')])).toBe('Ran 2 agents, ran a command')
  })

  it('states no failure count, so the run header draws its own', () => {
    const blocks = [...agent('Review'), call('Bash', { command: 'false' }), failed()]
    expect(toolRunSentence(blocks, 1)).toBe('Ran agent: Review (+1 tool)')
    expect(toolRunSentenceShowsFailures(blocks, 1)).toBe(false)
  })
})

describe('a Codex run with a spawned agent is unchanged', () => {
  it('keeps the grouped sentence for spawn_agent beside a command', () => {
    const blocks = [call('spawn_agent', { description: 'sleep task', message: 'run sleep 45' }), ok(), call('exec_command', { cmd: 'ls' }), ok()]
    expect(toolRunSentence(blocks)).toBe('Ran an agent, ran a command')
  })
})
