import { describe, expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog'
import type {
  AgentSessionOptionCatalog,
  CatalogOption
} from '../../../src/shared/agent-session-option-catalog-types'
import { claudeEffortSupport, withRunningClaudeModelEfforts } from './claude-running-model-efforts'

// Tables and canonical ids as read out of Claude Code 2.1.282 (2026-09-25).
const SEED = getAgentSessionOptionCatalog('claude')!

function effortValues(catalog: AgentSessionOptionCatalog, modelId: string): string[] | null {
  const effort = catalog.models.find((model) => model.id === modelId)?.options.find((option) => option.id === 'effort')
  return effort?.kind.type === 'select' ? effort.kind.choices.map((choice) => String(choice.value)) : null
}

function effortDefault(options: readonly CatalogOption[]): unknown {
  const effort = options.find((option) => option.id === 'effort')
  return effort?.kind.type === 'select' ? effort.kind.defaultValue : undefined
}

function effortOption(values: string[], defaultValue: string): CatalogOption {
  return {
    id: 'effort',
    label: 'Effort',
    category: 'thought_level',
    kind: { type: 'select', choices: values.map((value) => ({ value, label: value })), defaultValue },
    apply: { midSession: { kind: 'command', build: (value) => `/effort ${String(value)}` } }
  }
}

describe('what Claude Code refuses on the model a session reports', () => {
  it('refuses xhigh, and so Ultracode, on Opus 4.6 and Sonnet 4.6 however the id is dressed', () => {
    const noXhigh = { effort: true, max: true, xhigh: false }
    expect(claudeEffortSupport('claude-opus-4-6', null)).toEqual(noXhigh)
    expect(claudeEffortSupport('eu.anthropic.claude-opus-4-6', null)).toEqual(noXhigh)
    expect(claudeEffortSupport('eu.anthropic.claude-sonnet-4-6[1m]', null)).toEqual(noXhigh)
    expect(claudeEffortSupport('us.anthropic.claude-sonnet-4-6-v1:0', null)).toEqual(noXhigh)
  })

  it('refuses max as well on Opus 4.5, and all effort on the models before it', () => {
    expect(claudeEffortSupport('claude-opus-4-5-20251101', null)).toEqual({ effort: true, max: false, xhigh: false })
    const none = { effort: false, max: false, xhigh: false }
    expect(claudeEffortSupport('claude-sonnet-4-5-20250929', null)).toEqual(none)
    expect(claudeEffortSupport('claude-haiku-4-5', null)).toEqual(none)
    expect(claudeEffortSupport('claude-opus-4-1-20250805', null)).toEqual(none)
    expect(claudeEffortSupport('claude-opus-4-20250514', null)).toEqual(none)
    expect(claudeEffortSupport('claude-sonnet-4-20250514', null)).toEqual(none)
    expect(claudeEffortSupport('claude-3-7-sonnet-20250219', null)).toEqual(none)
  })

  it('knows of nothing refused on Opus 4.7 and newer, or on Fable', () => {
    expect(claudeEffortSupport('claude-opus-4-7', null)).toBeNull()
    expect(claudeEffortSupport('eu.anthropic.claude-opus-4-8[1m]', null)).toBeNull()
    expect(claudeEffortSupport('eu.anthropic.claude-opus-5-5[1m]', null)).toBeNull()
    expect(claudeEffortSupport('global.anthropic.claude-fable-5-1', null)).toBeNull()
    expect(claudeEffortSupport('eu.anthropic.claude-sonnet-5', null)).toBeNull()
  })

  it('does not guess at a model it has no table entry for', () => {
    expect(claudeEffortSupport('claude-something-9', null)).toBeNull()
    expect(claudeEffortSupport('', null)).toBeNull()
    expect(claudeEffortSupport('opus', null)).toBeNull()
    expect(claudeEffortSupport('opus', 'Opus')).toBeNull()
  })

  it('reads the version from the badge label when the id names only a family', () => {
    expect(claudeEffortSupport('opus', 'Opus 4.6')).toEqual({ effort: true, max: true, xhigh: false })
    expect(claudeEffortSupport('sonnet', 'Sonnet 4.6 (1M context)')).toEqual({ effort: true, max: true, xhigh: false })
    expect(claudeEffortSupport('sonnet', 'Sonnet 4.5')).toEqual({ effort: false, max: false, xhigh: false })
    expect(claudeEffortSupport('opus', 'Opus 5.5')).toBeNull()
  })

  it('trusts a full id over a label that disagrees with it', () => {
    expect(claudeEffortSupport('claude-opus-5-5', 'Opus 4.6')).toBeNull()
  })
})

describe('the running model offers only the levels Claude Code allows it', () => {
  it('cuts the seed Opus row for Opus 4.5 and leaves every other row alone', () => {
    const catalog = withRunningClaudeModelEfforts(SEED, 'claude-opus-4-5-20251101', 'Opus 4.5')
    expect(effortValues(catalog, 'opus')).toEqual(['low', 'medium', 'high'])
    expect(effortValues(catalog, 'sonnet')).toEqual(effortValues(SEED, 'sonnet'))
    expect(effortValues(catalog, 'fable')).toEqual(effortValues(SEED, 'fable'))
  })

  it('drops the effort row on Sonnet 4.5 and keeps the rest of the model', () => {
    const withFast: AgentSessionOptionCatalog = {
      ...SEED,
      models: SEED.models.map((model) =>
        model.id === 'sonnet'
          ? { ...model, options: [...model.options, SEED.models.find((row) => row.id === 'opus')!.options[1]!] }
          : model
      )
    }
    const catalog = withRunningClaudeModelEfforts(withFast, 'claude-sonnet-4-5', null)
    const sonnet = catalog.models.find((model) => model.id === 'sonnet')!
    expect(sonnet.options.map((option) => option.id)).toEqual(['fastMode'])
  })

  it('leaves the catalog untouched with no report, an unknown model, or a fully supported one', () => {
    expect(withRunningClaudeModelEfforts(SEED, null, null)).toBe(SEED)
    expect(withRunningClaudeModelEfforts(SEED, 'claude-something-9', null)).toBe(SEED)
    expect(withRunningClaudeModelEfforts(SEED, 'claude-opus-5-5', 'Opus 5.5')).toBe(SEED)
  })

  it('believes a row the host listed under the exact id that runs', () => {
    // The host's list is Claude Code's own answer for that model, capability
    // overrides included, so a Sonnet 4.6 it lists with xhigh keeps xhigh.
    const listed: AgentSessionOptionCatalog = {
      ...SEED,
      models: [{ id: 'eu.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6', options: [effortOption(['low', 'high', 'xhigh'], 'high')] }]
    }
    expect(withRunningClaudeModelEfforts(listed, 'eu.anthropic.claude-sonnet-4-6', 'Sonnet 4.6')).toBe(listed)
  })

  it('believes a host alias whose own label names the model that runs, and no other', () => {
    const aliased = (label: string): AgentSessionOptionCatalog => ({
      ...SEED,
      models: [{ id: 'opus', label, options: [effortOption(['low', 'high', 'xhigh'], 'high')] }]
    })
    const opus46 = aliased('Opus 4.6')
    expect(withRunningClaudeModelEfforts(opus46, 'eu.anthropic.claude-opus-4-6', 'Opus 4.6')).toBe(opus46)
    expect(effortValues(withRunningClaudeModelEfforts(aliased('Opus 5.5'), 'eu.anthropic.claude-opus-4-6', 'Opus 4.6'), 'opus')).toEqual([
      'low',
      'high'
    ])
  })

  it('moves a default the model refuses to high, or else the first level left', () => {
    const catalog = (options: CatalogOption[]): AgentSessionOptionCatalog => ({
      ...SEED,
      models: [{ id: 'opus', label: 'Opus', options }]
    })
    const toHigh = withRunningClaudeModelEfforts(catalog([effortOption(['low', 'high', 'xhigh', 'max'], 'max')]), 'claude-opus-4-5', null)
    expect(effortDefault(toHigh.models[0]!.options)).toBe('high')
    const toFirst = withRunningClaudeModelEfforts(catalog([effortOption(['medium', 'xhigh'], 'xhigh')]), 'claude-opus-4-6', null)
    expect(effortDefault(toFirst.models[0]!.options)).toBe('medium')
    const kept = withRunningClaudeModelEfforts(catalog([effortOption(['low', 'xhigh'], 'low')]), 'claude-opus-4-6', null)
    expect(effortDefault(kept.models[0]!.options)).toBe('low')
  })

  it('drops an effort row left with no level at all', () => {
    const onlyRefused: AgentSessionOptionCatalog = {
      ...SEED,
      models: [{ id: 'opus', label: 'Opus', options: [effortOption(['xhigh', 'ultracode'], 'xhigh')] }]
    }
    expect(withRunningClaudeModelEfforts(onlyRefused, 'claude-opus-4-6', null).models[0]!.options).toEqual([])
  })

  it('copes with a model that has no options and a catalog with no models', () => {
    const bare: AgentSessionOptionCatalog = { ...SEED, models: [{ id: 'opus', label: 'Opus', options: [] }] }
    expect(withRunningClaudeModelEfforts(bare, 'claude-opus-4-6', null).models[0]!.options).toEqual([])
    const empty: AgentSessionOptionCatalog = { ...SEED, models: [] }
    const cut = withRunningClaudeModelEfforts(empty, 'claude-opus-4-6', null)
    expect(cut.models).toEqual([])
    const fallback = cut.unknownModelOptions?.find((option) => option.id === 'effort')
    expect(fallback?.kind.type === 'select' ? fallback.kind.choices.map((choice) => choice.value) : null).toEqual([
      'low',
      'medium',
      'high',
      'max'
    ])
  })
})
