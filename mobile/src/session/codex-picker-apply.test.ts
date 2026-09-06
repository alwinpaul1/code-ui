import { describe, expect, it, vi } from 'vitest'
import { applyCodexPickerSelection, type CodexPickerIo } from './codex-picker-apply'

describe('Codex effort changes during work', () => {
  it('applies effort through the picker while a turn runs', async () => {
    const readScreen = vi
      .fn()
      .mockResolvedValueOnce(['• Working (esc to interrupt)'])
      .mockResolvedValueOnce([
        'Select Model and Effort',
        '› 1. gpt-6-astra (current)',
        'Press enter to confirm or esc to go back'
      ])
      .mockResolvedValueOnce([
        'Select Reasoning Level for gpt-6-astra',
        '› 1. High (current)',
        'Press enter to confirm or esc to go back'
      ])
      .mockResolvedValue(['gpt-6-astra high · ~/project'])
    const io: CodexPickerIo = {
      readScreen,
      sendKey: vi.fn(async () => true),
      typeCommand: vi.fn(async () => true),
      sleep: vi.fn(async () => {}),
      now: () => Date.now()
    }
    expect(
      await applyCodexPickerSelection(io, {
        model: 'gpt-6-astra',
        effort: { id: 'high', label: 'High' }
      })
    ).toEqual({ ok: true })
    expect(io.typeCommand).toHaveBeenCalledWith('/model')
    expect(io.sendKey).not.toHaveBeenCalledWith('\x1b')
  })
  it('does not type into an active approval', async () => {
    const io: CodexPickerIo = {
      readScreen: async () => [
        'Would you like to run the following command?',
        '$ echo hi',
        '› 1. Yes, proceed (y)',
        '  2. No, and tell Codex what to do differently (esc)',
        'Press enter to confirm or esc to cancel'
      ],
      sendKey: vi.fn(async () => true),
      typeCommand: vi.fn(async () => true),
      sleep: vi.fn(async () => {}),
      now: () => Date.now()
    }
    expect(await applyCodexPickerSelection(io, { model: 'gpt-6-astra' })).toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(io.typeCommand).not.toHaveBeenCalled()
  })
})
