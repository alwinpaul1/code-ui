import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'
import type { MobileFilePreviewRpcSender } from './mobile-file-preview-operations'
import { createSaveToPhoneRunner, type MobileFileSaveTarget } from './mobile-file-save'

// One runner is shared by the file preview and every session's tab menu
// (mobile-file-save-device.ts), and it runs one save per file at a time. A save the user has
// walked away from used to keep that slot until its current read came back, so asking again for
// the same file was told "Already saving x" and no picker ever opened (review of 20289862).

/** A desktop whose chunk replies wait until `release()`, so the user can move while one is out. */
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

function phone() {
  let next = 0
  return {
    createDocument: vi.fn(async () => `content://downloads/document/${++next}`),
    writeBase64: vi.fn(async () => {}),
    remove: vi.fn(async () => {})
  } satisfies MobileFileSaveTarget
}

const report = { source: 'worktree', worktreeId: 'wt-1', relativePath: 'out/report.pdf' } as const
const PDF = Buffer.from('%PDF-1.7\n')

describe('saving a file again after leaving its first save', () => {
  it('opens the picker when the user comes back to the file and taps Save again', async () => {
    const target = phone()
    const run = createSaveToPhoneRunner(target)
    const slow = gatedDesktop(PDF)

    // Save from the preview, then back out while the read is still out.
    const leftPreview = new AbortController()
    const firstToasts: string[] = []
    const first = run({
      client: slow.client,
      source: report,
      notify: (message) => firstToasts.push(message),
      signal: leftPreview.signal
    })
    leftPreview.abort()

    // The same file opened again, Save tapped again, before that first read has come back.
    const secondToasts: string[] = []
    const second = await run({
      client: readyDesktop(PDF),
      source: report,
      notify: (message) => secondToasts.push(message),
      signal: new AbortController().signal
    })
    slow.release()

    expect(secondToasts).not.toContain('Already saving report.pdf')
    expect(second).toMatchObject({ status: 'saved', fileName: 'report.pdf' })
    expect(await first).toEqual({ status: 'abandoned', fileName: 'report.pdf' })
    // One picker, the one the user asked for on the screen they are on.
    expect(target.createDocument).toHaveBeenCalledTimes(1)
    expect(firstToasts).toEqual(['Getting report.pdf from the desktop…'])
  })

  it('opens the picker for a preview save of a file the covered session is still reading', async () => {
    const target = phone()
    // Big enough that the read out when the session is covered brings a megabyte in with it.
    const run = createSaveToPhoneRunner(target, { chunkBytes: 512 * 1024 })
    const bigPdf = Buffer.alloc(3 * 1024 * 1024, 0x25)
    const slow = gatedDesktop(bigPdf)

    // Save to Phone from the session's tab menu; then the file browser covers the session.
    let sessionInFront = true
    const sessionToasts: string[] = []
    const fromTabMenu = run({
      client: slow.client,
      source: report,
      notify: (message) => sessionToasts.push(message),
      signal: new AbortController().signal,
      onScreen: () => sessionInFront
    })
    sessionInFront = false

    // The same file's preview, over the session: Save.
    const previewToasts: string[] = []
    const fromPreview = await run({
      client: readyDesktop(bigPdf),
      source: report,
      notify: (message) => previewToasts.push(message),
      signal: new AbortController().signal
    })
    // The user goes back to the session before the tab-menu read comes back.
    sessionInFront = true
    slow.release()

    expect(previewToasts).not.toContain('Already saving report.pdf')
    expect(previewToasts.at(-1)).toBe('Saved report.pdf (3.0 MB)')
    expect(fromPreview).toMatchObject({ status: 'saved' })
    expect(await fromTabMenu).toEqual({ status: 'abandoned', fileName: 'report.pdf' })
    // The replaced save opens no second picker, even with its session back in front, and says
    // nothing more into the session: not its progress, not "Not saved".
    expect(target.createDocument).toHaveBeenCalledTimes(1)
    expect(sessionToasts).toEqual(['Getting report.pdf from the desktop…'])
  })

  it('still refuses a second tap while the save that took over is running', async () => {
    const target = phone()
    const run = createSaveToPhoneRunner(target)
    const slowFirst = gatedDesktop(PDF)
    const slowSecond = gatedDesktop(PDF)

    const leftPreview = new AbortController()
    const first = run({
      client: slowFirst.client,
      source: report,
      notify: () => {},
      signal: leftPreview.signal
    })
    leftPreview.abort()
    const second = run({
      client: slowSecond.client,
      source: report,
      notify: () => {},
      signal: new AbortController().signal
    })
    // The left-behind save winds down while the one that took over is still reading. It must not
    // hand the file's slot back on the way out.
    slowFirst.release()
    expect(await first).toEqual({ status: 'abandoned', fileName: 'report.pdf' })

    const toasts: string[] = []
    const third = await run({
      client: readyDesktop(PDF),
      source: report,
      notify: (message) => toasts.push(message),
      signal: new AbortController().signal
    })
    slowSecond.release()

    expect(third).toEqual({ status: 'busy', fileName: 'report.pdf' })
    expect(toasts).toEqual(['Already saving report.pdf'])
    expect(await second).toMatchObject({ status: 'saved' })
    expect(target.createDocument).toHaveBeenCalledTimes(1)
  })

  it('refuses a second tap on the same session tab while the session is in front', async () => {
    const target = phone()
    const run = createSaveToPhoneRunner(target)
    const slow = gatedDesktop(PDF)
    const session = { signal: new AbortController().signal, onScreen: () => true }

    const first = run({ client: slow.client, source: report, notify: () => {}, ...session })
    const toasts: string[] = []
    const again = await run({
      client: readyDesktop(PDF),
      source: report,
      notify: (message) => toasts.push(message),
      ...session
    })
    slow.release()

    expect(again).toEqual({ status: 'busy', fileName: 'report.pdf' })
    expect(toasts).toEqual(['Already saving report.pdf'])
    expect(await first).toMatchObject({ status: 'saved' })
    expect(target.createDocument).toHaveBeenCalledTimes(1)
  })
})
