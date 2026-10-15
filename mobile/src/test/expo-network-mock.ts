// Why: expo-network's entry needs expo-modules-core's native EventEmitter at import, which Node
// does not have. The chat's status line reads the phone's network (use-phone-offline.ts), so
// every test that mounts the session route reaches it. The stand-in is a phone that is online
// and never changes; the hook's own behaviour, failures included, is pinned with `vi.mock` in
// use-phone-offline.test.tsx, which takes precedence over this alias.
export const NetworkStateType = {
  NONE: 'NONE',
  UNKNOWN: 'UNKNOWN',
  CELLULAR: 'CELLULAR',
  WIFI: 'WIFI'
} as const

export async function getNetworkStateAsync(): Promise<{ isConnected: boolean; isInternetReachable: boolean; type: string }> {
  return { isConnected: true, isInternetReachable: true, type: NetworkStateType.WIFI }
}

export async function getIpAddressAsync(): Promise<string> {
  return '0.0.0.0'
}

export function addNetworkStateListener(_listener: (state: unknown) => void): { remove: () => void } {
  return { remove: () => undefined }
}
