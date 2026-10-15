import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import { toolDetailSections } from './mobile-native-chat-tool-detail-sections'

// The Claude app keeps ExitPlanMode and AskUserQuestion out of tool groups
// (1.261013.20, the reducer `t5v`): a "Proposed plan" row of its own that opens
// the plan (`ccr_verb_proposed_plan`, the sheet's "Plan" section is
// `ccr_tool_exit_plan_mode`), and an "Asked <header>" row (`ccr_verb_asked`, the
// header of the first question, `hqz.c`). Code UI folded both into the run
// beside them: "Read a file, used 2 tools".

const PLAN = '# Plan\n\n1. Read the parser\n2. Fix the wrap column'

function read(id: string): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'Read', input: { file_path: `/repo/${id}.ts` }, callId: `toolu_${id}` },
    { type: 'tool-result', output: 'ok', callId: `toolu_${id}` }
  ]
}
const planCall: NativeChatBlock = { type: 'tool-call', name: 'ExitPlanMode', input: { plan: PLAN }, callId: 'toolu_plan' }
const planResult: NativeChatBlock = { type: 'tool-result', output: 'User has approved your plan.', callId: 'toolu_plan' }
const askCall: NativeChatBlock = {
  type: 'tool-call',
  name: 'AskUserQuestion',
  input: { questions: [{ header: 'Wrap column', question: 'Which column?', options: [{ label: '80' }, { label: '100' }] }] },
  callId: 'toolu_ask'
}
const askResult: NativeChatBlock = { type: 'tool-result', output: 'User answered: 80', callId: 'toolu_ask' }

function toolRuns(blocks: NativeChatBlock[]): NativeChatBlock[][] {
  return splitTurnIntoSegments(blocks)
    .filter((segment) => segment.kind === 'tools')
    .map((segment) => segment.blocks)
}

describe('a proposed plan and an asked question get rows of their own', () => {
  it('draws "Proposed plan" on its own row between the reads around it', () => {
    const runs = toolRuns([...read('a'), planCall, planResult, ...read('b')])
    expect(runs.map((run) => toolRunSentence(run))).toEqual(['Read a.ts', 'Proposed plan', 'Read b.ts'])
  })

  it('draws "Asked <header>" on its own row after a read', () => {
    const runs = toolRuns([...read('a'), ...read('b'), askCall, askResult])
    expect(runs.map((run) => toolRunSentence(run))).toEqual(['Read 2 files', 'Asked Wrap column'])
  })

  it('keeps a plan still waiting for its answer on its own row', () => {
    const runs = toolRuns([...read('a'), planCall])
    expect(runs.map((run) => toolRunSentence(run))).toEqual(['Read a.ts', 'Proposed plan'])
  })

  it('keeps a turn of only a plan as one row, and loses no block', () => {
    const blocks = [planCall, planResult]
    expect(toolRuns(blocks)).toEqual([blocks])
    const many = [...read('a'), askCall, askResult, planCall, planResult, ...read('b')]
    expect(splitTurnIntoSegments(many).flatMap((segment) => segment.blocks)).toEqual(many)
  })

  it('leaves another call\'s result in the run it belongs to', () => {
    const other = read('c')
    // The read's result came after the plan call: it answers the read, not the plan.
    const runs = toolRuns([other[0]!, planCall, other[1]!, planResult])
    expect(runs.flat()).toHaveLength(4)
    expect(runs.find((run) => run.includes(planCall))).not.toContain(other[1])
  })

  it('opens the plan as Markdown under "Plan"', () => {
    expect(toolDetailSections({ call: planCall as never, result: planResult as never })).toEqual([
      { kind: 'markdown', label: 'Plan', value: PLAN }
    ])
  })
})
