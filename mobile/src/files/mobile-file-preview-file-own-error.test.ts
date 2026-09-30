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
    ['binary', { code: 'runtime_error', message: 'binary_file' }],
    ['not there, by the file read\'s own not_found code', { code: 'not_found', message: '' }],
    ['not there, by that code with the words behind it', { code: 'not_found', message: 'no such file' }],
    ['not there, said in words', { code: 'runtime_error', message: 'File not found' }],
    ['not there, said to not exist', { code: 'runtime_error', message: 'File does not exist' }]
  ])('is kept when the file is %s', (_why, refusal) => {
    expect(isFileOwnPreviewError(previewErrorFromRefusal(refusal))).toBe(true)
  })

  // Review 2026-09-30, round 4: previewError read ANY "not found" as "File not found", so a refusal
  // about the desktop's worktree, runtime or method was kept as the file's answer and the figure
  // stayed a link until the document closed. What the refusal names as missing decides: its code
  // (`selector_not_found` names the selector), or the word its message puts before "not found".
  it.each([
    ['the worktree was not found', { code: 'selector_not_found', message: 'Worktree not found' }],
    ['the remote runtime was not found', { code: 'runtime_error', message: 'Remote Orca runtime not found' }],
    ['the method was not found', { code: 'method_not_found', message: 'Method not found' }],
    ['the method was not found, by its code alone', { code: 'method_not_found', message: '' }],
    ['the selector matched nothing', { code: 'runtime_error', message: 'Unknown worktree selector id:wt (not found)' }],
    ['the selector token is the whole message', { code: 'runtime_error', message: 'selector_not_found' }],
    ['the agent session was not found', { code: 'agent_session_not_found', message: 'Session not found' }],
    ['the worktree is said not to exist', { code: 'runtime_error', message: 'Worktree does not exist' }],
    ['the bare not_found code comes with words naming the worktree', { code: 'not_found', message: 'no such worktree' }],
    ['the words name nothing at all', { code: 'runtime_error', message: 'Not found' }]
  ])('is not kept when %s', (_why, refusal) => {
    expect(isFileOwnPreviewError(previewErrorFromRefusal(refusal))).toBe(false)
  })

  it('shows a refusal about the worktree or the runtime as what it is, not as a missing file', () => {
    expect(previewErrorFromRefusal({ code: 'selector_not_found', message: 'Worktree not found' })).toEqual({
      status: 'error',
      message: 'Unable to load preview: Worktree not found',
      reconnect: false
    })
    expect(previewErrorFromRefusal({ code: 'runtime_error', message: 'Remote Orca runtime not found' })).toEqual({
      status: 'error',
      message: 'Unable to load preview: Remote Orca runtime not found',
      reconnect: false
    })
    expect(previewErrorFromRefusal({ code: 'method_not_found', message: '' })).toEqual({
      status: 'error',
      message: 'Unable to load preview: method_not_found',
      reconnect: false
    })
    // The screen's own previewError, fed a thrown error's message, reads it the same way.
    expect(previewError('Worktree not found')).toEqual({
      status: 'error',
      message: 'Unable to load preview: Worktree not found',
      reconnect: false
    })
    expect(previewError('File not found')).toEqual({ status: 'error', message: 'File not found', reconnect: false })
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

// Review 2026-10-01: the classifier scanned the whole message, the quoted path included, so a
// missing file whose own name said "not found" read as something else missing: the preview said
// "Unable to load preview" and a figure with that name was re-read on every connection. The path a
// refusal quotes is data, not its words.
describe('a missing file whose own path says "not found"', () => {
  it.each([
    ["img/user_not_found.png"],
    ['img/page not found.png'],
    ['/Users/me/runtime not found/a.png'],
    ['Notes (not found).md']
  ])('is still "File not found" for %s', (path) => {
    const error = previewErrorFromRefusal({ code: 'runtime_error', message: `ENOENT: no such file or directory, open '${path}'` })
    expect(error).toMatchObject({ message: 'File not found' })
    expect(isFileOwnPreviewError(error)).toBe(true)
  })

  it('still reads a quoted worktree name as the worktree being missing', () => {
    expect(isFileOwnPreviewError(previewErrorFromRefusal({ code: 'runtime_error', message: "Worktree 'fig' not found" }))).toBe(false)
  })
})
