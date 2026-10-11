import type { ComponentProps } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatView } from './MobileNativeChatView'

type ChatProps = ComponentProps<typeof MobileNativeChatView>

/** What the chat overlay drew in one render: the chat view's props and what
 *  its created-file count provider read. The hold replays this, not the
 *  element built from it (see withLiveComposerInput). */
export type HeldNativeChat = {
  readonly chat: ChatProps
  readonly messages: readonly NativeChatMessage[]
  readonly wholeSession: boolean
}

/** The props that carry the user's own input: what is in the field, how a key
 *  reaches the draft, a focus request, the chips and the dictation paint, the
 *  send that reads them, and the keyboard the dock sits on. None of them
 *  describe the transcript, so none of them are what a hold exists to keep on
 *  screen. */
const LIVE_COMPOSER_INPUT = [
  'composerText',
  'onComposerTextChange',
  'composerFocusRequest',
  'onSend',
  'getSendCompletionGeneration',
  'getComposerEditGeneration',
  'attachments',
  'onRemoveAttachment',
  'onEditAttachment',
  'isAttaching',
  'videoFrameExtraction',
  'onCancelVideoFrameExtraction',
  'onCaptureImage',
  'onAttachImage',
  'onPasteImage',
  'onPasteImageFile',
  'onAttachFile',
  'onMicPress',
  'onBeforeSend',
  'onMicPressIn',
  'onMicPressOut',
  'micActive',
  'micLevel',
  'dictationPaint',
  'onComposerCursor',
  // Not sendErrorMessage: its wording is chosen against the rows (a row that
  // states the failure shortens it), so it is held with the rows it was read
  // against. An empty reload would otherwise bring back the long text under a
  // held row saying the same thing.
  'onClearSendError',
  // The keyboard's height, which the dock rides: a tap on the field in a new
  // tab raises the keyboard during the hold, and a held inset left the
  // composer under it.
  'keyboardInset',
  // Terminal keys typed from the chat: input too, and their handlers send.
  'keyStrip'
] as const satisfies readonly (keyof ChatProps)[]

type LiveComposerInput = Pick<ChatProps, (typeof LIVE_COMPOSER_INPUT)[number]>

/**
 * The held frame with this render's composer input laid over it.
 *
 * The hold used to replay the remembered element itself. React bails out of a
 * subtree whose element is the one it last committed, so the composer kept the
 * `value` it was drawn with, and React Native's TextInput writes its `value`
 * back over the native text after each key: every key typed during a hold
 * vanished, with the keyboard still up. A new agent tab sits in that hold the
 * moment it opens (no transcript before its first prompt reads as an empty
 * reload), which is where the user met it (2026-10-11).
 */
export function withLiveComposerInput(held: HeldNativeChat, live: HeldNativeChat): HeldNativeChat {
  const input: Partial<LiveComposerInput> = {}
  for (const key of LIVE_COMPOSER_INPUT) {
    Object.assign(input, { [key]: live.chat[key] })
  }
  return { ...held, chat: { ...held.chat, ...input } }
}
