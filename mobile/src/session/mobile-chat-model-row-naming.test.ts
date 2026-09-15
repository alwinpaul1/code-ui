import { describe, expect, it } from 'vitest'
import { nameModelRowsFromAgent } from './mobile-chat-model-row-naming'
import type { CatalogModel } from '../../../src/shared/agent-session-option-catalog-types'

const CLAUDE: CatalogModel[] = [
  { id: 'fable', label: 'Fable', options: [] },
  { id: 'opus', label: 'Opus', options: [] },
  { id: 'sonnet', label: 'Sonnet', options: [] }
]

describe('naming the model the agent says it is running', () => {
  it('states the agent’s own name instead of the family', () => {
    const rows = nameModelRowsFromAgent(CLAUDE, 'opus', 'Opus 4.8.5')
    expect(rows.find((row) => row.id === 'opus')?.label).toBe('Opus 4.8.5')
  })

  it('leaves every model the user has not chosen at its catalog name', () => {
    const rows = nameModelRowsFromAgent(CLAUDE, 'opus', 'Opus 4.8.5')
    expect(rows.find((row) => row.id === 'sonnet')?.label).toBe('Sonnet')
    expect(rows.find((row) => row.id === 'fable')?.label).toBe('Fable')
  })

  it('keeps the catalog name when the agent stated none', () => {
    expect(nameModelRowsFromAgent(CLAUDE, 'opus', null).find((r) => r.id === 'opus')?.label).toBe(
      'Opus'
    )
    expect(nameModelRowsFromAgent(CLAUDE, 'opus', '   ').find((r) => r.id === 'opus')?.label).toBe(
      'Opus'
    )
  })

  it('does nothing when no model is reported', () => {
    expect(nameModelRowsFromAgent(CLAUDE, null, 'Opus 4.8.5')).toEqual(CLAUDE)
  })

  it('names a Sonnet session Sonnet, not whatever ran before', () => {
    const rows = nameModelRowsFromAgent(CLAUDE, 'sonnet', 'Sonnet 4.5')
    expect(rows.find((row) => row.id === 'sonnet')?.label).toBe('Sonnet 4.5')
    expect(rows.find((row) => row.id === 'opus')?.label).toBe('Opus')
  })

  it('reads an empty catalog without inventing a row', () => {
    expect(nameModelRowsFromAgent([], 'opus', 'Opus 4.8.5')).toEqual([])
  })
})
