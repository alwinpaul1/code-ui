import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
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

  it('sits inside the selectable prose run when drawn, so a selection can cross it', async () => {
    // 2026-09-19, "the same copying issue is for md file previews too": a
    // drawn figure was its own View between two Texts, and the thesis
    // write-up has a figure per section, so no selection could leave one.
    const xml = '<svg viewBox="0 0 800 400"></svg>'
    await render(async () => ({ kind: 'svg', xml }))
    layout(360)
    const run = selectableRun()
    const inOrder = (node: ReactTestInstance): string =>
      node.children.map((child) => (typeof child === 'string' ? child : inOrder(child))).join('')
    expect(run.findAll((node) => node.props.testID === 'markdown-image')).toHaveLength(1)
    expect(inOrder(run)).toContain('4. CKA, the new score')
    expect(inOrder(run)).toContain('Take the trained model.')
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

  it('draws the link, not a zero-width picture, before the document is measured', async () => {
    const xml = '<svg viewBox="0 0 800 400"></svg>'
    const r = await render(async () => ({ kind: 'svg', xml }))
    expect(r.root.findAll((node) => node.props.testID === 'markdown-image-link')).toHaveLength(1)
    expect(r.root.findAllByType('SvgXml' as never)).toHaveLength(0)
  })
})
