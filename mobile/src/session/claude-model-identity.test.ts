import { describe, expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog'
import type { AgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog-types'
import { claudeCanonicalModel, matchClaudeCatalogModelId } from './claude-model-identity'

const SEED = getAgentSessionOptionCatalog('claude')!

function listing(...rows: Array<[id: string, label: string]>): AgentSessionOptionCatalog {
  return { ...SEED, models: rows.map(([id, label]) => ({ id, label, options: [] })) }
}

// Row ids and labels as Claude Code 2.1.282 lists them on a Bedrock host
// (fixtures/claude-list-models-2.1.282.jsonl).
const BEDROCK = listing(
  ['global.anthropic.claude-fable-5-1', 'Fable'],
  ['eu.anthropic.claude-sonnet-5', 'Sonnet'],
  ['eu.anthropic.claude-sonnet-4-6', 'Sonnet 4.6'],
  ['eu.anthropic.claude-sonnet-4-6[1m]', 'Sonnet 4.6 (1M context)'],
  ['opus', 'Opus 5.5'],
  ['haiku', 'Haiku'],
  ['eu.anthropic.claude-opus-4-8[1m]', 'Opus 4.8 (1M context)'],
  ['eu.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)']
)

describe('which model a Claude id or label names', () => {
  it('reads a host alias by its label, and a seed alias as no model at all', () => {
    expect(claudeCanonicalModel('opus', 'Opus 5.5')).toBe('claude-opus-5-5')
    expect(claudeCanonicalModel('eu.anthropic.claude-sonnet-4-6[1m]', 'Sonnet 4.6 (1M context)')).toBe('claude-sonnet-4-6')
    expect(claudeCanonicalModel('opus', 'Opus')).toBeNull()
    expect(claudeCanonicalModel('haiku', 'Haiku')).toBeNull()
  })
})

describe('the host row a Claude session stands on', () => {
  it('finds the region row for a bare id, and the 1M row for a 1M one', () => {
    expect(matchClaudeCatalogModelId(BEDROCK, 'claude-sonnet-4-6', 'Sonnet 4.6')).toBe('eu.anthropic.claude-sonnet-4-6')
    expect(matchClaudeCatalogModelId(BEDROCK, 'claude-sonnet-4-6[1m]', null)).toBe('eu.anthropic.claude-sonnet-4-6[1m]')
    expect(matchClaudeCatalogModelId(BEDROCK, 'claude-opus-5-5[1m]', null)).toBe('eu.anthropic.claude-opus-5-5[1m]')
  })

  it('keeps an exact id, even an alias whose label names another model', () => {
    expect(matchClaudeCatalogModelId(BEDROCK, 'opus', 'Opus 4.6')).toBe('opus')
    expect(matchClaudeCatalogModelId(BEDROCK, 'eu.anthropic.claude-opus-4-8[1m]', null)).toBe('eu.anthropic.claude-opus-4-8[1m]')
  })

  it('moves a badge off a row that is another model, onto the one that is this one', () => {
    expect(matchClaudeCatalogModelId(BEDROCK, 'sonnet', 'Sonnet 4.6')).toBe('eu.anthropic.claude-sonnet-4-6')
    expect(matchClaudeCatalogModelId(BEDROCK, 'sonnet', 'Sonnet 5')).toBe('eu.anthropic.claude-sonnet-5')
  })

  it('falls back to Orca\'s match when no row, or more than one, is the model', () => {
    // No Opus 4.6 row: the fold onto `opus` stands and the table cuts it.
    expect(matchClaudeCatalogModelId(BEDROCK, 'claude-opus-4-6', 'Opus 4.6')).toBe('opus')
    expect(matchClaudeCatalogModelId(BEDROCK, 'claude-sonnet-4-5-20250929', 'Sonnet 4.5')).toBeNull()
    const twice = listing(['us.anthropic.claude-sonnet-4-6', 'Sonnet 4.6'], ['eu.anthropic.claude-sonnet-4-6', 'Sonnet 4.6'])
    expect(matchClaudeCatalogModelId(twice, 'claude-sonnet-4-6', null)).toBeNull()
  })

  it('leaves the seed to Orca\'s matcher', () => {
    expect(matchClaudeCatalogModelId(SEED, 'eu.anthropic.claude-sonnet-4-6[1m]', 'Sonnet 4.6 (1M context)')).toBe('sonnet')
    expect(matchClaudeCatalogModelId(SEED, 'claude-opus-4-6', 'Opus 4.6')).toBe('opus')
    expect(matchClaudeCatalogModelId(SEED, 'gpt-5.5', null)).toBeNull()
  })

  it('answers nothing for a list of one other model, or none', () => {
    expect(matchClaudeCatalogModelId(listing(['opus', 'Opus 5.5']), 'claude-sonnet-4-6', null)).toBeNull()
    expect(matchClaudeCatalogModelId(listing(), 'claude-sonnet-4-6', null)).toBeNull()
    expect(matchClaudeCatalogModelId(BEDROCK, '   ', null)).toBeNull()
  })
})
