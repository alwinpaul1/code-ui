import { describe, expect, it } from 'vitest'
import {
  base64ByteLength,
  CCR_ATTACHMENT_EMPTY,
  CCR_ATTACHMENT_MAX_BYTES,
  CCR_ATTACHMENT_TOO_LARGE,
  CCR_UPLOAD_FAILED,
  CcrFileUploadError,
  uploadCcrFile,
  type CcrFileUploadRequest
} from './ccr-file-upload'

// A 2x1 PNG (one red, one blue pixel), the bytes probe P13 uploads.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAFBgEB1ld/kQAAAABJRU5ErkJggg=='
const TXT = Buffer.from('codeui probe line one\n').toString('base64')
// The reply probe P2 read live from POST /v1/files on 2026-10-15.
const FILES_REPLY = JSON.stringify({ type: 'file', id: 'file_016LDCgfiAvJMENoTLJ5KYbj', size_bytes: 204, created_at: '2026-10-15T00:43:53.396734Z', filename: 'probe.png', mime_type: 'image/png', downloadable: true })

function harness(answers: readonly { status: number; body: string }[]) {
  const sent: CcrFileUploadRequest[] = []
  const asked: { accountId: string; fresh: boolean }[] = []
  const deps = {
    auth: async (accountId: string, fresh: boolean) => {
      asked.push({ accountId, fresh })
      return { token: `token-of-${accountId}${fresh ? '-fresh' : ''}`, organizationUuid: 'org' }
    },
    upload: async (request: CcrFileUploadRequest) => {
      sent.push(request)
      return answers[Math.min(sent.length - 1, answers.length - 1)]!
    }
  }
  return { deps, sent, asked }
}

describe('an attachment uploaded to Anthropic when it is attached, with the tab session account own sign-in', () => {
  it('sends one multipart request: part "file" named as the file, purpose user_data, the Files API beta, and that account bearer', async () => {
    const { deps, sent, asked } = harness([{ status: 200, body: FILES_REPLY }])
    const file = await uploadCcrFile(deps, 'acct-tab', { base64: PNG, name: 'screen.png', mimeType: 'image/png' })
    expect(asked).toEqual([{ accountId: 'acct-tab', fresh: false }])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      url: 'https://api.anthropic.com/v1/files',
      headers: { Authorization: 'Bearer token-of-acct-tab', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14,oauth-2025-04-20' },
      part: { field: 'file', fileName: 'screen.png', mimeType: 'image/png', base64: PNG },
      fields: { purpose: 'user_data' }
    })
    expect(file).toEqual({ fileId: 'file_016LDCgfiAvJMENoTLJ5KYbj', fileName: 'screen.png', isImage: true, accountId: 'acct-tab' })
  })

  it('never asks for another account sign-in than the one named, even after a 401', async () => {
    const { deps, asked, sent } = harness([{ status: 401, body: '' }, { status: 200, body: FILES_REPLY }])
    await uploadCcrFile(deps, 'acct-work', { base64: PNG })
    expect(asked).toEqual([
      { accountId: 'acct-work', fresh: false },
      { accountId: 'acct-work', fresh: true }
    ])
    expect(sent.map((request) => request.headers.Authorization)).toEqual(['Bearer token-of-acct-work', 'Bearer token-of-acct-work-fresh'])
  })

  it('names a picked photo by its type and sends a text document as a non-image', async () => {
    const { deps, sent } = harness([{ status: 200, body: FILES_REPLY }])
    const photo = await uploadCcrFile(deps, 'a', { base64: PNG })
    expect(sent[0]!.part).toMatchObject({ fileName: 'image.png', mimeType: 'image/png' })
    expect(photo.isImage).toBe(true)
    const doc = await uploadCcrFile(deps, 'a', { base64: TXT, name: 'notes.txt', mimeType: 'text/plain' })
    expect(doc).toMatchObject({ fileName: 'notes.txt', isImage: false })
    expect(sent[1]!.part).toMatchObject({ fileName: 'notes.txt', mimeType: 'text/plain' })
  })

  it('refuses a 0-byte file before any request, with a reason that cannot be retried', async () => {
    const { deps, sent } = harness([{ status: 200, body: FILES_REPLY }])
    const error = await uploadCcrFile(deps, 'a', { base64: '', name: 'empty.txt' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CcrFileUploadError)
    expect((error as CcrFileUploadError).userMessage).toBe(CCR_ATTACHMENT_EMPTY)
    expect((error as CcrFileUploadError).refusedBeforeUpload).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('refuses a file one byte over the 30 MB cap before any request, in the app words, and takes one at the cap', async () => {
    const { deps, sent } = harness([{ status: 200, body: FILES_REPLY }])
    // 3 bytes per 4 base64 characters: a body of exactly CAP+1 bytes.
    const over = 'A'.repeat(Math.ceil(((CCR_ATTACHMENT_MAX_BYTES + 1) * 4) / 3 / 4) * 4)
    expect(base64ByteLength(over)).toBeGreaterThan(CCR_ATTACHMENT_MAX_BYTES)
    const error = await uploadCcrFile(deps, 'a', { base64: over, name: 'big.bin' }).catch((e: unknown) => e)
    expect((error as CcrFileUploadError).userMessage).toBe('File size exceeds 30 MB limit')
    expect(CCR_ATTACHMENT_TOO_LARGE).toBe('File size exceeds 30 MB limit')
    expect(sent).toHaveLength(0)
    const atCap = 'A'.repeat((CCR_ATTACHMENT_MAX_BYTES / 3) * 4)
    expect(base64ByteLength(atCap)).toBe(CCR_ATTACHMENT_MAX_BYTES)
    await expect(uploadCcrFile(deps, 'a', { base64: atCap, name: 'cap.bin' })).resolves.toMatchObject({ fileId: 'file_016LDCgfiAvJMENoTLJ5KYbj' })
  })

  it('fails with the app "Upload failed" on a server error or a reply with no id, and "too large" on a 413', async () => {
    for (const [answer, message] of [
      [{ status: 500, body: '{}' }, CCR_UPLOAD_FAILED],
      [{ status: 200, body: '{"type":"file"}' }, CCR_UPLOAD_FAILED],
      [{ status: 200, body: 'not json' }, CCR_UPLOAD_FAILED],
      [{ status: 413, body: '' }, CCR_ATTACHMENT_TOO_LARGE]
    ] as const) {
      const { deps } = harness([answer])
      const error = await uploadCcrFile(deps, 'a', { base64: PNG }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(CcrFileUploadError)
      expect((error as CcrFileUploadError).userMessage).toBe(message)
      expect((error as CcrFileUploadError).refusedBeforeUpload).toBe(false)
    }
  })

  it('fails as "Upload failed" with no sign-in at all, and never puts a token in the error', async () => {
    const deps = { auth: async () => null, upload: async () => ({ status: 200, body: FILES_REPLY }) }
    const error = (await uploadCcrFile(deps, 'a', { base64: PNG }).catch((e: unknown) => e)) as CcrFileUploadError
    expect(error.userMessage).toBe(CCR_UPLOAD_FAILED)
    const leaky = harness([{ status: 500, body: '' }])
    const failed = (await uploadCcrFile(leaky.deps, 'acct-x', { base64: PNG }).catch((e: unknown) => e)) as CcrFileUploadError
    expect(failed.message).not.toContain('token-of')
  })
})
