import { describe, expect, it, vi } from 'vitest'
import { forwardBackgroundClientRevival } from './background-client-revival'

describe('background client revival', () => {
  it('does not replace the relay a second time when the network changes', () => {
    const notify = vi.fn()
    forwardBackgroundClientRevival('network-change', notify)
    expect(notify).not.toHaveBeenCalled()
  })

  it('still tells the background relay when the screen returns', () => {
    const notify = vi.fn()
    forwardBackgroundClientRevival('app-resume', notify)
    expect(notify).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith('app-resume')
  })
})
