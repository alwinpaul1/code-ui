import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCREEN_COMPLETION_MEMORY,
  rememberScreenCompletions,
  screenCompletionsFromMemory
} from './mobile-screen-completion-memory'

const build = { label: 'Build the release APK locally', status: 'completed' }
const gate = { label: 'Run the gate', status: 'completed' }
const labels = (memory: Parameters<typeof screenCompletionsFromMemory>[0]) =>
  screenCompletionsFromMemory(memory).map(({ label, status }) => ({ label, status }))

describe('completion rows remembered across screen polls', () => {
  it('keeps a row once it has scrolled away', () => {
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build], 1_000)
    const gone = rememberScreenCompletions(seen, [], 2_000)
    expect(labels(gone)).toEqual([build])
  })

  it('returns the same map when a poll shows nothing new, so nothing re-renders', () => {
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build], 1_000)
    expect(rememberScreenCompletions(seen, [build], 2_000)).toBe(seen)
    expect(rememberScreenCompletions(seen, [], 3_000)).toBe(seen)
  })

  it('counts two identical rows on one screen as two completions, not one every poll', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, gate], 1_000)
    for (let poll = 0; poll < 5; poll += 1) {
      memory = rememberScreenCompletions(memory, [gate, gate], 2_000 + poll * 1_000)
    }
    expect(labels(memory)).toEqual([gate, gate])
  })

  it('counts the same row seen once and later once as one', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], 1_000)
    memory = rememberScreenCompletions(memory, [], 2_000)
    memory = rememberScreenCompletions(memory, [gate], 3_000)
    expect(labels(memory)).toEqual([gate])
  })

  it('tells a failed row from a completed one with the same label', () => {
    const memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, { ...gate, status: 'failed' }], 1_000)
    expect(screenCompletionsFromMemory(memory)).toHaveLength(2)
  })

  it('starts empty and yields nothing from nothing', () => {
    expect(screenCompletionsFromMemory(EMPTY_SCREEN_COMPLETION_MEMORY)).toEqual([])
    expect(rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [], 1_000)).toBe(EMPTY_SCREEN_COMPLETION_MEMORY)
  })

  // A row outlives its shell here; the reader needs when it was first seen to
  // keep it off a relaunch under the same description.
  it('keeps the time a row was first seen, not the time of a later poll that still shows it', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], 1_000)
    memory = rememberScreenCompletions(memory, [gate], 2_000)
    memory = rememberScreenCompletions(memory, [], 3_000)
    memory = rememberScreenCompletions(memory, [gate], 4_000)
    expect(screenCompletionsFromMemory(memory)).toEqual([{ ...gate, seenAt: 1_000 }])
  })

  it('stamps a second identical row with the poll that first showed two', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], 1_000)
    memory = rememberScreenCompletions(memory, [gate, gate], 5_000)
    expect(screenCompletionsFromMemory(memory)).toEqual([
      { ...gate, seenAt: 1_000 },
      { ...gate, seenAt: 5_000 }
    ])
  })

  it('hands the rows over earliest first, whatever row text they carry', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], 1_000)
    memory = rememberScreenCompletions(memory, [gate, build], 2_000)
    memory = rememberScreenCompletions(memory, [gate, gate, build], 3_000)
    expect(screenCompletionsFromMemory(memory).map((row) => [row.label, row.seenAt])).toEqual([
      ['Run the gate', 1_000],
      ['Build the release APK locally', 2_000],
      ['Run the gate', 3_000]
    ])
  })
})
