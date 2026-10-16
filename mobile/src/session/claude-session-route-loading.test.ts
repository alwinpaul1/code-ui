import { afterEach, describe, expect, it } from 'vitest'
import type { MobileSessionTab } from './mobile-session-route-types'
import { resetSessionTabsCacheForTests, sessionTabsCacheKey, writeCachedSessionTabs } from './mobile-session-tabs-cache'
import { cachedSessionRouteOpensClaude, sessionRouteOpensClaude, sessionRouteWorktreeId } from './claude-session-route-loading'

// 2026-10-16, from the device: a Claude session opening drew a bare spinner on an empty screen
// (the host compatibility check, HostProtocolGate, holding the whole host route back while the
// relay dialled). The user wanted "the screen with the mascot and loading session text". The
// gate cannot see the tab before the routes mount, but the phone's tab cache already knows which
// tab the session will open on.

function tab(fields: Partial<MobileSessionTab> & { id: string; type: string }): MobileSessionTab {
  return { title: fields.id, isActive: false, ...fields } as unknown as MobileSessionTab
}

const claudeTab = tab({ id: 't1', type: 'terminal', isActive: true, agentStatus: { agentType: 'claude' } } as never)
const shellTab = tab({ id: 't2', type: 'terminal', isActive: true })

afterEach(() => resetSessionTabsCacheForTests())

describe('a session route opening on a Claude tab', () => {
  it('is known from the cached tabs while the host check still holds the screen', () => {
    writeCachedSessionTabs(sessionTabsCacheKey('host-1', 'wt-1'), [shellTab, claudeTab].map((t) => ({ ...t, isActive: t === claudeTab })))
    expect(cachedSessionRouteOpensClaude('/h/host-1/session/wt-1', 'host-1')).toBe(true)
  })

  it('is not claimed for a plain terminal, another route, another host, or nothing cached', () => {
    writeCachedSessionTabs(sessionTabsCacheKey('host-1', 'wt-1'), [shellTab])
    expect(cachedSessionRouteOpensClaude('/h/host-1/session/wt-1', 'host-1')).toBe(false)
    writeCachedSessionTabs(sessionTabsCacheKey('host-1', 'wt-2'), [claudeTab])
    expect(cachedSessionRouteOpensClaude('/h/host-1/files/wt-2', 'host-1')).toBe(false)
    expect(cachedSessionRouteOpensClaude('/h/host-1/session/wt-2', 'host-2')).toBe(false)
    expect(cachedSessionRouteOpensClaude('/h/host-1/session/wt-9', 'host-1')).toBe(false)
    expect(cachedSessionRouteOpensClaude('/h/host-1/session/wt-2', undefined)).toBe(false)
  })
})

describe('the worktree a session route names', () => {
  it('is read from the path, decoded, and only for that host', () => {
    expect(sessionRouteWorktreeId('/h/host-1/session/wt-1', 'host-1')).toBe('wt-1')
    expect(sessionRouteWorktreeId('/h/host-1/session/folder%3A%2Fx', 'host-1')).toBe('folder:/x')
    expect(sessionRouteWorktreeId('/h/host-1/session/wt-1/extra', 'host-1')).toBe('wt-1')
    expect(sessionRouteWorktreeId('/h/host-1/session/', 'host-1')).toBeNull()
    expect(sessionRouteWorktreeId('/h/host-1', 'host-1')).toBeNull()
    expect(sessionRouteWorktreeId('/h/host-2/session/wt-1', 'host-1')).toBeNull()
    expect(sessionRouteWorktreeId('/h/host-1/session/%E0%A4%A', 'host-1')).toBeNull()
  })
})

// 2026-10-16: a workspace never opened on this phone has no cache, so the host check drew a bare
// spinner for a Claude session; the tapped row's hint (`?agent=claude`) speaks when nothing is cached.
describe('a session route with the tapped row\'s hint', () => {
  it('draws Clawd on the hint when nothing is cached for the workspace', () => {
    expect(sessionRouteOpensClaude('/h/host-1/session/wt-new', 'host-1', 'claude')).toBe(true)
  })

  it('keeps the spinner with no hint, or on another route or host', () => {
    expect(sessionRouteOpensClaude('/h/host-1/session/wt-new', 'host-1', null)).toBe(false)
    expect(sessionRouteOpensClaude('/h/host-1/files/wt-new', 'host-1', 'claude')).toBe(false)
    expect(sessionRouteOpensClaude('/h/host-1/session/wt-new', 'host-2', 'claude')).toBe(false)
    expect(sessionRouteOpensClaude('/h/host-1/session/wt-new', undefined, 'claude')).toBe(false)
  })

  it('lets the cached tabs, which the phone saw itself, outrank the hint either way', () => {
    writeCachedSessionTabs(sessionTabsCacheKey('host-1', 'wt-1'), [shellTab])
    expect(sessionRouteOpensClaude('/h/host-1/session/wt-1', 'host-1', 'claude')).toBe(false)
    writeCachedSessionTabs(sessionTabsCacheKey('host-1', 'wt-2'), [claudeTab])
    expect(sessionRouteOpensClaude('/h/host-1/session/wt-2', 'host-1', null)).toBe(true)
  })
})
