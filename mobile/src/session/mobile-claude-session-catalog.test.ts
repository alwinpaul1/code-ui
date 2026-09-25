import { describe, expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog'
import type { AgentSessionOptionCatalog, CatalogOption } from '../../../src/shared/agent-session-option-catalog-types'
import { effortDisplayLabel, mobileClaudeSessionCatalog, mobileEffortNamedCatalog } from './mobile-claude-session-catalog'
import { sessionModelPillLabel } from './session-model-pill'

function effortOf(catalog: AgentSessionOptionCatalog, modelId: string): CatalogOption | undefined {
  return catalog.models.find((model) => model.id === modelId)?.options.find((option) => option.id === 'effort')
}

function choices(option: CatalogOption | undefined): { value: string; label: string }[] {
  return option?.kind.type === 'select' ? option.kind.choices.map(({ value, label }) => ({ value: String(value), label })) : []
}

// 2026-09-25, the user, beside the Claude app's own Effort sheet: "Low,
// Medium, High, Extra, Max, Ultracode", and its pill "Opus 5.5 Extra". Code UI
// said "xhigh" and had no Ultracode. Claude Code 2.1.281 offers `/effort
// ultracode` ("xhigh effort + dynamic workflows") only on a model that
// supports xhigh, and refuses it otherwise.
describe('Claude effort, named the way the Claude app names it', () => {
  const catalog = mobileClaudeSessionCatalog(getAgentSessionOptionCatalog('claude')!)

  it('lists Extra for xhigh, and Ultracode after Max on a model that offers xhigh', () => {
    expect(choices(effortOf(catalog, 'opus'))).toEqual([
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'Extra' },
      { value: 'max', label: 'Max' },
      { value: 'ultracode', label: 'Ultracode' }
    ])
  })

  it('sends /effort ultracode when Ultracode is picked mid-session', () => {
    const apply = effortOf(catalog, 'opus')?.apply.midSession
    expect(apply?.kind === 'command' ? apply.build('ultracode') : null).toBe('/effort ultracode')
  })

  it('offers no Ultracode on a model without xhigh, and nothing on one with no effort', () => {
    const standard = mobileClaudeSessionCatalog({
      ...getAgentSessionOptionCatalog('claude')!,
      models: [
        {
          id: 'old',
          label: 'Old',
          options: [
            {
              ...effortOf(getAgentSessionOptionCatalog('claude')!, 'opus')!,
              kind: {
                type: 'select',
                choices: [
                  { value: 'low', label: 'Low' },
                  { value: 'high', label: 'High' }
                ],
                defaultValue: 'high'
              }
            }
          ]
        },
        { id: 'bare', label: 'Bare', options: [] }
      ]
    })
    expect(choices(effortOf(standard, 'old')).map((choice) => choice.value)).toEqual(['low', 'high'])
    expect(standard.models.find((model) => model.id === 'bare')?.options).toEqual([])
  })

  it('adds Ultracode once, however many times the catalog passes through', () => {
    const twice = mobileClaudeSessionCatalog(catalog)
    expect(choices(effortOf(twice, 'opus')).filter((choice) => choice.value === 'ultracode')).toHaveLength(1)
  })

  it('names the live effort on the model pill the same way', () => {
    expect(effortDisplayLabel('xhigh')).toBe('Extra')
    expect(effortDisplayLabel('high')).toBe('High')
    expect(effortDisplayLabel('max')).toBe('Max')
    expect(effortDisplayLabel('ultracode')).toBe('Ultracode')
    expect(effortDisplayLabel('turbo')).toBe('Turbo')
    expect(sessionModelPillLabel({ model: 'claude-opus-5-5', label: 'Opus 5.5 (1M context)', effort: 'xhigh' })).toBe(
      'Opus 5.5 Extra'
    )
  })

  it('names Codex\'s levels the same way, and gives Codex no Ultracode', () => {
    const codex = mobileEffortNamedCatalog(getAgentSessionOptionCatalog('codex')!, { ultracode: false })
    const labels = codex.models.flatMap((model) =>
      model.options.filter((option) => option.id === 'effort').flatMap((option) => choices(option))
    )
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.find((choice) => choice.value === 'xhigh')?.label ?? 'Extra').toBe('Extra')
    expect(labels.some((choice) => choice.value === 'ultracode')).toBe(false)
  })
})
