import { useCallback, useEffect } from 'react'
import { useFocusEffect } from 'expo-router'

import { useAppUpdateStore, hydrateAppUpdateState } from './app-update-store'

// Consolidates the app-update wiring for the Home screen so index.tsx doesn't
// grow with update-specific logic. Hydrates the persisted dismissed update id
// on mount, then runs a throttled (once/24h) update check each time Home
// regains focus. getState() keeps the screen from re-rendering on store
// transitions; the banner subscribes on its own.

export function useHomeUpdateCheck(): void {
  useEffect(() => {
    void hydrateAppUpdateState()
  }, [])

  useFocusEffect(
    useCallback(() => {
      void useAppUpdateStore.getState().checkForUpdate()
    }, [])
  )
}
