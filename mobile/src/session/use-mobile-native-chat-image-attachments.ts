import { useCallback, useRef } from 'react'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { useNativeChatAttachmentScopeWriters } from './use-native-chat-attachment-scope-writers'
import { useMobileNativeChatImageMarkup } from './use-mobile-native-chat-image-markup'
import { buildMobileNativeChatClearInputForText } from './mobile-native-chat-input-clear'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileImageSource } from './mobile-image-source-picker'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import {
  NO_NATIVE_CHAT_IMAGE_ATTACHMENTS,
  withScopeAttachments
} from './mobile-native-chat-image-scope-state'
import { pasteMobileNativeChatImagePaths } from './mobile-native-chat-image-send'
import { settleAfterImagePaste } from './mobile-native-chat-image-send-settle'
import { openMobileNativeChatSendBudget, type MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { spentSendBudgetRefusal } from './mobile-native-chat-send-budget-refusal'
import {
  clearMobileNativeChatInputResidue,
  clearMobileNativeChatInputStale,
  healMobileNativeChatStaleInput,
  isMobileNativeChatInputStale,
  markMobileNativeChatInputStale,
  mobileNativeChatInputResidue
} from './mobile-native-chat-stale-input'
import { SEND_REMINTED, sendFollowingTheTab } from './mobile-native-chat-send-claim'
import {
  agentComposerOnScreen,
  SEND_TERMINAL_RESTARTED,
  type MobileNativeChatSendFollow
} from './mobile-native-chat-send-follow'
import { useMobileNativeChatImageUpload } from './use-mobile-native-chat-image-upload'
import { isPendingNativeChatFile } from './mobile-native-chat-file-attachment'
import { withMobileNativeChatAttachmentNotes } from './mobile-native-chat-video-frames-attachment'
import { useMobileNativeChatSendGate } from './mobile-native-chat-send-readiness'
import { useMobileNativeChatSendChips } from './use-mobile-native-chat-send-chips'
import type { NativeChatVideoFrameExtractionState } from './mobile-native-chat-image-attachments-store'
import type { readSendUnderDialogRefusal } from './mobile-native-chat-dialog-guard'

type CurrentRef<T> = { readonly current: T }
type ShowToast = (message: string, durationMs?: number) => void

type Args = {
  readonly agent?: string | null
  readonly client: RpcClient | null
  readonly activeHandleRef: CurrentRef<string | null>
  readonly deviceTokenRef: CurrentRef<string | null>
  readonly getActiveWorktreeConnectionId: () => Promise<string | null>
  readonly connState: ConnectionState
  /** Identity of the active composer surface (same key shape as the drafts hook):
   *  chips are scoped to the tab that picked them, so a tab switch cannot ride
   *  one tab's image into another tab's terminal. Null disables attaching. */
  readonly scopeKey: string | null
  /** The native-chat input lease is ready — same gate `handleNativeChatSend` uses. */
  readonly enabled: boolean
  readonly showToast: ShowToast
  /** Send failures go to the composer's inline banner, not the toast — the same
   *  channel the controller's own rejections use, so one failure paints once. */
  readonly onSendError: (message: string) => void
  /** The plain text send (controller.handleNativeChatSendWithOutcome); wrapped so
   *  images ride along. The optional URIs drive the optimistic echo's thumbnails.
   *  Must preserve 'unknown': after a successful paste, an ambiguously-delivered
   *  text+Enter may have left the image on the input line, which needs healing.
   *  Accepts this action's budget so the text body draws from what the paste left
   *  rather than opening a second one. */
  readonly beforeImagePaste?: () => Promise<void>
  /** Empties the composer as the send starts (the chips go with it) and returns
   *  the undo. `images` also adds the optimistic bubble in this same call. */
  /** `imagePaths` are the desktop paths pasted, one per preview in `images`. */
  readonly beginImageSend?: (text: string, images?: string[], imagePaths?: string[]) => (() => void) | null
  readonly baseSend: (
    text: string,
    imagePreviewUris?: string[],
    deadline?: number,
    attachments?: readonly PendingNativeChatImage[],
    follow?: MobileNativeChatSendFollow
  ) => Promise<MobileNativeChatSendOutcome>
  /** Structured sessions send attachments without the terminal paste path. */
  readonly structuredNativeChat: boolean
  /** Why a send must not write to the terminal now, read off its screen: a
   *  dialog there takes typed keys as answers (mobile-native-chat-dialog-guard.ts). */
  readonly refuseUnderDialog: typeof readSendUnderDialogRefusal
  /** The terminal the host's session-tab snapshot names for the tab with this scope key. Without
   *  it no handle change is the tab's own, and a send refuses as a tab switch does. */
  readonly hostTerminalOfTab?: (scopeKey: string) => string | null
  /** Launch-context text parked on the agent's TUI input line, or null. The
   *  paste's leading clear must cover every line of it, or the draft's earlier
   *  lines survive and ride along with the image. */
  readonly readSeededLaunchDraft: () => string | null
  readonly onAttachSuccess?: () => void
  readonly onError?: () => void
  // Injected so the settle between image paste and submit is instant in tests.
  readonly sleep?: (ms: number) => Promise<void>
}

export type MobileNativeChatImageAttachments = {
  /** Pending chips for the active scope (tab) only. */
  readonly attachments: PendingNativeChatImage[]
  readonly isAttaching: boolean
  readonly attachImage: (source: MobileImageSource) => Promise<void>
  /** An image file already on the phone (a keyboard paste's cache copy). */
  readonly attachImageFile: (uri: string) => Promise<void>
  /** Any document via the file picker; described to the agent in the message text. */
  readonly attachDocument: () => Promise<void>
  readonly removeAttachment: (id: string) => void
  /** The markup editor's Done: uploads a flattened photo and swaps it into
   *  the chip at `id` (use-mobile-native-chat-image-markup.ts). */
  readonly replaceAttachment: (id: string, base64: string) => Promise<void>
  /** Ride any pending images along with `text`, then submit; clears the sent
   *  chips (and only those) once the send is accepted. */
  readonly sendNativeChat: (text: string) => Promise<boolean>
  /** A document attach is reading an over-the-cap video's frames, for the
   *  active scope only — null once it settles, extracted or not. */
  readonly videoFrameExtraction: NativeChatVideoFrameExtractionState | null
  /** Stops that extraction; a no-op once it has already settled. */
  readonly cancelVideoFrameExtraction: () => void
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function useMobileNativeChatImageAttachments({
  client,
  agent,
  activeHandleRef,
  deviceTokenRef,
  getActiveWorktreeConnectionId,
  connState,
  scopeKey,
  enabled,
  showToast,
  onSendError,
  baseSend,
  beforeImagePaste,
  beginImageSend,
  structuredNativeChat,
  refuseUnderDialog,
  hostTerminalOfTab,
  readSeededLaunchDraft,
  onAttachSuccess,
  onError,
  sleep = defaultSleep
}: Args): MobileNativeChatImageAttachments {
  const attachmentsByScope = useNativeChatImageAttachmentsStore((state) => state.byScope)
  const videoFrameExtractionByScope = useNativeChatImageAttachmentsStore(
    (state) => state.videoFrameExtractionByScope
  )
  const {
    setAttachmentsByScope,
    addUploadedImages,
    addUploadingImage,
    settleUploads,
    markAttachmentReuploading,
    replaceAttachmentImage,
    takeSentAttachments,
    restoreSentAttachments,
    setVideoFrameExtractionProgress
  } = useNativeChatAttachmentScopeWriters()
  const replaceAttachment = useMobileNativeChatImageMarkup({
    client, getActiveWorktreeConnectionId, scopeKey, markAttachmentReuploading,
    replaceAttachmentImage, showToast
  })
  const attachments =
    (scopeKey ? attachmentsByScope[scopeKey] : undefined) ?? NO_NATIVE_CHAT_IMAGE_ATTACHMENTS
  // Nothing has been written when a send below looks, so one tapped while the
  // relay re-dials waits for it on its own budget and then goes; a wait that
  // ends unready refuses as the gate always did, the box, chips and bubble
  // untouched (mobile-native-chat-send-readiness.ts). The tab's scope is the
  // target: a wait that outlives a tab switch gives up instead of sending.
  // The tab a send belongs to, read live: a closure's scopeKey is the one it was tapped on.
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey
  const sendGate = useMobileNativeChatSendGate({
    client, sendable: enabled && connState === 'connected', target: scopeKey, action: 'Message',
    lane: structuredNativeChat ? 'session' : 'terminal', onUnready: (message) => { onError?.(); onSendError(message) }
  })
  const settleSendChips = useMobileNativeChatSendChips({
    scopeKey, client, sendGate, onError, onSendError
  })

  const {
    attachImage,
    attachImageFile,
    attachDocument,
    cancelVideoFrameExtraction,
    isAttaching
  } = useMobileNativeChatImageUpload({
    client,
    activeHandleRef,
    getActiveWorktreeConnectionId,
    connState,
    scopeKey,
    structuredNativeChat,
    showToast,
    onImagesUploaded: addUploadedImages,
    onImageUploading: addUploadingImage,
    onUploadSettled: settleUploads,
    onVideoFrameExtractionProgress: setVideoFrameExtractionProgress,
    onAttachSuccess,
    onError
  })
  const videoFrameExtraction = (scopeKey ? videoFrameExtractionByScope[scopeKey] : undefined) ?? null

  const removeAttachment = useCallback(
    (id: string): void => {
      const scope = scopeKey
      if (!scope) {
        return
      }
      setAttachmentsByScope((prev) =>
        withScopeAttachments(
          prev,
          scope,
          (prev[scope] ?? []).filter((attachment) => attachment.id !== id)
        )
      )
    },
    [scopeKey]
  )

  const sendNativeChat = useCallback(
    (composerText: string): Promise<boolean> => {
      const operationTerminal = activeHandleRef.current
      // One budget for the whole user action. The paste loop, the settle, and the
      // text body that follows are a single send from the composer's point of view;
      // opening a budget per leg let `sending` run to twice the stated ceiling.
      const deadline = openMobileNativeChatSendBudget()
      const scope = scopeKey
      // A chip still uploading goes with this send, not the next one: the send
      // waits for it on this budget and says why when it never lands
      // (use-mobile-native-chat-send-chips.ts). It waits before it takes the
      // terminal, so a card tapped meanwhile is not refused (2026-09-26 review).
      const tap = { scope, deadline, text: composerText }
      return settleSendChips(tap, async (pendingAll) => {
        const refuse = (message: string): false => {
          onError?.()
          onSendError(message)
          return false
        }
        // Says why when the budget ran out (the app was away, or the desktop slow).
        const notSent = (): string => spentSendBudgetRefusal('Message', deadline) ?? 'Message not sent'
        return sendFollowingTheTab(
          {
            tappedTerminal: operationTerminal,
            structured: structuredNativeChat,
            liveTerminal: () => activeHandleRef.current,
            // The tab, not the handle, is who this send belongs to: the same tab
            // given a new terminal is followed, verified (mobile-native-chat-send-claim.ts).
            tabChanged: () => scopeKeyRef.current !== scope,
            hostTerminal: () => (scope ? (hostTerminalOfTab?.(scope) ?? null) : null),
            sendGate,
            deadline,
            // One read, before any paste: a dialog first, then (Claude or Codex) a screen with no input box.
            look: (client, terminal, followed) => refuseUnderDialog({ client, terminal, deadline, agent, requireComposer: !followed }),
            verify: (client, terminal) => agentComposerOnScreen({ client, terminal, agent, deadline }),
            refuse
          },
          async ({ terminal, follow }) => {
            // Documents never paste as images: their note joins the text body, and
            // the chip clears with the images once the send is accepted. A
            // video's frames DO paste as images (they are ordinary photos to
            // the terminal/session send below) — only their note joins the
            // text body the same way a document's does.
            const pendingFiles = pendingAll.filter(isPendingNativeChatFile)
            const pendingImages = pendingAll.filter(
              (attachment) => !isPendingNativeChatFile(attachment)
            )
            const text = withMobileNativeChatAttachmentNotes(composerText, pendingAll)
            const clearSent = (): void => {
              if (scope) {
                takeSentAttachments(scope, pendingAll)
              }
            }
            if (structuredNativeChat && pendingImages.length > 0 && scope) {
              if (!(await sendGate.wait(deadline))) {
                return false
              }
              // Empty the composer and add the optimistic bubble now, in the same
              // tick — not after the RPC settles (2026-09-24: the chips lingered
              // after the text left, then the bubble popped in once the send
              // resolved). A definite rejection puts text, chips and the echo back.
              const previewUris = pendingImages.map((attachment) => attachment.previewUri)
              const undoDraftClear = beginImageSend?.(text, previewUris) ?? null
              clearSent()
              const outcome = await baseSend(text, previewUris, deadline, pendingImages)
              if (outcome === 'rejected') {
                undoDraftClear?.()
                restoreSentAttachments(scope, pendingAll)
              }
              return outcome !== 'rejected'
            }
            if (pendingImages.length === 0 || !scope) {
              // Heal a previously failed paste: a text-only send to that terminal would
              // otherwise glue the stale image paste onto this message. Best-effort —
              // on failure the marker stays set and the text must not be submitted.
              const staleTerminal = structuredNativeChat ? activeHandleRef.current : terminal
              if (staleTerminal && isMobileNativeChatInputStale(staleTerminal)) {
                // Why: the heal is itself a terminal.send, so without the input lease it
                // can only be rejected — which used to latch the marker and fail every
                // later send with a bare "Message not sent" (#10681). Gate it like the
                // image path: it waits for the lease, or leaves the marker for later.
                const healClient = await sendGate.wait(deadline, () => scopeKeyRef.current !== scope)
                if (!healClient) {
                  return false
                }
                const healed = await healMobileNativeChatStaleInput({
                  client: healClient,
                  terminal: staleTerminal,
                  deviceToken: deviceTokenRef.current,
                  deadline
                })
                // A tab switch during the clear would send this text to a terminal the
                // clear never touched, so abort rather than reroute it.
                if (!healed || activeHandleRef.current !== staleTerminal) {
                  return refuse(!healed ? notSent() : follow && !follow.tabChanged() ? SEND_TERMINAL_RESTARTED : 'Message not sent')
                }
              }
              // Text-only sends paste nothing first, so 'unknown' leaves no stale input.
              const sent = await baseSend(text, undefined, deadline, undefined, follow ?? undefined)
              if (follow?.reminted) {
                return SEND_REMINTED
              }
              const accepted = sent !== 'rejected'
              if (accepted && pendingFiles.length > 0) {
                clearSent()
              }
              return accepted
            }
            const handle = terminal
            if (!handle || !follow) {
              return refuse('Message not sent (no terminal on this tab)')
            }
            // Nothing is written until the paste: a tab given another terminal
            // before it restarts from the top and is verified there, a switch refuses.
            const gone = (): false | typeof SEND_REMINTED =>
              follow.tabChanged() ? refuse('Message not sent (session changed)') : SEND_REMINTED
            const pasteClient = await sendGate.wait(deadline, follow.tabChanged)
            if (!pasteClient) {
              return false
            }
            if (activeHandleRef.current !== handle) {
              return gone()
            }
            // Set once the box has been emptied for this send; a no-op before that.
            let restoreOptimistic = (): void => {}
            try {
              // Drain caption mirroring before clearing/pasting. A delayed mirror
              // write after the image would overwrite or split this submission.
              await beforeImagePaste?.()
              if (activeHandleRef.current !== handle) {
                return gone()
              }
              // The box empties now, chips, echo and all, not after the paste and
              // the settle (2026-09-13: the Claude app sends both at once). A
              // paste that fails before the text goes puts all three back.
              const previewUris = pendingImages.map((attachment) => attachment.previewUri)
              // The agent's row names each path pasted: how the echo finds its row.
              const undoDraftClear = beginImageSend?.(text, previewUris, pendingImages.map((image) => image.path)) ?? null
              clearSent()
              restoreOptimistic = (): void => {
                undoDraftClear?.()
                if (scope) {
                  restoreSentAttachments(scope, pendingAll)
                }
              }
              const seededLaunchDraft = readSeededLaunchDraft()
              // A queue edit can leave the whole recalled queue on the agent, and the
              // draft mirror has typed this caption onto the line. One Ctrl+U clears
              // one VISUAL line (Claude Code 2.1.266), so the survivors would submit
              // glued to this photo's caption — size the clear for whatever is there.
              const residue = mobileNativeChatInputResidue(handle)
              const pasted = await pasteMobileNativeChatImagePaths({
                client: pasteClient,
                terminal: handle,
                agent,
                deviceToken: deviceTokenRef.current,
                imagePaths: pendingImages.map((attachment) => attachment.path),
                followedByText: text.trim().length > 0,
                deadline,
                clearInput: buildMobileNativeChatClearInputForText(seededLaunchDraft, residue, text)
              })
              if (!pasted) {
                // Put the chips and text back so the user can retry; the failed paste never submitted.
                restoreOptimistic()
                markMobileNativeChatInputStale(handle)
                return refuse(notSent())
              }
              // The paste's leading Ctrl+U cleared any earlier stale input in `handle`.
              clearMobileNativeChatInputStale(handle)
              clearMobileNativeChatInputResidue(handle)
              // Let the TUI take every image before the text + Enter follow: Claude drops an
              // Enter that lands while a pasted path is still being read, so its settle
              // looks for the chips (mobile-native-chat-image-send-settle.ts). The preview
              // URIs ride along to baseSend so the sent bubble shows the photo at once.
              const settled = await settleAfterImagePaste({
                client: pasteClient, terminal: handle, agent, expected: pendingImages.length, deadline, sleep
              })
              const textDeadline = settled.textDeadline
              // The paste above targeted `handle`; a tab switch during the settle would
              // route the text + Enter to a different terminal than the images. Abort —
              // the chips keep their scope and a retry's Ctrl+U clears the stale paste.
              if (activeHandleRef.current !== handle || settled.refusal) {
                restoreOptimistic()
                markMobileNativeChatInputStale(handle)
                return refuse(activeHandleRef.current === handle ? settled.refusal! : follow.tabChanged() ? 'Message not sent' : SEND_TERMINAL_RESTARTED)
              }
              const outcome = await baseSend(text, previewUris, textDeadline, undefined, follow)
              if (follow.reminted) {
                restoreOptimistic()
                markMobileNativeChatInputStale(handle)
                return refuse(SEND_TERMINAL_RESTARTED)
              }
              if (outcome !== 'accepted') {
                // 'rejected' leaves the pasted image path on this input line; 'unknown'
                // may have lost the text+Enter AFTER the paste landed, orphaning the
                // image onto whatever is sent next (#10228) — both must heal first.
                markMobileNativeChatInputStale(handle)
              }
              if (outcome === 'rejected') {
                // The chips and echo come back; baseSend already put the text back.
                restoreOptimistic()
              }
              return outcome !== 'rejected'
            } catch {
              // A thrown paste/send (network/RPC) puts the chips back and honors the
              // Promise<boolean> contract instead of rejecting. Retry-safe: the next
              // attempt's leading Ctrl+U clears whatever fraction of the paste landed.
              restoreOptimistic()
              markMobileNativeChatInputStale(handle)
              return refuse(notSent())
            }
            }
        )
      })
    },
    [
      activeHandleRef,
      baseSend,
      beforeImagePaste,
      beginImageSend,
      agent,
      hostTerminalOfTab,
      deviceTokenRef,
      onError,
      onSendError,
      readSeededLaunchDraft,
      refuseUnderDialog,
      scopeKey,
      sendGate,
      settleSendChips,
      sleep
    ]
  )

  return {
    attachments,
    isAttaching,
    attachImage,
    attachImageFile,
    attachDocument,
    removeAttachment,
    replaceAttachment,
    sendNativeChat,
    videoFrameExtraction,
    cancelVideoFrameExtraction
  }
}
