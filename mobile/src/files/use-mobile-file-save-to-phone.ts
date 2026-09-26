import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileFileSaveSource } from './mobile-file-save'
import { isSaveToPhoneSupported, saveDesktopFileToPhoneOnDevice } from './mobile-file-save-device'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'

const DEFAULT_NOTICE_MS = 2500

/** "Save to phone" for a screen with no toast of its own: the save, whether one is running, and the
 *  one line of feedback it gives (drawn with FloatingToast). */
export function useMobileFileSaveToPhone() {
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
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
      try {
        // No display name: the file keeps the name it has on the desktop, extension included.
        await saveDesktopFileToPhoneOnDevice({ client, source, notify })
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
