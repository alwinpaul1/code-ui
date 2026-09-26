import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileFileSaveSource } from './mobile-file-save'
import { isSaveToPhoneSupported, saveDesktopFileToPhoneOnDevice } from './mobile-file-save-device'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'

const DEFAULT_NOTICE_MS = 2500

/** "Save to phone" for a screen with no toast of its own: the save, whether one is running, and the
 *  one line of feedback it gives (drawn with FloatingToast).
 *
 *  A save lives as long as the screen: leaving it aborts the save, so a long read stops and
 *  Android's picker never opens over wherever the user went (mobile-file-save.ts). */
export function useMobileFileSaveToPhone() {
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const screenRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      screenRef.current?.abort()
      screenRef.current = null
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const notify = useCallback((message: string, durationMs = DEFAULT_NOTICE_MS) => {
    if (!mountedRef.current) {
      return
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    setNotice(message)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setNotice(null)
    }, durationMs)
  }, [])

  const save = useCallback(
    async (client: MobileFilePreviewRpcSender, source: MobileFileSaveSource) => {
      setSaving(true)
      screenRef.current ??= new AbortController()
      try {
        // No display name: the file keeps the name it has on the desktop, extension included.
        await saveDesktopFileToPhoneOnDevice({
          client,
          source,
          notify,
          signal: screenRef.current.signal
        })
      } finally {
        if (mountedRef.current) {
          setSaving(false)
        }
      }
    },
    [notify]
  )

  return { supported: isSaveToPhoneSupported, saving, notice, save }
}
