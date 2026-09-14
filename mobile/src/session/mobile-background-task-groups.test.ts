import { describe, expect, it } from 'vitest'
import { groupRunningTasksByKind } from './mobile-background-task-groups'
import type { BackgroundTask } from './mobile-background-tasks'

const task = (id: string, kind: BackgroundTask['kind']): BackgroundTask => ({
  id,
  kind,
  title: id,
  status: 'running',
  startedAt: null,
  elapsedMs: null
})

describe('grouping running background tasks by kind', () => {
  it('splits shells and agents into their own labelled groups, shells first', () => {
    const groups = groupRunningTasksByKind([
      task('s1', 'shell'),
      task('a1', 'agent'),
      task('s2', 'shell'),
      task('a2', 'agent')
    ])
    expect(groups.map((group) => [group.kind, group.heading, group.tasks.length])).toEqual([
      ['shell', 'Shells · 2', 2],
      ['agent', 'Agents · 2', 2]
    ])
  })

  it('uses a singular heading for a lone task of a kind', () => {
    const groups = groupRunningTasksByKind([task('s1', 'shell'), task('a1', 'agent')])
    expect(groups.map((group) => group.heading)).toEqual(['Shell · 1', 'Agent · 1'])
  })

  it('shows only the kinds that are present', () => {
    const groups = groupRunningTasksByKind([task('a1', 'agent'), task('a2', 'agent')])
    expect(groups.map((group) => group.kind)).toEqual(['agent'])
  })

  it('is empty when nothing is running', () => {
    expect(groupRunningTasksByKind([])).toEqual([])
  })
})
