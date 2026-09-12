import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import {
  addUploadingNativeChatImage,
  appendPendingNativeChatImages,
  dropUploadingNativeChatImages,
  uploadMobileNativeChatImages
} from './mobile-native-chat-image-attachment'

function ok(id: string, result: unknown): RpcSuccess {
  return { id, ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function methodNotFound(id: string): RpcResponse {
  return {
    id,
    ok: false,
    error: { code: 'method_not_found', message: 'no' },
    _meta: { runtimeId: 'r' }
  }
}

function failed(id: string, message: string): RpcResponse {
  return { id, ok: false, error: { code: 'failed', message }, _meta: { runtimeId: 'r' } }
}

function clientWithResponses(responses: RpcResponse[]): Pick<RpcClient, 'sendRequest'> & {
  calls: { method: string; params: unknown }[]
} {
  const calls: { method: string; params: unknown }[] = []
  return {
    calls,
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      const response = responses.shift()
      if (!response) {
        throw new Error(`unexpected request: ${method}`)
      }
      return response
    })
  }
}

describe('uploadMobileNativeChatImages', () => {
  it('uploads the picked image and returns its host path + local preview uri, without any terminal.send', async () => {
    const client = clientWithResponses([
      methodNotFound('start'),
      ok('save', '/tmp/orca-attach.png')
    ])

    const result = await uploadMobileNativeChatImages('library', {
      client,
      getConnectionId: async () => 'conn-7',
      pickImages: vi.fn().mockResolvedValue([{ base64: 'AAAA', uri: 'file:///photo.jpg' }])
    })

    expect(result).toEqual([{ path: '/tmp/orca-attach.png', previewUri: 'file:///photo.jpg' }])
    // Native chat defers the paste to submit — nothing is sent to the terminal here.
    expect(client.calls.some((call) => call.method === 'terminal.send')).toBe(false)
    const saveCall = client.calls.find((c) => c.method === 'clipboard.saveImageAsTempFile')
    expect(saveCall?.params).toMatchObject({ connectionId: 'conn-7' })
  })

  it('uploads all three selected images in picker order', async () => {
    const client = clientWithResponses([
      methodNotFound('start-a'),
      ok('save-a', '/tmp/a.png'),
      methodNotFound('start-b'),
      ok('save-b', '/tmp/b.png'),
      methodNotFound('start-c'),
      ok('save-c', '/tmp/c.png')
    ])

    const order: string[] = []
    async function* pickImages() {
      for (const image of [
        { base64: 'AAAA', uri: 'file:///a.jpg' },
        { base64: 'BBBB', uri: 'file:///b.jpg' },
        { base64: 'CCCC', uri: 'file:///c.jpg' }
      ]) {
        order.push(`read:${image.uri}`)
        yield image
      }
    }
    const result = await uploadMobileNativeChatImages('library', {
      client,
      getConnectionId: async () => 'conn-7',
      pickImages,
      onImageUploaded: (image) => order.push(`uploaded:${image.previewUri}`)
    })

    expect(result).toEqual([
      { path: '/tmp/a.png', previewUri: 'file:///a.jpg' },
      { path: '/tmp/b.png', previewUri: 'file:///b.jpg' },
      { path: '/tmp/c.png', previewUri: 'file:///c.jpg' }
    ])
    expect(order).toEqual([
      'read:file:///a.jpg',
      'uploaded:file:///a.jpg',
      'read:file:///b.jpg',
      'uploaded:file:///b.jpg',
      'read:file:///c.jpg',
      'uploaded:file:///c.jpg'
    ])
  })

  it('returns null when the picker is cancelled and uploads nothing', async () => {
    const client = clientWithResponses([])

    const result = await uploadMobileNativeChatImages('library', {
      client,
      getConnectionId: async () => null,
      pickImages: vi.fn().mockResolvedValue([])
    })

    expect(result).toEqual([])
    expect(client.calls).toEqual([])
  })

  it('reports completed uploads before a later image fails', async () => {
    const client = clientWithResponses([
      methodNotFound('start-a'),
      ok('save-a', '/tmp/a.png'),
      methodNotFound('start-b'),
      failed('save-b', 'upload failed')
    ])
    const onImageUploaded = vi.fn()

    await expect(
      uploadMobileNativeChatImages('library', {
        client,
        getConnectionId: async () => null,
        pickImages: vi.fn().mockResolvedValue([
          { base64: 'AAAA', uri: 'file:///a.jpg' },
          { base64: 'BBBB', uri: 'file:///b.jpg' }
        ]),
        onImageUploaded
      })
    ).rejects.toThrow('upload failed')
    expect(onImageUploaded).toHaveBeenCalledOnce()
    expect(onImageUploaded).toHaveBeenCalledWith({
      path: '/tmp/a.png',
      previewUri: 'file:///a.jpg'
    })
  })

  it('falls back to an inline data uri for the preview when the picker omits a uri', async () => {
    const client = clientWithResponses([methodNotFound('start'), ok('save', '/tmp/x.png')])

    const result = await uploadMobileNativeChatImages('files', {
      client,
      getConnectionId: async () => null,
      pickImages: vi.fn().mockResolvedValue([{ base64: 'BBBB' }])
    })

    expect(result).toEqual([{ path: '/tmp/x.png', previewUri: 'data:image/png;base64,BBBB' }])
  })

  it('signals upload start only after a real image is picked', async () => {
    const onUploadStart = vi.fn()
    const cancelledClient = clientWithResponses([])
    await uploadMobileNativeChatImages('library', {
      client: cancelledClient,
      getConnectionId: async () => null,
      pickImages: vi.fn().mockResolvedValue([]),
      onUploadStart
    })
    expect(onUploadStart).not.toHaveBeenCalled()

    const client = clientWithResponses([methodNotFound('start'), ok('save', '/tmp/y.png')])
    await uploadMobileNativeChatImages('library', {
      client,
      getConnectionId: async () => null,
      pickImages: vi.fn().mockResolvedValue([{ base64: 'CCCC', uri: 'file:///y.jpg' }]),
      onUploadStart
    })
    expect(onUploadStart).toHaveBeenCalledTimes(1)
  })

  // Claude app, 2026-09-13: a heavy file shows its chip with a ring at once,
  // and the composer keeps working. The chip must exist before the bytes go
  // up, and the finished upload must take that chip's place, not add one.
  it('announces each picked file before its upload, and the upload fills that chip', async () => {
    const onImageStart = vi.fn()
    const client = clientWithResponses([methodNotFound('start'), ok('save', '/tmp/y.png')])
    await uploadMobileNativeChatImages('files', {
      client,
      getConnectionId: async () => null,
      pickImages: vi.fn().mockResolvedValue([{ base64: 'CCCC', uri: 'file:///clip.mp4', name: 'clip.mp4' }]),
      onImageStart
    })
    expect(onImageStart).toHaveBeenCalledWith({ previewUri: 'file:///clip.mp4', kind: 'file', name: 'clip.mp4' })

    const counter = { current: 0 }
    const placeholder = addUploadingNativeChatImage([], onImageStart.mock.calls[0]![0], counter)
    expect(placeholder).toEqual([
      { id: 'img-1', path: '', uploading: true, previewUri: 'file:///clip.mp4', kind: 'file', name: 'clip.mp4' }
    ])
    const filled = appendPendingNativeChatImages(
      placeholder,
      [{ path: '/tmp/y.png', previewUri: 'file:///clip.mp4', kind: 'file', name: 'clip.mp4' }],
      counter
    )
    expect(filled).toEqual([
      { id: 'img-1', path: '/tmp/y.png', previewUri: 'file:///clip.mp4', kind: 'file', name: 'clip.mp4' }
    ])
    expect(dropUploadingNativeChatImages(placeholder)).toEqual([])
    expect(dropUploadingNativeChatImages(filled)).toEqual(filled)
  })
})
