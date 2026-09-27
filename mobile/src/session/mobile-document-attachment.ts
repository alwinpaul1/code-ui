import type { RpcClient } from '../transport/rpc-client'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'
import { saveMobileClipboardImageAsTempFile } from './mobile-clipboard-image'
import type { PickedMobileImage } from './mobile-image-source-picker'
import { withMobileNativeChatAttachmentNotes } from './mobile-native-chat-video-frames-attachment'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

export type AttachMobileDocumentDeps = {
  readonly client: Pick<RpcClient, 'sendRequest'>
  readonly terminal: string
  readonly deviceToken: string | null
  readonly getConnectionId: () => Promise<string | null>
  readonly pickDocuments: () => AsyncIterable<PickedMobileImage> | Iterable<PickedMobileImage>
  readonly onUploadStart?: () => void
  readonly beforeTerminalSend?: (terminal: string) => Promise<boolean>
}

/**
 * Terminal-mode counterpart of the chat file attachment: pick documents,
 * upload them through the image channel (the only byte path a phone has), and
 * type the notes onto the terminal's input line without pressing Enter, so
 * the user can add a prompt after them. Returns false when nothing was sent.
 *
 * A picked item is a named file everywhere except an over-the-cap video's
 * frames, which carry `videoFrame` instead of a name (`pickMobileDocuments`) —
 * this screen has no chip strip to paste them into, so like any other
 * document they become a note naming what they are, not a pasted image.
 */
export async function attachMobileDocumentsToTerminal({
  client,
  terminal,
  deviceToken,
  getConnectionId,
  pickDocuments,
  onUploadStart,
  beforeTerminalSend
}: AttachMobileDocumentDeps): Promise<boolean> {
  const notes: PendingNativeChatImage[] = []
  let connectionId: string | null = null
  for await (const picked of pickDocuments()) {
    if (notes.length === 0) {
      onUploadStart?.()
      connectionId = await getConnectionId()
    }
    const path = await saveMobileClipboardImageAsTempFile(client, picked.base64, { connectionId })
    notes.push(
      picked.videoFrame
        ? { id: `doc-${notes.length}`, path, previewUri: picked.uri ?? '', videoFrame: picked.videoFrame }
        : {
            id: `doc-${notes.length}`,
            path,
            previewUri: picked.uri ?? '',
            kind: 'file',
            name: picked.name ?? 'file'
          }
    )
  }
  if (notes.length === 0) {
    return false
  }
  if (beforeTerminalSend && !(await beforeTerminalSend(terminal))) {
    return false
  }
  const response = await client.sendRequest('terminal.send', {
    terminal,
    text: `${withMobileNativeChatAttachmentNotes('', notes)} `,
    enter: false,
    ...(deviceToken ? { client: { id: deviceToken, type: 'mobile' as const } } : {})
  })
  return isTerminalSendRpcAccepted(response)
}
