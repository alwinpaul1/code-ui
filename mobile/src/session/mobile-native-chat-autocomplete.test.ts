import { describe, expect, it, vi } from 'vitest'
import {
  applyAutocomplete,
  detectAutocompleteTrigger,
  rankSkillSuggestions,
  rankSlashCommandSuggestions,
  rankSuggestions
} from './mobile-native-chat-autocomplete'

describe('detectAutocompleteTrigger', () => {
  it('detects a slash command at the start', () => {
    expect(detectAutocompleteTrigger('/rev', 4)).toEqual({
      kind: 'slash',
      query: 'rev',
      start: 0,
      end: 4
    })
  })

  // Orca #19832: naming a skill mid-sentence — "validate it with /electron" —
  // offered nothing at all, because the picker only opened on the first
  // character of the draft.
  it('offers the picker for a command named mid-prompt', () => {
    expect(detectAutocompleteTrigger('validate it with /elec', 22)).toEqual({
      kind: 'slash',
      query: 'elec',
      start: 17,
      end: 22
    })
  })

  it('offers the picker on a fresh line of a multi-line draft', () => {
    expect(detectAutocompleteTrigger('ship it\n/rev', 12)).toMatchObject({
      kind: 'slash',
      query: 'rev',
      start: 8
    })
  })

  it('leaves a slash inside a word alone', () => {
    // `and/or` is prose, and `src/app.ts` is a path: neither opens a picker,
    // because neither token begins with the trigger.
    expect(detectAutocompleteTrigger('and/or', 6)).toBeNull()
    expect(detectAutocompleteTrigger('see src/app.ts', 14)).toBeNull()
  })

  it('detects an @ mention after whitespace or at start', () => {
    expect(detectAutocompleteTrigger('@src', 4)).toMatchObject({ kind: 'file', query: 'src' })
    expect(detectAutocompleteTrigger('look at @comp', 13)).toMatchObject({
      kind: 'file',
      query: 'comp'
    })
  })

  it('does not trigger @ mid-word (email-like)', () => {
    expect(detectAutocompleteTrigger('me@host', 7)).toBeNull()
  })

  it('closes the token once a space is typed', () => {
    expect(detectAutocompleteTrigger('@src ', 5)).toBeNull()
  })

  it('returns empty query right after the trigger char', () => {
    expect(detectAutocompleteTrigger('@', 1)).toMatchObject({ kind: 'file', query: '' })
  })
})

describe('applyAutocomplete', () => {
  it('replaces the trigger span and leaves a trailing space + cursor', () => {
    const trigger = detectAutocompleteTrigger('look at @comp', 13)!
    const { text, cursor } = applyAutocomplete('look at @comp', trigger, '@src/App.tsx')
    expect(text).toBe('look at @src/App.tsx ')
    expect(cursor).toBe(text.length)
  })
})

describe('rankSuggestions', () => {
  it('prefers prefix matches on the basename', () => {
    const out = rankSuggestions(['src/app/Main.tsx', 'src/AppBar.tsx', 'lib/zapp.ts'], 'app')
    expect(out[0]).toBe('src/AppBar.tsx')
    expect(out).toContain('lib/zapp.ts')
  })

  it('returns the head of the list for an empty query', () => {
    expect(rankSuggestions(['a', 'b', 'c'], '', 2)).toEqual(['a', 'b'])
  })

  it('matches a basename prefix on a bare filename with no directory', () => {
    // perf: the basename is now sliced off the last '/' instead of split+pop;
    // a candidate with no '/' at all must still match on its own full text.
    const out = rankSuggestions(['README.md', 'src/readme-notes.ts'], 'read')
    expect(out).toContain('README.md')
    expect(out).toContain('src/readme-notes.ts')
  })
})

describe('rankSlashCommandSuggestions', () => {
  const commands = [
    { name: 'clear', description: 'Clear conversation history' },
    { name: 'compact', description: 'Summarize and compact' },
    { name: 'mcp', description: 'List MCP tools' }
  ]

  it('shows the whole catalog for a bare slash', () => {
    expect(rankSlashCommandSuggestions(commands, '').map((c) => c.name)).toEqual([
      'clear',
      'compact',
      'mcp'
    ])
  })

  it('ranks prefix matches ahead of substring matches', () => {
    expect(rankSlashCommandSuggestions(commands, 'c').map((c) => c.name)).toEqual([
      'clear',
      'compact',
      'mcp'
    ])
    expect(rankSlashCommandSuggestions(commands, 'm').map((c) => c.name)).toEqual([
      'mcp',
      'compact'
    ])
  })

  it('is case-insensitive and drops non-matches', () => {
    expect(rankSlashCommandSuggestions(commands, 'CLE').map((c) => c.name)).toEqual(['clear'])
    expect(rankSlashCommandSuggestions(commands, 'zzz')).toEqual([])
  })

  it('preserves command identity and metadata for duplicate names', () => {
    const catalog = [
      { name: 'team-review', description: 'First' },
      { name: 'team-review', argumentHint: '<branch>' },
      { name: 'review', kindUnspecified: true as const }
    ]
    const result = rankSlashCommandSuggestions(catalog, 'review', 3)
    expect(result[0]).toBe(catalog[2])
    expect(result[1]).toBe(catalog[0])
    expect(result[2]).toBe(catalog[1])
  })
})

describe.each([
  { name: 'file', rank: rankSuggestions },
  {
    name: 'slash',
    rank: (names: readonly string[], query: string, limit: number): string[] =>
      rankSlashCommandSuggestions(
        names.map((name) => ({ name })),
        query,
        limit
      ).map((command) => command.name)
  }
])('$name suggestion bounds', ({ rank }) => {
  it('keeps later prefixes ahead of the earliest substring matches', () => {
    const candidates = ['team-review', 'team-review', 'pre-review', 'review-a', 'REVIEW-b']
    expect(rank(candidates, 'REVIEW', 4)).toEqual([
      'review-a',
      'REVIEW-b',
      'team-review',
      'team-review'
    ])
  })

  it('stops substring matching once enough fallback suggestions are retained', () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => `team-review-${index}`)
    candidates.push('review-last', 'review-final')
    const includes = String.prototype.includes
    let substringChecks = 0
    const spy = vi.spyOn(String.prototype, 'includes').mockImplementation(function (
      this: string,
      search: string,
      position?: number
    ) {
      substringChecks += 1
      return includes.call(this, search, position)
    })
    let result: string[]
    try {
      result = rank(candidates, 'review', 8)
    } finally {
      spy.mockRestore()
    }
    expect(result).toEqual(['review-last', 'review-final', ...candidates.slice(0, 6)])
    expect(substringChecks).toBeLessThanOrEqual(8)
  })

  it.each([0, -0, -1, -0.5, -Infinity, Number.NaN])(
    'preserves empty results for limit %s',
    (limit) => {
      expect(rank(['team-review', 'review-a', 'review-b'], 'review', limit)).toEqual([])
    }
  )

  it.each([0.5, 1.5, 2.5, Infinity])('preserves slice truncation for limit %s', (limit) => {
    const candidates = ['team-review', 'pre-review', 'review-a', 'review-b']
    expect(rank(candidates, 'review', limit)).toEqual(
      ['review-a', 'review-b', 'team-review', 'pre-review'].slice(0, limit)
    )
    expect(rank(candidates, '', limit)).toEqual(candidates.slice(0, limit))
  })
})

// Code UI's own ranker, found by the same grep as upstream's two. It matches a
// skill's description as well as its name, so an unbounded substring list here
// also retains every non-shown row in the catalog.
describe('skill suggestion bounds', () => {
  it('stops substring matching once enough fallback suggestions are retained', () => {
    const skills = Array.from({ length: 10_000 }, (_v, index) => ({
      name: `team-review-${index}`,
      description: 'review helper'
    }))
    skills.push({ name: 'review-last', description: '' }, { name: 'review-final', description: '' })
    const includes = String.prototype.includes
    let substringChecks = 0
    const spy = vi.spyOn(String.prototype, 'includes').mockImplementation(function (
      this: string,
      search: string,
      position?: number
    ) {
      substringChecks += 1
      return includes.call(this, search, position)
    })
    let names: string[]
    try {
      names = rankSkillSuggestions(skills, 'review', 8).map((skill) => skill.name)
    } finally {
      spy.mockRestore()
    }
    expect(names).toEqual([
      'review-last',
      'review-final',
      ...skills.slice(0, 6).map((skill) => skill.name)
    ])
    expect(substringChecks).toBeLessThanOrEqual(16)
  })

  it('keeps prefix matches ahead of description matches', () => {
    const skills = [
      { name: 'deploy', description: 'run a review first' },
      { name: 'review-notes', description: '' }
    ]
    expect(rankSkillSuggestions(skills, 'review', 4).map((skill) => skill.name)).toEqual([
      'review-notes',
      'deploy'
    ])
  })
})
