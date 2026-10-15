import type { CcrAttachmentRef } from './mobile-native-chat-file-mentions'

/**
 * Fetching a prompt's attachment from Anthropic, for the card's tap and an image's thumbnail.
 *
 * The Claude Code CLI downloads a `file_attachments` entry with its own token from
 * `GET {api}/api/oauth/files/{file_uuid}/content` (decompiled CLI, `resolveAndPrepend`; recorded in
 * scratchpad/plan/anthropic-direct-send-design.md). A read-only probe of 2026-10-15 against the
 * session "Memory limits for agent profiles" (scratchpad/probe/p9-attachments.cjs) showed the
 * phone's own sign-in is enough: a plain `Authorization: Bearer` returned 200 with the file's bytes
 * for a 12.8 MB recording (`ftypmp42`), a 5.9 MB one and a 508 KB JPEG, with or without the
 * `anthropic-beta` headers. A file belongs to the account that uploaded it, so every signed-in
 * account is asked in turn and the first 200 wins.
 *
 * Pure of React Native and Expo, so vitest runs it unmocked: the device layer (ccr-attachment-
 * open.ts) hands in the sign-ins and the download.
 */

export const CCR_API_BASE_URL = 'https://api.anthropic.com'

export type CcrAttachmentDeps = {
  accounts: () => Promise<readonly { id: string; accessToken: string | null }[]>
  /** Writes the response body to `destination`; the status, whatever it is. */
  download: (url: string, destination: string, headers: Record<string, string>) => Promise<{ status: number; uri: string }>
  remove: (uri: string) => Promise<void>
  /** A directory the cache owns, ending in a slash. */
  cacheDir: string
}

export type CcrAttachmentOutcome = { uri: string } | { error: string }

const FILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function ccrAttachmentUrl(fileUuid: string): string {
  return `${CCR_API_BASE_URL}/api/oauth/files/${fileUuid}/content`
}

/** The cache file's name: the original name with whatever a path cannot hold taken out. */
export function ccrAttachmentCachePath(cacheDir: string, ref: CcrAttachmentRef): string {
  const safe = [...ref.fileName].map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char)).join('').replace(/^\.+/, '_').slice(-120) || 'file'
  return `${cacheDir}ccr-attachments/${ref.fileUuid}/${safe}`
}

/** MIME type by extension, for the viewer the tap hands the file to. */
export function ccrAttachmentMime(fileName: string): string {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : ''
  return MIME[ext] ?? '*/*'
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

/**
 * The attachment's bytes in a cache file, or why not. The reasons are the ones a person can act on:
 * nobody signed in, no signed-in account owns the file, or every request failed.
 */
export async function fetchCcrAttachment(ref: CcrAttachmentRef, deps: CcrAttachmentDeps): Promise<CcrAttachmentOutcome> {
  if (!FILE_UUID.test(ref.fileUuid)) {
    return { error: 'The file reference is not one Anthropic issues.' }
  }
  let accounts: Awaited<ReturnType<CcrAttachmentDeps['accounts']>>
  try {
    accounts = await deps.accounts()
  } catch (error) {
    return { error: `Could not read the Anthropic sign-in: ${error instanceof Error ? error.message : String(error)}` }
  }
  const tokens = accounts.filter((account) => account.accessToken)
  if (tokens.length === 0) {
    return { error: 'Sign in to Anthropic to open this file.' }
  }
  const destination = ccrAttachmentCachePath(deps.cacheDir, ref)
  let notTheirs = 0
  let failure: string | null = null
  for (const account of tokens) {
    try {
      const response = await deps.download(ccrAttachmentUrl(ref.fileUuid), destination, { Authorization: `Bearer ${account.accessToken}`, 'anthropic-version': '2023-06-01' })
      if (response.status >= 200 && response.status < 300) {
        return { uri: response.uri }
      }
      await deps.remove(response.uri).catch(() => undefined)
      if (response.status === 403 || response.status === 404 || response.status === 410) {
        notTheirs += 1
      } else {
        failure = `Anthropic answered ${response.status}.`
      }
    } catch (error) {
      failure = `The download failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (failure) {
    return { error: failure }
  }
  return { error: notTheirs > 0 ? 'None of the signed-in Anthropic accounts owns this file.' : 'The file could not be downloaded.' }
}
