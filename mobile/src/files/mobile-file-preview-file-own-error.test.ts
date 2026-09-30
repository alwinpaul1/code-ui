import { describe, expect, it } from 'vitest'
import { isFileOwnPreviewError, previewError, previewErrorFromRefusal } from './mobile-file-preview-response'

/**
 * Which failed preview reads are the file's own answer (review 2026-09-30, round 3). The markdown
 * figure resolver keeps only these; before, it kept everything but four recoverable phrases, and
 * "Remote Orca runtime is not connected." left a figure a link until the document was closed.
 */
describe("a preview error that is the file's own answer", () => {
  it.each([
    ['not there', { code: 'runtime_error', message: "ENOENT: no such file or directory, open '/w/fig.png'" }],
    ['too large', { code: 'runtime_error', message: 'file_too_large' }],
    ['too large, by its code alone', { code: 'file_too_large', message: '' }],
    ['binary', { code: 'runtime_error', message: 'binary_file' }]
  ])('is kept when the file is %s', (_why, refusal) => {
    expect(isFileOwnPreviewError(previewErrorFromRefusal(refusal))).toBe(true)
  })

  it.each([
    ['the remote runtime was not connected', { code: 'runtime_unavailable', message: 'Remote Orca runtime is not connected.' }],
    ['the request timed out', { code: 'timeout', message: 'Request timed out' }],
    ['the runtime closed the connection', { code: 'remote_runtime_unavailable', message: 'Remote Orca runtime closed the connection' }],
    ['the filesystem was unreachable', { code: 'unavailable', message: 'remote connection dropped' }],
    ['a grant went stale', { code: 'terminal_file_grant_expired', message: 'terminal_file_grant_expired' }],
    ['the cause is unknown', { code: 'internal', message: 'Something new went wrong on the desktop' }],
    ['the desktop gave no reason at all', { code: '', message: '' }]
  ])('is not kept when %s', (_why, refusal) => {
    expect(isFileOwnPreviewError(previewErrorFromRefusal(refusal))).toBe(false)
  })

  it('is never an answer the screen builds for itself, or one still in flight', () => {
    expect(isFileOwnPreviewError({ status: 'error', message: 'Unable to load preview', reconnect: false })).toBe(false)
    expect(isFileOwnPreviewError({ status: 'waiting', message: 'Waiting for desktop...', reconnect: true })).toBe(false)
    expect(isFileOwnPreviewError({ status: 'loading', message: 'Loading...' })).toBe(false)
    expect(isFileOwnPreviewError({ status: 'error', message: 'File not found', reconnect: true })).toBe(false)
  })

  it('leaves what the preview screen shows for these refusals as it was', () => {
    // The resolver's rule moved; the screen's copy and its `reconnect` flag did not.
    expect(
      previewErrorFromRefusal({ code: 'runtime_unavailable', message: 'Remote Orca runtime is not connected.' })
    ).toEqual({ status: 'error', message: 'Unable to load preview: Remote Orca runtime is not connected.', reconnect: false })
    expect(previewErrorFromRefusal({ code: 'timeout', message: 'Request timed out' })).toEqual({
      status: 'error',
      message: 'Unable to load preview: Request timed out',
      reconnect: false
    })
    expect(previewError('remote connection dropped')).toEqual({
      status: 'error',
      message: 'Unable to reach the desktop filesystem',
      reconnect: true
    })
    expect(previewError('no such file')).toEqual({ status: 'error', message: 'File not found', reconnect: false })
    expect(previewError('file_too_large')).toEqual({
      status: 'error',
      message: 'File too large for mobile preview',
      reconnect: false
    })
    expect(previewError('binary_file')).toEqual({ status: 'error', message: 'Binary preview unavailable', reconnect: false })
  })
})
