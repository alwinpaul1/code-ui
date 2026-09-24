import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { ToolDetailBody, ToolDetailHeader } from './MobileNativeChatToolDetailSheet'

// The header/body are tested apart from `DraggableDetailSheet`, the same way
// `MobileBackgroundTasksSheetBody` is tested apart from `BottomDrawer` —
// neither content component touches gesture-handler/reanimated itself.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
// Same reason `MobileBackgroundTasksSheet.test.tsx` mocks out `BottomDrawer`:
// the drawer shell pulls in gesture-handler/reanimated's Flow-typed RN
// internals, which Node cannot parse, and the content under test never
// touches it.
vi.mock('../components/DraggableDetailSheet', () => ({
  DraggableDetailSheet: 'DraggableDetailSheet'
}))

const SEND_MESSAGE_PAIR: NativeChatToolPair = {
  call: {
    type: 'tool-call',
    name: 'SendMessage',
    input: {
      to: 'a8f65c53ecfad2908',
      type: 'handback',
      content: 'Finished the fix.',
      summary: 'Fixed the count.',
      recipient: 'peer',
      message: 'Done'
    }
  },
  result: { type: 'tool-result', output: '{"ok":true}' }
}

// `Txt` is a composite wrapper around a host `Text`; both carry whatever
// `testID` its caller passed, so `findByProps` is ambiguous between them and
// `.props.style` off the wrong one is `undefined` (the composite never
// received a `style` prop at all — only the host's merged array has color).
// `findAllByType('Text')` keeps this to the host node the mock actually
// renders.
function findTextNode(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAllByType('Text').find((node) => node.props.testID === testID)!
}

function findText(renderer: ReactTestRenderer, testID: string): string {
  const children = findTextNode(renderer, testID).props.children
  return Array.isArray(children) ? children.join('') : String(children)
}

function textColor(renderer: ReactTestRenderer, testID: string): string | undefined {
  const style = findTextNode(renderer, testID).props.style
  const entries = Array.isArray(style) ? style : [style]
  return entries.find((entry: { color?: string } | null) => entry?.color)?.color
}

function renderTree(children: React.ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(createElement(ThemeProvider, { initialPreference: scheme }, children))
  })
  return renderer!
}

describe('tool detail header: title and status', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows the row sentence as the title and Completed as the status', () => {
    renderer = renderTree(createElement(ToolDetailHeader, { pair: SEND_MESSAGE_PAIR }))
    // The row's own sentence, as the Claude app titles the sheet ("Messaged @…").
    expect(findText(renderer, 'tool-detail-title')).toBe('Messaged @a8f65c53ecfad2908 Fixed the count.')
    expect(findText(renderer, 'tool-detail-status')).toBe('Completed')
  })

  it('shows Failed in the danger tone, in both light and dark', () => {
    const failed: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'false' } },
      result: { type: 'tool-result', output: 'exit 1', isError: true }
    }
    renderer = renderTree(createElement(ToolDetailHeader, { pair: failed }))
    expect(findText(renderer, 'tool-detail-status')).toBe('Failed')
    expect(textColor(renderer, 'tool-detail-status')).toBe(lightColors.danger)
    act(() => renderer!.unmount())
    renderer = renderTree(createElement(ToolDetailHeader, { pair: failed }), 'dark')
    expect(textColor(renderer, 'tool-detail-status')).toBe(darkColors.danger)
  })
})

describe('tool detail body: Inputs and Output', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('lists every input by name, alphabetically, the evidenced SendMessage order', () => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_PAIR }))
    const names = renderer.root
      .findAllByProps({ testID: 'tool-detail-input-row' })
      .map((row) => row.findAllByType('Text')[0]!.props.children)
    expect(names).toEqual(['content', 'message', 'recipient', 'summary', 'to', 'type'])
  })

  it('shows the raw output and no Prettify pill when it is not JSON', () => {
    const plain: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
      result: { type: 'tool-result', output: 'a.ts\nb.ts\n' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: plain }))
    expect(findText(renderer, 'tool-detail-output')).toBe('a.ts\nb.ts\n')
    expect(renderer.root.findAllByProps({ testID: 'tool-detail-prettify' })).toHaveLength(0)
  })

  it('prettifies JSON output on tap, and un-prettifies it back on a second tap', () => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_PAIR }))
    expect(findText(renderer, 'tool-detail-output')).toBe('{"ok":true}')
    const pill = renderer.root.findByProps({ testID: 'tool-detail-prettify' })
    act(() => {
      pill.props.onPress()
    })
    expect(findText(renderer, 'tool-detail-output')).toBe(
      JSON.stringify({ ok: true }, null, 2)
    )
    const pillAgain = renderer.root.findByProps({ testID: 'tool-detail-prettify' })
    act(() => {
      pillAgain.props.onPress()
    })
    expect(findText(renderer, 'tool-detail-output')).toBe('{"ok":true}')
  })

  it('renders no Inputs section for a call with no arguments at all', () => {
    const noArgs: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: {} },
      result: { type: 'tool-result', output: 'ok' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: noArgs }))
    expect(renderer.root.findAllByProps({ testID: 'tool-detail-input-row' })).toHaveLength(0)
  })

  it('renders no Output section for a call still running with no result yet', () => {
    const running: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'sleep 5' }, state: 'running' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: running }))
    expect(renderer.root.findAllByProps({ testID: 'tool-detail-output' })).toHaveLength(0)
  })
})
