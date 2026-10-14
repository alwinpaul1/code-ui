import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 2026-10-14, the user's device: the live dictation caption drew upright. The
// Claude app sets it in the composer's face, italic (etq.S). Ours asked for
// `fontStyle: 'italic'` over `fonts.regular`, and Android, which picks a face
// by the family's name, had no italic file under that name. The app's Text
// goes through `instrumentSansTextStyle` (patches/react-native), which is what
// puts the italic face on it; this runs the caption's own style through it.
vi.mock('react-native', async () => {
  const React = await import('react')
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map((item) => flatten(item) ?? {}))
    }
    return style && typeof style === 'object' ? { ...(style as Record<string, unknown>) } : undefined
  }
  return {
    Text: ({ children, ...props }: { children?: ReactNode }) => React.createElement('Text', props, children),
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, flatten, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
  }
})
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  const view = ({ children, ...props }: { children?: ReactNode }) => React.createElement('AnimatedView', props, children)
  return {
    default: { View: view },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: <T extends object>(factory: () => T) => factory(),
    withSpring: (to: number) => to
  }
})
vi.mock('react-native-svg', () => {
  const part = 'SvgPart'
  return { default: part, Defs: part, LinearGradient: part, Rect: part, Stop: part }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

import { fontFamily } from '../theme/tokens'
import { instrumentSansTextStyle } from '../theme/instrument-sans-text'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatDictationCaption } from './MobileNativeChatDictationCaption'

describe('the live dictation caption', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('is set in the italic face, in the composer’s size, not drawn upright', () => {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' } as never,
          createElement(MobileNativeChatDictationCaption, {
            spoken: 'check the build before you merge',
            shown: true,
            // What MobileNativeChatComposer hands it.
            textStyle: { fontFamily: fontFamily.regular, fontSize: 17, lineHeight: 24 }
          })
        )
      )
    })
    const words = renderer!.root.findAll(
      (node) => String(node.type) === 'Text' && node.children.join('') === 'check the build before you merge'
    )[0]
    expect(words).toBeDefined()
    const drawn = instrumentSansTextStyle(words!.props.style) as unknown
    const flat = (Array.isArray(drawn) ? Object.assign({}, ...drawn) : drawn) as Record<string, unknown>
    expect(flat).toMatchObject({ fontFamily: 'InstrumentSans_400Regular_Italic', fontSize: 17, lineHeight: 24, fontStyle: 'italic' })
  })
})
