import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import PdfMock from '../test/react-native-pdf-mock'
import {
  flushReadingPositions,
  readingPositionKey,
  resetReadingPositionMemoryForTests
} from '../storage/reading-positions'
import { MobileFilePdfPreview } from './MobileFilePdfPreview'
import { MobileFileMarkdownPreview } from './MobileFileMarkdownPreview'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Code: 'Code',
  Download: 'Download',
  Pencil: 'Pencil'
}))

vi.mock('../components/MobileMarkdown', () => ({
  MobileMarkdown: 'MobileMarkdown'
}))

vi.mock('./MobileFilePreviewSourceText', () => ({
  MobileFilePreviewSourceText: 'MobileFilePreviewSourceText',
  MobileFilePreviewTruncatedNote: 'MobileFilePreviewTruncatedNote'
}))

vi.mock('./mobile-pdf-download-device', () => ({
  savePreviewedPdf: async () => 'saved'
}))

vi.mock('../theme/theme-context', () => ({
  useTheme: () => ({
    colors: {
      bg: '#000',
      bgPanel: '#111',
      bgRaised: '#222',
      border: '#333',
      text: '#fff',
      textSecondary: '#999',
      danger: '#f00'
    }
  }),
  useThemedStyles: () => ({})
}))

const key = readingPositionKey('host-1', 'wt-1', 'docs/thesis.pdf')
const markdownKey = readingPositionKey('host-1', 'wt-1', 'docs/thesis.md')

/** A process death: memory and pending timers go, storage stays. */
async function killTheApp(): Promise<void> {
  await flushReadingPositions()
  resetReadingPositionMemoryForTests()
}

async function renderPdf(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(
      createElement(MobileFilePdfPreview, {
        uri: 'file:///cache/thesis.pdf',
        fileName: 'thesis.pdf',
        readingPositionKey: key
      })
    )
  })
  // The restored position is read from storage before the native view mounts.
  await act(async () => {
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('MobileFilePdfPreview did not render')
  }
  return renderer
}

function pdfNode(renderer: ReactTestRenderer) {
  return renderer.root.findByType(PdfMock)
}

async function renderMarkdown(scrollTo: ReturnType<typeof vi.fn>): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(
      createElement(MobileFileMarkdownPreview, {
        relativePath: 'docs/thesis.md',
        content: '# Thesis\n\nlong',
        truncated: false,
        byteLength: 20,
        readingPositionKey: markdownKey
      }),
      { createNodeMock: (element) => (element.type === 'ScrollView' ? { scrollTo } : null) }
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('MobileFileMarkdownPreview did not render')
  }
  return renderer
}

function scrollView(renderer: ReactTestRenderer) {
  return renderer.root.findByType('ScrollView')
}

function scrollEvent(y: number, contentHeight: number) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: contentHeight },
      layoutMeasurement: { width: 400, height: 800 }
    }
  }
}

beforeEach(async () => {
  resetReadingPositionMemoryForTests()
  await AsyncStorage.clear()
})

afterEach(() => {
  resetReadingPositionMemoryForTests()
})

describe('a PDF put down partway', () => {
  it('opens at the page it was closed on after the app was swiped away', async () => {
    const first = await renderPdf()
    await act(async () => {
      pdfNode(first).props.onLoadComplete(200)
      pdfNode(first).props.onPageChanged(47, 200)
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    const second = await renderPdf()
    expect(pdfNode(second).props.page).toBe(47)
  })

  it('does not remember page 1', async () => {
    const first = await renderPdf()
    await act(async () => {
      pdfNode(first).props.onLoadComplete(200)
      pdfNode(first).props.onPageChanged(47, 200)
      pdfNode(first).props.onPageChanged(1, 200)
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    expect((await AsyncStorage.getItem('orca:readingPositions')) ?? '').not.toContain('thesis.pdf')
    const second = await renderPdf()
    expect(pdfNode(second).props.page).toBe(1)
  })

  it('keeps the initial page fixed while the reader pages on', async () => {
    const first = await renderPdf()
    await act(async () => {
      pdfNode(first).props.onLoadComplete(200)
      pdfNode(first).props.onPageChanged(47, 200)
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    const second = await renderPdf()
    await act(async () => {
      pdfNode(second).props.onLoadComplete(200)
      pdfNode(second).props.onPageChanged(48, 200)
      pdfNode(second).props.onPageChanged(49, 200)
    })
    // A changed `page` prop makes the native view jump; the reader must not
    // be yanked back to 47 by their own re-render.
    expect(pdfNode(second).props.page).toBe(47)
  })
})

describe('a rendered markdown file put down partway', () => {
  it('scrolls back to where it was after the app was swiped away', async () => {
    const firstScrollTo = vi.fn()
    const first = await renderMarkdown(firstScrollTo)
    await act(async () => {
      scrollView(first).props.onContentSizeChange(400, 5000)
      scrollView(first).props.onScroll(scrollEvent(1234, 5000))
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    const scrollTo = vi.fn()
    const second = await renderMarkdown(scrollTo)
    await act(async () => {
      scrollView(second).props.onContentSizeChange(400, 5000)
    })
    expect(scrollTo).toHaveBeenCalledWith({ y: 1234, animated: false })
  })

  it('scales the offset when the document renders at a different height', async () => {
    const first = await renderMarkdown(vi.fn())
    await act(async () => {
      scrollView(first).props.onContentSizeChange(400, 5000)
      scrollView(first).props.onScroll(scrollEvent(1234, 5000))
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    const scrollTo = vi.fn()
    const second = await renderMarkdown(scrollTo)
    await act(async () => {
      scrollView(second).props.onContentSizeChange(400, 2500)
    })
    expect(scrollTo).toHaveBeenCalledWith({ y: 617, animated: false })
  })

  it('does not remember the top of the document', async () => {
    const first = await renderMarkdown(vi.fn())
    await act(async () => {
      scrollView(first).props.onContentSizeChange(400, 5000)
      scrollView(first).props.onScroll(scrollEvent(1234, 5000))
      scrollView(first).props.onScroll(scrollEvent(0, 5000))
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    const scrollTo = vi.fn()
    const second = await renderMarkdown(scrollTo)
    await act(async () => {
      scrollView(second).props.onContentSizeChange(400, 5000)
    })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('restores again after Source and back, which remounts the scroller', async () => {
    // Review 2026-09-19: the restore ran once per document, so Preview →
    // Source → Preview came back at the top.
    const first = await renderMarkdown(vi.fn())
    await act(async () => {
      scrollView(first).props.onContentSizeChange(400, 5000)
      scrollView(first).props.onScroll(scrollEvent(1234, 5000))
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    const scrollTo = vi.fn()
    const second = await renderMarkdown(scrollTo)
    await act(async () => {
      scrollView(second).props.onContentSizeChange(400, 5000)
    })
    expect(scrollTo).toHaveBeenCalledTimes(1)
    const toggle = (label: string) =>
      second.root.findAllByType('Pressable').find((node) => node.props.accessibilityLabel === label)!
    await act(async () => {
      toggle('View Markdown source').props.onPress()
    })
    await act(async () => {
      toggle('View rendered Markdown preview').props.onPress()
    })
    await act(async () => {
      scrollView(second).props.onContentSizeChange(400, 5000)
    })
    expect(scrollTo).toHaveBeenCalledTimes(2)
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 1234, animated: false })
  })

  it('restores once, not on every relayout', async () => {
    const first = await renderMarkdown(vi.fn())
    await act(async () => {
      scrollView(first).props.onContentSizeChange(400, 5000)
      scrollView(first).props.onScroll(scrollEvent(1234, 5000))
    })
    await act(async () => {
      first.unmount()
    })
    await killTheApp()

    const scrollTo = vi.fn()
    const second = await renderMarkdown(scrollTo)
    await act(async () => {
      scrollView(second).props.onContentSizeChange(400, 5000)
      scrollView(second).props.onScroll(scrollEvent(3000, 5000))
      scrollView(second).props.onContentSizeChange(400, 5200)
    })
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})
