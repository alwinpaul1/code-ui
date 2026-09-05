import { beforeEach, describe, expect, it } from 'vitest'
import {
  readCachedSessionTabs,
  resetSessionTabsCacheForTests,
  sessionTabsCacheKey,
  writeCachedSessionTabs
} from './mobile-session-tabs-cache'
import type { MobileSessionTab } from './mobile-session-route-types'

const tab = (id: string) => ({ id, type: 'terminal', title: id }) as unknown as MobileSessionTab

describe('session tabs cache', () => {
  beforeEach(() => resetSessionTabsCacheForTests())

  it('returns the last accepted tabs for a project and nothing for an unseen one', () => {
    const key = sessionTabsCacheKey('host-1', 'repo::/a')
    expect(readCachedSessionTabs(key)).toEqual([])
    writeCachedSessionTabs(key, [tab('t1')])
    expect(readCachedSessionTabs(key).map((t) => t.id)).toEqual(['t1'])
    expect(readCachedSessionTabs(sessionTabsCacheKey('host-1', 'repo::/b'))).toEqual([])
  })

  it('keeps at most twelve projects', () => {
    for (let i = 0; i < 13; i += 1) {
      writeCachedSessionTabs(sessionTabsCacheKey('h', `w${i}`), [tab(`t${i}`)])
    }
    expect(readCachedSessionTabs(sessionTabsCacheKey('h', 'w0'))).toEqual([])
    expect(readCachedSessionTabs(sessionTabsCacheKey('h', 'w12'))).toHaveLength(1)
  })
})
