// Pure: no React Native or Expo imports, so vitest runs it unmocked. The
// device half (the Android picker and the writes) is mobile-file-save-device.ts.
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { formatPreviewByteLength } from './mobile-file-preview-response'
import {
  readWholeDesktopFile,
  sourcePath,
  type MobileFileSaveSource,
  type WholeDesktopFileReadOptions
} from './mobile-file-whole-read'

export type { MobileFileSaveSource } from './mobile-file-whole-read'

/** Where a saved file goes: the phone's own storage, through the system "Save to" picker. */
export type MobileFileSaveTarget = {
  /** Opens the picker; resolves the document the user named, or null when they backed out. */
  createDocument: (suggestedName: string, mimeType: string) => Promise<string | null>
  writeBase64: (uri: string, base64: string) => Promise<void>
  /** Removes a document whose write failed, so no half-written file is left looking whole. When
   *  it throws, the save's message says the incomplete copy is still there. */
  remove: (uri: string) => Promise<void>
}

export type MobileFileSaveOutcome =
  | { status: 'saved'; fileName: string; byteLength: number }
  | { status: 'cancelled'; fileName: string }
  /** The file cannot be saved whole; `message` says why. */
  | { status: 'refused'; fileName: string; message: string }
  | { status: 'failed'; fileName: string; message: string }
  /** The user left before the picker could open, so it never opened and nothing was written. */
  | { status: 'abandoned'; fileName: string }

export type MobileFileSaveRequest = {
  source: MobileFileSaveSource
  /** The name the file is offered under; its path's last segment when absent. */
  fileName?: string
}

/** Where the user is while a save runs. Android's picker is a system screen: opened after the user
 *  has walked away, it lands over whatever they went to, and the result toast shows nowhere. */
export type SaveToPhonePresence = {
  /** Aborted once the screen the save was asked from is gone: the read stops at its next wave,
   *  the picker never opens, and nothing more is said. */
  signal?: AbortSignal
  /** Asked the moment the picker would open. False while another screen covers the one the save
   *  was asked from: the picker stays shut and the save ends unsaved. */
  onScreen?: () => boolean
}

/**
 * Save one desktop file into the phone's storage.
 *
 * The bytes are read in full BEFORE the picker opens. Android's create-document picker makes the
 * file the moment the user confirms it, so opening it first and then finding the file cannot come
 * over whole would leave an empty file in Downloads under the right name.
 */
export async function saveDesktopFileToPhone(
  client: MobileFilePreviewRpcSender,
  request: MobileFileSaveRequest,
  target: MobileFileSaveTarget,
  options: WholeDesktopFileReadOptions & Pick<SaveToPhonePresence, 'onScreen'> = {}
): Promise<MobileFileSaveOutcome> {
  const fileName = suggestedSaveFileName(request.fileName ?? sourcePath(request.source))
  const read = await readWholeDesktopFile(client, request.source, options)
  if (options.signal?.aborted) {
    return { status: 'abandoned', fileName }
  }
  if (read.status === 'refused') {
    return { status: 'refused', fileName, message: `Can't save ${fileName}: ${read.reason}` }
  }
  if (read.status === 'failed') {
    return { status: 'failed', fileName, message: `Couldn't save ${fileName}: ${read.reason}` }
  }
  if (options.onScreen?.() === false) {
    return { status: 'abandoned', fileName }
  }
  let uri: string | null
  try {
    uri = await target.createDocument(fileName, saveMimeTypeFor(fileName))
  } catch (error) {
    return {
      status: 'failed',
      fileName,
      message: `Couldn't save ${fileName}: the phone's save picker did not open (${errorText(error)})`
    }
  }
  if (!uri) {
    return { status: 'cancelled', fileName }
  }
  try {
    await target.writeBase64(uri, read.base64)
  } catch (error) {
    const failed = `Couldn't save ${fileName}: the phone could not write it (${errorText(error)})`
    try {
      await target.remove(uri)
    } catch {
      // The picker made the document before the write; one that stays behind is empty or cut
      // short under the name the user chose, and would read as the file. Say so.
      return {
        status: 'failed',
        fileName,
        message: `${failed}. An incomplete ${fileName} is left where you chose to save it; delete it there`
      }
    }
    return { status: 'failed', fileName, message: failed }
  }
  return { status: 'saved', fileName, byteLength: read.byteLength }
}

/** What a save says when it is done. */
export function saveOutcomeMessage(outcome: MobileFileSaveOutcome): string {
  switch (outcome.status) {
    case 'saved':
      return `Saved ${outcome.fileName} (${formatPreviewByteLength(outcome.byteLength)})`
    case 'cancelled':
      return 'Not saved'
    case 'abandoned':
      return `Not saved: you left before ${outcome.fileName} was ready`
    case 'refused':
    case 'failed':
      return outcome.message
    default: {
      const unhandled: never = outcome
      return unhandled
    }
  }
}

export type SaveToPhoneRun = SaveToPhonePresence & {
  client: MobileFilePreviewRpcSender
  source: MobileFileSaveSource
  fileName?: string
  /** The screen's own toast. The long first duration keeps "Getting…" up while a big file pages
   *  over; every later message replaces it. */
  notify: (message: string, durationMs?: number) => void
}

export type SaveToPhoneRunOutcome = MobileFileSaveOutcome | { status: 'busy'; fileName: string }

const FETCHING_NOTICE_MS = 60_000
const PROGRESS_STEP_BYTES = 1024 * 1024
const RESULT_NOTICE_MS = 2500
const PROBLEM_NOTICE_MS = 4500

/**
 * A save with its feedback: "Getting…", a line per megabyte while it pages, then the outcome.
 *
 * One save per file at a time, but only while the user can still see the save they asked for. A
 * second tap on the same screen says it is already going rather than reading the file twice. A save
 * whose screen is gone or covered does not hold the file: a save asked for from the screen in front
 * takes over, and the one it replaces stops reading, never opens the picker, and says nothing more.
 * Why: the runner is shared by the preview and every session's tab menu, so a save the user left
 * would otherwise answer "Already saving" to the one they asked for next, and neither would open.
 */
export function createSaveToPhoneRunner(
  target: MobileFileSaveTarget,
  options: Omit<WholeDesktopFileReadOptions, 'onProgress'> & {
    onSaved?: () => void
    onProblem?: () => void
  } = {}
): (run: SaveToPhoneRun) => Promise<SaveToPhoneRunOutcome> {
  const inFlight = new Map<string, InFlightSave>()
  return async ({ client, source, fileName: requestedName, notify, signal, onScreen }) => {
    const fileName = suggestedSaveFileName(requestedName ?? sourcePath(source))
    const key = `${source.worktreeId}\n${sourcePath(source)}`
    const holder = inFlight.get(key)
    if (holder && !holder.signal?.aborted && holder.onScreen?.() !== false) {
      notify(`Already saving ${fileName}`, RESULT_NOTICE_MS)
      return { status: 'busy', fileName }
    }
    holder?.replaced.abort()
    const self: InFlightSave = { signal, onScreen, replaced: new AbortController() }
    inFlight.set(key, self)
    // Ended by the user leaving (their signal) or by a save that took over (`replaced`).
    const stopped = new AbortController()
    const stop = () => stopped.abort()
    signal?.addEventListener('abort', stop)
    self.replaced.signal.addEventListener('abort', stop)
    if (signal?.aborted) {
      stop()
    }
    const say = (message: string, durationMs: number) => {
      if (!self.replaced.signal.aborted) {
        notify(message, durationMs)
      }
    }
    try {
      say(`Getting ${fileName} from the desktop…`, FETCHING_NOTICE_MS)
      let lastStep = 0
      const outcome = await saveDesktopFileToPhone(client, { source, fileName }, target, {
        ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
        ...(options.chunkBytes ? { chunkBytes: options.chunkBytes } : {}),
        signal: stopped.signal,
        onScreen: () => !self.replaced.signal.aborted && onScreen?.() !== false,
        onProgress: (bytes) => {
          const step = Math.floor(bytes / PROGRESS_STEP_BYTES)
          if (step > lastStep) {
            lastStep = step
            say(
              `Getting ${fileName}… ${formatPreviewByteLength(step * PROGRESS_STEP_BYTES)}`,
              FETCHING_NOTICE_MS
            )
          }
        }
      })
      if (outcome.status === 'abandoned' && stopped.signal.aborted) {
        // The screen is gone, or another save of this file took over; there is nobody to tell.
        return outcome
      }
      if (outcome.status === 'saved') {
        options.onSaved?.()
      } else if (outcome.status !== 'cancelled' && outcome.status !== 'abandoned') {
        options.onProblem?.()
      }
      say(
        saveOutcomeMessage(outcome),
        outcome.status === 'saved' ||
          outcome.status === 'cancelled' ||
          outcome.status === 'abandoned'
          ? RESULT_NOTICE_MS
          : PROBLEM_NOTICE_MS
      )
      return outcome
    } finally {
      signal?.removeEventListener('abort', stop)
      // A save that was taken over must not free the slot of the one that took it.
      if (inFlight.get(key) === self) {
        inFlight.delete(key)
      }
    }
  }
}

/** The save holding a file's slot: whose screen it answers to, and how to end it. */
type InFlightSave = SaveToPhonePresence & { replaced: AbortController }

/** `docs/out/Report.PDF` → `Report.PDF`. */
export function suggestedSaveFileName(path: string): string {
  const segments = path.split(/[\\/]/)
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]?.trim()
    if (segment) {
      return segment
    }
  }
  return 'file'
}

/**
 * The type the picker is told. Only types whose extension Android maps straight back; everything
 * else is octet-stream. Why: a documents provider appends the extension of the type it is given
 * when the name's own extension maps to a different type (android.os.FileUtils.splitFileName), so
 * `app.ts` offered as text/plain is written as `app.ts.txt`. For octet-stream it keeps the name as
 * given.
 */
const SAVE_MIME_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  zip: 'application/zip'
}

export function saveMimeTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  return SAVE_MIME_TYPES[extension] ?? 'application/octet-stream'
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.trim().slice(0, 140) || 'no reason given'
}
