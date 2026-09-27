import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import { downloadMobilePdf, type MobilePdfDownloadDeps } from './mobile-pdf-download'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { createSaveToPhoneRunner, type MobileFileSaveTarget } from './mobile-file-save'

// expo-intent-launcher (57.0.1) keeps one pending Activity result at a time
// (IntentLauncherModule.kt): a second startActivityAsync while the first is still open throws
// ActivityAlreadyStartedException, synchronously, rather than queuing. The runner gives each FILE
// its own slot (mobile-file-save.ts), so nothing stopped two DIFFERENT files' saves -- or a save
// and the PDF viewer's Download (mobile-pdf-download.ts) -- from each reaching their own picker
// call at once. Reported symptom: Save to Phone on a big file, then on a small file; the small
// file's picker opens first, and while the user is still choosing a folder the big file's read
// finishes and its own picker call collides, failing with "Couldn't save a.pdf: the phone's save
// picker did not open (IntentLauncher activity is already started...)".

/** expo-intent-launcher's own collision text (ActivityAlreadyStartedException.kt, 57.0.1). */
const ACTIVITY_ALREADY_STARTED =
  'IntentLauncher activity is already started. You need to wait for its result before starting another activity.'

/** Models the real launcher: one pending picker at a time. A second `open()` call made while the
 *  first is still open rejects at once, exactly as expo-intent-launcher's native module does, so a
 *  test built on it is exercising the real collision shape rather than racing a timer. */
function androidPicker() {
  let closeCurrent: ((uri: string) => void) | null = null
  let next = 0
  return {
    pickerOpen: () => closeCurrent !== null,
    /** Closes whichever picker is currently open, as the user finishing (or cancelling) would. */
    finishPicker: () => {
      const close = closeCurrent
      closeCurrent = null
      close?.(`content://downloads/document/${++next}`)
    },
    open: (): Promise<string> => {
      if (closeCurrent) {
        return Promise.reject(new Error(ACTIVITY_ALREADY_STARTED))
      }
      return new Promise<string>((resolve) => {
        closeCurrent = resolve
      })
    }
  }
}

function pickerSaveTarget(picker: ReturnType<typeof androidPicker>): MobileFileSaveTarget {
  return {
    createDocument: vi.fn(() => picker.open()),
    writeBase64: vi.fn(async () => {}),
    remove: vi.fn(async () => {})
  }
}

function pickerPdfDeps(picker: ReturnType<typeof androidPicker>): MobilePdfDownloadDeps {
  return {
    createDocument: vi.fn(() => picker.open()),
    readBase64: vi.fn(async () => 'JVBERi0xLjcK'),
    writeBase64: vi.fn(async () => {}),
    remove: vi.fn(async () => {})
  }
}

/** A picker call whose settlement (resolve or reject) the test controls directly, one call at a
 *  time, in the order `createDocument` was invoked -- for proving the gate moves on after a
 *  rejection, not for modelling the launcher's own collision (androidPicker does that). */
function manualPicker() {
  const pending: Array<{ resolve: (uri: string) => void; reject: (error: Error) => void }> = []
  return {
    createDocument: vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          pending.push({ resolve, reject })
        })
    ),
    pendingCount: () => pending.length,
    rejectOldest: (error: Error) => pending.shift()?.reject(error),
    resolveOldest: (uri: string) => pending.shift()?.resolve(uri)
  }
}

/** A desktop whose chunk replies wait until `release()`, so a file's read can be held mid-flight
 *  while another file's save reaches the picker first (mobile-file-save-left-behind.test.ts). */
function gatedDesktop(file: Buffer) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const sendRequest = vi.fn(async (_method: string, params: Record<string, unknown>) => {
    await gate
    const offset = params.offset as number
    const slice = file.subarray(offset, offset + (params.length as number))
    return {
      id: '1',
      ok: true,
      result: {
        contentBase64: slice.toString('base64'),
        bytesRead: slice.length,
        eof: offset + slice.length >= file.length
      },
      _meta: { runtimeId: 'runtime-1' }
    } as RpcResponse
  })
  return {
    client: { sendRequest } as unknown as MobileFilePreviewRpcSender,
    release: () => release()
  }
}

/** A desktop that answers at once. */
function readyDesktop(file: Buffer) {
  const desktop = gatedDesktop(file)
  desktop.release()
  return desktop.client
}

const PDF = Buffer.from('%PDF-1.7\n')
const bigFile = { source: 'worktree', worktreeId: 'wt-1', relativePath: 'big.pdf' } as const
const smallFile = { source: 'worktree', worktreeId: 'wt-1', relativePath: 'small.pdf' } as const
const thirdFile = { source: 'worktree', worktreeId: 'wt-1', relativePath: 'third.pdf' } as const

/** Flushes every microtask already scheduled (a chunked read's own chained awaits included)
 *  without advancing past anything genuinely still pending, such as a held picker. */
async function flushPendingMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the save picker gate', () => {
  it('does not fail a big file colliding with a small file whose picker the same session opened first', async () => {
    const picker = androidPicker()
    const target = pickerSaveTarget(picker)
    const run = createSaveToPhoneRunner(target)
    const session = new AbortController()
    const slowBig = gatedDesktop(Buffer.alloc(3 * 1024 * 1024, 0x25))

    const big = run({
      client: slowBig.client,
      source: bigFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })
    const small = run({
      client: readyDesktop(PDF),
      source: smallFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })

    // The small file reads instantly, so its picker is the one that opens first.
    await vi.waitFor(() => expect(picker.pickerOpen()).toBe(true))
    expect(target.createDocument).toHaveBeenCalledTimes(1)

    // The big file's read finishes while the small file's picker is still open. On the bug this
    // collides right here, synchronously, with the small file's still-open picker -- nobody has
    // closed anything yet.
    slowBig.release()
    await flushPendingMicrotasks()
    expect(target.createDocument).toHaveBeenCalledTimes(1)

    picker.finishPicker()
    await expect(small).resolves.toMatchObject({ status: 'saved', fileName: 'small.pdf' })

    await vi.waitFor(() => expect(target.createDocument).toHaveBeenCalledTimes(2))
    picker.finishPicker()
    const outcome = await big

    expect(outcome.status).not.toBe('failed')
    expect(outcome).toMatchObject({ status: 'saved', fileName: 'big.pdf' })
  })

  it('holds the PDF viewer Download until a file save from the same session has closed its picker', async () => {
    const picker = androidPicker()
    const saveTarget = pickerSaveTarget(picker)
    const run = createSaveToPhoneRunner(saveTarget)
    const session = new AbortController()

    const save = run({
      client: readyDesktop(PDF),
      source: smallFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })
    await vi.waitFor(() => expect(picker.pickerOpen()).toBe(true))

    const deps = pickerPdfDeps(picker)
    const download = downloadMobilePdf(
      { uri: 'file:///cache/orca-pdf-1.pdf', fileName: 'big.pdf' },
      deps
    )
    await flushPendingMicrotasks()
    expect(deps.createDocument).not.toHaveBeenCalled()

    picker.finishPicker()
    await expect(save).resolves.toMatchObject({ status: 'saved' })

    await vi.waitFor(() => expect(deps.createDocument).toHaveBeenCalledTimes(1))
    picker.finishPicker()
    await expect(download).resolves.toEqual({ status: 'saved' })
  })

  it('opens the picker for a save waiting behind one whose own picker call rejected', async () => {
    const control = manualPicker()
    const target: MobileFileSaveTarget = {
      createDocument: control.createDocument,
      writeBase64: vi.fn(async () => {}),
      remove: vi.fn(async () => {})
    }
    const run = createSaveToPhoneRunner(target)
    const session = new AbortController()

    const first = run({
      client: readyDesktop(PDF),
      source: bigFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })
    const second = run({
      client: readyDesktop(PDF),
      source: smallFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })

    // Only the first file has reached the picker so far; the second is queued behind it.
    await vi.waitFor(() => expect(control.pendingCount()).toBe(1))
    control.rejectOldest(new Error('No Activity found to handle Intent'))

    const outcomeFirst = await first
    expect(outcomeFirst).toMatchObject({ status: 'failed' })

    // The rejection freed the gate: the second file's turn has come.
    await vi.waitFor(() => expect(control.pendingCount()).toBe(1))
    control.resolveOldest('content://downloads/document/2')
    const outcomeSecond = await second
    expect(outcomeSecond).toMatchObject({ status: 'saved', fileName: 'small.pdf' })
  })

  it('does not open a picker for a waiting save whose screen went away before its turn came', async () => {
    const picker = androidPicker()
    const target = pickerSaveTarget(picker)
    const run = createSaveToPhoneRunner(target)
    const session = new AbortController()
    const slowSecond = gatedDesktop(PDF)

    const first = run({
      client: readyDesktop(PDF),
      source: bigFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })
    await vi.waitFor(() => expect(picker.pickerOpen()).toBe(true))
    expect(target.createDocument).toHaveBeenCalledTimes(1)

    let secondOnScreen = true
    const second = run({
      client: slowSecond.client,
      source: smallFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => secondOnScreen
    })
    slowSecond.release()
    await flushPendingMicrotasks()
    // The second file's read is done, but its picker call is still queued behind the first's.
    expect(target.createDocument).toHaveBeenCalledTimes(1)

    secondOnScreen = false
    picker.finishPicker()
    await expect(first).resolves.toMatchObject({ status: 'saved' })

    await expect(second).resolves.toEqual({ status: 'abandoned', fileName: 'small.pdf' })
    expect(target.createDocument).toHaveBeenCalledTimes(1)
  })

  it('opens three different saves in a row, one at a time, in the order they asked', async () => {
    const picker = androidPicker()
    const target = pickerSaveTarget(picker)
    const run = createSaveToPhoneRunner(target)
    const session = new AbortController()

    const first = run({
      client: readyDesktop(PDF),
      source: bigFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })
    await vi.waitFor(() => expect(target.createDocument).toHaveBeenCalledTimes(1))

    const second = run({
      client: readyDesktop(PDF),
      source: smallFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })
    await flushPendingMicrotasks()
    expect(target.createDocument).toHaveBeenCalledTimes(1)

    const third = run({
      client: readyDesktop(PDF),
      source: thirdFile,
      notify: () => {},
      signal: session.signal,
      onScreen: () => true
    })
    await flushPendingMicrotasks()
    expect(target.createDocument).toHaveBeenCalledTimes(1)

    picker.finishPicker()
    await expect(first).resolves.toMatchObject({ status: 'saved', fileName: 'big.pdf' })
    await vi.waitFor(() => expect(target.createDocument).toHaveBeenCalledTimes(2))

    picker.finishPicker()
    await expect(second).resolves.toMatchObject({ status: 'saved', fileName: 'small.pdf' })
    await vi.waitFor(() => expect(target.createDocument).toHaveBeenCalledTimes(3))

    picker.finishPicker()
    await expect(third).resolves.toMatchObject({ status: 'saved', fileName: 'third.pdf' })
  })
})
