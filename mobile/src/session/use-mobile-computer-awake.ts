import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComputerAwakeMode } from '../../../src/shared/computer-awake-mode'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { computerAwakeUpdateParams, readComputerAwakeModeFromSettings } from './mobile-computer-awake'

type AwakeClient = Pick<RpcClient, 'sendRequest'>

function settingsOf(response: RpcSuccess | RpcFailure): unknown {
  if (!response.ok) {
    throw new Error((response as RpcFailure).error.message)
  }
  return ((response as RpcSuccess).result as { settings?: unknown } | null)?.settings
}

/**
 * Mirror of Orca's "Keep computer awake" popover for the phone.
 *
 * The host stores the choice in its client settings, so the phone reads it with
 * `settings.get` each time the control opens (the Mac popover may have changed
 * it since) and writes it with `settings.update`. The host normalizes and
 * re-broadcasts the value, so the mode shown afterwards is the one it echoed
 * back rather than the one the phone asked for.
 */
export function useMobileComputerAwake(params: {
  client: AwakeClient | null
  enabled: boolean
}): {
  mode: ComputerAwakeMode | null
  /** null until the first `settings.get` answers; false when the host omits the keys. */
  supported: boolean | null
  saving: boolean
  error: string | null
  setMode: (mode: ComputerAwakeMode) => Promise<boolean>
} {
  const { client, enabled } = params
  const [mode, setModeState] = useState<ComputerAwakeMode | null>(null)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    if (!enabled || !client) {
      return
    }
    const generation = ++generationRef.current
    setError(null)
    client
      .sendRequest('settings.get')
      .then((response) => {
        if (generationRef.current !== generation) {
          return
        }
        const reported = readComputerAwakeModeFromSettings(settingsOf(response))
        setSupported(reported !== null)
        setModeState(reported)
      })
      .catch((cause: unknown) => {
        if (generationRef.current !== generation) {
          return
        }
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [client, enabled])

  const setMode = useCallback(
    async (next: ComputerAwakeMode): Promise<boolean> => {
      if (!client) {
        return false
      }
      const generation = ++generationRef.current
      const previous = mode
      setModeState(next)
      setSaving(true)
      setError(null)
      try {
        const response = await client.sendRequest(
          'settings.update',
          computerAwakeUpdateParams(next)
        )
        const echoed = readComputerAwakeModeFromSettings(settingsOf(response))
        if (generationRef.current === generation) {
          setModeState(echoed ?? next)
        }
        return true
      } catch (cause: unknown) {
        if (generationRef.current === generation) {
          setModeState(previous)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
        return false
      } finally {
        if (generationRef.current === generation) {
          setSaving(false)
        }
      }
    },
    [client, mode]
  )

  return { mode, supported, saving, error, setMode }
}
