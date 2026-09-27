import { describe, expect, it } from 'vitest'
import type { PickedMobileImage } from './mobile-image-source-picker'
import { attachMobileDocumentsToTerminal } from './mobile-document-attachment'
import { makeClient, methodNotFound, ok, sendResult } from './use-mobile-native-chat-image-attachments.test-support'

// Every upload takes the single-frame fallback (methodNotFound on start, then
// a save that hands back a path) — the byte payloads below are tiny, so real
// code takes that branch regardless of call order or count.
function documentClient() {
  return makeClient((method) =>
    method === 'clipboard.startImageUpload'
      ? methodNotFound('start')
      : method === 'clipboard.saveImageAsTempFile'
        ? ok('save', '/tmp/upload.png')
        : sendResult(true)
  )
}

async function* pick(items: PickedMobileImage[]): AsyncGenerator<PickedMobileImage> {
  for (const item of items) {
    yield item
  }
}

describe('attachMobileDocumentsToTerminal', () => {
  it('still types an ordinary document as a named-file note', async () => {
    const client = documentClient()
    const accepted = await attachMobileDocumentsToTerminal({
      client,
      terminal: 't1',
      deviceToken: null,
      getConnectionId: async () => null,
      pickDocuments: () => pick([{ base64: 'AAAA', uri: 'file:///a.pdf', name: 'a.pdf' }])
    })
    expect(accepted).toBe(true)
    const sendCall = client.calls.find((call) => call.method === 'terminal.send')!
    expect((sendCall.params as { text: string }).text).toMatch(/^Attached file "a\.pdf" is on this machine at/)
  })

  it('returns false, sending nothing, when the picker yields nothing', async () => {
    const client = documentClient()
    const accepted = await attachMobileDocumentsToTerminal({
      client,
      terminal: 't1',
      deviceToken: null,
      getConnectionId: async () => null,
      pickDocuments: () => pick([])
    })
    expect(accepted).toBe(false)
    expect(client.calls).toHaveLength(0)
  })
})
