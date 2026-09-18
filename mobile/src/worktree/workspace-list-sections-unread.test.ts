import { describe, expect, it } from 'vitest'
import { shouldClearUnreadOnOpen } from './workspace-list-sections'

// "Mark unread" (row #8 of the extension-port map). Split into its own file
// alongside workspace-list-sections-archive.test.ts rather than growing
// workspace-list-sections.test.ts past its max-lines budget.
describe('clearing the unread dot on open', () => {
  it('clears an unread row the moment it is opened', () => {
    expect(shouldClearUnreadOnOpen({ unread: true })).toBe(true)
  })

  it('is a no-op — no RPC worth sending — for a row that was already read', () => {
    expect(shouldClearUnreadOnOpen({ unread: false })).toBe(false)
  })

  it('still clears when the unread row being opened is the one already active', () => {
    // "Marking the active session unread clears the moment it is focused
    // again" — the degenerate case the port brief calls out. isActive plays
    // no part in the decision, which is the point: opening IS focusing it.
    expect(shouldClearUnreadOnOpen({ unread: true })).toBe(true)
  })
})
