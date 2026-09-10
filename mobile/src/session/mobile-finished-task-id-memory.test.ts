import { describe, expect, it } from 'vitest'
import {
  FINISHED_TASK_ID_MEMORY_MAX,
  rememberFinishedTaskIds
} from './mobile-finished-task-id-memory'

describe('finished background-task ids the beacon has already reported', () => {
  it('keeps a task retired after its id scrolls out of the beacon window', () => {
    // Measured 2026-09-10 on a 40 MB transcript: the status line reads a fixed
    // tail, and a busy session wrote past it in 87 seconds. The completion for
    // ae7466e035c7b1bcd was 1.27 MB behind the end by the next refresh, so the
    // beacon stopped naming it and the phone showed a dead agent as running.
    const first = rememberFinishedTaskIds([], ['ae7466e035c7b1bcd'])
    const second = rememberFinishedTaskIds(first, [])
    expect(second).toContain('ae7466e035c7b1bcd')
  })

  it('unions later ids without repeating an earlier one', () => {
    const first = rememberFinishedTaskIds([], ['a', 'b'])
    const second = rememberFinishedTaskIds(first, ['b', 'c'])
    expect(second).toEqual(['a', 'b', 'c'])
  })

  it('returns the same array when nothing new arrived, so renders stay stable', () => {
    const first = rememberFinishedTaskIds([], ['a'])
    expect(rememberFinishedTaskIds(first, ['a'])).toBe(first)
    expect(rememberFinishedTaskIds(first, [])).toBe(first)
  })

  it('drops the oldest ids rather than growing without bound', () => {
    const many = Array.from({ length: FINISHED_TASK_ID_MEMORY_MAX + 10 }, (_, i) => `t${i}`)
    const remembered = rememberFinishedTaskIds([], many)
    expect(remembered).toHaveLength(FINISHED_TASK_ID_MEMORY_MAX)
    expect(remembered.at(-1)).toBe(`t${many.length - 1}`)
    expect(remembered).not.toContain('t0')
  })
})
