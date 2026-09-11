import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

/**
 * Whether a ghostty pane moves the grid under the finger while a
 * mouse-tracking TUI (Claude Code) owns the scroll, reconciling each host
 * repaint into that motion. On by default: measured 2026-09-11 on a Galaxy
 * S23 over Orca Relay, the host's repaints reach the phone at 23–27/s, so
 * without it the grid can only move at the network's cadence. Off pins the
 * grid to the host's frames, which is what every release before this did.
 */
const KEY = 'terminalFollowFinger'

export function parseTerminalFollowFinger(raw: string | null): boolean {
  return raw !== 'off'
}

export async function loadTerminalFollowFinger(): Promise<boolean> {
  try {
    return parseTerminalFollowFinger(await AsyncStorage.getItem(KEY))
  } catch {
    return true
  }
}

export async function saveTerminalFollowFinger(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, enabled ? 'on' : 'off')
  } catch {
    // Why: a failed write must not block the switch; the next launch re-reads.
  }
}

/** Read once per mount, like the engine flag: a pane never flips mid-life. */
export function useTerminalFollowFinger(): boolean {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    let cancelled = false
    void loadTerminalFollowFinger().then((loaded) => {
      if (!cancelled) {
        setEnabled(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  return enabled
}
