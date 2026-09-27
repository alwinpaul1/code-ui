import { useCallback, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMediaPicker } from '../platform/media-picker'
import {
  ImageLibraryPermissionError,
  type MobileImageSource
} from '../platform/media-picker-contract'
import { attachMobileImageToTerminal } from './mobile-image-attachment'
import { attachMobileDocumentsToTerminal } from './mobile-document-attachment'
import { pickMobileDocuments } from './mobile-image-source-picker'
import {
  describeVideoFrameExtractionFailure,
  VideoFrameExtractionError
} from './mobile-video-frame-extractor'

type CurrentRef<T> = {
  readonly current: T
}

type ShowToast = (message: string, durationMs?: number) => void

type UseMobileImageAttachmentArgs = {
  readonly agent?: string | null
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
  agent,
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
  const picker = useMediaPicker()
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
        // This screen has no chip strip to show reading-frames progress or a
        // cancel in, so its own document attach never extracts a video's
        // frames (`videoFrames: 'refuse'` below) — but if that ever changes,
        // or extraction is reached by some other path, name why rather than
        // falling through to the bare "Attach failed" (2026-09-27 review).
        if (error instanceof VideoFrameExtractionError) {
          showToast(`File too large to attach (18 MB max) — the video ${describeVideoFrameExtractionFailure(error)}`, 1500)
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
          agent,
          terminal: activeHandle!,
          deviceToken: deviceTokenRef.current,
          getConnectionId: getActiveWorktreeConnectionId,
          pickImage: picker.pickImage,
          onUploadStart: () => setIsAttaching(true),
          beforeTerminalSend
        })
      ),
    [
      activeHandle,
      agent,
      beforeTerminalSend,
      client,
      deviceTokenRef,
      getActiveWorktreeConnectionId,
      picker,
      run
    ]
  )
  const attachDocument = useCallback(
    () =>
      run(() =>
        attachMobileDocumentsToTerminal({
          client: client!,
          terminal: activeHandle!,
          deviceToken: deviceTokenRef.current,
          getConnectionId: getActiveWorktreeConnectionId,
          // This screen types a note with a disk path for any document; a
          // video's frames have no path of their own to give it (they upload
          // as bytes, not a file), and this screen has no chip strip to show
          // them, or extraction progress, or a cancel — so an over-cap video
          // keeps today's outright refusal instead (2026-09-27 review: it
          // used to extract anyway and the frames were unreachable, since the
          // note it typed named no path for them at all).
          pickDocuments: () => pickMobileDocuments(undefined, undefined, 'refuse'),
          onUploadStart: () => setIsAttaching(true),
          beforeTerminalSend
        })
      ),
    [activeHandle, beforeTerminalSend, client, deviceTokenRef, getActiveWorktreeConnectionId, run]
  )

  return { attachImage, attachDocument, isAttaching }
}
