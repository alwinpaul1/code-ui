import { useCallback, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { attachMobileImageToTerminal } from './mobile-image-attachment'
import { attachMobileDocumentsToTerminal } from './mobile-document-attachment'
import {
  ImageLibraryPermissionError,
  pickMobileDocuments,
  pickMobileImage,
  type MobileImageSource
} from './mobile-image-source-picker'

type CurrentRef<T> = {
  readonly current: T
}

type ShowToast = (message: string, durationMs?: number) => void

type UseMobileImageAttachmentArgs = {
  readonly client: RpcClient | null
  readonly activeHandle: string | null
  readonly canSend: boolean
  readonly connState: ConnectionState
  readonly deviceTokenRef: CurrentRef<string | null>
  readonly getActiveWorktreeConnectionId: () => Promise<string | null>
  readonly showToast: ShowToast
  readonly onSuccess: () => void
  readonly onError: () => void
  readonly beforeTerminalSend?: (terminal: string) => Promise<boolean>
}

type MobileImageAttachment = {
  readonly attachImage: (source: MobileImageSource) => Promise<void>
  /** Any document; its note is typed onto the terminal line, no Enter. */
  readonly attachDocument: () => Promise<void>
  // True only while the picked image is uploading to the host (not while the
  // picker is open) — drives the send spinner so the 3-5s transfer isn't a no-op.
  readonly isAttaching: boolean
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useMobileImageAttachment({
  client,
  activeHandle,
  canSend,
  connState,
  deviceTokenRef,
  getActiveWorktreeConnectionId,
  showToast,
  onSuccess,
  onError,
  beforeTerminalSend
}: UseMobileImageAttachmentArgs): MobileImageAttachment {
  const [isAttaching, setIsAttaching] = useState(false)
  const run = useCallback(
    async (send: () => Promise<boolean>): Promise<void> => {
      if (!client || !activeHandle || !canSend) {
        return
      }
      try {
        const sent = await send()
        // Cancelled picker: no error, no toast.
        if (sent) {
          onSuccess()
        }
      } catch (error) {
        onError()
        if (connState !== 'connected') {
          showToast('Attach failed (disconnected)', 1500)
          return
        }
        if (error instanceof ImageLibraryPermissionError) {
          showToast('Photo permission denied', 1500)
          return
        }
        if (getErrorMessage(error) === 'Clipboard image is too large') {
          showToast('File too large to attach (18 MB max)', 1500)
          return
        }
        showToast('Attach failed', 1500)
      } finally {
        setIsAttaching(false)
      }
    },
    [activeHandle, canSend, client, connState, onError, onSuccess, showToast]
  )
  const attachImage = useCallback(
    (source: MobileImageSource) =>
      run(() =>
        attachMobileImageToTerminal(source, {
          client: client!,
          terminal: activeHandle!,
          deviceToken: deviceTokenRef.current,
          getConnectionId: getActiveWorktreeConnectionId,
          pickImage: pickMobileImage,
          onUploadStart: () => setIsAttaching(true),
          beforeTerminalSend
        })
      ),
    [activeHandle, beforeTerminalSend, client, deviceTokenRef, getActiveWorktreeConnectionId, run]
  )
  const attachDocument = useCallback(
    () =>
      run(() =>
        attachMobileDocumentsToTerminal({
          client: client!,
          terminal: activeHandle!,
          deviceToken: deviceTokenRef.current,
          getConnectionId: getActiveWorktreeConnectionId,
          pickDocuments: () => pickMobileDocuments(),
          onUploadStart: () => setIsAttaching(true),
          beforeTerminalSend
        })
      ),
    [activeHandle, beforeTerminalSend, client, deviceTokenRef, getActiveWorktreeConnectionId, run]
  )

  return { attachImage, attachDocument, isAttaching }
}
