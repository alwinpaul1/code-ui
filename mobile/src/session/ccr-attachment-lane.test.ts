import { describe, expect, it, vi } from 'vitest'
import { ccrAttachmentLane, type CcrUploadForSession } from './use-ccr-attachment-lane'
import { CCR_ATTACHMENTS_THROUGH_ANTHROPIC, CcrFileUploadError } from './ccr-file-upload'
import type { CcrSendTarget } from './ccr-session-cache'
import { uploadMobileNativeChatImages } from './mobile-native-chat-image-attachment'
import { nativeChatComposerSend } from './native-chat-send-route'
import type { MobileClipboardImageRpcSender } from './mobile-clipboard-image-operations'

const target = (accountId: string, sessionId = 'cse_01TAB'): CcrSendTarget => ({ kind: 'target', accountId, sessionId })
const uploaded = (accountId: string) => ({ fileId: 'file_01X', fileName: 'image.png', isImage: true, accountId })

describe('a Claude tab attachment on the Anthropic lane', () => {
  it('uploads under the tab OWN session account, read at the pick, never another profile copy', async () => {
    const upload = vi.fn<CcrUploadForSession>(async (accountId) => uploaded(accountId))
    let current = target('acct-personal', 'cse_01PERSONAL')
    const lane = ccrAttachmentLane({ enabled: true, resolveTarget: () => current, send: async () => 'accepted', upload })!
    const store = lane.store()!
    await expect(store({ base64: 'iVBORw0KGgo=' })).resolves.toEqual({ path: '', anthropicFile: uploaded('acct-personal') })
    // The tab moved to its work profile: the next pick goes up under that account, to that session.
    current = target('acct-work', 'cse_01WORK')
    await store({ base64: 'iVBORw0KGgo=', name: 'a.png' })
    expect(upload.mock.calls.map(([accountId, sessionId]) => [accountId, sessionId])).toEqual([
      ['acct-personal', 'cse_01PERSONAL'],
      ['acct-work', 'cse_01WORK']
    ])
    expect(lane.accountId()).toBe('acct-work')
  })

  it('uploads nothing while the tab has no target of its own, and says why on the chip', async () => {
    const upload = vi.fn<CcrUploadForSession>()
    const lane = ccrAttachmentLane({ enabled: true, resolveTarget: () => ({ kind: 'refused', reason: 'other-account' }), send: async () => 'accepted', upload })!
    const error = await lane.store()!({ base64: 'iVBORw0KGgo=' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CcrFileUploadError)
    expect((error as CcrFileUploadError).userMessage).toMatch(/^Upload failed: the session this tab is matched to belongs to another Anthropic account/)
    expect(upload).not.toHaveBeenCalled()
    expect(lane.accountId()).toBeNull()
  })

  it('is off while the switch is off, so attachments keep the desktop path', () => {
    expect(ccrAttachmentLane({ enabled: false, resolveTarget: () => target('a'), send: async () => 'accepted', upload: vi.fn() })).toBeNull()
    // Waiting on probe P13: shipped off.
    expect(CCR_ATTACHMENTS_THROUGH_ANTHROPIC).toBe(false)
  })

  it('a pick and its retry go to the Anthropic store, and the desktop is never touched', async () => {
    const desktop: MobileClipboardImageRpcSender = { sendRequest: vi.fn(async () => { throw new Error('desktop touched') }) } as unknown as MobileClipboardImageRpcSender
    const getConnectionId = vi.fn(async () => 'conn-1')
    let fail = true
    const store = vi.fn(async () => {
      if (fail) { throw new CcrFileUploadError('Upload failed', 'HTTP 500') }
      return { path: '', anthropicFile: uploaded('acct-tab') }
    })
    let retry: (() => Promise<unknown>) | null = null
    const failed: unknown[] = []
    await uploadMobileNativeChatImages('library', {
      client: null,
      getConnectionId,
      store,
      pickImages: async () => [{ base64: 'iVBORw0KGgo=', uri: 'file:///p.png', mimeType: 'image/png' }],
      onImageFailed: (_image, error, again) => {
        failed.push(error)
        retry = again
      }
    }).catch(() => undefined)
    expect(failed).toHaveLength(1)
    fail = false
    await expect(retry!()).resolves.toEqual({ path: '', anthropicFile: uploaded('acct-tab'), previewUri: 'file:///p.png' })
    expect(store).toHaveBeenCalledWith({ base64: 'iVBORw0KGgo=', mimeType: 'image/png' })
    expect(getConnectionId).not.toHaveBeenCalled()
    expect(desktop.sendRequest).not.toHaveBeenCalled()
  })

  it('a finished pick lands on its chip with the Anthropic file and no desktop path', async () => {
    const landed: unknown[] = []
    await uploadMobileNativeChatImages('library', {
      client: null,
      getConnectionId: async () => null,
      store: async ({ name }) => ({ path: '', anthropicFile: { fileId: 'file_D', fileName: name ?? '?', isImage: false, accountId: 'acct-tab' } }),
      pickImages: async () => [{ base64: 'JVBERi0x', uri: 'file:///r.pdf', name: 'report.pdf', mimeType: 'application/pdf' }],
      onImageUploaded: (image) => landed.push(image)
    })
    expect(landed).toEqual([{ previewUri: 'file:///r.pdf', kind: 'file', name: 'report.pdf', path: '', anthropicFile: { fileId: 'file_D', fileName: 'report.pdf', isImage: false, accountId: 'acct-tab' } }])
  })
})

describe('which send the composer runs', () => {
  const terminal = vi.fn(async () => true)
  const viaAnthropic = vi.fn(async () => true)
  const anthropicText = vi.fn(async () => true)
  const images = (count: number) => ({ sendNativeChat: terminal, sendAnthropic: viaAnthropic, attachments: Array.from({ length: count }) })

  it('keeps a Codex tab, and every tab with no Anthropic lane, on the desktop path, chips or not', () => {
    expect(nativeChatComposerSend({}, images(0))).toBe(terminal)
    expect(nativeChatComposerSend({}, images(2))).toBe(terminal)
  })

  it('sends a Claude tab chips through the desktop while the switch is off, and through Anthropic once on', async () => {
    expect(nativeChatComposerSend({ nativeChatAnthropicSend: anthropicText, nativeChatAnthropicAttachments: null }, images(1))).toBe(terminal)
    const on = nativeChatComposerSend({ nativeChatAnthropicSend: anthropicText, nativeChatAnthropicAttachments: {} }, images(1))
    await on('what is in this photo')
    expect(viaAnthropic).toHaveBeenCalledWith('what is in this photo')
    expect(terminal).not.toHaveBeenCalled()
    // A slash command still types into the terminal, as on the text lane.
    await on('/compact')
    expect(terminal).toHaveBeenCalledWith('/compact')
  })
})
