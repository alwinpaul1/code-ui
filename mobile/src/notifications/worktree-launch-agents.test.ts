import { afterEach, describe, expect, it } from 'vitest'
import {
  resetWorktreeLaunchAgentsForTests,
  setWorktreeLaunchAgents,
  uniqueWorktreeLaunchAgent
} from './worktree-launch-agents'

afterEach(() => {
  resetWorktreeLaunchAgentsForTests()
})

describe('unique worktree launch agent', () => {
  it('returns Grok when that is the only agent launched there', () => {
    setWorktreeLaunchAgents('wt-1', ['grok', 'grok'])
    expect(uniqueWorktreeLaunchAgent('wt-1')).toBe('grok')
  })

  it('returns null when Claude and Grok both ran', () => {
    setWorktreeLaunchAgents('wt-1', ['grok', 'claude'])
    expect(uniqueWorktreeLaunchAgent('wt-1')).toBeNull()
  })
})
