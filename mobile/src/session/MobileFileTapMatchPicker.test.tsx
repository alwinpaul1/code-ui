import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
// Why: lucide's entry pulls React Native internals that the host-tag mock above removed.
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))

/** What the mocked drawer was last handed, so its hide callback can be fired as the native one is. */
const drawer = vi.hoisted(() => ({ onAfterClose: undefined as undefined | (() => void) }))
// Why: the drawer is a native modal stack; what it holds, and whether it is up, is under test.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({
    visible,
    children,
    onAfterClose
  }: {
    visible: boolean
    children: ReactNode
    onAfterClose?: () => void
  }) => {
    drawer.onAfterClose = onAfterClose
    return visible ? children : null
  }
}))

/** The session screen's navigation focus: false once another route is pushed over it. */
const screen = vi.hoisted(() => ({ focused: true }))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    // React Navigation's contract: the effect runs on focus, its cleanup on blur.
    useFocusEffect: (effect: () => void | (() => void)) => {
      const focused = screen.focused
      React.useEffect(() => (focused ? effect() : undefined), [effect, focused])
    }
  }
})

import { ThemeProvider } from '../theme/theme-context'
import { FILE_TAP_MATCH_ROOT_LABEL, MobileFileTapMatchPicker } from './MobileFileTapMatchPicker'
import type { FileTapMatchOffer } from './mobile-native-chat-open-file'
import type { FileTapMatchPickerModel } from './use-mobile-file-tap-handlers'

function pickerModel(offer: Partial<FileTapMatchOffer> | null): FileTapMatchPickerModel {
  return {
    offer: offer
      ? {
          name: 'index.ts',
          paths: ['mobile/src/a/index.ts', 'mobile/src/b/index.ts'],
          complete: true,
          open: vi.fn(),
          ...offer
        }
      : null,
    visible: true,
    pick: vi.fn(),
    close: vi.fn(),
    afterClose: vi.fn()
  }
}

function sheet(scheme: 'light' | 'dark', picker: FileTapMatchPickerModel) {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileFileTapMatchPicker picker={picker} />
    </ThemeProvider>
  )
}

function renderInScheme(scheme: 'light' | 'dark', picker: FileTapMatchPickerModel) {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(sheet(scheme, picker))
  })
  return renderer!
}

beforeEach(() => {
  screen.focused = true
  drawer.onAfterClose = undefined
})

/** Host elements by their mocked tag; `findAllByType` types only component references. */
function hostNodes(node: ReactTestInstance, tag: 'Pressable' | 'Text'): ReactTestInstance[] {
  return node.findAll((candidate) => String(candidate.type) === tag)
}

function textOf(node: ReactTestInstance): string {
  return hostNodes(node, 'Text')
    .flatMap((text) => text.children.filter((child): child is string => typeof child === 'string'))
    .join('')
}

function rowLabels(renderer: ReactTestRenderer): string[] {
  return hostNodes(renderer.root, 'Pressable').map(textOf)
}

/** Every colour the sheet paints, surfaces and text alike. */
function paintedColors(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => node.props?.style !== undefined && node.props.style !== null)
    .flatMap((node) => {
      const styles = [node.props.style].flat(Infinity) as unknown[]
      return styles.flatMap((style) => {
        if (typeof style !== 'object' || style === null) {
          return []
        }
        const { backgroundColor, color } = style as { backgroundColor?: unknown; color?: unknown }
        return [backgroundColor, color].filter(
          (value): value is string => typeof value === 'string'
        )
      })
    })
}

describe('the drawer that asks which same-named file a chat tap meant', () => {
  it('names each file by its folder, painted from the live theme in light and dark', () => {
    const light = renderInScheme('light', pickerModel({}))
    const dark = renderInScheme('dark', pickerModel({}))

    for (const renderer of [light, dark]) {
      expect(rowLabels(renderer)).toEqual(['mobile/src/a', 'mobile/src/b'])
      expect(textOf(renderer.root)).toContain('2 files named index.ts')
    }
    expect(paintedColors(light).length).toBeGreaterThan(0)
    expect(paintedColors(dark)).not.toEqual(paintedColors(light))
  })

  it('labels a match at the top of the workspace, which has no folder', () => {
    const renderer = renderInScheme('dark', pickerModel({ paths: ['index.ts', 'src/index.ts'] }))

    expect(rowLabels(renderer)).toEqual([FILE_TAP_MATCH_ROOT_LABEL, 'src'])
  })

  it('offers a lone match with a warning when the desktop searched only part of the workspace', () => {
    const renderer = renderInScheme(
      'light',
      pickerModel({ name: 'x.ts', paths: ['deep/x.ts'], complete: false })
    )

    expect(rowLabels(renderer)).toEqual(['deep'])
    expect(textOf(renderer.root)).toContain(
      'Files named x.ts (the desktop searched only part of the workspace)'
    )
  })

  it('hands the pressed row to the tap flow and closes, marking no row as already open', () => {
    const picker = pickerModel({})
    const renderer = renderInScheme('light', picker)
    const rows = hostNodes(renderer.root, 'Pressable')

    expect(rows.map((row) => row.props.accessibilityState.selected)).toEqual([false, false])
    act(() => rows[1]!.props.onPress())

    expect(picker.pick).toHaveBeenCalledWith('mobile/src/b/index.ts')
    expect(picker.close).toHaveBeenCalledTimes(1)
  })

  it('opens the picked file only once the drawer has finished hiding', () => {
    const picker = pickerModel({})
    const renderer = renderInScheme('dark', picker)

    act(() => hostNodes(renderer.root, 'Pressable')[0]!.props.onPress())
    expect(picker.afterClose).not.toHaveBeenCalled()
    // The native drawer calls this when its hide animation ends.
    act(() => drawer.onAfterClose?.())

    expect(picker.afterClose).toHaveBeenCalledTimes(1)
  })

  it('stays down while another screen is over the session, instead of popping over it', () => {
    screen.focused = false
    const renderer = renderInScheme('light', pickerModel({}))

    expect(hostNodes(renderer.root, 'Pressable')).toEqual([])
  })

  it('shows an offer that landed while the screen was covered once the user comes back', () => {
    screen.focused = false
    const picker = pickerModel({})
    const renderer = renderInScheme('dark', picker)
    expect(hostNodes(renderer.root, 'Pressable')).toEqual([])

    act(() => {
      screen.focused = true
      renderer.update(sheet('dark', picker))
    })

    expect(rowLabels(renderer)).toEqual(['mobile/src/a', 'mobile/src/b'])
    expect(picker.close).not.toHaveBeenCalled()
  })

  it('closes when the session screen loses focus', () => {
    const picker = pickerModel({})
    const renderer = renderInScheme('light', picker)
    expect(picker.close).not.toHaveBeenCalled()

    act(() => {
      screen.focused = false
      renderer.update(sheet('light', picker))
    })

    expect(picker.close).toHaveBeenCalledTimes(1)
    expect(hostNodes(renderer.root, 'Pressable')).toEqual([])
  })

  it('draws nothing while there is nothing to choose between', () => {
    const renderer = renderInScheme('light', pickerModel(null))

    expect(hostNodes(renderer.root, 'Pressable')).toEqual([])
  })
})

describe('where the drawer is mounted', () => {
  // A defect of structure: the hook can offer matches and the drawer can draw them, and still no
  // sheet appears if the session screen never mounts it. Read from the AST, not the text, because
  // these files carry prose that names the component.
  it('is mounted by the session surface, fed the controller’s picker', () => {
    const path = new URL('./MobileSessionSurface.tsx', import.meta.url)
    const source = ts.createSourceFile(
      'MobileSessionSurface.tsx',
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    const mounts: string[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText() === 'MobileFileTapMatchPicker'
      ) {
        for (const attribute of node.attributes.properties) {
          if (
            ts.isJsxAttribute(attribute) &&
            attribute.initializer &&
            ts.isJsxExpression(attribute.initializer)
          ) {
            mounts.push(
              `${attribute.name.getText()}=${attribute.initializer.expression?.getText()}`
            )
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)

    expect(mounts).toEqual(['picker=controller.fileTapMatchPicker'])
  })
})
