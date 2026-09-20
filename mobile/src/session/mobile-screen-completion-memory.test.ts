import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCREEN_COMPLETION_MEMORY,
  rememberScreenCompletions,
  screenCompletionsFromMemory
} from './mobile-screen-completion-memory'

const build = { label: 'Build the release APK locally', status: 'completed' }
const gate = { label: 'Run the gate', status: 'completed' }

describe('completion rows remembered across screen polls', () => {
  it('keeps a row once it has scrolled away', () => {
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build])
    const gone = rememberScreenCompletions(seen, [])
    expect(screenCompletionsFromMemory(gone)).toEqual([build])
  })

  it('returns the same map when a poll shows nothing new, so nothing re-renders', () => {
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build])
    expect(rememberScreenCompletions(seen, [build])).toBe(seen)
    expect(rememberScreenCompletions(seen, [])).toBe(seen)
  })

  it('counts two identical rows on one screen as two completions, not one every poll', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, gate])
    for (let poll = 0; poll < 5; poll += 1) {
      memory = rememberScreenCompletions(memory, [gate, gate])
    }
    expect(screenCompletionsFromMemory(memory)).toEqual([gate, gate])
  })

  it('counts the same row seen once and later once as one', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate])
    memory = rememberScreenCompletions(memory, [])
    memory = rememberScreenCompletions(memory, [gate])
    expect(screenCompletionsFromMemory(memory)).toEqual([gate])
  })

  it('tells a failed row from a completed one with the same label', () => {
    const memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, { ...gate, status: 'failed' }])
    expect(screenCompletionsFromMemory(memory)).toHaveLength(2)
  })

  it('starts empty and yields nothing from nothing', () => {
    expect(screenCompletionsFromMemory(EMPTY_SCREEN_COMPLETION_MEMORY)).toEqual([])
    expect(rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [])).toBe(EMPTY_SCREEN_COMPLETION_MEMORY)
  })
})
