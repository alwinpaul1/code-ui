import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'desktopHudLaunchArgsEnabled'

/** Default on: nothing is visible on the desktop either way, so a fresh
 *  install should show the HUD for desktop-started agents too. The switch
 *  lives in Settings → Chat UI, and turning it off removes the flags from the
 *  host's launch profile again on the next connect. */
export async function loadDesktopHudLaunchEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export async function saveDesktopHudLaunchEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, enabled ? 'true' : 'false')
  } catch {
    // Best effort; the next launch re-reads.
  }
}
