import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Home's Tasks card while the desktop's task sources are still unread. It drew "GitHub" and a
 * tappable GitHub icon until the three reads answered, and after one of them failed, even for a
 * user whose visible providers were GitLab and Linear only (review, 2026-09-30).
 */

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight', ListTodo: 'ListTodo' }))
vi.mock('../ui/PressScale', () => ({
  PressScale: (props: Record<string, unknown>) => createElement('PressScale', props)
}))
vi.mock('../components/TaskProviderLogo', () => ({
  TaskProviderLogo: (props: Record<string, unknown>) => createElement('TaskProviderLogo', props)
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import { MobileHomeTasksCard } from './MobileHomeTasksCard'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(
  scheme: 'light' | 'dark',
  providers: TaskProvider[] | undefined
): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileHomeTasksCard enabled providers={providers} onOpen={() => undefined} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

const lines = (root: ReactTestInstance) =>
  root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => ({ node, text: [node.props.children].flat().join('') }))

const providerButtons = (root: ReactTestInstance) =>
  root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      /^Open .* tasks$/.test(String(node.props.accessibilityLabel))
  )

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])(
  'the Home Tasks card in a %s session',
  (scheme, palette) => {
    it('says it is checking the sources, and claims no provider, before they are read', () => {
      const root = render(scheme, undefined)
      const caption = lines(root).find(({ text }) => text === 'Checking sources…')
      expect(flat(caption?.node.props.style).color).toBe(palette.textSecondary)
      expect(lines(root).map(({ text }) => text)).not.toContain('GitHub')
      expect(providerButtons(root)).toHaveLength(0)
    })

    it('names the sources once read, and says so when there are none', () => {
      const read = render(scheme, ['gitlab', 'linear'])
      expect(lines(read).map(({ text }) => text)).toContain('GitLab · Linear')
      expect(providerButtons(read)).toHaveLength(2)
      act(() => renderer?.unmount())
      const none = render(scheme, [])
      expect(lines(none).map(({ text }) => text)).toContain('No task sources connected')
    })
  }
)
