import { getNetworkStateAsync } from 'expo-network'

/** expo-network's `NetworkStateType` name for the active connection, or null. */
export async function readMobileNetworkType(): Promise<string | null> {
  try {
    const state = await getNetworkStateAsync()
    return state.type ?? null
  } catch {
    return null
  }
}
