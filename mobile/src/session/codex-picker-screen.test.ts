import { describe, expect, it } from 'vitest'
import {
  isCodexIdle,
  isCodexWorking,
  matchCodexEffortRow,
  parseCodexPickerScreen
} from './codex-picker-screen'

// Captured from Codex 0.153.4 on 2026-09-05 via `orca terminal read --screen`.
const STATUS_TAIL = [
  '│  Weekly limit:                [████████████████████] 100% left (resets 17:16 on 12 Sep) │',
  '╰─────────────────────────────────────────────────────────────────────────────────────────╯'
]
const MODEL_STEP = [
  ...STATUS_TAIL,
  '  Select Model and Effort',
  '  Access legacy models by running codex -m <model_name> or in your config.toml',
  '  1. gpt-6-astra (default)  Our most capable model for complex, demanding work.',
  '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
  '  3. gpt-5.6-terra          Balanced agentic coding model for everyday work.',
  '  4. gpt-5.6-luna           Fast and affordable agentic coding model.',
  '  5. gpt-5.5                Proven previous-generation model for coding and general work.',
  '  6. gpt-5.4-mini           Small, fast, and cost-efficient model for simpler coding tasks.',
  '  7. gpt-5.3-codex-spark    Ultra-fast coding model.',
  '  Press enter to confirm or esc to go back'
]
const EFFORT_STEP = [
  ...STATUS_TAIL,
  '› 3',
  '• 3',
  '  Select Reasoning Level for gpt-5.6-sol',
  '  1. Low (default)         Fast responses with lighter reasoning',
  '  2. Medium                Balances speed and reasoning depth for everyday tasks',
  '  3. High                  Greater reasoning depth for complex problems',
  '› 4. Extra high (current)  Extra high reasoning depth for complex problems',
  '  5. More reasoning…       Max and Ultra consume usage limits faster',
  '  Press enter to confirm or esc to go back'
]

describe('parseCodexPickerScreen', () => {
  it('reads the model step: slugs, flags, descriptions, and the cursor', () => {
    const screen = parseCodexPickerScreen(MODEL_STEP)
    expect(screen?.step).toBe('model')
    expect(screen?.cursorIndex).toBe(2)
    expect(screen?.rows.map((row) => row.name)).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark'
    ])
    expect(screen?.rows[0]).toMatchObject({ index: 1, isDefault: true, isCurrent: false })
    expect(screen?.rows[1]).toMatchObject({ index: 2, isDefault: false, isCurrent: true })
    expect(screen?.rows[2]?.description).toBe('Balanced agentic coding model for everyday work.')
  })

  it('reads the effort step with its model, the current level, and the expander', () => {
    const screen = parseCodexPickerScreen(EFFORT_STEP)
    expect(screen?.step).toBe('effort')
    expect(screen?.model).toBe('gpt-5.6-sol')
    expect(screen?.cursorIndex).toBe(4)
    expect(screen?.rows.map((row) => row.name)).toEqual([
      'Low',
      'Medium',
      'High',
      'Extra high',
      'More reasoning…'
    ])
    expect(screen?.rows[0]).toMatchObject({ isDefault: true })
    expect(screen?.rows[3]).toMatchObject({ isCurrent: true })
    expect(screen?.rows[4]?.isMore).toBe(true)
  })

  it('returns null when no picker is on screen', () => {
    expect(parseCodexPickerScreen([...STATUS_TAIL, '› Ask Codex to do anything'])).toBeNull()
  })
})

describe('matchCodexEffortRow', () => {
  it('matches a discovered level by id or by label, case-insensitively', () => {
    const rows = parseCodexPickerScreen(EFFORT_STEP)!.rows
    expect(matchCodexEffortRow(rows, { id: 'xhigh', label: 'Extra High' })?.index).toBe(4)
    expect(matchCodexEffortRow(rows, { id: 'low', label: 'Low' })?.index).toBe(1)
    expect(matchCodexEffortRow(rows, { id: 'ultra', label: 'Ultra' })).toBeUndefined()
  })
})

describe('idle and working detection', () => {
  it('sees an idle prompt', () => {
    const lines = ['• ok', '› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project']
    expect(isCodexIdle(lines)).toBe(true)
    expect(isCodexWorking(lines)).toBe(false)
  })
  it('sees a running turn', () => {
    const lines = ['› 3', '• Working (1s • esc to interrupt)', '› Ask Codex to do anything']
    expect(isCodexIdle(lines)).toBe(false)
    expect(isCodexWorking(lines)).toBe(true)
  })
})
