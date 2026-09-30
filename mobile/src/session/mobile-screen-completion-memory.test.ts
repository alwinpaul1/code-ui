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
const bound = (memory: Parameters<typeof screenCompletionsFromMemory>[0]) =>
  screenCompletionsFromMemory(memory).map((row) => [row.label, row.launchIds])

// The window's labelled shell launches, oldest first, as readTaskEvidence
// hands them over.
const gate1 = { id: 'bgate0001', label: 'Run the gate' }
const gate2 = { id: 'bgate0002', label: 'Run the gate' }
const build1 = { id: 'bud7tazkw', label: 'Build the release APK locally' }

describe('completion rows remembered across screen polls', () => {
  it('keeps a row once it has scrolled away', () => {
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build], [build1])
    const gone = rememberScreenCompletions(seen, [], [build1])
    expect(labels(gone)).toEqual([build])
  })

  it('returns the same memory when a poll shows nothing new, so nothing re-renders', () => {
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build], [build1])
    expect(rememberScreenCompletions(seen, [build], [build1])).toBe(seen)
    expect(rememberScreenCompletions(seen, [], [build1]).copies).toBe(seen.copies)
  })

  it('counts two identical rows on one screen as two completions, not one every poll', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, gate], [gate1, gate2])
    for (let poll = 0; poll < 5; poll += 1) {
      memory = rememberScreenCompletions(memory, [gate, gate], [gate1, gate2])
    }
    expect(labels(memory)).toEqual([gate, gate])
  })

  it('counts the same row seen once and later once as one', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1])
    memory = rememberScreenCompletions(memory, [], [gate1])
    memory = rememberScreenCompletions(memory, [gate], [gate1])
    expect(labels(memory)).toEqual([gate])
  })

  it('tells a failed row from a completed one with the same label', () => {
    const memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, { ...gate, status: 'failed' }], [gate1, gate2])
    expect(screenCompletionsFromMemory(memory)).toHaveLength(2)
  })

  it('starts empty and yields nothing from nothing', () => {
    expect(screenCompletionsFromMemory(EMPTY_SCREEN_COMPLETION_MEMORY)).toEqual([])
    expect(rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [], [])).toBe(EMPTY_SCREEN_COMPLETION_MEMORY)
    expect(rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [], [gate1])).toBe(EMPTY_SCREEN_COMPLETION_MEMORY)
  })
})

// A row outlives its shell here; the reader needs which launches the row
// can have announced to keep it off a relaunch under the same description.
describe('the launches each remembered row is bound to', () => {
  it('keeps the launches the window held when a row was first seen, not those of a later poll that still shows it', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1])
    memory = rememberScreenCompletions(memory, [gate], [gate1, gate2])
    expect(screenCompletionsFromMemory(memory)).toEqual([{ ...gate, launchIds: ['bgate0001'] }])
  })

  it('binds a second identical row to the launches held when the poll first showed two', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1])
    memory = rememberScreenCompletions(memory, [gate, gate], [gate1, gate2])
    expect(bound(memory)).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Run the gate', ['bgate0001', 'bgate0002']]
    ])
  })

  it('hands the rows over in the order they were first seen, whatever row text they carry', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1])
    memory = rememberScreenCompletions(memory, [gate, build], [gate1, build1])
    memory = rememberScreenCompletions(memory, [gate, gate, build], [gate1, build1, gate2])
    expect(bound(memory)).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Build the release APK locally', ['bud7tazkw']],
      ['Run the gate', ['bgate0001', 'bgate0002']]
    ])
  })

  it('binds a row by its whitespace-folded label, as the transcript stores it', () => {
    const memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [{ label: 'Run  the\ngate', status: 'completed' }], [gate1])
    expect(bound(memory)).toEqual([['Run  the\ngate', ['bgate0001']]])
  })

  // A shell that ends within a poll or two: its row is painted before the
  // phone's transcript read holds the launch.
  it('lets a row seen before any launch with its label retire nothing until one appears, then binds it to that one', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [])
    expect(bound(memory)).toEqual([['Run the gate', []]])
    memory = rememberScreenCompletions(memory, [], [build1])
    expect(bound(memory)).toEqual([['Run the gate', []]])
    memory = rememberScreenCompletions(memory, [], [build1, gate1])
    expect(bound(memory)).toEqual([['Run the gate', ['bgate0001']]])
    // Bound once: a later relaunch is not added to it.
    expect(bound(rememberScreenCompletions(memory, [], [build1, gate1, gate2]))).toEqual([['Run the gate', ['bgate0001']]])
  })

  it('binds such a row to the first of several launches that appear together, never to all of them', () => {
    const waiting = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [])
    expect(bound(rememberScreenCompletions(waiting, [], [gate1, gate2]))).toEqual([['Run the gate', ['bgate0001']]])
  })

  it('binds two such rows to one launch each', () => {
    const waiting = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, { ...gate, status: 'failed' }], [])
    expect(bound(rememberScreenCompletions(waiting, [], [gate1, gate2]))).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Run the gate', ['bgate0002']]
    ])
  })

  it('never binds a row seen while a launch with its label was known, even a settled one, to a later launch', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1])
    memory = rememberScreenCompletions(memory, [], [gate1, gate2])
    expect(bound(memory)).toEqual([['Run the gate', ['bgate0001']]])
  })
})
