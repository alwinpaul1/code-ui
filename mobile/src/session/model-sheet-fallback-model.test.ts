import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClaudeModelList } from '../../../src/shared/claude-model-list-probe'
import type { AgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog-types'
import { createNativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'
import { parseAgentHudBeaconPayload, type AgentHudBeacon } from './agent-hud-beacon'
import { matchClaudeCatalogModelId } from './claude-model-identity'
import { discoveredClaudeCatalogModels } from './claude-model-discovery'
import { applyAgentHudBeaconFields } from './hud-beacon-fields'
import { activeModels, nameModelRowsFromAgent } from './mobile-chat-model-row-naming'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'
import { modelSheetLayout } from './model-sheet-layout'
import { sessionModelPillParts } from './session-model-pill'

// Claude Code 2.1.300 can move a session onto a fallback model. Its transcript
// then carries a system record `subtype: model_refusal_fallback` with
// `originalModel: claude-opus-5-5`, `fallbackModel: claude-opus-4-8`,
// `scope: session`, and the session really runs Opus 4.8: the beacon says
// `claude-opus-4-8` / "Opus 4.8" and the usage band paints `Opus 4.8 medium │`.
// The screen reader turns that row into the family word `opus` plus the name
// "Opus 4.8", and the screen pair outranks the beacon.
//
// On 0.9.146 the "Select model" sheet then read Fable 5.1 / Opus 4.8 ✓ /
// Sonnet 5.5 / Haiku 5.5: the `opus` ALIAS row, which Claude Code lists as
// "Opus 5.5", was renamed "Opus 4.8" and checked. That tells the user a tap on
// it gives 4.8, when it gives 5.5. The alias row must keep its own name, and
// the listed `claude-opus-4-8` row under More models is the running one.
//
// Screen: the real 2.1.295 capture of a 126-column fullscreen tab (see
// claude-status-line-band-without-turn-row.test.ts), with ONLY the band row's
// model text edited from `Opus 5.5 xhigh` to `Opus 4.8 medium`; the fallback
// itself was observed on Claude Code 2.1.300. Model list: Claude Code
// 2.1.295's own `list_models` answer.

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
}

const SCREEN = fixture('claude-usage-band-fullscreen-126-agent-finished-2.1.295.txt').split('\n')
// The band row opens with the pill cap glyph (U+E0B6) the mod paints.
const BAND_ROW = /^ \u{e0b6} Opus 5\.5 xhigh │/u

function withBandModel(text: string): string[] {
  const index = SCREEN.findLastIndex((line) => BAND_ROW.test(line))
  expect(index).toBeGreaterThan(-1)
  return SCREEN.map((line, at) => (at === index ? line.replace('Opus 5.5 xhigh', text) : line))
}

// Claude Code 2.1.277 with claude-hud, `orca terminal read --screen` 2026-09-19
// (claude-footer-without-status-line.test.ts), the badge's model text edited
// from `Opus 5 (1M context) xhigh` to the fallback's `Opus 4.8 medium`.
const RULE_80 = '─'.repeat(80)
const CLAUDE_HUD_FALLBACK = [
  '✻ Frolicking… (15m 36s · ↓ 56.6k tokens)',
  RULE_80,
  '❯',
  RULE_80,
  '  [Opus 4.8 medium | Max 20x] ██░░░░ 28% (275k/1.0M)',
  '  Usage ░░░░░░ 7% (resets 1:20 AM) | Weekly ██░░░░ 38% (resets Wed 7:00 PM)',
  '  ─────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×19 | ✓ Skill ×1',
  '  ⏵⏵ auto mode on · 1 shell · ← for agents'
]

const LISTED = parseClaudeModelList(fixture('claude-list-models-2.1.295.jsonl'))
const CATALOG: AgentSessionOptionCatalog = {
  models: discoveredClaudeCatalogModels(LISTED),
  modelApply: {}
}

// The beacon in the frame shape Claude Code's status-line payload is written
// in (hud-beacon-fields.test.ts), stating the fallback model it runs.
const FALLBACK_BEACON: AgentHudBeacon = (() => {
  const beacon = parseAgentHudBeaconPayload(
    'CUIHUD1 agent=claude sid=77954fea-1013-4225-b187-a8b3162a04ce model=claude-opus-4-8 name=Opus%204.8 effort=medium used=649540 win=1000000 pct=64',
    0
  )
  if (!beacon) {
    throw new Error('fallback beacon payload did not parse')
  }
  return beacon
})()

/** The chain the sheet runs: screen + beacon → reported pair → rows named for
 *  the agent → the checked row (withRunningModelSelected's matcher) → layout. */
function sheetFor(screen: readonly string[], beacon: AgentHudBeacon | null, catalog = CATALOG) {
  const hud = applyAgentHudBeaconFields(parseTerminalHudObservation(screen), beacon)
  expect(hud).not.toBeNull()
  const record = createNativeChatSessionOptionRecord('claude')
  const models = activeModels(catalog, record, hud!.modelId, hud!.modelLabel)
  const checked = matchClaudeCatalogModelId(
    { models: models.map((model) => ({ ...model, options: [] })), modelApply: {} },
    hud!.modelId!,
    hud!.modelLabel
  )
  const layout = modelSheetLayout(
    models.map((model) => ({
      value: model.id,
      label: model.label,
      ...(model.description ? { description: model.description } : {})
    }))
  )
  const pill = sessionModelPillParts({ model: hud!.modelId, label: hud!.modelLabel, effort: hud!.effort })
  return { hud: hud!, models, checked, layout: layout!, pill }
}

describe('a Claude session that fell back to an older model', () => {
  it('keeps the Opus row on Opus 5.5 and checks Opus 4.8 under More models when Claude falls back to Opus 4.8', () => {
    const sheet = sheetFor(withBandModel('Opus 4.8 medium'), FALLBACK_BEACON)
    // The screen pair as the reader gives it today: family word + the agent's name.
    expect(sheet.hud).toMatchObject({ modelId: 'opus', modelLabel: 'Opus 4.8', effort: 'medium' })

    const featuredOpus = sheet.layout.featured.find((row) => row.value === 'opus')
    expect(featuredOpus?.label).toBe('Opus 5.5')
    expect(sheet.checked).not.toBe('opus')
    expect(sheet.checked).toBe('claude-opus-4-8')
    expect(sheet.layout.more).toContainEqual({ value: 'claude-opus-4-8', label: 'Opus 4.8' })
    // No featured row claims to be 4.8.
    expect(sheet.layout.featured.map((row) => row.label)).not.toContain('Opus 4.8')
    // The pill states the model really running.
    expect(sheet.pill?.name).toBe('Opus 4.8')
  })

  it('keeps the Opus row on Opus 5.5 when a claude-hud badge names the fallback', () => {
    const sheet = sheetFor(CLAUDE_HUD_FALLBACK, FALLBACK_BEACON)
    expect(sheet.hud).toMatchObject({ modelId: 'opus', modelLabel: 'Opus 4.8' })
    expect(sheet.layout.featured.find((row) => row.value === 'opus')?.label).toBe('Opus 5.5')
    expect(sheet.checked).toBe('claude-opus-4-8')
    expect(sheet.layout.more).toContainEqual({ value: 'claude-opus-4-8', label: 'Opus 4.8' })
    expect(sheet.pill?.name).toBe('Opus 4.8')
  })

  it('still checks the Opus row when the band names the model the alias lists', () => {
    const sheet = sheetFor(SCREEN, null)
    expect(sheet.hud).toMatchObject({ modelId: 'opus', modelLabel: 'Opus 5.5' })
    expect(sheet.checked).toBe('opus')
    expect(sheet.layout.featured.find((row) => row.value === 'opus')?.label).toBe('Opus 5.5')
    expect(sheet.layout.more).toContainEqual({ value: 'claude-opus-4-8', label: 'Opus 4.8' })
  })

  it('still names the seed Opus row after the agent when no list was discovered', () => {
    const seed: AgentSessionOptionCatalog = {
      models: [
        { id: 'fable', label: 'Fable', options: [] },
        { id: 'opus', label: 'Opus', options: [] },
        { id: 'sonnet', label: 'Sonnet', options: [] },
        { id: 'haiku', label: 'Haiku', options: [] }
      ],
      modelApply: {}
    }
    const sheet = sheetFor(withBandModel('Opus 4.8 medium'), FALLBACK_BEACON, seed)
    expect(sheet.checked).toBe('opus')
    expect(sheet.models.find((row) => row.id === 'opus')?.label).toBe('Opus 4.8')
  })

  it('does not rename the Opus row to the fallback when no listed row is Opus 4.8', () => {
    // Degenerate list: the alias and nothing else for its family. The report
    // folds onto the alias, as a full id with no row of its own always has,
    // but the alias keeps its own "Opus 5.5": that is what a tap on it gives.
    const only: AgentSessionOptionCatalog = {
      models: CATALOG.models.filter((model) => model.id === 'opus' || model.id === 'sonnet'),
      modelApply: {}
    }
    const sheet = sheetFor(withBandModel('Opus 4.8 medium'), FALLBACK_BEACON, only)
    expect(sheet.checked).toBe('opus')
    expect(sheet.models.find((row) => row.id === 'opus')?.label).toBe('Opus 5.5')
    expect(sheet.pill?.name).toBe('Opus 4.8')
  })

  it('takes the fallback row on a host whose alias names another model', () => {
    // Bedrock-shaped rows (claude-model-identity.test.ts, 2.1.282 capture):
    // the one listed Opus 4.8 is the 1M row, so a non-1M report has no row of
    // its own and folds onto the alias, while a 1M one finds its row.
    const bedrock: AgentSessionOptionCatalog = {
      models: [
        { id: 'opus', label: 'Opus 5.5', options: [] },
        { id: 'eu.anthropic.claude-opus-4-8[1m]', label: 'Opus 4.8 (1M context)', options: [] }
      ],
      modelApply: {}
    }
    expect(matchClaudeCatalogModelId(bedrock, 'opus', 'Opus 4.8')).toBe('opus')
    expect(matchClaudeCatalogModelId(bedrock, 'opus', 'Opus 4.8 (1M context)')).toBe(
      'eu.anthropic.claude-opus-4-8[1m]'
    )
    expect(matchClaudeCatalogModelId(bedrock, 'opus', 'Opus 5.5')).toBe('opus')
  })

  it('names nothing on an empty list', () => {
    expect(nameModelRowsFromAgent([], 'opus', 'Opus 4.8')).toEqual([])
    expect(matchClaudeCatalogModelId({ models: [], modelApply: {} }, 'opus', 'Opus 4.8')).toBeNull()
  })
})
