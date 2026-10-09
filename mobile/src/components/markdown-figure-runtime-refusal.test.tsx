import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { createMarkdownImageResolver } from '../files/markdown-image-resolver'

vi.mock('react-native', async () => {
  const { createElement } = await import('react')
  const ImageMock = Object.assign((props: Record<string, unknown>) => createElement('RNImage', props), {
    getSize: vi.fn()
  })
  return {
    Image: ImageMock,
    Linking: { openURL: vi.fn() },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View'
  }
})
vi.mock('react-native-svg', () => ({ SvgXml: 'SvgXml' }))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }))
vi.mock('../files/mobile-pdf-cache', () => ({ resolveMobilePdfUri: vi.fn() }))

/**
 * The resolver and the figure, crossed (review 2026-09-30, round 3). The figure reads again once per
 * new connection, and each alone passed its tests: the figure's against a resolver double that
 * answers what it is told, the resolver's against replies. Together, a figure the desktop refused
 * with "Remote Orca runtime is not connected." stayed a link for as long as the document was open,
 * because the resolver had kept that refusal as the file's answer and the figure's re-read got it
 * back from the cache.
 */

const XML = '<svg viewBox="0 0 800 400"></svg>'
const DOCUMENT = ['Before.', '', '![CKA twins](fig/cka.svg)', '', 'After.'].join('\n')

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

function desktop(replies: unknown[]) {
  let connectedAt: number | null = 1
  const listeners = new Set<() => void>()
  const methods: string[] = []
  const client = {
    sendRequest: vi.fn(async (method: string) => {
      methods.push(method)
      const next = replies.shift()
      if (!next) {
        throw new Error('no reply scripted')
      }
      if (typeof next === 'object' && 'throw' in next) {
        throw new Error(String(next.throw))
      }
      return next
    }),
    getLastConnectedAt: () => connectedAt,
    onStateChange: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
  return {
    methods,
    resolve: createMarkdownImageResolver({ client: client as never, worktreeId: 'wt', documentRelativePath: 'README.md' }),
    announce: async (at: number) => {
      connectedAt = at
      await act(async () => {
        for (const listener of Array.from(listeners)) {
          listener()
        }
        await Promise.resolve()
      })
      await settle()
    }
  }
}

async function settle() {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function open(resolveImage: unknown) {
  await act(async () => {
    renderer = create(createElement(MobileMarkdown, { content: DOCUMENT, resolveImage: resolveImage as never }))
  })
  await settle()
  // The mocked View is the host string 'View', which ElementType does not name.
  const root = renderer!.root.findAll((node) => node.type === ('View' as never) && node.props.onLayout)[0]!
  act(() => root.props.onLayout({ nativeEvent: { layout: { width: 360, height: 0 } } }))
  return renderer!
}

const links = (r: ReactTestRenderer) => r.root.findAll((node) => node.props.testID === 'markdown-image-link')

describe('a figure the desktop refused while its runtime was not connected', () => {
  it('is drawn once the host connects again, with no tap', async () => {
    const host = desktop([
      { ok: false, error: { code: 'runtime_unavailable', message: 'Remote Orca runtime is not connected.' } },
      { ok: true, result: { content: XML, truncated: false, byteLength: XML.length } }
    ])
    const r = await open(host.resolve)
    expect(links(r)).toHaveLength(1)
    expect(host.methods).toEqual(['files.read'])
    // The same connection repainting itself is not a new connection: no second read.
    await host.announce(1)
    expect(host.methods).toHaveLength(1)
    await host.announce(2)
    expect(host.methods).toEqual(['files.read', 'files.read'])
    expect(r.root.findByType('SvgXml' as never).props).toMatchObject({ xml: XML, width: 360 })
    expect(links(r)).toHaveLength(0)
  })

  it('is not read again when the document is drawn again on the connection the read failed on', async () => {
    // Source and back remounts every figure. One that did not answer waits for a NEW connection.
    const host = desktop([
      { throw: 'Request timed out: files.read' },
      { ok: true, result: { content: XML, truncated: false, byteLength: XML.length } }
    ])
    await open(host.resolve)
    act(() => renderer?.unmount())
    const r = await open(host.resolve)
    expect(host.methods).toHaveLength(1)
    expect(links(r)).toHaveLength(1)
    await host.announce(2)
    expect(host.methods).toHaveLength(2)
    expect(links(r)).toHaveLength(0)
  })

  it('stays the link, read once, when the host said the file is not there', async () => {
    const host = desktop([
      { ok: false, error: { code: 'runtime_error', message: "ENOENT: no such file or directory, open 'fig/cka.svg'" } }
    ])
    const r = await open(host.resolve)
    await host.announce(2)
    expect(links(r)).toHaveLength(1)
    expect(host.methods).toHaveLength(1)
  })
})
