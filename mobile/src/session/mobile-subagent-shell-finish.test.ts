import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeAgentHudChannelText } from './agent-hud-channel'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { CLAUDE_HUD_STATUSLINE_SCRIPT } from './agent-hud-launch-args'
import { parseClaudeRunningShellCount } from './claude-footer-shell-count'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'
import { mergeSubagentActivity, subagentWatchTargets } from './mobile-subagent-activity'
import { orcaTranscriptRows, recordsThrough, type RawSubagentRecord } from './fixtures/claude-subagent-transcripts-2.1.296'

// The last shell inside a subagent, ending while that subagent still works.
//
// A throwaway Claude Code 2.1.296 session (`tmux -L cuifinish`, 2026-10-10,
// session 3a763800, launched with the phone's own --settings flag) launched
// background agents "Finish probe C" and "Finish probe D". C ran `sleep 15` in
// the background (blrzd991j), D `sleep 20` (bchgdtvqt), and each then sat in a
// 40 s / 50 s foreground `ping`. Both shells ended inside those pings:
//
//  - the LEAD's transcript gained a `queue-operation` enqueue of each
//    notification within half a second of the end (20:11:10.526 and
//    20:11:14.004), the records in fixtures/claude-subagent-shell-finish-2.1.296/;
//  - the phone's unchanged status line beaconed `done=blrzd991j`, then
//    `done=blrzd991j,bchgdtvqt`, on its next 5 s tick (the payload below is a
//    real one, decoded from the beacon bytes that run wrote);
//  - the subagents' own files got the notification only when each ping
//    returned (20:11:35, 20:11:47), as `attachment` records Orca's reader
//    never decodes;
//  - the footer dropped its count at the second end: "· 1 shell" became no
//    count at all (screen-no-shell-count.txt), so the footer cannot say zero.

const here = (name: string) => fileURLToPath(new URL(`./fixtures/claude-subagent-shell-finish-2.1.296/${name}`, import.meta.url))
const records = (name: string) => JSON.parse(readFileSync(here(name), 'utf8')) as RawSubagentRecord[]

const SESSION = '3a763800-2942-4c7b-8951-6525fd388abc'
const AGENT_C = 'ab3b52b8fe9f6adfc'
const AGENT_D = 'a14e0b9521dbcd668'
const SHELL_C = 'blrzd991j'
const SHELL_D = 'bchgdtvqt'

const REAL_PAYLOAD =
  'CUIHUD1 agent=claude hk=1 hb=5 sid=3a763800-2942-4c7b-8951-6525fd388abc model=claude-opus-5-5 name=Opus%205.5 effort=medium used=60919 win=1000000 pct=6 h5=5:1791678000 d7=69:1791997200 done=blrzd991j,bchgdtvqt live='

/** C mid-ping (its launch answered, the ping sent) and D mid-ping. */
const cMidPing = () => orcaTranscriptRows(recordsThrough(records(`agent-c-${AGENT_C}.json`), 'c63637b9'))
const dMidPing = () => orcaTranscriptRows(recordsThrough(records(`agent-d-${AGENT_D}.json`), '7760fbc6'))

const LAUNCHED = Date.parse('2026-10-10T20:10:49.900Z')
/** 20:11:16, both shells over, both agents still pinging. */
const NOW = Date.parse('2026-10-10T20:11:16.000Z')

function agentRow(id: string, title: string): BackgroundTask {
  return { id, kind: 'agent', title, status: 'running', startedAt: LAUNCHED, elapsedMs: NOW - LAUNCHED }
}
const leadTasks = (): BackgroundTasks => ({
  running: [agentRow(AGENT_C, 'Finish probe C'), agentRow(AGENT_D, 'Finish probe D')],
  finished: []
})
const feeds = () =>
  new Map([
    [AGENT_C, cMidPing()],
    [AGENT_D, dMidPing()]
  ])
const shellIds = (tasks: readonly BackgroundTask[]) => tasks.filter((task) => task.kind === 'shell').map((task) => task.id)

const SHELLS: readonly string[] = ['sh', 'bash', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])]

function statusLinePayload(shell: string, transcriptPath: string): string {
  const status = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/claude-statusline-2.1.266.json', import.meta.url)), 'utf8')) as Record<string, unknown>
  const tty = join(mkdtempSync(join(tmpdir(), 'cuihud-finish-')), 'pty')
  const home = mkdtempSync(join(tmpdir(), 'cuihud-home-'))
  execFileSync(shell, ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], {
    input: JSON.stringify({ ...status, session_id: SESSION, transcript_path: transcriptPath }),
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: home, CUIHUD_TTY: tty },
    timeout: 20_000
  })
  const frames = decodeAgentHudChannelText(readFileSync(tty, 'latin1'))
  expect(frames).toHaveLength(1)
  return frames[0]!
}

describe("a subagent's last shell, ending while the subagent still works", () => {
  it('is named finished by the status line, read off the lead transcript the shell end was queued in', () => {
    for (const shell of SHELLS) {
      const beacon = parseAgentHudBeaconPayload(statusLinePayload(shell, here(`${SESSION}.jsonl`)))
      expect(beacon?.doneTaskIds, shell).toEqual([SHELL_C, SHELL_D])
      // Neither shell was launched by the lead, so neither is "live" there.
      expect(beacon?.runningTaskIds, shell).toEqual([])
    }
  })

  it('cannot be read off the screen: the footer paints no count once the last shell ends', () => {
    const rows = readFileSync(here('screen-no-shell-count.txt'), 'utf8').split('\n')
    expect(rows.some((row) => row.includes('Finish probe C'))).toBe(true)
    expect(parseClaudeRunningShellCount(rows)).toBeNull()
  })

  it('leaves Running for Finished once the real beacon names it, though nothing else does', () => {
    const blind = mergeSubagentActivity(leadTasks(), feeds(), { now: NOW, liveShellCount: null })
    expect(shellIds(blind.running)).toEqual([SHELL_C, SHELL_D])

    const done = parseAgentHudBeaconPayload(REAL_PAYLOAD)!.doneTaskIds
    const merged = mergeSubagentActivity(leadTasks(), feeds(), { now: NOW, liveShellCount: null, finishedTaskIds: done })
    expect(merged.running.map((task) => task.id)).toEqual([AGENT_C, AGENT_D])
    expect(merged.finished.map((task) => [task.id, task.kind, task.status])).toEqual([
      [SHELL_C, 'shell', 'completed'],
      [SHELL_D, 'shell', 'completed']
    ])
  })

  it('retires only the shell the beacon names: after the first end, D stays running', () => {
    const merged = mergeSubagentActivity(leadTasks(), feeds(), {
      now: Date.parse('2026-10-10T20:11:12.000Z'),
      liveShellCount: 1,
      finishedTaskIds: parseAgentHudBeaconPayload(REAL_PAYLOAD.replace(',bchgdtvqt', ''))!.doneTaskIds
    })
    expect(shellIds(merged.running)).toEqual([SHELL_D])
    expect(shellIds(merged.finished)).toEqual([SHELL_C])
  })

  it('an empty or absent done= changes nothing', () => {
    for (const payload of [REAL_PAYLOAD.replace(' done=blrzd991j,bchgdtvqt', ''), REAL_PAYLOAD.replace('done=blrzd991j,bchgdtvqt', 'done=')]) {
      const done = parseAgentHudBeaconPayload(payload)!.doneTaskIds
      expect(done).toEqual([])
      const merged = mergeSubagentActivity(leadTasks(), feeds(), { now: NOW, finishedTaskIds: done })
      expect(shellIds(merged.running)).toEqual([SHELL_C, SHELL_D])
    }
  })

  it('on a Codex tab: its notify beacon names no finished task and no subagent file is read', () => {
    const codex = parseAgentHudBeaconPayload('CUIHUD1 agent=codex sid=01a08736-aaaa-bbbb-cccc-000000000001 model=gpt-6-astra effort=high used=22147 win=258400')
    expect(codex?.doneTaskIds).toEqual([])
    expect(subagentWatchTargets({ agent: 'codex', running: leadTasks().running, parentTranscriptPath: `/x/${SESSION}.jsonl` })).toEqual([])
  })
})
