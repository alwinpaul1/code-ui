import { useEffect } from 'react'
import { AppState } from 'react-native'

/** Calls `onReturn` each time the app comes back to the foreground. `onReturn`
 *  should be stable; it is subscribed once per identity. vitest.setup.ts stubs
 *  this for every test, since component tests mock 'react-native' to a few host
 *  tags with no AppState; composer-keeps-keyboard-focus.test.tsx drives it. */
export function useAppReturns(onReturn: () => void): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        onReturn()
      }
    })
    return () => subscription.remove()
  }, [onReturn])
}
