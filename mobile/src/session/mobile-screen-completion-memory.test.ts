import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCREEN_COMPLETION_MEMORY,
  rememberScreenCompletions,
  screenCompletionsFromMemory
} from './mobile-screen-completion-memory'

/** The phone time of every poll below, unless a case is about time. */
const T0 = 1_000
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
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build], [build1], T0)
    const gone = rememberScreenCompletions(seen, [], [build1], T0)
    expect(labels(gone)).toEqual([build])
  })

  it('returns the same memory when a poll shows nothing new, so nothing re-renders', () => {
    const seen = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [build], [build1], T0)
    expect(rememberScreenCompletions(seen, [build], [build1], T0)).toBe(seen)
    expect(rememberScreenCompletions(seen, [], [build1], T0).copies).toBe(seen.copies)
  })

  it('counts two identical rows on one screen as two completions, not one every poll', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, gate], [gate1, gate2], T0)
    for (let poll = 0; poll < 5; poll += 1) {
      memory = rememberScreenCompletions(memory, [gate, gate], [gate1, gate2], T0)
    }
    expect(labels(memory)).toEqual([gate, gate])
  })

  it('counts the same row seen once and later once as one', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [], [gate1], T0)
    memory = rememberScreenCompletions(memory, [gate], [gate1], T0)
    expect(labels(memory)).toEqual([gate])
  })

  it('tells a failed row from a completed one with the same label', () => {
    const memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, { ...gate, status: 'failed' }], [gate1, gate2], T0)
    expect(screenCompletionsFromMemory(memory)).toHaveLength(2)
  })

  it('starts empty and yields nothing from nothing', () => {
    expect(screenCompletionsFromMemory(EMPTY_SCREEN_COMPLETION_MEMORY)).toEqual([])
    expect(rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [], [], T0)).toBe(EMPTY_SCREEN_COMPLETION_MEMORY)
    expect(rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [], [gate1], T0)).toBe(EMPTY_SCREEN_COMPLETION_MEMORY)
  })
})

// A row outlives its shell here; the reader needs which launches the row
// can have announced to keep it off a relaunch under the same description.
describe('the launches each remembered row is bound to', () => {
  it('keeps the launches the window held when a row was first seen, not those of a later poll that still shows it', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [gate], [gate1, gate2], T0)
    expect(screenCompletionsFromMemory(memory)).toEqual([{ ...gate, launchIds: ['bgate0001'] }])
  })

  it('binds a second identical row to the launches held when the poll first showed two', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [gate, gate], [gate1, gate2], T0)
    expect(bound(memory)).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Run the gate', ['bgate0001', 'bgate0002']]
    ])
  })

  it('hands the rows over in the order they were first seen, whatever row text they carry', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [gate, build], [gate1, build1], T0)
    memory = rememberScreenCompletions(memory, [gate, gate, build], [gate1, build1, gate2], T0)
    expect(bound(memory)).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Build the release APK locally', ['bud7tazkw']],
      ['Run the gate', ['bgate0001', 'bgate0002']]
    ])
  })

  it('binds a row by its whitespace-folded label, as the transcript stores it', () => {
    const memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [{ label: 'Run  the\ngate', status: 'completed' }], [gate1], T0)
    expect(bound(memory)).toEqual([['Run  the\ngate', ['bgate0001']]])
  })

  // A shell that ends within a poll or two: its row is painted before the
  // phone's transcript read holds the launch.
  it('lets a row seen before any launch with its label retire nothing until one appears, then binds it to that one', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [], T0)
    expect(bound(memory)).toEqual([['Run the gate', []]])
    memory = rememberScreenCompletions(memory, [], [build1], T0)
    expect(bound(memory)).toEqual([['Run the gate', []]])
    memory = rememberScreenCompletions(memory, [], [build1, gate1], T0)
    expect(bound(memory)).toEqual([['Run the gate', ['bgate0001']]])
    // Bound once: a later relaunch is not added to it.
    expect(bound(rememberScreenCompletions(memory, [], [build1, gate1, gate2], T0))).toEqual([['Run the gate', ['bgate0001']]])
  })

  it('binds such a row to the first of several launches that appear together, never to all of them', () => {
    const waiting = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [], T0)
    expect(bound(rememberScreenCompletions(waiting, [], [gate1, gate2], T0))).toEqual([['Run the gate', ['bgate0001']]])
  })

  // A chat opens on 40 records: the launch a row names can be above them, and
  // never arrive. The next launch under its description is then a relaunch.
  it('binds such a row to a launch that comes in 10 s after it was first seen, the last moment it may', () => {
    const waiting = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [], T0)
    expect(bound(rememberScreenCompletions(waiting, [], [gate1], T0 + 10_000))).toEqual([['Run the gate', ['bgate0001']]])
  })

  it('binds such a row to no launch once it has waited longer than 10 s, even one that comes in later', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [], T0)
    expect(bound(rememberScreenCompletions(memory, [], [gate1], T0 + 10_001))).toEqual([['Run the gate', []]])
    memory = rememberScreenCompletions(memory, [], [], T0 + 30_000)
    expect(bound(memory)).toEqual([['Run the gate', []]])
    expect(bound(rememberScreenCompletions(memory, [], [gate1], T0 + 31_000))).toEqual([['Run the gate', []]])
  })

  it('binds two such rows to one launch each', () => {
    const waiting = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, { ...gate, status: 'failed' }], [], T0)
    expect(bound(rememberScreenCompletions(waiting, [], [gate1, gate2], T0))).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Run the gate', ['bgate0002']]
    ])
  })

  it('never binds a row seen while a launch with its label was known, even a settled one, to a later launch', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [], [gate1, gate2], T0)
    expect(bound(memory)).toEqual([['Run the gate', ['bgate0001']]])
  })
})

// A relaunch's own row reads word for word like the first run's. A row back
// on screen after a poll without it is a new completion only when a launch
// with its label came after the ones its latest copy was bound to.
describe('a row that left the screen and came back', () => {
  const gate3 = { id: 'bgate0003', label: 'Run the gate' }

  it('adds a copy, bound to what the window holds now, when a launch with its label came since', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [], [gate1], T0)
    memory = rememberScreenCompletions(memory, [], [gate1, gate2], T0)
    memory = rememberScreenCompletions(memory, [gate], [gate1, gate2], T0)
    expect(bound(memory)).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Run the gate', ['bgate0001', 'bgate0002']]
    ])
    // Staying on screen adds nothing more.
    expect(rememberScreenCompletions(memory, [gate], [gate1, gate2], T0)).toBe(memory)
  })

  it('adds no copy when nothing was launched in between, with no launch at all or with one', () => {
    let empty = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [], T0)
    empty = rememberScreenCompletions(empty, [], [], T0)
    empty = rememberScreenCompletions(empty, [gate], [], T0)
    expect(bound(empty)).toEqual([['Run the gate', []]])

    let one = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    one = rememberScreenCompletions(one, [], [gate1], T0)
    one = rememberScreenCompletions(one, [gate], [gate1], T0)
    expect(bound(one)).toEqual([['Run the gate', ['bgate0001']]])
  })

  it('does not take an older launch paged in from above the window for a new one', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate2], T0)
    memory = rememberScreenCompletions(memory, [], [gate2], T0)
    memory = rememberScreenCompletions(memory, [gate], [gate1, gate2], T0)
    expect(bound(memory)).toEqual([['Run the gate', ['bgate0002']]])
  })

  it('takes every launch left in the window as new once the ones the row knew have slid out', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [], [gate1], T0)
    memory = rememberScreenCompletions(memory, [gate], [gate2], T0)
    expect(bound(memory)).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Run the gate', ['bgate0002']]
    ])
  })

  it('takes a relaunch’s own row for new after a row whose launch never came in', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [], T0)
    memory = rememberScreenCompletions(memory, [], [], T0 + 20_000)
    memory = rememberScreenCompletions(memory, [], [gate2], T0 + 30_000)
    memory = rememberScreenCompletions(memory, [gate], [gate2], T0 + 300_000)
    expect(bound(memory)).toEqual([
      ['Run the gate', []],
      ['Run the gate', ['bgate0002']]
    ])
  })

  it('adds no more copies than rows on screen, however many launches came since', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate], [gate1], T0)
    memory = rememberScreenCompletions(memory, [], [gate1], T0)
    expect(screenCompletionsFromMemory(rememberScreenCompletions(memory, [gate], [gate1, gate2, gate3], T0))).toHaveLength(2)
    expect(screenCompletionsFromMemory(rememberScreenCompletions(memory, [gate, gate], [gate1, gate2, gate3], T0))).toHaveLength(3)
  })

  it('judges each row text on its own: another row leaving does not make this one come back', () => {
    let memory = rememberScreenCompletions(EMPTY_SCREEN_COMPLETION_MEMORY, [gate, build], [gate1, build1], T0)
    memory = rememberScreenCompletions(memory, [gate], [gate1, build1, gate2], T0)
    expect(bound(memory)).toEqual([
      ['Run the gate', ['bgate0001']],
      ['Build the release APK locally', ['bud7tazkw']]
    ])
  })
})

