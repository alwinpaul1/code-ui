import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

/**
 * Whether a ghostty pane moves the grid under the finger while a
 * mouse-tracking TUI (Claude Code) owns the scroll, at most one row ahead of
 * the host. Off by default: the grid then shows exactly what the host painted,
 * the whole pane, nothing displaced — at the host's repaint cadence (measured
 * 2026-09-11 on a Galaxy S23: 23–27/s over Orca Relay). On, the grid follows
 * the finger at the display rate, and the prompt bobs by up to one row until
 * the host's repaint lands; every attempt to keep the prompt still while
 * predicting the transcript (2026-09-11, five builds) misclassified some
 * content row as chrome on a live Claude screen and drew it twice.
 */
const KEY = 'terminalFollowFinger'

export function parseTerminalFollowFinger(raw: string | null): boolean {
  return raw === 'on'
}

export async function loadTerminalFollowFinger(): Promise<boolean> {
  try {
    return parseTerminalFollowFinger(await AsyncStorage.getItem(KEY))
  } catch {
    return false
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
  const [enabled, setEnabled] = useState(false)
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
