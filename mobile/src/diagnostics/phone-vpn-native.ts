import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'
import type { NativePhoneVpn } from './phone-vpn-status'

/**
 * The native half of the phone-VPN check, or null where there is none.
 *
 * It lives in the OrcaMobileWebShell module (mobile/modules/orca-mobile-web-shell), not a network
 * module, on purpose: Expo compiles a module under mobile/modules from its own source, while a
 * `file:` package under mobile/packages is compiled from pnpm's copy in node_modules, which a
 * local build only refreshes on `pnpm install`. Only Android implements `phoneVpnStatus`; iOS
 * registers the module without it, which reads as unknown.
 *
 * Kept apart from phone-vpn-status.ts so the report and its tests never import `expo`.
 */
export function phoneVpnNativeModule(): NativePhoneVpn | null {
  if (Platform.OS !== 'android') {
    return null
  }
  try {
    return requireOptionalNativeModule<NativePhoneVpn>('OrcaMobileWebShell')
  } catch {
    return null
  }
}
