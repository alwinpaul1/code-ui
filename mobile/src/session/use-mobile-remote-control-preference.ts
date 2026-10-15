import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_REMOTE_CONTROL_NEW_SESSIONS,
  loadRemoteControlNewSessions,
  peekRemoteControlNewSessions,
  saveRemoteControlNewSessions,
  subscribeRemoteControlNewSessions
} from '../storage/remote-control-preference'

/** The Settings switch for Remote Control on new Claude sessions: optimistic in memory, ordered on
 *  disk, put back to what storage holds if the write fails. Reads on before storage answers. */
export function useMobileRemoteControlPreference(): {
  remoteControl: boolean
  setRemoteControl: (enabled: boolean) => void
} {
  const value = useSyncExternalStore(
    subscribeRemoteControlNewSessions,
    peekRemoteControlNewSessions,
    peekRemoteControlNewSessions
  )
  useEffect(() => {
    if (value === null) {
      void loadRemoteControlNewSessions()
    }
  }, [value])
  const setRemoteControl = useCallback((enabled: boolean) => {
    void saveRemoteControlNewSessions(enabled).catch(() => loadRemoteControlNewSessions())
  }, [])
  return { remoteControl: value ?? DEFAULT_REMOTE_CONTROL_NEW_SESSIONS, setRemoteControl }
}
