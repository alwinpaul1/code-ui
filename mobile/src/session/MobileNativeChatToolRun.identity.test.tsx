import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'

// Orca #26968 (8452fc3315): a line opened in a tool run stays with its command when the rows
// before it go or move. The run keyed its lines by position, so a refreshed history that dropped
// the first call handed the open state to whichever call moved into that slot. Upstream's
// MobileNativeChatToolRun.identity.test.tsx, adapted: in this fork most lines open the detail
// sheet, and the ones that expand in place are edits with a diff card, so these runs are edits.

vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      constructor(private value: number) {}
      setValue(next: number): void {
        this.value = next
      }
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
// Every icon an edit's diff card and the run draw, by name; this suite reads no icon.
vi.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === 'then' ? undefined : String(name)), has: () => true })
)
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

function edit(callId: string, file: string): NativeChatBlock[] {
  return [
    {
      type: 'tool-call',
      name: 'Edit',
      callId,
      input: { file_path: `/repo/${file}`, old_string: `old ${file}`, new_string: `new ${file}` }
    },
    {
      type: 'tool-result',
      callId,
      output: `The file /repo/${file} has been updated successfully.`
    }
  ]
}

function Harness({ blocks }: { blocks: NativeChatBlock[] }): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, {
    blocks,
    defaultExpanded: true,
    expandChildren: false,
    activeCall: null,
    styles
  })
}

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

function show(blocks: NativeChatBlock[]): void {
  const element = (
    <ThemeProvider initialPreference="light">
      <Harness blocks={blocks} />
    </ThemeProvider>
  )
  act(() => {
    if (tree) {
      tree.update(element)
    } else {
      tree = create(element)
    }
  })
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join('')
}

const lines = (): ReactTestInstance[] =>
  tree!.root.findAll((node) => node.props?.testID === 'tool-line')

function line(file: string, occurrence = 0): ReactTestInstance {
  const found = lines().filter((node) => textOf(node).includes(file))[occurrence]
  if (!found) {
    throw new Error(`No tool line names ${file}`)
  }
  return found
}

const isOpen = (node: ReactTestInstance): boolean => node.props.accessibilityState?.expanded === true

it('keeps an opened edit open on the same file when an earlier row disappears', () => {
  show([...edit('a', 'first.ts'), ...edit('b', 'second.ts'), ...edit('c', 'third.ts')])
  expect(lines().every((node) => !isOpen(node))).toBe(true)
  act(() => line('second.ts').props.onPress())
  expect(isOpen(line('second.ts'))).toBe(true)

  show([...edit('b', 'second.ts'), ...edit('c', 'third.ts')])
  expect(isOpen(line('second.ts'))).toBe(true)
  expect(isOpen(line('third.ts'))).toBe(false)
})

it('keeps it with its command when the rows are reordered', () => {
  show([...edit('a', 'first.ts'), ...edit('b', 'second.ts')])
  act(() => line('first.ts').props.onPress())
  show([...edit('b', 'second.ts'), ...edit('a', 'first.ts')])
  expect(isOpen(line('first.ts'))).toBe(true)
  expect(isOpen(line('second.ts'))).toBe(false)
})

it('opens a repeated provider id once per occurrence, after an unrelated prefix goes', () => {
  const repeated = [...edit('dup', 'same.ts'), ...edit('dup', 'same.ts')]
  show([...edit('p', 'prefix.ts'), ...repeated])
  act(() => line('same.ts', 1).props.onPress())
  show(repeated)
  expect(isOpen(line('same.ts', 0))).toBe(false)
  expect(isOpen(line('same.ts', 1))).toBe(true)
})

it('keeps a single-row run working: an empty and a one-line run draw without a key clash', () => {
  show([])
  expect(lines()).toHaveLength(0)
  show(edit('only', 'one.ts'))
  expect(lines().length).toBeLessThanOrEqual(1)
})
