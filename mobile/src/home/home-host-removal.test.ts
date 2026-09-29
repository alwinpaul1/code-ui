import { describe, expect, it, vi } from 'vitest'
import { removeHomeHost, type HomeHostRemovalDeps } from './home-host-removal'

/**
 * Reported 2026-09-30 from the source: home said "Could not remove host" and put the Remove Host
 * sheet back when the removal had already committed and only the catalog read after it failed, and
 * the removed desktop stayed listed. Each step here is a genuine rejection, not a stub returning [].
 */
const host = { id: 'b', name: 'Studio Mac' }

function deps(over: Partial<HomeHostRemovalDeps> = {}) {
  const order: string[] = []
  const d = {
    remove: vi.fn(async (_hostId: string) => {
      order.push('remove')
    }),
    dropLocally: vi.fn((_hostId: string) => {
      order.push('drop')
    }),
    reread: vi.fn(async () => {
      order.push('reread')
    }),
    setConfirm: vi.fn(),
    alert: vi.fn(),
    warn: vi.fn(),
    ...over
  }
  return { d, order }
}

describe('removing a desktop from home', () => {
  it('says removal failed, and keeps the confirm sheet, when the removal itself fails', async () => {
    const { d } = deps({ remove: vi.fn(() => Promise.reject(new Error('storage write failed'))) })
    await removeHomeHost(host, d)
    expect(d.alert).toHaveBeenCalledTimes(1)
    expect(d.alert).toHaveBeenCalledWith('Could not remove host', 'Please try again.')
    expect(d.setConfirm).toHaveBeenLastCalledWith(host)
    expect(d.dropLocally).not.toHaveBeenCalled()
    expect(d.reread).not.toHaveBeenCalled()
    // The one line it leaves behind names the step that failed.
    expect(d.warn).toHaveBeenCalledWith(
      expect.stringMatching(/removing host b failed/),
      expect.any(Error)
    )
  })

  it('does not say removal failed when only the re-read after it fails', async () => {
    const { d } = deps({ reread: vi.fn(() => Promise.reject(new Error('keychain locked'))) })
    await removeHomeHost(host, d)
    expect(d.alert).not.toHaveBeenCalled()
    expect(d.setConfirm).not.toHaveBeenCalledWith(host)
    expect(d.setConfirm).toHaveBeenLastCalledWith(null)
    expect(d.dropLocally).toHaveBeenCalledWith('b')
    expect(d.warn).toHaveBeenCalledWith(
      expect.stringMatching(/host b was removed, but the catalog re-read after it failed/),
      expect.any(Error)
    )
  })

  it('takes the desktop off the list at once, not after a re-read that never settles', async () => {
    const { d } = deps({ reread: vi.fn(() => new Promise<void>(() => {})) })
    void removeHomeHost(host, d)
    await Promise.resolve()
    await Promise.resolve()
    expect(d.setConfirm).toHaveBeenLastCalledWith(null)
    expect(d.dropLocally).toHaveBeenCalledWith('b')
    expect(d.alert).not.toHaveBeenCalled()
  })

  it('closes the sheet, takes the desktop off the list, then re-reads, when both succeed', async () => {
    const { d, order } = deps()
    await removeHomeHost(host, d)
    expect(order).toEqual(['remove', 'drop', 'reread'])
    expect(d.remove).toHaveBeenCalledWith('b')
    expect(d.setConfirm).toHaveBeenCalledTimes(1)
    expect(d.setConfirm).toHaveBeenCalledWith(null)
    expect(d.alert).not.toHaveBeenCalled()
    expect(d.warn).not.toHaveBeenCalled()
  })
})
