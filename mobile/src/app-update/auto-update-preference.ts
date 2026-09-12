import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'codeui:auto-update-check'

/** Default ON: the whole point is that a release reaches the phone without
 *  the app being opened, the way system updates do. The toggle lives in About. */
export async function loadBackgroundUpdateCheckEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export async function saveBackgroundUpdateCheckEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, enabled ? 'true' : 'false')
  } catch {
    // Why: a failed write must not block the toggle; the next launch re-reads.
  }
}
