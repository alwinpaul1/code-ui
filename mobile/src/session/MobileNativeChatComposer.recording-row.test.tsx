import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// The composer while the mic is on, after the Claude app 1.261009.20 (the user's screen recording
// of 2026-10-14, and the decompile: `kcw.f` is the speech toolbar, `x030.b` swaps the composer to
// it, `aj1` is the text field that folds away). Tap the mic and the composer becomes one row:
// Cancel, a waveform, Stop dictation and Send dictation. Each of the three brings the composer back.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Rect: 'Rect',
  Stop: 'Stop'
}))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Code: 'Code',
  Hand: 'Hand',
  Image: 'Image',
  ImagePlus: 'ImagePlus',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  FileUp: 'FileUp',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Zap: 'Zap',
  Plus: 'Plus',
  Square: 'Square',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))
const motion = vi.hoisted(() => ({ reduced: false as boolean | null }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => motion.reduced }))
const springs = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock('react-native-reanimated', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    withSpring: (value: unknown, config: unknown) => {
      springs.calls.push(config)
      return value
    }
  }
})

import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { DICTATION_BUTTON_DISABLED_OPACITY, DICTATION_ROW_SPRING } from './MobileNativeChatDictationRow'

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  motion.reduced = false
  springs.calls = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown, pressed = false): Record<string, unknown> {
  if (typeof style === 'function') {
    return flat((style as (state: { pressed: boolean }) => unknown)({ pressed }), pressed)
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flat(entry, pressed)))
  }
  return (style ?? {}) as Record<string, unknown>
}

type Take = {
  surface?: string
  disabled?: boolean
  value?: string
  micActive?: boolean
  micTranscribing?: boolean
  micLevel?: number
  caption?: string
}

const handlers = {
  onSend: vi.fn(),
  onCancelDictation: vi.fn(),
  onStopDictation: vi.fn()
}

function element(take: Take, scheme: 'light' | 'dark'): React.JSX.Element {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileNativeChatComposer
        value={take.value ?? ''}
        onChangeText={vi.fn()}
        onSend={handlers.onSend}
        sendSurfaceId={take.surface ?? 'tab-a'}
        getSendCompletionGeneration={() => 0}
        getComposerEditGeneration={() => 0}
        onAttachImage={vi.fn()}
        onMicPress={vi.fn()}
        disabled={take.disabled ?? false}
        micActive={take.micActive ?? false}
        micTranscribing={take.micTranscribing ?? false}
        micLevel={take.micLevel ?? 0}
        dictationCaption={take.caption ?? ''}
        onCancelDictation={handlers.onCancelDictation}
        onStopDictation={handlers.onStopDictation}
      />
    </ThemeProvider>
  )
}

async function render(take: Take, scheme: 'light' | 'dark' = 'light'): Promise<void> {
  handlers.onSend = vi.fn().mockResolvedValue(true)
  handlers.onCancelDictation = vi.fn()
  handlers.onStopDictation = vi.fn()
  await act(async () => {
    renderer = create(element(take, scheme))
  })
}

async function rerender(take: Take, scheme: 'light' | 'dark' = 'light'): Promise<void> {
  await act(async () => {
    renderer!.update(element(take, scheme))
  })
}

const byTestId = (id: string): ReactTestInstance => renderer!.root.find((node) => node.props.testID === id)
const anyTestId = (id: string): ReactTestInstance[] =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')
const button = (label: string): ReactTestInstance =>
  renderer!.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label)

/** What the user sees of the composer: the field, the action row and the recording row. */
function shown(): { field: number; actions: number; recordingRow: number; recordingRowTakesTouches: boolean } {
  const layer = byTestId('native-chat-dictation-layer')
  const actions = byTestId('native-chat-composer-actions').parent!
  return {
    field: flat(byTestId('native-chat-composer-field').props.style).opacity as number,
    actions: flat(actions.props.style).opacity as number,
    recordingRow: flat(layer.props.style).opacity as number,
    recordingRowTakesTouches: layer.props.pointerEvents === 'auto'
  }
}

const IDLE = { field: 1, actions: 1, recordingRow: 0, recordingRowTakesTouches: false }
const RECORDING = { field: 0, actions: 0, recordingRow: 1, recordingRowTakesTouches: true }

describe('the composer while the mic is on', () => {
  it('becomes one row of Cancel, a waveform, Stop and Send while recording, with the field folded away', async () => {
    await render({ value: 'fix the', micActive: false })
    expect(shown()).toEqual(IDLE)
    expect(anyTestId('dictation-waveform')).toHaveLength(0)
    await rerender({ value: 'fix the', micActive: true })
    expect(shown()).toEqual(RECORDING)
    const row = byTestId('native-chat-dictation-row')
    const parts = row.children.filter((child): child is ReactTestInstance => typeof child !== 'string')
    expect(parts.map((part) => part.props.accessibilityLabel ?? part.props.testID ?? 'centre')).toEqual([
      'Cancel',
      'centre',
      'Stop dictation',
      'Send dictation'
    ])
    expect(row.findAll((node) => node.props.testID === 'dictation-waveform' && typeof node.type === 'string')).toHaveLength(1)
    expect(flat(row.props.style)).toMatchObject({ flexDirection: 'row', gap: 12 })
    // Folded, not unmounted: the field keeps its text and focus, so the keyboard stays up.
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'TextInput')).toHaveLength(1)
    // The folded parts are hidden from a screen reader too.
    expect(byTestId('native-chat-composer-field').props.accessibilityElementsHidden).toBe(true)
    expect(byTestId('native-chat-composer-actions').parent!.props.accessibilityElementsHidden).toBe(true)
  })

  it('folds the field even when it holds text, as the Claude app does', async () => {
    await render({ value: 'a long draft that was there before the mic', micActive: true })
    expect(shown().field).toBe(0)
  })

  it('comes up for a take that is transcribing, and stays up until the take ends', async () => {
    await render({ micTranscribing: true })
    expect(shown()).toEqual(RECORDING)
    await rerender({ micTranscribing: false })
    expect(shown()).toEqual(IDLE)
  })

  it('keeps the old composer for a caller that wires no recording row', async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatComposer
            value=""
            onChangeText={vi.fn()}
            onSend={vi.fn()}
            sendSurfaceId="tab-a"
            getSendCompletionGeneration={() => 0}
            getComposerEditGeneration={() => 0}
            onMicPress={vi.fn()}
            micActive
          />
        </ThemeProvider>
      )
    })
    expect(anyTestId('native-chat-dictation-layer')).toHaveLength(0)
    expect(flat(byTestId('native-chat-composer-field').props.style).opacity).toBe(1)
  })
})

describe('the recording row’s buttons', () => {
  it('Cancel discards the take, and the composer comes back', async () => {
    await render({ value: 'fix the', micActive: true })
    await act(async () => button('Cancel').props.onPress())
    expect(handlers.onCancelDictation).toHaveBeenCalledTimes(1)
    expect(handlers.onStopDictation).not.toHaveBeenCalled()
    await rerender({ value: 'fix the', micActive: false })
    expect(shown()).toEqual(IDLE)
    expect(handlers.onSend).not.toHaveBeenCalled()
  })

  it('Stop ends the take and keeps the words in the composer, sending nothing', async () => {
    await render({ value: 'fix the login', micActive: true })
    await act(async () => button('Stop dictation').props.onPress())
    expect(handlers.onStopDictation).toHaveBeenCalledTimes(1)
    expect(handlers.onCancelDictation).not.toHaveBeenCalled()
    await rerender({ value: 'fix the login', micTranscribing: true })
    await rerender({ value: 'fix the login bug', micTranscribing: false })
    expect(shown()).toEqual(IDLE)
    expect(handlers.onSend).not.toHaveBeenCalled()
    expect(byTestId('native-chat-composer-input-fold').findByType('TextInput' as never).props.value).toBe(
      'fix the login bug'
    )
  })

  it('Send stops the take, waits for its last words, then sends them', async () => {
    await render({ value: 'fix the login', micActive: true })
    await act(async () => button('Send dictation').props.onPress())
    expect(handlers.onStopDictation).toHaveBeenCalledTimes(1)
    expect(handlers.onSend).not.toHaveBeenCalled()
    await rerender({ value: 'fix the login', micTranscribing: true })
    expect(handlers.onSend).not.toHaveBeenCalled()
    await rerender({ value: 'fix the login bug', micTranscribing: false })
    expect(handlers.onSend).toHaveBeenCalledTimes(1)
    expect(handlers.onSend).toHaveBeenCalledWith('fix the login bug')
    expect(shown()).toEqual(IDLE)
  })

  it('a Cancel after Send sends nothing when the take ends', async () => {
    await render({ value: 'fix the login', micActive: true })
    await act(async () => button('Send dictation').props.onPress())
    await rerender({ value: 'fix the login', micTranscribing: true })
    await act(async () => button('Cancel').props.onPress())
    await rerender({ value: '', micTranscribing: false })
    expect(handlers.onSend).not.toHaveBeenCalled()
  })

  it('a later take ended by Stop does not send because an earlier one was ended by Send', async () => {
    await render({ value: '', micActive: true })
    await act(async () => button('Send dictation').props.onPress())
    // Nothing was said: the take ends with an empty draft, and the send has nothing to send.
    await rerender({ value: '', micActive: false })
    expect(handlers.onSend).not.toHaveBeenCalled()
    await rerender({ value: '', micActive: true })
    await act(async () => button('Stop dictation').props.onPress())
    await rerender({ value: 'just words', micActive: false })
    expect(handlers.onSend).not.toHaveBeenCalled()
  })
})

describe('Send dictation never sends somewhere else, and never fails silently', () => {
  // Review of 2026-10-14: the composer is shared across chat tabs, so a Send tapped in one tab and
  // a switch while the words finished sent the other tab's draft to the other tab.
  it('drops the pending send when the composer moves to another chat before the take ends', async () => {
    await render({ value: 'for tab a', micActive: true })
    await act(async () => button('Send dictation').props.onPress())
    await rerender({ value: 'for tab a', micTranscribing: true })
    await rerender({ surface: 'tab-b', value: 'tab b draft', micTranscribing: false })
    expect(handlers.onSend).not.toHaveBeenCalled()
  })

  // Review of 2026-10-14: the composer's send refuses while input is locked, so the row's Send
  // stopped the take and dropped the send without a word. It is greyed there, as Send is.
  it('greys Send dictation while the composer cannot send, and keeps Stop', async () => {
    await render({ value: 'fix', micActive: true, disabled: true })
    expect(button('Send dictation').props.disabled).toBe(true)
    expect(flat(button('Send dictation').props.style).opacity).toBe(DICTATION_BUTTON_DISABLED_OPACITY)
    expect(button('Stop dictation').props.disabled).toBeFalsy()
  })
})

describe('while the take is transcribing', () => {
  it('shows "Transcribing…" in place of the waveform, keeps Cancel live, and dims the button that did not end it', async () => {
    await render({ value: 'fix', micActive: true })
    await act(async () => button('Stop dictation').props.onPress())
    await rerender({ value: 'fix', micTranscribing: true })
    const label = renderer!.root.find((node) => (node.type as unknown) === 'Text' && node.props.children === 'Transcribing…')
    expect(flat(label.parent!.props.style).opacity).toBe(1)
    expect(flat(anyTestId('dictation-waveform-fade')[0]!.props.style).opacity).toBe(0)
    expect(button('Cancel').props.disabled).toBeFalsy()
    // Stop ended it: Stop shows the busy ring at full strength, Send dims to 38%.
    expect(button('Stop dictation').props.disabled).toBe(true)
    expect(button('Stop dictation').props.accessibilityState).toMatchObject({ busy: true })
    expect(button('Stop dictation').findAll((node) => (node.type as unknown) === 'ActivityIndicator')).toHaveLength(1)
    expect(flat(button('Stop dictation').props.style).opacity).toBe(1)
    expect(button('Send dictation').props.disabled).toBe(true)
    expect(flat(button('Send dictation').props.style).opacity).toBe(DICTATION_BUTTON_DISABLED_OPACITY)
    expect(DICTATION_BUTTON_DISABLED_OPACITY).toBe(0.38)
  })

  it('rings Send and dims Stop when Send ended it', async () => {
    await render({ value: 'fix', micActive: true })
    await act(async () => button('Send dictation').props.onPress())
    await rerender({ value: 'fix', micTranscribing: true })
    expect(button('Send dictation').findAll((node) => (node.type as unknown) === 'ActivityIndicator')).toHaveLength(1)
    expect(flat(button('Stop dictation').props.style).opacity).toBe(DICTATION_BUTTON_DISABLED_OPACITY)
  })

  it('dims both when the take ended by itself (a silence stop)', async () => {
    await render({ value: 'fix', micTranscribing: true })
    expect(flat(button('Stop dictation').props.style).opacity).toBe(DICTATION_BUTTON_DISABLED_OPACITY)
    expect(flat(button('Send dictation').props.style).opacity).toBe(DICTATION_BUTTON_DISABLED_OPACITY)
  })

  it('hides "Transcribing…" while listening, from the eye and from a screen reader', async () => {
    await render({ micActive: true })
    const label = renderer!.root.find((node) => (node.type as unknown) === 'Text' && node.props.children === 'Transcribing…')
    expect(flat(label.parent!.props.style).opacity).toBe(0)
    expect(label.parent!.props.accessibilityElementsHidden).toBe(true)
  })
})

describe.each(['light', 'dark'] as const)('the recording row’s colours in %s', (scheme) => {
  const colors = scheme === 'dark' ? darkColors : lightColors

  it('draws Cancel and Stop in the composer’s control circle with the ink glyph, Send in the composer’s clay circle', async () => {
    await render({ micActive: true }, scheme)
    for (const label of ['Cancel', 'Stop dictation']) {
      expect(flat(button(label).props.style), label).toMatchObject({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.composerControl
      })
      expect(flat(button(label).props.style, true).backgroundColor, `${label} pressed`).toBe(colors.composerControlPressed)
    }
    expect(button('Cancel').findByType('X' as never).props.color).toBe(colors.text)
    const square = button('Stop dictation').findByType('Square' as never)
    expect(square.props.fill).toBe(colors.text)
    expect(square.props.color).toBe(colors.text)
    expect(flat(button('Send dictation').props.style)).toMatchObject({ width: 36, height: 36, backgroundColor: colors.composerSend })
    expect(button('Send dictation').findByType('ArrowUp' as never).props.color).toBe(colors.composerSendGlyph)
  })

  it('writes "Transcribing…" in the secondary ink', async () => {
    await render({ micTranscribing: true }, scheme)
    const label = renderer!.root.find((node) => (node.type as unknown) === 'Text' && node.props.children === 'Transcribing…')
    expect(flat(label.props.style).color).toBe(colors.textSecondary)
  })
})

describe('the swap’s motion', () => {
  it('springs at the Claude app’s ratio 1, stiffness 400', async () => {
    await render({ micActive: false })
    await rerender({ micActive: true })
    expect(springs.calls).toContainEqual(DICTATION_ROW_SPRING)
    expect(DICTATION_ROW_SPRING.stiffness).toBeCloseTo(400)
    expect(DICTATION_ROW_SPRING.damping).toBeCloseTo(2 * Math.sqrt(400))
    expect(DICTATION_ROW_SPRING.mass).toBe(1)
  })

  it('snaps with reduced motion on, as the Claude app does with animations off', async () => {
    motion.reduced = true
    await render({ micActive: false })
    await rerender({ micActive: true })
    expect(springs.calls).toEqual([])
    expect(shown()).toEqual(RECORDING)
  })
})

// The Claude app's live caption (1.261009.20; the user's recording of 2026-10-14, and the
// decompile: `yv8.java:2219-2257` feeds `etq.R`/`etq.S` the take's transcript while the speech
// toolbar is up). The field is folded away, so this is where the words are seen as they are said.
describe('the live caption above the recording row', () => {
  const captionText = (): string | null => {
    const texts = byTestId('native-chat-dictation-caption').findAll(
      (node) => (node.type as unknown) === 'Text' && typeof node.props.children === 'string'
    )
    return texts.length === 0 ? null : (texts[0]!.props.children as string)
  }
  const captionShown = (): boolean => {
    const style = flat(byTestId('native-chat-dictation-caption').props.style)
    return (style.opacity as number) > 0 && (style.height as number) > 0
  }

  it('shows the words above the recording row while they are spoken', async () => {
    await render({ micActive: true, caption: 'How are you' })
    expect(captionShown()).toBe(true)
    expect(captionText()).toBe('How are you')
    // Above the composer card, not inside it.
    const caption = byTestId('native-chat-dictation-caption')
    const card = byTestId('native-chat-composer')
    const order = renderer!.root.findAll((node) => node === caption || node === card)
    expect(order[0]).toBe(caption)
    await rerender({ micActive: true, caption: 'How are you doing? I am fine. Thanks.' })
    expect(captionText()).toBe('How are you doing? I am fine. Thanks.')
    // Still shown while the last words finish.
    await rerender({ micTranscribing: true, caption: 'How are you doing? I am fine. Thanks.' })
    expect(captionShown()).toBe(true)
  })

  it('shows nothing before the first word, and a single word once it comes', async () => {
    await render({ micActive: true, caption: '' })
    expect(captionShown()).toBe(false)
    await rerender({ micActive: true, caption: '   ' })
    expect(captionShown()).toBe(false)
    await rerender({ micActive: true, caption: 'How' })
    expect(captionShown()).toBe(true)
    expect(captionText()).toBe('How')
  })

  it('draws the words in italic secondary ink, the composer’s size, from the start edge', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const colors = scheme === 'dark' ? darkColors : lightColors
      await render({ micActive: true, caption: 'How are you' }, scheme)
      const text = byTestId('native-chat-dictation-caption').find(
        (node) => (node.type as unknown) === 'Text' && node.props.children === 'How are you'
      )
      expect(flat(text.props.style)).toMatchObject({
        color: colors.textSecondary,
        fontStyle: 'italic',
        fontSize: 17,
        lineHeight: 24,
        textAlign: 'left'
      })
      // The scrim behind it is the chat's own colour.
      expect(flat(byTestId('native-chat-dictation-caption-box').parent!.props.style).backgroundColor).toBe(colors.chatBg)
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('keeps a fixed four-line box for many lines: the words grow upward and the top line fades', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
    await render({ micActive: true, caption: 'one line' })
    const height = flat(byTestId('native-chat-dictation-caption').props.style).height
    await rerender({ micActive: true, caption: long })
    // The box does not grow with the words, so the chat above does not move as lines arrive.
    expect(flat(byTestId('native-chat-dictation-caption').props.style).height).toBe(height)
    expect(height).toBe(4 * 24 + 2 * 8)
    const box = byTestId('native-chat-dictation-caption-box')
    expect(flat(box.props.style)).toMatchObject({ height: 4 * 24, overflow: 'hidden' })
    const text = box.find((node) => (node.type as unknown) === 'Text' && node.props.children === long)
    // Anchored one line of air above the bottom, with no top: it grows upward and is clipped.
    expect(flat(text.props.style)).toMatchObject({ position: 'absolute', bottom: 24 })
    expect(flat(text.props.style).top).toBeUndefined()
    expect(anyTestId('native-chat-dictation-caption-fade')).toHaveLength(1)
  })

  it('goes when the take is cancelled, and the next take starts with nothing', async () => {
    await render({ micActive: true, caption: 'How are you' })
    await act(async () => button('Cancel').props.onPress())
    await rerender({ micActive: false, caption: 'How are you' })
    expect(captionShown()).toBe(false)
    expect(byTestId('native-chat-dictation-caption').props.accessibilityElementsHidden).toBe(true)
    await rerender({ micActive: true, caption: '' })
    expect(captionShown()).toBe(false)
  })

  it('appears without the spring under reduced motion', async () => {
    motion.reduced = true
    await render({ micActive: true, caption: '' })
    await rerender({ micActive: true, caption: 'How' })
    expect(springs.calls).toEqual([])
    expect(captionShown()).toBe(true)
  })
})
