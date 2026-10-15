import { describe, expect, it } from 'vitest'
import { agentWorksInWorktree } from './agent-works-in-worktree'

// Project folder names as Claude Code 2.1.300 writes them (`j0` in the binary): every character
// that is not a letter or digit becomes `-`; past 200 characters the name is cut and hashed.

describe('where a Claude session works, against its tab’s worktree', () => {
  it('says elsewhere for the reported tab: a NexOS tab whose agent worked in the NexOS-Mobile checkout', () => {
    expect(
      agentWorksInWorktree(
        '/Users/alwinpaul/.claude-work/projects/-Users-alwinpaul-Desktop-NexOS-Mobile-wt-tablet-cab-redesign/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl',
        '/Users/alwinpaul/Desktop/NexDash/NexOS'
      )
    ).toBe('elsewhere')
  })

  it('says here for a session started in the worktree, under any config dir', () => {
    expect(agentWorksInWorktree('/Users/a/.claude/projects/-Users-a-Desktop-Project-Code-UI/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl', '/Users/a/Desktop/Project/Code UI')).toBe('here')
    expect(agentWorksInWorktree('/Users/a/.claude-work/projects/-Users-a-Desktop-Project-Code-UI/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl', '/Users/a/Desktop/Project/Code UI')).toBe('here')
  })

  it('does not take a sibling whose name starts the same for the worktree (NexOS vs NexOS-Mobile)', () => {
    expect(agentWorksInWorktree('/Users/a/.claude/projects/-Users-a-NexOS-Mobile/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl', '/Users/a/NexOS')).toBe('elsewhere')
  })

  it('says unknown with no transcript, no worktree path, or a path that is not a Claude transcript', () => {
    expect(agentWorksInWorktree(null, '/w')).toBe('unknown')
    expect(agentWorksInWorktree('', '/w')).toBe('unknown')
    expect(agentWorksInWorktree('/Users/a/.claude/projects/-w/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl', null)).toBe('unknown')
    expect(agentWorksInWorktree('/Users/a/.codex/sessions/2026/10/15/rollout-x.jsonl', '/w')).toBe('unknown')
  })

  it('reads a Windows transcript path with its own separators', () => {
    expect(agentWorksInWorktree('C:\\Users\\a\\.claude\\projects\\C--Users-a-repo\\e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl', 'C:\\Users\\a\\repo')).toBe('here')
  })

  it('matches a worktree path long enough to be cut and hashed by its cut name', () => {
    const worktree = `/Users/a/${'deep/'.repeat(45)}repo`
    const cut = worktree.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200)
    expect(agentWorksInWorktree(`/Users/a/.claude/projects/${cut}-1x9k2/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl`, worktree)).toBe('here')
    expect(agentWorksInWorktree(`/Users/a/.claude/projects/${cut}/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl`, worktree)).toBe('elsewhere')
  })
})
