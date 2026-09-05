import { describe, expect, it } from 'vitest'
import { discoveredCodexCatalogModels, parseCodexDiscovery } from './codex-model-discovery'

// Shape of the host's `git.discoverCommitMessageModels` result for agentId
// 'codex' (parseCodexModels over `codex debug models`), captured 2026-09-05.
const RESULT = {
  success: true,
  capability: { id: 'codex' },
  defaultModelId: 'gpt-6-astra',
  catalogOrigin: 'probe',
  models: [
    {
      id: 'gpt-6-astra',
      label: 'GPT-6-Astra',
      thinkingLevels: [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'xhigh', label: 'Extra High' },
        { id: 'max', label: 'Max' },
        { id: 'ultra', label: 'Ultra' }
      ],
      defaultThinkingLevel: 'medium',
      isDefault: true
    },
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5',
      thinkingLevels: [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'xhigh', label: 'Extra High' }
      ],
      defaultThinkingLevel: 'medium'
    },
    { id: '', label: 'broken' }
  ]
}

describe('parseCodexDiscovery', () => {
  it('keeps each model with its own levels and default', () => {
    const models = parseCodexDiscovery(RESULT)
    expect(models.map((model) => model.id)).toEqual(['gpt-6-astra', 'gpt-5.5'])
    expect(models[0]?.levels.map((level) => level.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    ])
    expect(models[0]?.isDefault).toBe(true)
    expect(models[1]?.levels).toHaveLength(4)
    expect(models[1]?.defaultLevel).toBe('medium')
  })

  it('returns nothing for a failed or malformed result', () => {
    expect(parseCodexDiscovery({ success: false, error: 'codex not found' })).toEqual([])
    expect(parseCodexDiscovery(null)).toEqual([])
  })
})

describe('discoveredCodexCatalogModels', () => {
  it('builds a per-model effort select from the discovered levels', () => {
    const [astra, five] = discoveredCodexCatalogModels(parseCodexDiscovery(RESULT))
    expect(astra?.isDefault).toBe(true)
    const effort = astra?.options[0]
    expect(effort?.id).toBe('effort')
    expect(effort?.kind.type === 'select' && effort.kind.choices.map((c) => c.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    ])
    expect(effort?.kind.type === 'select' && effort.kind.defaultValue).toBe('medium')
    expect(five?.options[0]?.kind.type === 'select' && five.options[0].kind.choices).toHaveLength(4)
  })
})
