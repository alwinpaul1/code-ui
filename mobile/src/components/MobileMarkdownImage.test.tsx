import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { peekImagePreview, resetImagePreviewForTests } from '../session/image-preview-store'

const getSize = vi.hoisted(() => vi.fn())
vi.mock('react-native', async () => {
  const { createElement } = await import('react')
  // A host tag with the static Image.getSize the component measures with.
  const ImageMock = Object.assign(
    (props: Record<string, unknown>) => createElement('RNImage', props),
    { getSize }
  )
  return {
    Platform: { OS: 'android' },
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

const DOCUMENT = ['## 4. CKA, the new score', '', '![CKA twins](fig/fig3_cka.svg)', '', 'Take the trained model.'].join(
  '\n'
)

let renderer: ReactTestRenderer | null = null

beforeEach(() => resetImagePreviewForTests())

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  getSize.mockReset()
})

async function render(resolveImage?: (url: string) => Promise<unknown>) {
  await act(async () => {
    renderer = create(createElement(MobileMarkdown, { content: DOCUMENT, resolveImage: resolveImage as never }))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return renderer!
}

/** The host connection a resolver hands its figures: `connect` is a NEW connection. */
function connectionDouble() {
  const listeners = new Set<() => void>()
  let connectedAt: number | null = 1
  const announce = async () => {
    await act(async () => {
      for (const listener of Array.from(listeners)) {
        listener()
      }
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
  }
  return {
    connection: {
      lastConnectedAt: () => connectedAt,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
    },
    announce,
    connect: async (at: number) => {
      connectedAt = at
      await announce()
    },
    listening: () => listeners.size
  }
}

/** The document measures its own width once; figures inline in the prose
 *  run are sized from it. */
function layout(width: number) {
  const root = renderer!.root.findAll((node) => node.type === 'View' && node.props.onLayout)[0]!
  act(() => root.props.onLayout({ nativeEvent: { layout: { width, height: 0 } } }))
}

function selectableRun() {
  const runs = renderer!.root.findAllByType('Text' as never).filter((node) => node.props.selectable === true)
  expect(runs).toHaveLength(1)
  return runs[0]!
}

describe('a figure in a markdown document', () => {
  // Reported 2026-09-19 with a screenshot of thesis_explained.md: the figure
  // showed as a link. The file sits beside the document on the desktop.
  it('draws an SVG the host hands back, at its own aspect ratio', async () => {
    const xml = '<svg viewBox="0 0 800 400"></svg>'
    const r = await render(async (url) => (url === 'fig/fig3_cka.svg' ? { kind: 'svg', xml } : null))
    layout(360)
    const svg = r.root.findByType('SvgXml' as never)
    expect(svg.props).toMatchObject({ xml, width: 360, height: 180 })
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(0)
  })

  it('draws a bitmap the host hands back, sized by what Image measures', async () => {
    getSize.mockImplementation((_uri: string, ok: (w: number, h: number) => void) => ok(1000, 500))
    const r = await render(async () => ({ kind: 'bitmap', uri: 'data:image/png;base64,AAAA' }))
    await act(async () => {
      await Promise.resolve()
    })
    layout(300)
    const image = r.root.findByType('RNImage' as never)
    expect(image.props.source).toEqual({ uri: 'data:image/png;base64,AAAA' })
    expect(image.props.style).toMatchObject({ width: 300, height: 150 })
  })

  it('stays the tappable link when the host cannot give the file', async () => {
    const r = await render(async () => null)
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(1)
    expect(r.root.findAllByType('RNImage' as never)).toHaveLength(0)
  })

  it('stays inside the selectable prose run where nothing can draw it', async () => {
    const r = await render(undefined)
    selectableRun()
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image')).toHaveLength(0)
  })

  it('is a block of its own between the prose runs when drawn, not a view inside one', async () => {
    // 2026-09-19: a drawn figure was put INSIDE the run as an inline view so
    // a selection could cross it, and the phone drew it over the heading
    // above and the prose below ("one of the images is overlapping with
    // text"). Android does not re-lay an inline view that grows after the
    // run's first layout, so the figure is a block again and a selection
    // stops at it; the prose on either side is still two selectable runs.
    const xml = '<svg viewBox="0 0 800 400"></svg>'
    const r = await render(async () => ({ kind: 'svg', xml }))
    layout(360)
    const runs = r.root.findAllByType('Text' as never).filter((node) => node.props.selectable === true)
    expect(runs).toHaveLength(2)
    for (const run of runs) {
      expect(run.findAll((node) => node.props.testID === 'markdown-image')).toHaveLength(0)
    }
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image')).toHaveLength(1)
  })

  it('opens the full-screen viewer on the figure itself when tapped', async () => {
    // 2026-09-19, "click an image in a md preview to zoom it to read the
    // text in it": the viewer gets the SVG as drawn, not a link to the file.
    const xml = '<svg viewBox="0 0 800 400"></svg>'
    const r = await render(async () => ({ kind: 'svg', xml }))
    layout(360)
    const figure = r.root.findAll((node) => node.props.testID === 'markdown-image')[0]!
    act(() => figure.props.onPress())
    expect(peekImagePreview()).toMatchObject({
      sources: [{ kind: 'svg', xml }],
      label: 'CKA twins',
      index: 0
    })
  })

  it('draws a figure whose read failed during a drop once the host connects again, with no tap', async () => {
    // Review 2026-09-30: a figure opened during a reconnect stayed a link over a healthy
    // connection until the document was closed. One read per NEW connection, never per render.
    const xml = '<svg viewBox="0 0 800 400"></svg>'
    const host = connectionDouble()
    let reachable = false
    let reads = 0
    const resolve = Object.assign(
      async () => {
        reads += 1
        return reachable ? { kind: 'svg', xml } : null
      },
      { connection: host.connection }
    )
    const r = await render(resolve)
    layout(360)
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(1)
    // The same connection saying something else about itself is not a reason to read again.
    await host.announce()
    expect(reads).toBe(1)
    reachable = true
    await host.connect(2)
    expect(reads).toBe(2)
    expect(r.root.findByType('SvgXml' as never).props).toMatchObject({ xml, width: 360 })
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(0)
    // A drawn figure is not read again when the host reconnects once more.
    await host.connect(3)
    expect(reads).toBe(2)
    act(() => renderer?.unmount())
    renderer = null
    expect(host.listening()).toBe(0)
  })

  it('stays the link when resolving the figure throws, instead of taking the document down', async () => {
    // Review 2026-09-30: `![chart](100%.png)` threw URIError out of the figure's effect, which
    // tore the viewer down through the nearest error boundary. Whatever a resolver does, the
    // figure falls back to the link.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const r = await render(() => {
        throw new URIError('URI malformed')
      })
      layout(360)
      expect(r.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(1)
      const rejected = await render(() => Promise.reject(new Error('remote connection dropped')))
      expect(rejected.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('draws the link, not a zero-width picture, before the document is measured', async () => {
    const xml = '<svg viewBox="0 0 800 400"></svg>'
    const r = await render(async () => ({ kind: 'svg', xml }))
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(1)
    expect(r.root.findAllByType('SvgXml' as never)).toHaveLength(0)
  })
})
