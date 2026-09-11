import { getIpAddressAsync, getNetworkStateAsync } from 'expo-network'

/** expo-network's `NetworkStateType` name for the active connection, or null. */
export async function readMobileNetworkType(): Promise<string | null> {
  try {
    const state = await getNetworkStateAsync()
    return state.type ?? null
  } catch {
    return null
  }
}

/**
 * A key for "the network the phone is on right now", built from what the OS
 * gives for free: the transport type and the phone's own address. Joining a
 * different Wi-Fi, switching to cellular, or a VPN taking the route all change
 * it; nothing here asks for the SSID or a location permission.
 */
export async function readMobileNetworkIdentity(): Promise<string | null> {
  try {
    const [state, ip] = await Promise.all([
      getNetworkStateAsync(),
      getIpAddressAsync().catch(() => null)
    ])
    const type = state.type ?? null
    if (type === null && ip === null) {
      return null
    }
    return `${type ?? 'UNKNOWN'}|${ip ?? '?'}`
  } catch {
    return null
  }
}
