import { useEffect, useMemo, useRef, useState } from 'react'
import { CCR_SEND_REFUSALS, type CcrSendFiles } from './use-ccr-composer-send'
import { CCR_ATTACHMENTS_THROUGH_ANTHROPIC, CcrFileUploadError, type CcrUploadedFile } from './ccr-file-upload'
import type { CcrSendTarget } from './ccr-session-cache'
import type { NativeChatAttachmentStore } from './mobile-native-chat-image-attachment'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { NativeChatAnthropicAttachments } from './use-native-chat-anthropic-send'

export type CcrUploadForSession = (accountId: string, sessionId: string, file: { base64: string; name?: string | null; mimeType?: string | null }, signal?: AbortSignal) => Promise<CcrUploadedFile>

/**
 * A Claude tab's attachments on the Anthropic lane (ccr-file-upload.ts): each pick uploads with
 * the sign-in of the account the tab's OWN session belongs to, read at the pick
 * (ccrSendTargetForTab, never another profile's copy of the session), and the send references the
 * finished ones. Null while the switch is off or the tab is not on the lane: attachments then keep
 * the desktop path. Stable across renders, reading its inputs live.
 *
 * Every upload it starts is held in `inflight` while it runs, and stops when the pick's own signal
 * aborts (its chip was removed) or when the lane's owner goes away (`cancelUploads`), so none
 * goes on to leave a file at Anthropic that nothing references. `upload` is the one step a
 * different route (the file sent inline in the event instead) would replace.
 */
export function ccrAttachmentLane(args: {
  enabled: boolean
  resolveTarget: () => CcrSendTarget
  send: (text: string, files?: CcrSendFiles) => Promise<MobileNativeChatSendOutcome>
  upload: CcrUploadForSession
  inflight?: Set<AbortController>
}): NativeChatAnthropicAttachments | null {
  if (!args.enabled) {
    return null
  }
  const inflight = args.inflight ?? new Set<AbortController>()
  const store: NativeChatAttachmentStore = async (bytes, signal) => {
    const target = args.resolveTarget()
    if (target.kind === 'refused') {
      throw new CcrFileUploadError(CCR_SEND_REFUSALS[target.reason].replace(/^Message not sent/, 'Upload failed'), `no target (${target.reason})`)
    }
    const upload = new AbortController()
    const stop = (): void => upload.abort()
    if (signal?.aborted) {
      upload.abort()
    }
    signal?.addEventListener('abort', stop)
    inflight.add(upload)
    try {
      const anthropicFile = await args.upload(target.accountId, target.sessionId, bytes, upload.signal)
      return { path: '', anthropicFile }
    } finally {
      inflight.delete(upload)
      signal?.removeEventListener('abort', stop)
    }
  }
  return {
    store: () => store,
    accountId: () => {
      const target = args.resolveTarget()
      return target.kind === 'target' ? target.accountId : null
    },
    send: args.send
  }
}

/** Calls back every upload in `inflight`. */
export function cancelCcrUploads(inflight: Set<AbortController>): void {
  for (const upload of inflight) {
    upload.abort()
  }
  inflight.clear()
}

/** The device upload, loaded on the first pick: ccr-file-upload-device.ts pulls in expo-file-system,
 *  which the chat's own tests cannot load, the same reason the attachment card loads
 *  ccr-attachment-open.ts with `import()` (MobileNativeChatFileCard.tsx). */
const uploadOnDevice: CcrUploadForSession = async (accountId, sessionId, file, signal) => (await import('./ccr-file-upload-device')).uploadCcrFileForSession(accountId, sessionId, file, signal)

export function useCcrAttachmentLane(args: {
  /** The tab is on the Anthropic lane now. */
  active: boolean
  resolveTarget: () => CcrSendTarget
  send: (text: string, files?: CcrSendFiles) => Promise<MobileNativeChatSendOutcome>
  upload?: CcrUploadForSession
  /** Tests turn it on; the app reads the one switch. */
  switchOn?: boolean
}): NativeChatAnthropicAttachments | null {
  const latest = useRef(args)
  latest.current = args
  const [inflight] = useState(() => new Set<AbortController>())
  // Leaving the chat calls back what is still going up; the chip it belonged to, if the strip
  // still holds it, goes failed with its retry (mobile-native-chat-upload-retry.ts).
  useEffect(() => () => cancelCcrUploads(inflight), [inflight])
  const enabled = args.active && (args.switchOn ?? CCR_ATTACHMENTS_THROUGH_ANTHROPIC)
  return useMemo(
    () =>
      ccrAttachmentLane({
        enabled,
        inflight,
        resolveTarget: () => latest.current.resolveTarget(),
        send: (text, files) => latest.current.send(text, files),
        upload: (accountId, sessionId, file, signal) => (latest.current.upload ?? uploadOnDevice)(accountId, sessionId, file, signal)
      }),
    [enabled, inflight]
  )
}
