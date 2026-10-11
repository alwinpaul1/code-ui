import { describe, expect, it } from 'vitest'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'
import { mergeSubagentActivity } from './mobile-subagent-activity'
import { EMPTY_FINISHED_SUBAGENT_ROWS, keepFinishedSubagentRows } from './subagent-finished-rows'
import { PROBE_B_AGENT, PROBE_B_STOPPED_SHELL, orcaTranscriptRows, probeBRecords, recordsThrough } from './fixtures/claude-subagent-transcripts-2.1.296'

// The Claude app keeps a subagent's finished shells in Finished ("Run the full
// gate  Shell  Completed", the user's screenshot of 2026-10-11) after the agent
// that ran them has handed back. Code UI read a subagent's transcript only
// while the agent ran, so the moment it finished its shells' rows went with
// the read. Real records: probe B of Claude Code 2.1.296, whose stopped shell
// (bnj50z9e4) is in Finished while B runs.

const NOW = Date.parse('2026-10-10T18:45:29.000Z')
const bRow: BackgroundTask = { id: PROBE_B_AGENT, kind: 'agent', title: 'Sleep probe B', status: 'running', startedAt: NOW - 16_000, elapsedMs: 16_000 }
const bFinished: BackgroundTask = { ...bRow, status: 'completed', elapsedMs: null }
const bAfterStop = () => orcaTranscriptRows(recordsThrough(probeBRecords(), '1f61a477'))

describe("a subagent's finished shells stay in Finished after the agent hands back", () => {
  it('keeps B\'s stopped shell in Finished once B has finished and its transcript is no longer read', () => {
    const whileRunning: BackgroundTasks = { running: [bRow], finished: [] }
    const merged = mergeSubagentActivity(whileRunning, new Map([[PROBE_B_AGENT, bAfterStop()]]), { now: NOW })
    expect(merged.finished.map((task) => task.id)).toEqual([PROBE_B_STOPPED_SHELL])
    const first = keepFinishedSubagentRows(EMPTY_FINISHED_SUBAGENT_ROWS, whileRunning, merged)

    const afterHandBack: BackgroundTasks = { running: [], finished: [bFinished] }
    const later = keepFinishedSubagentRows(first.memory, afterHandBack, afterHandBack)

    expect(later.tasks.finished.map((task) => [task.id, task.status])).toEqual([
      [PROBE_B_STOPPED_SHELL, 'completed'],
      [PROBE_B_AGENT, 'completed']
    ])
  })

  it('remembers no running row: a shell still running when its agent finished has no known end', () => {
    const lane: BackgroundTasks = { running: [bRow], finished: [] }
    const shell: BackgroundTask = { id: 'bshell001', kind: 'shell', title: 'sleep 120', status: 'running', startedAt: NOW, elapsedMs: 0 }
    const first = keepFinishedSubagentRows(EMPTY_FINISHED_SUBAGENT_ROWS, lane, { running: [bRow, shell], finished: [] })
    const later = keepFinishedSubagentRows(first.memory, { running: [], finished: [] }, { running: [], finished: [] })
    expect(later.tasks).toEqual({ running: [], finished: [] })
  })

  it('never lists a kept row twice, nor over a row the lead lists again', () => {
    const lane: BackgroundTasks = { running: [bRow], finished: [] }
    const done: BackgroundTask = { id: 'bshell002', kind: 'shell', title: 'sleep 1', status: 'completed', startedAt: NOW, elapsedMs: null }
    const first = keepFinishedSubagentRows(EMPTY_FINISHED_SUBAGENT_ROWS, lane, { running: [bRow], finished: [done] })
    const again = keepFinishedSubagentRows(first.memory, lane, { running: [bRow], finished: [done] })
    expect(again.tasks.finished.map((task) => task.id)).toEqual(['bshell002'])
    const relisted: BackgroundTasks = { running: [{ ...done, status: 'running', elapsedMs: 0 }], finished: [] }
    expect(keepFinishedSubagentRows(first.memory, relisted, relisted).tasks.finished).toEqual([])
  })

  it('changes nothing with nothing remembered and no feed rows (no subagents)', () => {
    const lane: BackgroundTasks = { running: [], finished: [] }
    const kept = keepFinishedSubagentRows(EMPTY_FINISHED_SUBAGENT_ROWS, lane, lane)
    expect(kept.tasks).toBe(lane)
    expect(kept.memory).toBe(EMPTY_FINISHED_SUBAGENT_ROWS)
  })
})
