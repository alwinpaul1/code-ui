import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

// Why: SecureStore keys must match [A-Za-z0-9._-] — a colon or a space is rejected
// outright — so the host id is encoded rather than pasted in.
const KEY_PREFIX = 'orca.mac-unlock.'
const WEB_KEY_PREFIX = 'orca:web-mac-unlock:'

// Why WHEN_UNLOCKED_THIS_DEVICE_ONLY: a login password must not ride an iCloud
// keychain sync or a backup restore onto a second device.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

/** Encodes a host id into the SecureStore alphabet. `.` escapes a four-hex-digit
 *  code unit, so the mapping stays injective: two different host ids can never
 *  collide onto one key and hand a Mac the wrong password. */
export function macUnlockPasswordKey(hostId: string): string {
  let encoded = ''
  for (const char of hostId) {
    for (let index = 0; index < char.length; index += 1) {
      const unit = char.charCodeAt(index)
      encoded += /[A-Za-z0-9_-]/.test(char[index] ?? '')
        ? char[index]
        : `.${unit.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return `${KEY_PREFIX}${encoded}`
}

function webKey(hostId: string): string {
  return `${WEB_KEY_PREFIX}${hostId}`
}

export async function readMacUnlockPassword(hostId: string): Promise<string | null> {
  // Why: Expo SecureStore has no working web backend; only web falls back.
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(webKey(hostId))
  }
  return SecureStore.getItemAsync(macUnlockPasswordKey(hostId), OPTIONS)
}

export async function writeMacUnlockPassword(hostId: string, password: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(webKey(hostId), password)
    return
  }
  await SecureStore.setItemAsync(macUnlockPasswordKey(hostId), password, OPTIONS)
}

export async function clearMacUnlockPassword(hostId: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(webKey(hostId))
    return
  }
  await SecureStore.deleteItemAsync(macUnlockPasswordKey(hostId), OPTIONS)
}
