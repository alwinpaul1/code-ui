import { describe, expect, it } from 'vitest'
import {
  applySlashSuggestion,
  filterSlashCommands,
  getAgentSlashCommands,
  isSlashCommandDraft,
  slashCommandDispatchText,
  slashCommandOpensOverlay
} from './native-chat-slash-commands'

describe('getAgentSlashCommands', () => {
  it('returns Codex-specific commands (e.g. /model, /resume) for codex', () => {
    const names = getAgentSlashCommands('codex').map((c) => c.name)
    expect(names).toContain('model')
    expect(names).toContain('resume')
    expect(names).toContain('diff')
  })

  it("returns Claude Code's built-in commands for claude, most-used first", () => {
    const commands = getAgentSlashCommands('claude')
    const names = commands.map((c) => c.name)
    expect(names.slice(0, 4)).toEqual(['clear', 'compact', 'model', 'loop'])
    expect(names).toContain('plan')
    expect(names).toContain('mcp')
    expect(names).toContain('security-review')
    // Codex-only commands stay out of the Claude catalog.
    expect(names).not.toContain('pets')
    expect(new Set(names).size).toBe(names.length)
  })

  it('falls back to a small common set for an unknown agent (never empty)', () => {
    const names = getAgentSlashCommands('some-other-agent').map((c) => c.name)
    expect(names).toEqual(['clear', 'help'])
  })
})

describe('isSlashCommandDraft', () => {
  it('is true for a leading slash, even with leading whitespace', () => {
    expect(isSlashCommandDraft('/clear')).toBe(true)
    expect(isSlashCommandDraft('  /model')).toBe(true)
  })

  it('is false for ordinary prose or a mid-line slash', () => {
    expect(isSlashCommandDraft('fix the bug')).toBe(false)
    expect(isSlashCommandDraft('run a/b test')).toBe(false)
    expect(isSlashCommandDraft('')).toBe(false)
  })
})

describe('filterSlashCommands', () => {
  const codex = getAgentSlashCommands('codex')

  it('returns all commands for an empty query (bare /)', () => {
    expect(filterSlashCommands(codex, '')).toHaveLength(codex.length)
  })

  it('prefix-matches case-insensitively', () => {
    const names = filterSlashCommands(codex, 'mod').map((c) => c.name)
    expect(names).toEqual(['model'])
    expect(filterSlashCommands(codex, 'MOD').map((c) => c.name)).toEqual(['model'])
  })
})

describe('dispatch vs completion text', () => {
  it('dispatch text has no trailing space (Enter dispatches the command)', () => {
    expect(slashCommandDispatchText({ name: 'clear' })).toBe('/clear')
  })

  it('completion text has a trailing space (Tab completes for arguments)', () => {
    expect(applySlashSuggestion({ name: 'model' })).toBe('/model ')
  })
})

describe('leading paths are not commands', () => {
  it('keeps a desktop image paste path as chat, not a slash command', () => {
    const paste = '/var/folders/0y/T/orca-paste-1.png [Image #1] remove this'
    expect(isSlashCommandDraft(paste)).toBe(false)
    expect(isSlashCommandDraft('/Users/me/notes.md please read')).toBe(false)
    expect(isSlashCommandDraft('/model')).toBe(true)
    expect(isSlashCommandDraft('/mcp verbose')).toBe(true)
  })
})

describe('slashCommandOpensOverlay (Codex)', () => {
  it('flags picker/prompt commands and not text-only ones', () => {
    expect(slashCommandOpensOverlay('codex', '/model')).toBe(true)
    expect(slashCommandOpensOverlay('codex', '/permissions')).toBe(true)
    expect(slashCommandOpensOverlay('codex', '/status')).toBe(false)
    expect(slashCommandOpensOverlay('codex', '/compact')).toBe(false)
    expect(slashCommandOpensOverlay('codex', '/mcp verbose')).toBe(false)
  })
  it('assumes an unknown command needs the terminal', () => {
    expect(slashCommandOpensOverlay('codex', '/whatever')).toBe(true)
  })
})
