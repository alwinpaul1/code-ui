import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseClaudeModelList } from '../../../src/shared/claude-model-list-probe'
import { modelSheetLayout } from './model-sheet-layout'

function fixtureChoices(name: string) {
  const stdout = readFileSync(join(__dirname, 'fixtures', name), 'utf8')
  return parseClaudeModelList(stdout).map((model) => ({
    value: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {})
  }))
}

// Claude Code 2.1.295's own `list_models` answer (captured 2026-10-09), the
// list behind the Claude app picker the sheet copies.
describe('the model sheet on the list Claude Code 2.1.295 gives', () => {
  const layout = modelSheetLayout(fixtureChoices('claude-list-models-2.1.295.jsonl'))

  it('shows Fable, Opus, Sonnet and Haiku 5.x first, with the taglines the agent gives', () => {
    expect(layout?.featured).toEqual([
      { value: 'fable', label: 'Fable 5.1', description: 'For your toughest challenges' },
      { value: 'opus', label: 'Opus 5.5', description: 'For complex work and everyday tasks' },
      { value: 'sonnet', label: 'Sonnet 5.5', description: 'Most efficient for simpler tasks' },
      { value: 'haiku', label: 'Haiku 5.5', description: 'Fastest for quick answers' }
    ])
  })

  it('lists the older models under More models, by family and newest first', () => {
    expect(layout?.more.map((choice) => choice.label)).toEqual([
      'Fable 5',
      'Opus 5',
      'Opus 4.8',
      'Opus 4.7',
      'Opus 4.6',
      'Sonnet 5',
      'Sonnet 4.6',
      'Haiku 4.5'
    ])
  })

  it('reads a dated id as its version, not the date', () => {
    expect(layout?.more.at(-1)).toEqual({ value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' })
  })
})

// Claude Code 2.1.282's own `list_models` answer (captured 2026-09-25).
describe('the model sheet on the list Claude Code 2.1.282 gives', () => {
  const layout = modelSheetLayout(fixtureChoices('claude-list-models-2.1.282.jsonl'))

  it('puts the newest model of each family on the first page, with a version and a tagline', () => {
    expect(layout?.featured).toEqual([
      {
        value: 'global.anthropic.claude-fable-5-1',
        label: 'Fable 5.1',
        description: 'For your toughest challenges'
      },
      { value: 'opus', label: 'Opus 5.5', description: 'For complex work and everyday tasks' },
      {
        value: 'eu.anthropic.claude-sonnet-5',
        label: 'Sonnet 5',
        description: 'Most efficient for simpler tasks'
      },
      { value: 'haiku', label: 'Haiku 4.5', description: 'Fastest for quick answers' }
    ])
  })

  it('keeps every other row behind More models, by family and newest first', () => {
    expect(layout?.more).toEqual([
      { value: 'eu.anthropic.claude-opus-5-5[1m]', label: 'Opus 5.5 (1M context)' },
      { value: 'eu.anthropic.claude-opus-4-8[1m]', label: 'Opus 4.8 (1M context)' },
      { value: 'eu.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { value: 'eu.anthropic.claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' }
    ])
  })

  it('loses no row the agent listed', () => {
    const all = fixtureChoices('claude-list-models-2.1.282.jsonl').map((choice) => choice.value)
    const shown = [...layout!.featured, ...layout!.more].map((choice) => choice.value)
    expect(shown.toSorted()).toEqual(all.toSorted())
  })
})

describe('the model sheet on lists that are not Claude Code 2.1.282', () => {
  it('lays out the static seed by family when no row names a version', () => {
    const layout = modelSheetLayout([
      { value: 'fable', label: 'Fable' },
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'haiku', label: 'Haiku' }
    ])
    expect(layout?.featured.map((choice) => choice.label)).toEqual([
      'Fable',
      'Opus',
      'Sonnet',
      'Haiku'
    ])
    expect(layout?.more).toEqual([])
  })

  it('lists Codex flat, with no More models page', () => {
    expect(
      modelSheetLayout([
        { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
        { value: 'gpt-5.5', label: 'GPT-5.5' }
      ])
    ).toBeNull()
  })

  it('does not split a list on one stray family word', () => {
    expect(
      modelSheetLayout([
        { value: 'grok-4', label: 'Grok 4' },
        { value: 'opus-proxy', label: 'Opus proxy' }
      ])
    ).toBeNull()
  })

  it('lays out nothing for an empty list', () => {
    expect(modelSheetLayout([])).toBeNull()
  })

  it('features a 1M-only family by nothing, and keeps it in More models', () => {
    const layout = modelSheetLayout([
      { value: 'opus', label: 'Opus 5.5' },
      { value: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' }
    ])
    expect(layout?.featured.map((choice) => choice.value)).toEqual(['opus'])
    expect(layout?.more).toEqual([
      { value: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' }
    ])
  })

  it('keeps a row it cannot name at the end of More models, under its own label', () => {
    const layout = modelSheetLayout([
      { value: 'opus', label: 'Opus 5.5' },
      { value: 'haiku', label: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
      { value: 'my-proxy-model', label: 'Team proxy' }
    ])
    expect(layout?.more).toEqual([{ value: 'my-proxy-model', label: 'Team proxy' }])
  })
})

// The running row is renamed to the agent's own name before the sheet sees it
// (nameModelRowsFromAgent: `opus` -> "Opus 4.8.5", or a status line's
// "Opus 5.5 (1M context)"). Re-parsed, it dropped off the first page, lost its
// ".5", and sat beside claude-opus-4-8 as a second "Opus 4.8" (review,
// 2026-10-09).
describe('the model sheet when the agent has renamed the running row', () => {
  const renamed = (label: string) =>
    fixtureChoices('claude-list-models-2.1.295.jsonl').map((choice) =>
      choice.value === 'opus' ? { ...choice, label } : choice
    )

  it('keeps the renamed alias on the first page, under the name the agent gave it', () => {
    const layout = modelSheetLayout(renamed('Opus 4.8.5'))
    expect(layout?.featured[1]).toEqual({
      value: 'opus',
      label: 'Opus 4.8.5',
      description: 'For complex work and everyday tasks'
    })
    expect(layout?.more.map((choice) => choice.label)).not.toContain('Opus 4.8.5')
    expect(layout?.more.filter((choice) => choice.label === 'Opus 4.8')).toHaveLength(1)
  })

  it('keeps a 1M session alias on the first page; only the id says a row is 1M', () => {
    const layout = modelSheetLayout(renamed('Opus 5.5 (1M context)'))
    expect(layout?.featured[1]).toMatchObject({ value: 'opus', label: 'Opus 5.5 (1M context)' })
  })

  it('keeps a renamed alias of the static seed on the first page', () => {
    const layout = modelSheetLayout([
      { value: 'fable', label: 'Fable' },
      { value: 'opus', label: 'Opus 5.5 (1M context)' },
      { value: 'sonnet', label: 'Sonnet' }
    ])
    expect(layout?.featured.map((choice) => choice.value)).toEqual(['fable', 'opus', 'sonnet'])
  })
})
