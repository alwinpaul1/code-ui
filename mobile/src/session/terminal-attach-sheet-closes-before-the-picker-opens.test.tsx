import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileTerminalInputActions } from './MobileTerminalInputActions'

// The terminal's + ("Add to terminal") had the same shape as the chat's + sheet
// (plus-sheet-closes-before-the-picker-opens.test.tsx): its Photos and Files rows
// launched the system picker and closed the sheet in the same press, so the
// picker's Activity paused the app with the sheet's exit a frame or two in, and
// the sheet stood frozen half-closed behind Android's photo picker. Both rows now
// wait for the sheet to have gone (ActionSheetModal's `closeBeforePress`).
//
// The drawer is a stand-in here: `onAfterClose` is what the real one calls once
// its exit has run and its unmount committed (use-drawer-mount-lifecycle.ts).

const drawer = vi.hoisted(() => ({
  props: null as null | { visible: boolean; onClose: () => void; onAfterClose?: () => void }
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Keyboard: { dismiss: () => {}, isVisible: () => false, addListener: () => ({ remove: () => {} }) },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light'
  }
})
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Edit3: 'Edit3',
  Image: 'Image',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  FileUp: 'FileUp',
  Plus: 'Plus',
  Trash2: 'Trash2'
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: (props: {
      visible: boolean
      onClose: () => void
      onAfterClose?: () => void
      children?: ReactNode
    }) => {
      drawer.props = props
      return props.visible ? React.createElement('BottomDrawer', null, props.children) : null
    }
  }
})
vi.mock('../components/VoiceLevelBars', () => ({ VoiceLevelBars: () => null }))

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  drawer.props = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const idleDictation = { isStarting: false, isRecording: false, isProcessing: false }

function mount(scheme: 'light' | 'dark', onAttachImage: () => void, onAttachFile: () => void): void {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileTerminalInputActions
          canSend
          isAttaching={false}
          dictation={idleDictation}
          dictationMode="toggle"
          onAttachImage={onAttachImage}
          onAttachFile={onAttachFile}
          onDictationToggle={() => {}}
          onDictationPressIn={() => {}}
          onDictationPressOut={() => {}}
          onDictationCancel={() => {}}
        />
      </ThemeProvider>
    )
  })
}

function pressable(match: (node: ReactTestInstance) => boolean): ReactTestInstance {
  return renderer!.root.find((node) => String(node.type) === 'Pressable' && match(node))
}

function openSheet(): void {
  act(() => (pressable((node) => node.props.accessibilityLabel === 'Add to terminal').props.onPress as () => void)())
}

/** A row of the open sheet, by the label it draws. */
function row(label: string): ReactTestInstance {
  return pressable((node) => node.findAll((child) => child.props.children === label).length > 0)
}

/** The real drawer's exit running to its end. */
function sheetGone(): void {
  act(() => drawer.props?.onAfterClose?.())
}

describe.each(['light', 'dark'] as const)('the terminal attach sheet in %s mode', (scheme) => {
  it.each(['Photos', 'Files'] as const)('has left the screen before %s opens its picker', (label) => {
    const onAttachImage = vi.fn()
    const onAttachFile = vi.fn()
    const launched = label === 'Photos' ? onAttachImage : onAttachFile
    mount(scheme, onAttachImage, onAttachFile)
    openSheet()

    act(() => (row(label).props.onPress as () => void)())

    expect(drawer.props?.visible, 'the sheet was not asked to close').toBe(false)
    expect(launched, 'the picker launched while the sheet was still closing').not.toHaveBeenCalled()

    sheetGone()

    expect(launched).toHaveBeenCalledOnce()
    expect(label === 'Photos' ? onAttachFile : onAttachImage).not.toHaveBeenCalled()
  })

  it('never opens the picker for a Photos tap the user took back by reopening the sheet', () => {
    const onAttachImage = vi.fn()
    mount(scheme, onAttachImage, vi.fn())
    openSheet()
    act(() => (row('Photos').props.onPress as () => void)())

    // The + again before the exit finished, then dismissed without a choice.
    openSheet()
    act(() => drawer.props!.onClose())
    sheetGone()

    expect(onAttachImage, 'the abandoned Photos tap opened the picker on a later close').not.toHaveBeenCalled()
  })
})
