import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoomableImage } from './ZoomableImage'

vi.mock('react-native', async () => {
  const { createElement } = await import('react')
  return {
    Image: (props: Record<string, unknown>) => createElement('RNImage', props),
    StyleSheet: { create: (styles: unknown) => styles },
    View: 'View'
  }
})
vi.mock('react-native-svg', () => ({ SvgXml: 'SvgXml' }))
vi.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {}
  for (const name of [
    'onStart',
    'onUpdate',
    'onEnd',
    'enabled',
    'minPointers',
    'maxPointers',
    'numberOfTaps',
    'maxDuration'
  ]) {
    chain[name] = () => chain
  }
  return {
    Gesture: {
      Pinch: () => chain,
      Pan: () => chain,
      Tap: () => chain,
      Simultaneous: () => ({}),
      Exclusive: () => ({})
    },
    GestureDetector: 'GestureDetector'
  }
})

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

// The gestures themselves run on the UI thread and are covered by the
// arithmetic in zoomable-image-math.test.ts; this checks what the component
// puts on screen for each kind of picture.
describe('a picture in the zoom viewer', () => {
  it('draws a wide bitmap fitted to the box width', () => {
    act(() => {
      renderer = create(
        createElement(ZoomableImage, {
          source: { kind: 'bitmap', uri: 'data:image/png;base64,AAAA' },
          width: 400,
          height: 800,
          aspectRatio: 2
        })
      )
    })
    const image = renderer!.root.findByType('RNImage' as never)
    expect(image.props.source).toEqual({ uri: 'data:image/png;base64,AAAA' })
    expect(image.props.style).toEqual({ width: 400, height: 200 })
  })

  it('draws an SVG at the same fit, through react-native-svg', () => {
    act(() => {
      renderer = create(
        createElement(ZoomableImage, {
          source: { kind: 'svg', xml: '<svg viewBox="0 0 100 400"/>' },
          width: 400,
          height: 800,
          aspectRatio: 0.25
        })
      )
    })
    const svg = renderer!.root.findByType('SvgXml' as never)
    expect(svg.props).toMatchObject({ xml: '<svg viewBox="0 0 100 400"/>', width: 200, height: 800 })
  })

  it('fills the box while the aspect ratio is still unknown', () => {
    act(() => {
      renderer = create(
        createElement(ZoomableImage, {
          source: { kind: 'bitmap', uri: 'file:///a.png' },
          width: 300,
          height: 500
        })
      )
    })
    expect(renderer!.root.findByType('RNImage' as never).props.style).toEqual({
      width: 300,
      height: 500
    })
  })
})
