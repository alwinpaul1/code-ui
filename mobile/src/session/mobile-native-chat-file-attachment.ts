import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

export function isPendingNativeChatFile(attachment: PendingNativeChatImage): boolean {
  return attachment.kind === 'file'
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : null
}

/**
 * The text that carries a document into the prompt.
 *
 * Why text: Orca's mobile RPC has no file-write method for phones, so the bytes
 * go through the clipboard image upload, which stores them under a `.png` name
 * in the host's temp dir with no content check. The agent gets the real name
 * and is told to rename before reading, so a PDF is read as a PDF.
 */
export function buildMobileNativeChatFileNotes(
  files: readonly PendingNativeChatImage[]
): string {
  return files
    .filter(isPendingNativeChatFile)
    .map((file) => {
      const name = file.name ?? 'file'
      const extension = extensionOf(name)
      const rename = extension
        ? `The .png extension is only the upload container; move it to a path ending in "${extension}" before reading it.`
        : 'The .png extension is only the upload container; rename it before reading it.'
      return `Attached file "${name}" is on this machine at ${file.path}. ${rename}`
    })
    .join('\n')
}

/** Prepend the file notes to the user's text; a bare document still sends. */
export function withMobileNativeChatFileNotes(
  text: string,
  files: readonly PendingNativeChatImage[]
): string {
  const notes = buildMobileNativeChatFileNotes(files)
  if (!notes) {
    return text
  }
  const body = text.trim()
  return body ? `${notes}\n\n${body}` : notes
}
