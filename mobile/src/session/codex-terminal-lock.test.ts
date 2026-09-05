import { beforeEach, describe, expect, it } from 'vitest'
import { resetCodexTerminalLockForTests, withCodexTerminalLock } from './codex-terminal-lock'

describe('withCodexTerminalLock', () => {
  beforeEach(() => resetCodexTerminalLockForTests())

  it('runs drivers on the same terminal strictly one after another', async () => {
    const order: string[] = []
    const slow = withCodexTerminalLock('t', async () => {
      order.push('a-start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('a-end')
      return 'a'
    })
    const fast = withCodexTerminalLock('t', async () => {
      order.push('b')
      return 'b'
    })
    expect(await Promise.all([slow, fast])).toEqual(['a', 'b'])
    expect(order).toEqual(['a-start', 'a-end', 'b'])
  })

  it('lets a failure release the lock for the next driver', async () => {
    await expect(
      withCodexTerminalLock('t', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(await withCodexTerminalLock('t', async () => 'next')).toBe('next')
  })

  it('does not serialize different terminals against each other', async () => {
    const order: string[] = []
    const a = withCodexTerminalLock('x', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('x')
    })
    const b = withCodexTerminalLock('y', async () => {
      order.push('y')
    })
    await Promise.all([a, b])
    expect(order).toEqual(['y', 'x'])
  })
})
