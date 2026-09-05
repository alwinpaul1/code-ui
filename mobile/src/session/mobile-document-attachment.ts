import type { RpcClient } from '../transport/rpc-client'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'
import { saveMobileClipboardImageAsTempFile } from './mobile-clipboard-image'
import type { PickedMobileImage } from './mobile-image-source-picker'
import { buildMobileNativeChatFileNotes } from './mobile-native-chat-file-attachment'

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
 * type the file notes onto the terminal's input line without pressing Enter,
 * so the user can add a prompt after them. Returns false when nothing was sent.
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
  const notes: { id: string; path: string; previewUri: string; kind: 'file'; name: string }[] = []
  let connectionId: string | null = null
  for await (const picked of pickDocuments()) {
    if (notes.length === 0) {
      onUploadStart?.()
      connectionId = await getConnectionId()
    }
    const path = await saveMobileClipboardImageAsTempFile(client, picked.base64, { connectionId })
    notes.push({
      id: `doc-${notes.length}`,
      path,
      previewUri: picked.uri ?? '',
      kind: 'file',
      name: picked.name ?? 'file'
    })
  }
  if (notes.length === 0) {
    return false
  }
  if (beforeTerminalSend && !(await beforeTerminalSend(terminal))) {
    return false
  }
  const response = await client.sendRequest('terminal.send', {
    terminal,
    text: `${buildMobileNativeChatFileNotes(notes)} `,
    enter: false,
    ...(deviceToken ? { client: { id: deviceToken, type: 'mobile' as const } } : {})
  })
  return isTerminalSendRpcAccepted(response)
}
