import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'
import {
  mergeSubagentActivity,
  SUBAGENT_WATCH_CAP,
  subagentLatestStep,
  subagentWatchTargets
} from './mobile-subagent-activity'
import { parseClaudeRunningShellCount } from './claude-footer-shell-count'
import { SUBAGENT_SHELL_SCREEN, screenRows } from './fixtures/claude-subagent-shells-2.1.296'
import {
  orcaTranscriptRows,
  PROBE_A_AGENT,
  PROBE_A_SHELL,
  PROBE_B_AGENT,
  PROBE_B_SHELL,
  PROBE_B_STOPPED_SHELL,
  probeARecords,
  probeBRecords,
  recordsThrough
} from './fixtures/claude-subagent-transcripts-2.1.296'

// Real subagent transcripts, Claude Code 2.1.296 (fixtures/claude-subagent-transcripts-2.1.296.ts),
// as Orca 1.4.224's reader hands them to the phone.

const LAUNCHED = Date.parse('2026-10-10T18:45:13.000Z')

function agentRow(id: string, title: string, now: number): BackgroundTask {
  return { id, kind: 'agent', title, status: 'running', startedAt: LAUNCHED, elapsedMs: now - LAUNCHED }
}

function leadTasks(now: number, extra: Partial<BackgroundTasks> = {}): BackgroundTasks {
  return {
    running: [agentRow(PROBE_A_AGENT, 'Sleep probe A', now), agentRow(PROBE_B_AGENT, 'Sleep probe B', now)],
    finished: [],
    ...extra
  }
}

/** A's transcript at 18:45:17.942, its `cd … | head -3` call sent, no answer yet. */
const aMidCommand = () => orcaTranscriptRows(recordsThrough(probeARecords(), 'b8efa9d2'))
/** B's transcript right after its TaskStop answered (18:45:27.964). */
const bAfterStop = () => orcaTranscriptRows(recordsThrough(probeBRecords(), '1f61a477'))

const feeds = (entries: [string, NativeChatMessage[]][]) => new Map(entries)

describe("a background agent's row shows its latest step, as the Claude app does", () => {
  it('titles a running agent "Running cd /private/tmp && ls | head -3" while that command runs', () => {
    const now = Date.parse('2026-10-10T18:45:18.200Z')
    const merged = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_A_AGENT, aMidCommand()]]), { now })
    const a = merged.running.find((task) => task.id === PROBE_A_AGENT)!
    expect(a.latestStep).toBe('Running cd /private/tmp && ls | head -3')
    // The spawn description stays on the row for the screen reader and the Stop.
    expect(a.title).toBe('Sleep probe A')
  })

  it('reads the first line of a multi-line command, and the run wording for any other tool', () => {
    const call = (name: string, input: Record<string, unknown>): NativeChatMessage => ({
      id: name,
      role: 'assistant',
      timestamp: 1,
      source: 'transcript',
      blocks: [{ type: 'tool-call', name, input }]
    })
    expect(subagentLatestStep([call('Bash', { command: 'cd /private/tmp\nls -la', description: 'List' })])).toBe('Running cd /private/tmp')
    expect(subagentLatestStep([call('ToolSearch', { query: 'select:TaskStop', max_results: 5 })])).toBe('Running ToolSearch select:TaskStop')
    // B's real TaskStop: no JSON in a title.
    expect(subagentLatestStep([call('TaskStop', { task_id: 'bnj50z9e4' })])).toBe('Running TaskStop')
  })

  it("keeps the description when the agent's transcript is unread, refused, or holds no call yet", () => {
    const now = Date.parse('2026-10-10T18:45:18.200Z')
    const tasks = leadTasks(now)
    // No feed at all: the very same object, so nothing downstream re-renders for it.
    expect(mergeSubagentActivity(tasks, new Map(), { now })).toBe(tasks)
    const onlyPrompt = orcaTranscriptRows(recordsThrough(probeARecords(), '3dbeb752'))
    const merged = mergeSubagentActivity(tasks, feeds([[PROBE_A_AGENT, onlyPrompt], [PROBE_B_AGENT, []]]), { now })
    expect(merged.running.map((task) => [task.id, task.title, task.latestStep])).toEqual([
      [PROBE_A_AGENT, 'Sleep probe A', undefined],
      [PROBE_B_AGENT, 'Sleep probe B', undefined]
    ])
  })
})

describe('shells started inside subagents are listed as their own rows', () => {
  it("lists A's background sleep under A with its live time, and no Stop", () => {
    const now = Date.parse('2026-10-10T18:46:35.616Z')
    const merged = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_A_AGENT, aMidCommand()]]), { now })
    expect(merged.running.map((task) => task.id)).toEqual([PROBE_A_AGENT, PROBE_A_SHELL, PROBE_B_AGENT])
    const shell = merged.running[1]!
    expect(shell).toMatchObject({ kind: 'shell', title: 'Start a 120-second background sleep', status: 'running', stoppable: false })
    // Launched 18:45:15.616: 1m 20s later.
    expect(shell.elapsedMs).toBe(80_000)
  })

  it("moves B's stopped shell to Finished and keeps its live one running", () => {
    const now = Date.parse('2026-10-10T18:45:29.000Z')
    const merged = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_B_AGENT, bAfterStop()]]), { now })
    expect(merged.running.map((task) => task.id)).toEqual([PROBE_A_AGENT, PROBE_B_AGENT, PROBE_B_SHELL])
    expect(merged.finished.map((task) => [task.id, task.kind, task.status])).toEqual([[PROBE_B_STOPPED_SHELL, 'shell', 'completed']])
  })

  it("cannot see a subagent shell's notification (Orca drops the isMeta record), so the footer retires it", () => {
    // B's whole transcript: bbg412m8r's notification reached B at 18:45:46, as
    // an isMeta user record, and the phone never receives it.
    const rows = orcaTranscriptRows(probeBRecords())
    expect(JSON.stringify(rows)).not.toContain('task-notification')
    const now = Date.parse('2026-10-10T18:45:50.000Z')
    const both = feeds([[PROBE_A_AGENT, aMidCommand()], [PROBE_B_AGENT, rows]])
    const unfitted = mergeSubagentActivity(leadTasks(now), both, { now })
    expect(unfitted.running.filter((task) => task.kind === 'shell').map((task) => task.id)).toEqual([PROBE_A_SHELL, PROBE_B_SHELL])
    // A real footer reading "· 1 shell" (2.1.296): one of the two listed is
    // over, and which is unknown, so the older one (A's, 18:45:15.616) goes.
    const footer = parseClaudeRunningShellCount(screenRows(SUBAGENT_SHELL_SCREEN))
    expect(footer).toBe(1)
    const fitted = mergeSubagentActivity(leadTasks(now), both, { now, liveShellCount: footer })
    expect(fitted.running.filter((task) => task.kind === 'shell').map((task) => task.id)).toEqual([PROBE_B_SHELL])
    expect(fitted.finished.find((task) => task.id === PROBE_A_SHELL)?.status).toBe('finished')
  })

  it('keeps a shell the footer retired retired while a dialog covers the footer', () => {
    const rows = orcaTranscriptRows(probeBRecords())
    const now = Date.parse('2026-10-10T18:45:50.000Z')
    const both = feeds([[PROBE_A_AGENT, aMidCommand()], [PROBE_B_AGENT, rows]])
    // The footer read "1 shell" at 18:45:48 and has left the screen since.
    const covered = mergeSubagentActivity(leadTasks(now), both, {
      now,
      liveShellCount: null,
      heldShellCount: { count: 1, at: Date.parse('2026-10-10T18:45:48.000Z') }
    })
    expect(covered.running.filter((task) => task.kind === 'shell').map((task) => task.id)).toEqual([PROBE_B_SHELL])
    // A held reading says nothing about a shell launched after it was taken.
    const early = mergeSubagentActivity(leadTasks(now), both, {
      now,
      liveShellCount: null,
      heldShellCount: { count: 0, at: Date.parse('2026-10-10T18:45:20.000Z') }
    })
    expect(early.running.filter((task) => task.kind === 'shell').map((task) => task.id)).toEqual([PROBE_A_SHELL, PROBE_B_SHELL])
  })

  it("retires a subagent shell the agent's Stop hook no longer lists, once that list postdates its launch", () => {
    const rows = orcaTranscriptRows(probeBRecords())
    const now = Date.parse('2026-10-10T18:45:50.000Z')
    const answered = Date.parse('2026-10-10T18:45:48.000Z')
    const merged = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_B_AGENT, rows]]), {
      now,
      stopRunning: { ids: [PROBE_A_SHELL], at: answered }
    })
    expect(merged.running.map((task) => task.id)).not.toContain(PROBE_B_SHELL)
    // A list older than the launch says nothing about it.
    const stale = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_B_AGENT, rows]]), {
      now,
      stopRunning: { ids: [], at: Date.parse('2026-10-10T18:45:10.000Z') }
    })
    expect(stale.running.map((task) => task.id)).toContain(PROBE_B_SHELL)
  })

  it('takes listed shells out of the "+N shells in subagents" count, and drops the line when all are listed', () => {
    const now = Date.parse('2026-10-10T18:45:29.000Z')
    const both = feeds([[PROBE_A_AGENT, aMidCommand()], [PROBE_B_AGENT, bAfterStop()]])
    const all = mergeSubagentActivity(leadTasks(now, { shellsInSubagents: 2 }), both, { now, liveShellCount: 2 })
    expect(all.running.filter((task) => task.kind === 'shell')).toHaveLength(2)
    expect(all.shellsInSubagents).toBeUndefined()
    const one = mergeSubagentActivity(leadTasks(now, { shellsInSubagents: 2 }), feeds([[PROBE_A_AGENT, aMidCommand()]]), {
      now,
      liveShellCount: 2
    })
    expect(one.shellsInSubagents).toBe(1)
  })

  it('never lists a shell twice when the lead already lists that id', () => {
    const now = Date.parse('2026-10-10T18:45:29.000Z')
    const lead = leadTasks(now)
    lead.running.push({ id: PROBE_A_SHELL, kind: 'shell', title: 'sleep 120', status: 'running', startedAt: null, elapsedMs: null })
    const merged = mergeSubagentActivity(lead, feeds([[PROBE_A_AGENT, aMidCommand()]]), { now })
    expect(merged.running.filter((task) => task.id === PROBE_A_SHELL)).toHaveLength(1)
  })
})

describe('which agents the sheet reads', () => {
  const now = Date.parse('2026-10-10T18:45:20.000Z')
  const parent = '/Users/me/.claude/projects/-p/59454ec6-195e-419b-92a4-d1c97be7ea47.jsonl'

  it('reads only running Claude subagents, at most six', () => {
    const running: BackgroundTask[] = Array.from({ length: 8 }, (_unused, index) => agentRow(`a${index}`, `Agent ${index}`, now))
    running.push({ id: PROBE_A_SHELL, kind: 'shell', title: 'sleep', status: 'running', startedAt: null, elapsedMs: null })
    const targets = subagentWatchTargets({ agent: 'claude', running, parentTranscriptPath: parent })
    expect(targets).toHaveLength(SUBAGENT_WATCH_CAP)
    expect(SUBAGENT_WATCH_CAP).toBe(6)
    expect(targets[0]).toMatchObject({
      agentId: 'a0',
      sessionId: 'agent-a0',
      transcriptPath: '/Users/me/.claude/projects/-p/59454ec6-195e-419b-92a4-d1c97be7ea47/subagents/agent-a0.jsonl'
    })
  })

  it('reads nothing on a Codex tab, for no running agent, or for a placeholder row', () => {
    expect(subagentWatchTargets({ agent: 'codex', running: [agentRow('a0', 'x', now)], parentTranscriptPath: parent })).toEqual([])
    expect(subagentWatchTargets({ agent: 'claude', running: [], parentTranscriptPath: parent })).toEqual([])
    const placeholder: BackgroundTask = { id: 'host-monitoring', kind: 'shell', title: 'x', status: 'running', startedAt: null, elapsedMs: null }
    expect(subagentWatchTargets({ agent: 'claude', running: [placeholder], parentTranscriptPath: parent })).toEqual([])
  })
})

describe("a subagent's last shell leaves Running when the status line says it finished", () => {
  it('moves B\'s shell to Finished from the beacon\'s done= ids, with no footer count and B still running', () => {
    // B's whole transcript as Orca serves it: the completion is not in it.
    const rows = orcaTranscriptRows(probeBRecords())
    const now = Date.parse('2026-10-10T18:45:50.000Z')
    const unread = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_B_AGENT, rows]]), { now, liveShellCount: null })
    expect(unread.running.map((task) => task.id)).toContain(PROBE_B_SHELL)
    const merged = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_B_AGENT, rows]]), {
      now,
      liveShellCount: null,
      finishedTaskIds: [PROBE_B_SHELL]
    })
    expect(merged.running.map((task) => task.id)).toEqual([PROBE_A_AGENT, PROBE_B_AGENT])
    expect(merged.finished.find((task) => task.id === PROBE_B_SHELL)).toMatchObject({ kind: 'shell', status: 'completed', stoppable: false })
  })

  it('leaves a shell running when the finished ids name other tasks, or none', () => {
    const rows = orcaTranscriptRows(probeBRecords())
    const now = Date.parse('2026-10-10T18:45:50.000Z')
    for (const finishedTaskIds of [[], [PROBE_A_SHELL, PROBE_A_AGENT]]) {
      const merged = mergeSubagentActivity(leadTasks(now), feeds([[PROBE_B_AGENT, rows]]), { now, finishedTaskIds })
      expect(merged.running.map((task) => task.id)).toContain(PROBE_B_SHELL)
    }
  })
})
