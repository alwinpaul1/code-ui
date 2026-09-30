import { describe, expect, it } from 'vitest'
import {
  MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH,
  MAX_QUICK_COMMAND_LABEL_LENGTH,
  MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH
} from '../terminal/quick-commands'
import { createEmptyQuickCommandDraft, draftToQuickCommand, type QuickCommandDraft } from './quick-command-draft'

// The draft is cut to the shared caps before it is saved, sent to the desktop
// and, for a terminal command, typed into the shell. The caps count UTF-16
// code units, and an emoji is two: a cut that landed between them saved the
// first half alone, a broken glyph in the list and a stray byte in the shell.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const EMOJI = '😀'

function draft(overrides: Partial<QuickCommandDraft>): QuickCommandDraft {
  return { ...createEmptyQuickCommandDraft({ type: 'global' }), label: 'Run the gate', command: 'npx vitest run', ...overrides }
}

describe('a quick command whose text runs past its cap on an emoji', () => {
  it('saves the label without half of the emoji the cap fell inside', () => {
    const saved = draftToQuickCommand(draft({ label: `${'a'.repeat(MAX_QUICK_COMMAND_LABEL_LENGTH - 1)}${EMOJI}` }))
    expect(saved?.label).toBe('a'.repeat(MAX_QUICK_COMMAND_LABEL_LENGTH - 1))
    expect(saved?.label).not.toMatch(LONE_SURROGATE)
  })

  it('types a terminal command without half of the emoji the cap fell inside', () => {
    const saved = draftToQuickCommand(draft({ command: `${'a'.repeat(MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH - 1)}${EMOJI}` }))
    expect(saved?.action).toBe('terminal-command')
    const command = saved?.action === 'terminal-command' ? saved.command : null
    expect(command).toBe('a'.repeat(MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH - 1))
    expect(command).not.toMatch(LONE_SURROGATE)
  })

  it('sends an agent prompt without half of the emoji the cap fell inside', () => {
    const saved = draftToQuickCommand(
      draft({
        action: 'agent-prompt',
        agent: 'claude',
        prompt: `${'a'.repeat(MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH - 1)}${EMOJI}`
      })
    )
    expect(saved?.action).toBe('agent-prompt')
    const prompt = saved?.action === 'agent-prompt' ? saved.prompt : null
    expect(prompt).toBe('a'.repeat(MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH - 1))
    expect(prompt).not.toMatch(LONE_SURROGATE)
  })

  it('keeps an emoji that ends exactly at the cap', () => {
    const label = `${'a'.repeat(MAX_QUICK_COMMAND_LABEL_LENGTH - 2)}${EMOJI}`
    expect(draftToQuickCommand(draft({ label }))?.label).toBe(label)
  })

  it('leaves plain text at the cap whole, and cuts plain text past it at the cap', () => {
    const atCap = 'a'.repeat(MAX_QUICK_COMMAND_LABEL_LENGTH)
    expect(draftToQuickCommand(draft({ label: atCap }))?.label).toBe(atCap)
    expect(draftToQuickCommand(draft({ label: `${atCap}b` }))?.label).toBe(atCap)
  })

  it('saves nothing for an empty label, command or prompt', () => {
    expect(draftToQuickCommand(draft({ label: '' }))).toBeNull()
    expect(draftToQuickCommand(draft({ command: '' }))).toBeNull()
    expect(draftToQuickCommand(draft({ action: 'agent-prompt', agent: 'claude', prompt: '' }))).toBeNull()
  })

  it('saves a one-character emoji label whole', () => {
    expect(draftToQuickCommand(draft({ label: EMOJI }))?.label).toBe(EMOJI)
  })
})
