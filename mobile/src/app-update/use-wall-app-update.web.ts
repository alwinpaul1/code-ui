import type { WallAppUpdate } from './use-wall-app-update'

/** The tasks page has no update checker or AsyncStorage; the wall falls back to the releases list. */
export function useWallAppUpdate(): WallAppUpdate | null {
  return null
}
