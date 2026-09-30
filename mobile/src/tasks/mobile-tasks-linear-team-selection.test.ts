import { describe, expect, it } from 'vitest'
import type { LinearTeam } from '../../../src/shared/linear/workspace-types'
import { reconcileTeamSelection } from './mobile-tasks-reviewer-linear'

// Orca #22279 (v1.4.211..v1.4.217): a saved `defaultLinearTeamSelection` that was not a string array
// (a bare string reached Orca 1.4.207, report 0a2b6e7f) threw "filter is not a function" and took
// the page down. A host that predates the desktop fix projects that raw value to paired clients,
// so the phone reads it the same way: anything but an array means every team.
const teams = [
  { id: 'team-a', name: 'Alpha', key: 'ALP' },
  { id: 'team-b', name: 'Beta', key: 'BET' }
] as LinearTeam[]

describe('reconcileTeamSelection', () => {
  it('keeps the saved teams that still exist', () => {
    expect([...reconcileTeamSelection(teams, ['team-b', 'gone'])]).toEqual(['team-b'])
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty list', []],
    ['only teams that no longer exist', ['gone']],
    ['a bare string, as Orca 1.4.207 saved it', 'team-a'],
    ['an object', { 0: 'team-a' }],
    ['a number', 3]
  ])('reads %s as every team', (_name, saved) => {
    expect([...reconcileTeamSelection(teams, saved)]).toEqual(['team-a', 'team-b'])
  })

  it('reads a list with a non-string entry by its strings', () => {
    expect([...reconcileTeamSelection(teams, ['team-a', 7, null])]).toEqual(['team-a'])
  })

  it('answers an empty team list without throwing', () => {
    expect([...reconcileTeamSelection([], 'team-a')]).toEqual([])
    expect([...reconcileTeamSelection([], ['team-a'])]).toEqual([])
  })
})
