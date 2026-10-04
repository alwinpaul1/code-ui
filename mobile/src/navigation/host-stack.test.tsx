/**
 * Orca #24268: the page's host stack slides on push and Back. The pieces that can be pinned
 * without a browser: the screen list both stacks share, the native stack drawing it (themed, in
 * both modes), the direction rule that decides what slides, and `app/h/_layout.tsx` mounting the
 * shared stack instead of declaring its own.
 *
 * The slide itself (Web Animations on the compositor) needs a real page and is not covered here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { HOST_STACK_SCREENS } from './host-stack-screens'
import { hostStackTransitionBetween } from './host-stack-transition'

vi.mock('expo-router', () => {
  const Stack = (props: { children?: ReactNode }) => createElement('Stack', props, props.children)
  Stack.Screen = (props: Record<string, unknown>) => createElement('StackScreen', props)
  return { Stack }
})
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))

import { HostStack } from './host-stack'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const route = (key: string) => ({ key })
const view = (...keys: string[]) => ({ routes: keys.map(route), descriptors: {} })

describe('the native host stack', () => {
  it.each(['light', 'dark'] as const)(
    'declares every shared screen in order on a themed surface, in %s',
    async (scheme) => {
      await act(async () => {
        renderer = create(
          createElement(ThemeProvider, {
            initialPreference: scheme,
            children: createElement(HostStack, { animation: 'default' })
          })
        )
      })
      const stack = renderer!.root.find((n) => (n.type as unknown) === 'Stack')
      const screens = renderer!.root.findAll((n) => (n.type as unknown) === 'StackScreen')
      expect(screens.map((s) => s.props.name)).toEqual(HOST_STACK_SCREENS.map((s) => s.name))
      expect(screens.map((s) => s.props.options.title)).toEqual(
        HOST_STACK_SCREENS.map((s) => s.title)
      )
      expect(stack.props.screenOptions.animation).toBe('default')
      // A literal dark colour in light mode would pass every other check; the two modes differ.
      expect(typeof stack.props.screenOptions.contentStyle.backgroundColor).toBe('string')
    }
  )

  it('hands the tablet split view no animation', async () => {
    await act(async () => {
      renderer = create(
        createElement(ThemeProvider, {
          initialPreference: 'light',
          children: createElement(HostStack, { animation: 'none' })
        })
      )
    })
    expect(
      renderer!.root.find((n) => (n.type as unknown) === 'Stack').props.screenOptions.animation
    ).toBe('none')
  })

  it('paints a different surface in light and dark', async () => {
    const surfaces: string[] = []
    for (const scheme of ['light', 'dark'] as const) {
      await act(async () => {
        renderer = create(
          createElement(ThemeProvider, {
            initialPreference: scheme,
            children: createElement(HostStack, { animation: 'default' })
          })
        )
      })
      surfaces.push(
        renderer!.root.find((n) => (n.type as unknown) === 'Stack').props.screenOptions.contentStyle
          .backgroundColor
      )
      act(() => renderer?.unmount())
    }
    expect(surfaces[0]).not.toBe(surfaces[1])
  })
})

describe('what slides on the page', () => {
  it('slides a push in over the screen it covers', () => {
    expect(hostStackTransitionBetween(view('a'), [route('a'), route('b')])).toEqual({
      kind: 'push',
      enteringKey: 'b',
      underKey: 'a'
    })
  })

  it('keeps a popped screen until it has slid out', () => {
    const popped = hostStackTransitionBetween(view('a', 'b'), [route('a')])
    expect(popped).toMatchObject({ kind: 'pop', leaving: { key: 'b' } })
  })

  it('does not slide a replace or a reset, which have no direction', () => {
    expect(hostStackTransitionBetween(view('a'), [route('c')])).toBeNull()
    expect(hostStackTransitionBetween(view('a', 'b'), [route('c'), route('d')])).toBeNull()
  })

  it('does not slide when the top screen did not change, or when there is no screen', () => {
    expect(hostStackTransitionBetween(view('a'), [route('a')])).toBeNull()
    expect(hostStackTransitionBetween(view(), [route('a')])).toBeNull()
    expect(hostStackTransitionBetween(view('a'), [])).toBeNull()
  })
})

describe('app/h/_layout.tsx', () => {
  const source = readFileSync(join(__dirname, '../../app/h/_layout.tsx'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('mounts the shared host stack instead of declaring its own Stack', () => {
    expect(code).toMatch(/from '\.\.\/\.\.\/src\/navigation\/host-stack'/)
    expect(code).not.toMatch(/<Stack[\s>]/)
    expect(code).not.toMatch(/function HostStack\b/)
  })
})
