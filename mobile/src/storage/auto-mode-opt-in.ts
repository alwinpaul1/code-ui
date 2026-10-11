import AsyncStorage from '@react-native-async-storage/async-storage'

// Whether this phone has said yes to the Claude app's "Enable Auto mode?"
// question. Kept on the device only, as the Claude app keeps it
// (`auto_mode_opted_in`); nothing is written to the desktop.

const AUTO_MODE_OPT_IN_KEY = 'orca:autoModeOptedIn'

/** False when the store cannot be read: asking again is the safe failure. */
export async function loadAutoModeOptedIn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(AUTO_MODE_OPT_IN_KEY)) === 'true'
  } catch {
    return false
  }
}

/** A failed write only means the question comes back next time. */
export async function saveAutoModeOptedIn(): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTO_MODE_OPT_IN_KEY, 'true')
  } catch {
    // Fail open: the pick still goes through.
  }
}
