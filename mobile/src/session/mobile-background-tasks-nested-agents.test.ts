import { describe, expect, it } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import {
  NESTED_REVIEWERS,
  OWN_AGENTS,
  ROSTER_FIRST_OBSERVED,
  ownAgentLaunch,
  rosterRow
} from './fixtures/claude-orchestration-2.1.281'

// Session 967668df (Claude Code 2.1.281), 2026-09-26 00:00 UTC: five of the
// lead's own agents running, and reviewers those agents started coming and
// going. Claude Code keeps ONE task registry for the whole process — every
// subagent's context is handed the lead's `taskRegistry` — so its SubagentStart
// hook fires on the lead's pane for a reviewer too, and Orca's roster
// (`agentStatus.subagents`) lists it beside the lead's own agents. Nothing on
// the row says which is which: at the lead's Stop at 00:53:36 two reviewers
// (spawnDepth 2) got descriptions from the same `background_tasks` payload as
// the lead's agents did. Claude Code's own agent panel lists only the lead's
// agents at the top level and folds a reviewer under its parent as "(+N)".
//
// What tells them apart on the phone is the lead's transcript: it holds the
// launch of every agent the lead started, and never a reviewer's.

const NOW = Date.parse('2026-09-26T00:05:00.000Z')
const pane = (subagents: AgentSubagentSnapshot[]): BackgroundTaskHostStatus => ({ state: 'working', subagents })

const ownRows = (): AgentSubagentSnapshot[] =>
  Object.values(OWN_AGENTS).map((agent) => rosterRow(agent.id, ROSTER_FIRST_OBSERVED[agent.id]!, `[description of ${agent.id}]`))
const reviewerRow = (reviewer: { id: string; first: string }): AgentSubagentSnapshot =>
  rosterRow(reviewer.id, Date.parse(reviewer.first))

/** What the phone had read by 00:05: the launch of abe6 is in the loaded
 *  window; a776, acf3 and adfd went by in an earlier window it read this
 *  session; a441 was running before the phone first looked. */
const window = ownAgentLaunch(OWN_AGENTS.abe6)
const provenance = {
  ownAgentIds: [OWN_AGENTS.a776.id, OWN_AGENTS.acf3.id, OWN_AGENTS.adfd.id, OWN_AGENTS.abe6.id],
  preexistingAgentIds: [OWN_AGENTS.a441.id]
}

describe("the running-tasks count is the session's own work, not its agents' reviewers", () => {
  it('counts the five agents the session launched, not the reviewers those agents started', () => {
    const roster = [...ownRows(), reviewerRow(NESTED_REVIEWERS.a874), reviewerRow(NESTED_REVIEWERS.a3a4)]

    const tasks = deriveBackgroundTasks(window, NOW, pane(roster), { agentProvenance: provenance })

    expect(tasks.running.map((task) => task.id).sort()).toEqual(Object.values(OWN_AGENTS).map((agent) => agent.id).sort())
  })

  it('holds the count still while a reviewer starts and finishes', () => {
    const counts = [
      [...ownRows()],
      [...ownRows(), reviewerRow(NESTED_REVIEWERS.a3a4)],
      [...ownRows(), reviewerRow(NESTED_REVIEWERS.a3a4), reviewerRow(NESTED_REVIEWERS.aba3)],
      [...ownRows(), reviewerRow(NESTED_REVIEWERS.aba3)],
      [...ownRows()]
    ].map((roster) => deriveBackgroundTasks(window, NOW, pane(roster), { agentProvenance: provenance }).running.length)

    expect(counts).toEqual([5, 5, 5, 5, 5])
  })

  it('still counts an agent that was already running when the phone first looked', () => {
    // a441 launched at 19:31, hours above anything the phone has read. The
    // phone cannot place it, so a row it found already running keeps the
    // benefit of the doubt; only a row that APPEARS while the phone watches
    // the lead's transcript, with no launch there, is known not to be the
    // lead's.
    const tasks = deriveBackgroundTasks([], NOW, pane([rosterRow(OWN_AGENTS.a441.id, ROSTER_FIRST_OBSERVED[OWN_AGENTS.a441.id]!)]), {
      agentProvenance: { ownAgentIds: [], preexistingAgentIds: [OWN_AGENTS.a441.id] }
    })

    expect(tasks.running.map((task) => task.id)).toEqual([OWN_AGENTS.a441.id])
  })

  it('counts a teammate the roster tracks, which no Agent launch names but no subagent can start', () => {
    // Teammate ids are `a<name>-<hex>`, and Claude Code refuses a teammate
    // spawned from inside a subagent (`subagent_nested_teammate`), so one on
    // the roster is always the lead's.
    const teammate = rosterRow('areviewer-0f3a9c1d2e4b5a6c', NOW - 60_000)

    const tasks = deriveBackgroundTasks([], NOW, pane([teammate]), { agentProvenance: { ownAgentIds: [], preexistingAgentIds: [] } })

    expect(tasks.running.map((task) => task.id)).toEqual([teammate.id])
  })

  it('counts every roster row on a tab whose reader cannot place them', () => {
    // A Codex transcript records no launch the phone reads, so the caller
    // passes no provenance and the roster is taken as it stands, as before.
    const roster = [...ownRows(), reviewerRow(NESTED_REVIEWERS.a3a4)]

    const tasks = deriveBackgroundTasks([], NOW, pane(roster), {})

    expect(tasks.running).toHaveLength(6)
  })
})
