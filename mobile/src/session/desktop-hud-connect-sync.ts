import AsyncStorage from '@react-native-async-storage/async-storage'
import type { RpcClient } from '../transport/rpc-client'
import { syncAgentHudDesktopLaunchArgs } from './agent-hud-desktop-launch-args'

/** Where the removed "Desktop agents report model and context" switch kept its
 *  answer. Nothing reads it any more: the beacon flags are always on. */
const RETIRED_SWITCH_KEY = 'desktopHudLaunchArgsEnabled'

/**
 * On every connect: put the beacon flags into the host's launch profile
 * (a Windows host gets none, and loses one saved earlier). A user who turned
 * the old switch off had them taken out; this puts them back, and drops the
 * stored "off" so it stops being a loose end. Storage failing costs nothing.
 */
export async function syncDesktopHudOnConnect(client: RpcClient) {
  try {
    await AsyncStorage.removeItem(RETIRED_SWITCH_KEY)
  } catch {
    // Best effort: the value is never read.
  }
  return syncAgentHudDesktopLaunchArgs(client)
}
