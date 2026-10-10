import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { RawSubagentRecord } from './claude-subagent-transcripts-2.1.296'

// Background work that ends while the LEAD is busy, from a throwaway Claude Code
// 2.1.296 session driven in its own tmux server (`tmux -L cuitasks`, 110×50,
// `env -i`, the phone's real --settings flag from buildClaudeHudSettingsJson('darwin')
// with CUIHUD_TTY pointed at a scratch file), 2026-10-11, session 15e64a5d. Nothing
// was written to the user's configuration and the server was killed afterwards.
//
// At 23:04:08Z the lead launched, in one response: "Busy lead shell A" (`sleep 20`,
// be35dkrdx), "Busy lead shell B" (`sleep 45`, bvaf1cakl), agent "Busy probe quick"
// (add2052be12e5e13c: `sleep 25` in the background, b7zau4jdq, then hands back at
// once), agent "Busy probe slow" (a6aa230045f63f331: a 50 s foreground `ping`), and
// then sat in its own 75 s foreground `ping` until 23:05:25. Every completion landed
// while the lead was in that ping, so none of them reached the lead's transcript as
// a user turn: each is a `queue-operation` enqueue (lead-queue-operations.jsonl),
// delivered later as an `attachment` Orca's reader drops.
//
//   23:04:13.4  quick agent hands back (SubagentStop; enqueue add2052…)
//   23:04:29.1  lead shell A ends (enqueue be35dkrdx); footer 3 shells → 2
//   23:04:37.1  quick agent's shell ends (enqueue b7zau4jdq), which RESUMES the quick
//               agent (SubagentStart again at 23:04:37.2); footer 2 → 1
//   23:04:38.8  quick agent hands back again (enqueue add2052… a second time)
//   23:04:54.4  lead shell B ends (enqueue bvaf1cakl); the footer drops its count and
//               shows "(shift+tab to cycle)" in its place (screen-footer-no-count.txt)
//   23:05:04.4  slow agent hands back (enqueue a6aa…)
//
// beacon-payloads.txt: every distinct frame the unchanged status line and Stop hook
// wrote, decoded from the captured bytes, in order. `done=` names the agents' ids as
// well as the shells'.
//
// The screen-dialog-*.txt, screen-agent-panel-*.txt and screen-footer-<width>.txt
// files are `tmux capture-pane -p` of the same session (blank rows kept; Orca's
// `terminal.read --screen` drops them): Claude Code's own Background dialog, opened
// with ↓ (which focuses the footer's "N shells" pill, screen-shells-pill-focused.txt)
// and Enter; after `x` on a row; after Esc; while the lead worked; at 48 columns; and
// the footer at 48, 40, 34 and 28 columns with two shells running.

const here = (name: string) => fileURLToPath(new URL(`./claude-busy-lead-tasks-2.1.296/${name}`, import.meta.url))

export const BUSY_SESSION = '15e64a5d-26e7-4d65-9b2d-3ef2f4e1fae8'
export const LEAD_SHELL_A = 'be35dkrdx'
export const LEAD_SHELL_B = 'bvaf1cakl'
export const QUICK_AGENT = 'add2052be12e5e13c'
export const QUICK_AGENT_SHELL = 'b7zau4jdq'
export const SLOW_AGENT = 'a6aa230045f63f331'

/** When the lead's launch response was written (its first tool call). */
export const BUSY_LAUNCHED_AT = Date.parse('2026-10-10T23:04:08.931Z')

export const busyRecords = (name: 'lead' | 'agent-quick' | 'agent-slow'): RawSubagentRecord[] => {
  const file = name === 'lead' ? 'lead.json' : name === 'agent-quick' ? `agent-quick-${QUICK_AGENT}.json` : `agent-slow-${SLOW_AGENT}.json`
  return JSON.parse(readFileSync(here(file), 'utf8')) as RawSubagentRecord[]
}

/** A captured screen, as rows. `dropBlank` gives the rows the way Orca's screen read
 *  serves them. */
export function busyScreen(name: string, options: { dropBlank?: boolean } = {}): string[] {
  const rows = readFileSync(here(name), 'utf8').replace(/\n$/, '').split('\n')
  return options.dropBlank ? rows.filter((row) => row.trim() !== '') : rows
}

/** The decoded beacon frames, in the order they were written. */
export const busyBeaconPayloads = (): string[] =>
  readFileSync(here('beacon-payloads.txt'), 'utf8').split('\n').filter((line) => line.trim() !== '')
