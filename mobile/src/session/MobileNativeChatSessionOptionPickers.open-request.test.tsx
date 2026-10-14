import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

// `openRequest` is a count the chat controller raises to ask for the model sheet: the Codex
// `/model` command raises it, and so does the header menu's Change model. The controller outlives
// the chat view, which unmounts when the user flips to the terminal and comes back, so a picker
// that opened whenever the count was above zero opened the sheet again on every return, long
// after the request was answered (found in review of the header's Change model, 2026-10-14).
// A picker answers the requests that come while it is mounted, and only those.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({
      visible,
      onClose,
      children
    }: {
      visible: boolean
      onClose: () => void
      children?: React.ReactNode
    }) => (visible ? React.createElement('BottomDrawer', { visible, onClose }, children) : null)
  }
})

const MODEL: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: {
    type: 'select',
    currentValue: 'opus',
    choices: [
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' }
    ]
  },
  valueSource: 'reported',
  transport: 'catalog',
  settable: true
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function element(openRequest: number, snapshot: SessionOptionDescriptor[] = [MODEL]) {
  const controller: MobileNativeChatSessionOptionsController = {
    snapshot,
    pendingId: null,
    setOption: vi.fn(),
    invokeAction: vi.fn(),
    recordCommand: vi.fn()
  }
  return (
    <ThemeProvider initialPreference="light">
      <MobileNativeChatSessionOptionPickers
        controller={controller}
        isWorking={false}
        reportFailure={vi.fn()}
        scopeKey="host/wt/tab"
        openRequest={openRequest}
        claudeModelLayout
      />
    </ThemeProvider>
  )
}

function mount(openRequest: number, snapshot?: SessionOptionDescriptor[]) {
  act(() => {
    renderer = create(element(openRequest, snapshot))
  })
}
function update(openRequest: number, snapshot?: SessionOptionDescriptor[]) {
  act(() => renderer!.update(element(openRequest, snapshot)))
}
const sheetOpen = () => renderer!.root.findAll((node) => String(node.type) === 'BottomDrawer').length > 0

describe('the model sheet a request opens', () => {
  it('opens when the count rises while the picker is on screen', () => {
    mount(0)
    expect(sheetOpen()).toBe(false)
    update(1)
    expect(sheetOpen()).toBe(true)
  })

  it('does not open again when the chat view comes back with the count where it left it', () => {
    // The first chat view answered request 1 and unmounted; a new one mounts with the count at 1.
    mount(1)
    expect(sheetOpen()).toBe(false)
  })

  it('opens for the next request after such a return', () => {
    mount(1)
    update(2)
    expect(sheetOpen()).toBe(true)
  })

  it('does not open again when the model option changes under a request already answered', () => {
    // Another tab's picker takes this one's place with the controller's count unchanged.
    mount(0)
    update(1)
    expect(sheetOpen()).toBe(true)
    act(() => renderer!.root.find((node) => String(node.type) === 'BottomDrawer').props.onClose())
    expect(sheetOpen()).toBe(false)
    update(1, [{ ...MODEL, id: 'other-model' }])
    expect(sheetOpen()).toBe(false)
  })

  it('opens when the model option arrives after the request did, once', () => {
    mount(0, [])
    update(1, [])
    expect(sheetOpen()).toBe(false)
    update(1)
    expect(sheetOpen()).toBe(true)
  })
})
