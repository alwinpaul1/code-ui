import { describe, expect, it, vi } from 'vitest'
import { ccrAttachmentCachePath, ccrAttachmentMime, ccrAttachmentUrl, fetchCcrAttachment, type CcrAttachmentDeps } from './ccr-attachment-fetch'
import { RECORDING_UUID } from './fixtures/ccr-attachments-2026-10-15'

// What the 2026-10-15 probe saw: GET /api/oauth/files/{file_uuid}/content with the phone's own
// bearer token answered 200 and the file's bytes, for the recording of the user's report
// (12,813,883 bytes, `ftypmp42`). A file belongs to the account that uploaded it.

const REF = { fileUuid: RECORDING_UUID, fileName: 'Screen_Recording_20261015_123030_Code UI.mp4', isImage: false }

function deps(statuses: Record<string, number>, accounts: { id: string; accessToken: string | null }[] = [{ id: 'a', accessToken: 'tok-a' }, { id: 'b', accessToken: 'tok-b' }]): CcrAttachmentDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    accounts: async () => accounts,
    download: vi.fn(async (_url: string, destination: string, headers: Record<string, string>) => {
      calls.push(headers.Authorization!)
      return { status: statuses[headers.Authorization!.slice(7)] ?? 200, uri: destination }
    }),
    remove: vi.fn(async () => undefined),
    cacheDir: 'file:///cache/'
  }
}

describe('fetchCcrAttachment', () => {
  it('asks the oauth files endpoint with the signed-in account’s bearer token', async () => {
    const d = deps({})
    const outcome = await fetchCcrAttachment(REF, d)
    expect(outcome).toEqual({ uri: `file:///cache/ccr-attachments/${RECORDING_UUID}/Screen_Recording_20261015_123030_Code UI.mp4` })
    expect(d.download).toHaveBeenCalledWith(`https://api.anthropic.com/api/oauth/files/${RECORDING_UUID}/content`, expect.any(String), expect.objectContaining({ Authorization: 'Bearer tok-a' }))
    expect(ccrAttachmentUrl(RECORDING_UUID)).toContain('/api/oauth/files/')
  })

  it('asks the next account when the first does not own the file', async () => {
    const d = deps({ 'tok-a': 404 })
    expect(await fetchCcrAttachment(REF, d)).toHaveProperty('uri')
    expect(d.calls).toEqual(['Bearer tok-a', 'Bearer tok-b'])
    expect(d.remove).toHaveBeenCalledTimes(1)
  })

  it('says no signed-in account owns it when every one answers 404 or 403', async () => {
    expect(await fetchCcrAttachment(REF, deps({ 'tok-a': 404, 'tok-b': 403 }))).toEqual({ error: 'None of the signed-in Anthropic accounts owns this file.' })
  })

  it('names the status of a failure that is not about ownership, and keeps looking first', async () => {
    const d = deps({ 'tok-a': 500, 'tok-b': 404 })
    expect(await fetchCcrAttachment(REF, d)).toEqual({ error: 'Anthropic answered 500.' })
    expect(d.calls).toHaveLength(2)
  })

  it('reports a download that threw, not a crash', async () => {
    const d = deps({})
    d.download = vi.fn(async () => {
      throw new Error('Network request failed')
    })
    expect(await fetchCcrAttachment(REF, d)).toEqual({ error: 'The download failed: Network request failed' })
  })

  it('asks to sign in when nobody is, and when every sign-in has no token', async () => {
    expect(await fetchCcrAttachment(REF, deps({}, []))).toEqual({ error: 'Sign in to Anthropic to open this file.' })
    expect(await fetchCcrAttachment(REF, deps({}, [{ id: 'a', accessToken: null }]))).toEqual({ error: 'Sign in to Anthropic to open this file.' })
  })

  it('reports an unreadable sign-in store instead of rejecting', async () => {
    const d = deps({})
    d.accounts = async () => {
      throw new Error('keystore locked')
    }
    expect(await fetchCcrAttachment(REF, d)).toEqual({ error: 'Could not read the Anthropic sign-in: keystore locked' })
  })

  it('refuses a file id that is not a uuid before it reaches a path or a URL', async () => {
    const d = deps({})
    expect(await fetchCcrAttachment({ ...REF, fileUuid: '../../etc/passwd' }, d)).toEqual({ error: 'The file reference is not one Anthropic issues.' })
    expect(d.download).not.toHaveBeenCalled()
  })
})

describe('ccrAttachmentCachePath', () => {
  it('keeps the name a viewer shows and takes out what a path cannot hold', () => {
    expect(ccrAttachmentCachePath('file:///c/', { ...REF, fileName: 'a/b\\c:d.pdf' })).toBe(`file:///c/ccr-attachments/${RECORDING_UUID}/a_b_c_d.pdf`)
    expect(ccrAttachmentCachePath('file:///c/', { ...REF, fileName: '..hidden' })).toBe(`file:///c/ccr-attachments/${RECORDING_UUID}/_hidden`)
  })
})

describe('ccrAttachmentMime', () => {
  it('types the kinds the app sends and leaves an unknown one to the viewer chooser', () => {
    expect(ccrAttachmentMime('Screen_Recording.MP4')).toBe('video/mp4')
    expect(ccrAttachmentMime('notes.pdf')).toBe('application/pdf')
    expect(ccrAttachmentMime('1000150278.jpg')).toBe('image/jpeg')
    expect(ccrAttachmentMime('archive.xyz')).toBe('*/*')
    expect(ccrAttachmentMime('README')).toBe('*/*')
  })
})
