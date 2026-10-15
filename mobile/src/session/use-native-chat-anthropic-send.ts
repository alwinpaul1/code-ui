import { useCallback, useRef } from 'react'
import { CCR_ATTACHMENT_NO_ACCOUNT, planCcrAttachmentSend } from './ccr-attachment-send'
import type { NativeChatAttachmentStore, PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { CcrSendFiles } from './use-ccr-composer-send'

/** A Claude tab that sends through Anthropic with its attachments (ccr-file-upload.ts): picks go
 *  to Anthropic, and the send references them in one event with the words. */
export type NativeChatAnthropicAttachments = {
  /** The upload for this tab now; null while the tab is not on that lane (the desktop path then). */
  readonly store: () => NativeChatAttachmentStore | null
  /** The account the tab's session belongs to now (ccrSendTargetForTab), or null with no target. */
  readonly accountId: () => string | null
  readonly send: (text: string, files?: CcrSendFiles) => Promise<MobileNativeChatSendOutcome>
}

/**
 * The Anthropic lane's send for a composer's chips: the words and every chip that finished
 * uploading in one event, nothing through the desktop (ccr-attachment-send.ts decides which chips
 * go). The chips leave the strip as the send starts and come back if it is rejected.
 */
export function useNativeChatAnthropicSend(args: {
  anthropic: NativeChatAnthropicAttachments | null
  scopeKey: string | null
  onError?: () => void
  onSendError: (message: string) => void
  takeSentAttachments: (scope: string, sent: readonly PendingNativeChatImage[]) => void
  restoreSentAttachments: (scope: string, sent: readonly PendingNativeChatImage[]) => void
}): (text: string) => Promise<boolean> {
  const latest = useRef(args)
  latest.current = args
  return useCallback(async (composerText: string): Promise<boolean> => {
    const { anthropic: lane, scopeKey: scope, onError, onSendError, takeSentAttachments, restoreSentAttachments } = latest.current
    if (!lane || !scope) {
      return false
    }
    const chips = useNativeChatImageAttachmentsStore.getState().byScope[scope] ?? []
    if (chips.length === 0) {
      return (await lane.send(composerText)) !== 'rejected'
    }
    const accountId = lane.accountId()
    if (accountId === null) {
      // Chips, and no target read yet: refused whole. A plain send here could post the words
      // the moment the target settles and leave the chips behind without a word.
      onError?.()
      onSendError(CCR_ATTACHMENT_NO_ACCOUNT)
      return false
    }
    const plan = planCcrAttachmentSend(chips, composerText, accountId)
    switch (plan.kind) {
      case 'nothing':
        return false
      case 'refuse':
        onError?.()
        onSendError(plan.message)
        return false
      case 'send': {
        takeSentAttachments(scope, plan.sent)
        const outcome = await lane.send(composerText, { attachments: plan.files, previewUris: plan.previewUris, accountId }).catch(() => 'rejected' as const)
        if (outcome === 'rejected') {
          // Marked: the rejected POST may have reached the session, so removing these keeps the file.
          restoreSentAttachments(scope, plan.sent.map((chip) => ({ ...chip, carriedBySend: true })))
        }
        return outcome !== 'rejected'
      }
      default: {
        const unhandled: never = plan
        return unhandled
      }
    }
  }, [])
}
