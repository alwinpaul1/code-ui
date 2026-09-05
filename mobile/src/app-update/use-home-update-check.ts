import { useCallback, useEffect } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'

import { useAppUpdateStore, hydrateAppUpdateState } from './app-update-store'

// Home owns update polling: restore the last known update on mount (so a cold
// start shows the dialog at once), then run the throttled check on every Home
// focus and every return to the foreground. The dialog shows on every open
// until the update is installed; "Later" only hides it for this app session.

export function useHomeUpdateCheck(): void {
  useEffect(() => {
    void hydrateAppUpdateState().then(() => useAppUpdateStore.getState().checkForUpdate())
  }, [])

  useFocusEffect(
    useCallback(() => {
      void useAppUpdateStore.getState().checkForUpdate()
    }, [])
  )

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void useAppUpdateStore.getState().checkForUpdate()
      }
    })
    return () => subscription.remove()
  }, [])
}
