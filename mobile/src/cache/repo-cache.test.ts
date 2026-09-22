import { describe, expect, it, vi } from 'vitest'

import { getCachedRepos, setCachedRepos } from './repo-cache'
import {
  clearProjectNotificationIconsForTest,
  projectNotificationIconForLocation
} from '../notifications/project-notification-icon'

describe('repo cache', () => {
  it('returns recent host-scoped repos', () => {
    const repos = [{ id: 'repo-1' }]

    setCachedRepos('host-1', repos)

    expect(getCachedRepos('host-1')).toBe(repos)
    expect(getCachedRepos('host-2')).toBeNull()
  })

  it('keeps a project picture for notifications after the repo list expires', () => {
    clearProjectNotificationIconsForTest()
    vi.useFakeTimers()
    try {
      setCachedRepos('host-1', [
        {
          displayName: 'NexOS',
          repoIcon: { type: 'image', src: 'https://github.com/nexos.png?size=64' }
        }
      ])
      vi.advanceTimersByTime(60_001)

      expect(getCachedRepos('host-1')).toBeNull()
      expect(projectNotificationIconForLocation('NexOS / main')).toBe(
        'https://github.com/nexos.png?size=64'
      )
    } finally {
      vi.useRealTimers()
      clearProjectNotificationIconsForTest()
    }
  })

  it('expires stale entries', () => {
    vi.useFakeTimers()
    try {
      setCachedRepos('host-stale', [{ id: 'repo-stale' }])
      vi.advanceTimersByTime(60_001)

      expect(getCachedRepos('host-stale')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
