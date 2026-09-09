import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'backgroundDeliveryEnabled'

/** Default off: it puts a persistent row in the notification shade, which is
 *  the user's call to make. */
export async function loadBackgroundDeliveryEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true'
  } catch {
    return false
  }
}

export async function saveBackgroundDeliveryEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, enabled ? 'true' : 'false')
  } catch {
    // Why: a failed write must not block the toggle; the next launch re-reads.
  }
}
