import { describe, expect, it, vi } from 'vitest'
import { applyCodexPickerSelection, type CodexPickerIo } from './codex-picker-apply'
import { parseCodexHudObservation } from './mobile-terminal-hud-parse'
import { acceptCodexStatusModel } from './use-codex-current-model'

// Codex 0.158.0 names the model in its footer as "GPT-6-Sol", where 0.155.1 printed the slug
// "gpt-6-sol". The footers below are the recorded captures in codex-0158-screens.test.ts
// (0.158.0: IDLE_AFTER_TURN and WORKING; 0.155.1: WORKING_0155), pasted verbatim. The picker rows
// are the 0.153.4 shape codex-picker-screen.ts documents: no 0.158 picker has been captured, and
// no live 0.158 tab has been driven from the phone.
const FOOTER_0158 = [
  '› Ask Codex to do anything',
  '',
  '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch · List and summarize files',
  '  ? for shortcuts'
]
const FOOTER_0155 = [
  '› Ask Codex to do anything',
  '',
  '  gpt-6-sol medium · ~/orca-lanes/sta8834/corpus/scratch · renaming... ⠙'
]
const MODEL_STEP = [
  'Select Model and Effort',
  '› 1. gpt-6-sol (current)  Reliable agentic workhorse for everyday tasks.',
  '  2. gpt-6-astra (default)  Our most capable model for complex work.',
  'Press enter to confirm or esc to go back'
]
const EFFORT_STEP = [
  'Select Reasoning Level for gpt-6-sol',
  '  1. Low                  Fast responses with lighter reasoning',
  '› 2. Medium (current)     Balanced reasoning',
  '  3. High                 Deeper reasoning',
  'Press enter to confirm or esc to go back'
]

/** A picker run over a fake clock: the idle screen, the two picker steps, then `after` for good. */
function pickerIo(idle: string[], after: string[]): CodexPickerIo {
  let clock = 0
  return {
    readScreen: vi
      .fn()
      .mockResolvedValueOnce(idle)
      .mockResolvedValueOnce(MODEL_STEP)
      .mockResolvedValueOnce(EFFORT_STEP)
      .mockResolvedValue(after),
    sendKey: vi.fn(async () => true),
    typeCommand: vi.fn(async () => true),
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock
  }
}

const TARGET = { model: 'gpt-6-sol', effort: { id: 'medium', label: 'Medium' } }

describe('a model change on Codex 0.158, whose footer capitalises the model', () => {
  it('is reported as applied once the footer reads "GPT-6-Sol medium", not as a failure', async () => {
    expect(await applyCodexPickerSelection(pickerIo(FOOTER_0158, FOOTER_0158), TARGET)).toEqual({
      ok: true
    })
  })

  it('is still reported as applied under the 0.155 lowercase footer', async () => {
    expect(await applyCodexPickerSelection(pickerIo(FOOTER_0155, FOOTER_0155), TARGET)).toEqual({
      ok: true
    })
  })

  it('is still unverified when the footer names another model or another effort', async () => {
    const astra = FOOTER_0158.map((line) => line.replace('GPT-6-Sol', 'GPT-6-Astra'))
    expect(await applyCodexPickerSelection(pickerIo(FOOTER_0158, astra), TARGET)).toEqual({
      ok: false,
      reason: 'unverified'
    })
    const high = FOOTER_0158.map((line) => line.replace('GPT-6-Sol medium', 'GPT-6-Sol high'))
    expect(await applyCodexPickerSelection(pickerIo(FOOTER_0158, high), TARGET)).toEqual({
      ok: false,
      reason: 'unverified'
    })
  })
})

describe('the Codex model pill under a capitalised 0.158 footer', () => {
  const known = ['gpt-6-sol', 'gpt-6-astra']

  it('takes the footer model and names it by the slug the account lists', () => {
    const footer = parseCodexHudObservation(FOOTER_0158)
    expect(footer?.modelId).toBe('GPT-6-Sol')
    expect(acceptCodexStatusModel(footer?.modelId, known)).toBe('gpt-6-sol')
  })

  it('still takes the 0.155 lowercase footer model', () => {
    const footer = parseCodexHudObservation(FOOTER_0155)
    expect(acceptCodexStatusModel(footer?.modelId, known)).toBe('gpt-6-sol')
  })

  it('still refuses a model the account does not list, whatever its case', () => {
    expect(acceptCodexStatusModel('GPT-Reserve', known)).toBeNull()
    expect(acceptCodexStatusModel('Claude-Opus-5', known)).toBeNull()
    expect(acceptCodexStatusModel('GPT-6-Sol', [])).toBe('GPT-6-Sol')
  })
})
