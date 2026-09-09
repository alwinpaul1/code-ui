import type { ConnectionState } from './types'

type RelaySessionStateSource = {
  getState: () => ConnectionState
  isClosed: () => boolean
  onStateChange: (listener: (state: ConnectionState) => void) => () => void
}

/**
 * Resolve once the relay session is connected; reject on a terminal state or
 * after `timeoutMs`. State changes are edge-triggered, so a session that
 * already failed is checked directly — before 2026-09-09 a request arriving
 * after `fail()` saw no event and could only die on the 30 s timer.
 */
export function waitForRelaySessionConnected(
  source: RelaySessionStateSource,
  timeoutMs: number
): Promise<void> {
  const state = source.getState()
  if (state === 'connected') {
    return Promise.resolve()
  }
  if (source.isClosed()) {
    return Promise.reject(new Error(`relay session ${state}`))
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = source.onStateChange((next) => {
      if (next === 'connected') {
        finish()
        resolve()
      } else if (next === 'disconnected' || next === 'auth-failed') {
        finish()
        reject(new Error(`relay session ${next}`))
      }
    })
    timer = setTimeout(() => {
      finish()
      reject(new Error('relay session connection timed out'))
    }, timeoutMs)
    function finish(): void {
      if (timer) {
        clearTimeout(timer)
      }
      unsubscribe()
    }
  })
}
