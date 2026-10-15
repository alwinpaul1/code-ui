import { describe, expect, it } from 'vitest'
import type { CcrEvent } from './ccr-session-api'
import { ccrSessionSlashCommands, claudeAppCommandOf } from './ccr-slash-commands'
import { mobileNativeChatSlashSuggestions } from './mobile-native-chat-session-catalog'
import { composerSuggestionInsertText } from './composer-suggestion-text'

// The `/` menu of a Claude tab on Anthropic is the session's own list, as the Claude app reads it
// from the stream's `system` event (1.261013.20, jau.java:27-28, su8.w4, iu7.java). The init
// event's shape is Claude Code 2.1.300's, from probe p4 (2026-10-15): bare names, the skills also
// named in `skills`, and a terminal-only list.

let seq = 0
const event = (payload: Record<string, unknown>): CcrEvent => ({ eventId: `e${(seq += 1)}`, sequenceNum: seq, payload: { uuid: `u${seq}`, ...payload } })
const init = (extra: Record<string, unknown>) =>
  event({ type: 'system', subtype: 'init', model: 'claude-opus-4-7', permissionMode: 'auto', ...extra })

describe('the session’s own slash commands', () => {
  it('lists what the init event names, skills as skills, then the app’s own /workflows, /diff and /model', () => {
    const list = ccrSessionSlashCommands([
      init({ slash_commands: ['compact', 'context', 'academic-writer', 'review'], skills: ['academic-writer'], terminal_slash_commands: ['doctor'] })
    ])
    expect(list).toEqual([
      { name: 'compact', kind: 'command' },
      { name: 'context', kind: 'command' },
      { name: 'academic-writer', kind: 'skill' },
      { name: 'review', kind: 'command' },
      { name: 'workflows', kind: 'command', description: '' },
      { name: 'diff', kind: 'command', description: '' },
      { name: 'model', kind: 'command', description: 'Choose a model' }
    ])
  })

  it('adds /focus from the terminal-only list, and nothing else from it', () => {
    const list = ccrSessionSlashCommands([init({ slash_commands: ['compact'], terminal_slash_commands: ['doctor', 'focus', 'vim'] })])
    expect(list?.map((command) => command.name)).toEqual(['compact', 'focus', 'workflows', 'diff', 'model'])
  })

  it('reads the newest statement, not the first', () => {
    const list = ccrSessionSlashCommands([init({ slash_commands: ['old-one'] }), event({ type: 'assistant' }), init({ slash_commands: ['new-one'] })])
    expect(list?.map((command) => command.name)).toEqual(['new-one', 'workflows', 'diff', 'model'])
  })

  it('lists /model once when the session names it too, as the app’s own', () => {
    const list = ccrSessionSlashCommands([init({ slash_commands: ['model', 'compact', 'compact'] })])
    expect(list?.filter((command) => command.name === 'model')).toEqual([{ name: 'model', kind: 'command', description: 'Choose a model' }])
    expect(list?.filter((command) => command.name === 'compact')).toHaveLength(1)
  })

  it('with an empty list, offers the app’s own commands alone', () => {
    expect(ccrSessionSlashCommands([init({ slash_commands: [] })])?.map((command) => command.name)).toEqual(['workflows', 'diff', 'model'])
  })

  it('is undefined (the curated catalog stays) with no events, or none that states a list', () => {
    expect(ccrSessionSlashCommands([])).toBeUndefined()
    expect(ccrSessionSlashCommands([init({}), event({ type: 'user' })])).toBeUndefined()
  })

  it('ignores a list that is not one, a subagent’s event, and entries that are not names', () => {
    expect(ccrSessionSlashCommands([init({ slash_commands: 'compact' })])).toBeUndefined()
    expect(ccrSessionSlashCommands([init({ slash_commands: ['compact'], parent_tool_use_id: 'toolu_1' })])).toBeUndefined()
    const list = ccrSessionSlashCommands([init({ slash_commands: [7, null, '', '  ', '/compact', { name: 'x' }] })])
    expect(list?.map((command) => command.name)).toEqual(['compact', 'workflows', 'diff', 'model'])
  })

  it('answers the same array for the same statement, so the menu is not rebuilt on every event', () => {
    const statement = init({ slash_commands: ['compact'] })
    const first = ccrSessionSlashCommands([statement])
    expect(ccrSessionSlashCommands([statement, event({ type: 'assistant' })])).toBe(first)
  })
})

describe('the menu the composer draws from it', () => {
  it('offers the session’s commands and skills, and not the curated catalog’s terminal-only ones', () => {
    const sessionCommands = ccrSessionSlashCommands([
      init({ slash_commands: ['compact', 'academic-writer'], skills: ['academic-writer'], terminal_slash_commands: ['doctor'] })
    ])
    const rows = mobileNativeChatSlashSuggestions({ agent: 'claude', scannedSkills: [], sessionCommands, conversationCommands: undefined, query: '' })
    expect(rows.map(composerSuggestionInsertText)).toEqual(['/academic-writer', '/compact', '/diff', '/model', '/workflows'])
    const model = rows.find((row) => row.kind === 'command' && row.command.name === 'model')
    expect(model?.kind === 'command' ? model.command.description : null).toBe('Choose a model')
    const diff = rows.find((row) => row.kind === 'command' && row.command.name === 'diff')
    expect(diff?.kind === 'command' ? diff.command.description : 'none').toBeUndefined()
  })
})

describe('which sends are the app’s own commands', () => {
  it('is the bare command alone, as typed or as the menu leaves it', () => {
    expect(claudeAppCommandOf('/model')).toBe('model')
    expect(claudeAppCommandOf('/model ')).toBe('model')
    expect(claudeAppCommandOf('  /diff\n')).toBe('diff')
    expect(claudeAppCommandOf('/workflows')).toBe('workflows')
  })

  it('is not a command with words after it, another command, or prose', () => {
    expect(claudeAppCommandOf('/model opus')).toBeNull()
    expect(claudeAppCommandOf('/models')).toBeNull()
    expect(claudeAppCommandOf('/compact')).toBeNull()
    expect(claudeAppCommandOf('show me the /diff')).toBeNull()
    expect(claudeAppCommandOf('')).toBeNull()
  })
})
