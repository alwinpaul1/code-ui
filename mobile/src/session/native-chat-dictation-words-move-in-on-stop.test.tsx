/**
 * "When audio is transcribed live, it's edited live there itself while the mic is on, and only
 * then it moves to the composer" (the user, 2026-10-15, about the Claude app).
 *
 * The Claude app keeps a take's words out of the draft until the take ends: while it listens the
 * words live only in the caption above the speech toolbar (`yv8` → `etq.R`), revised in place as
 * recognition revises them. The draft is written once, when the take finishes (1.261009.20,
 * `k35` case 2: `ddw` Finished → `rs8.z(text)`; the Code session composer `qb6.b1` → `qb6.n2`, at
 * the caret the take started from, spaced by `ox20.e`). Until 2026-10-15 Code UI wrote every
 * partial into the (folded) draft, so the draft changed under the user while they spoke.
 *
 * Mounts the real `useMobileSessionNativeChatDictation` over a scripted Anthropic engine, because
 * the defect is in the session wiring between the engine's partials and the composer.
 */
import { createElement, useRef } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NativeChatSendError from './use-mobile-native-chat-send-error'

type Transcript = (text: string, final: boolean, interim?: string) => void

const engine = vi.hoisted(() => ({
  onTranscript: null as ((text: string, final: boolean, interim?: string) => void) | null,
  onError: null as ((err: Error) => void) | null,
  starts: 0,
  cancels: 0
}))
const composer = vi.hoisted(() => ({ text: '', writes: 0 }))
const seen = vi.hoisted(() => ({ toasts: new Array<string>() }))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'android' }
}))
vi.mock('expo-router', () => ({ useFocusEffect: () => {} }))
vi.mock('../platform/haptics', () => ({ triggerError: () => {} }))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: async () => {} }) }))
vi.mock('../hooks/use-mobile-live-transcription', () => ({
  useMobileLiveTranscription: () => ({
    available: false,
    isStarting: false,
    isRecording: false,
    isProcessing: false,
    start: async () => {},
    stop: async () => {},
    cancel: async () => {},
    prime: async () => {},
    release: () => {}
  })
}))
vi.mock('../hooks/use-mobile-dictation', () => ({
  useMobileDictation: () => ({
    isStarting: false,
    isRecording: false,
    isProcessing: false,
    start: async () => {},
    stop: async () => {},
    cancel: async () => {}
  })
}))
vi.mock('../hooks/use-anthropic-dictation', () => ({
  useAnthropicDictation: (options: { onTranscript: Transcript; onError: (err: Error) => void }) => {
    engine.onTranscript = options.onTranscript
    engine.onError = options.onError
    return {
      available: true,
      refreshAvailable: async () => true,
      isStarting: false,
      isRecording: true,
      isProcessing: false,
      start: async () => {
        engine.starts += 1
      },
      stop: async () => {},
      cancel: async () => {
        engine.cancels += 1
      }
    }
  }
}))
vi.mock('./use-mobile-native-chat-send-error', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeChatSendError>()),
  useMobileNativeChatSendError: () => ({
    message: null,
    show: () => {},
    clear: () => {},
    keepWhile: () => {},
    bannerMountedRef: { current: false }
  })
}))
vi.mock('./use-mobile-native-chat-readability', () => ({ useMobileNativeChatReadability: () => false }))
vi.mock('./use-mobile-native-chat-input-lease', () => ({
  useMobileNativeChatInputLease: () => ({
    ready: true,
    readyRef: { current: true },
    lockReason: null,
    markReady: () => {},
    clear: () => {}
  })
}))
vi.mock('./use-mobile-native-chat-controller', () => ({
  useMobileNativeChatController: () => ({
    nativeChatSession: { messages: [] },
    toggleTabChatView: () => {},
    showNativeChat: true,
    showNativeChatRef: { current: true },
    chatComposerText: composer.text,
    setChatComposerText: (next: string | ((current: string) => string)) => {
      composer.writes += 1
      composer.text = typeof next === 'function' ? next(composer.text) : next
    }
  })
}))
vi.mock('./use-mobile-send-completion-generation', () => ({
  useMobileSendCompletionGeneration: () => () => 0
}))

import { useMobileSessionNativeChatDictation } from './use-mobile-session-native-chat-dictation'

type Model = ReturnType<typeof useMobileSessionNativeChatDictation>

function mount(): { readonly model: () => Model } {
  const held: { model: Model | null } = { model: null }
  function Probe(): null {
    const scope = {
      hostId: 'h1',
      worktreeId: 'w1',
      client: null,
      connState: 'connected',
      agentSessionPromptCancelSupported: true,
      setInput: () => {},
      liveInputTerminalHandles: new Set<string>(),
      activeHandle: 't1',
      activeSessionTabId: 'tab1',
      activeSessionTab: { id: 'tab1', type: 'agent-session' },
      diffComments: [],
      diffCommentsRef: useRef([]),
      setShowDictationSetup: () => {},
      setDictationMode: () => {},
      deviceTokenRef: useRef('dev'),
      dictationRouteContextRef: useRef(null),
      activeHandleRef: useRef('t1'),
      canSend: true,
      liveInputEnabled: false,
      showToast: (message: string) => {
        seen.toasts.push(message)
      },
      resetLiveInputFocus: () => {},
      router: { push: () => {} }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scope carries every member this hook destructures; the rest of the session model is unreachable from the mic path.
    held.model = useMobileSessionNativeChatDictation(scope as never, async () => true)
    return null
  }
  act(() => {
    create(createElement(Probe))
  })
  return {
    model: () => {
      if (!held.model) {
        throw new Error('the probe never rendered')
      }
      return held.model
    }
  }
}

/** Starts a take with `draft` in the composer and the caret at `cursor` (default: its end). */
function startTake(draft: string, cursor = draft.length): { readonly model: () => Model } {
  composer.text = draft
  const mounted = mount()
  act(() => {
    mounted.model().composerCursorRef.current = cursor
    mounted.model().startDictation()
  })
  composer.writes = 0
  return mounted
}

function hear(text: string, final = false): void {
  act(() => {
    engine.onTranscript?.(text, final, final ? '' : text)
  })
}

beforeEach(() => {
  engine.onTranscript = null
  engine.onError = null
  engine.starts = 0
  engine.cancels = 0
  composer.text = ''
  composer.writes = 0
  seen.toasts.length = 0
})

describe('while the mic is on, the words live above the composer', () => {
  it('revises the caption in place as recognition revises its words, and never writes the draft', () => {
    const take = startTake('')
    expect(engine.starts).toBe(1)
    hear('do the')
    expect(take.model().dictationCaption).toBe('do the')
    hear('do the same like')
    expect(take.model().dictationCaption).toBe('do the same like')
    // Recognition revises an earlier word: the caption is replaced, not appended to.
    hear('do the same like how')
    hear('do this same like how')
    expect(take.model().dictationCaption).toBe('do this same like how')
    expect(composer.text).toBe('')
    expect(composer.writes).toBe(0)
  })

  it('leaves an existing draft exactly as it was while the words come', () => {
    const take = startTake('Fix the build')
    hear('and the tests')
    hear('and the tests too')
    expect(take.model().dictationCaption).toBe('and the tests too')
    expect(composer.text).toBe('Fix the build')
    expect(composer.writes).toBe(0)
  })
})

describe('when the mic stops, the words move into the composer', () => {
  it('writes the final words into an empty composer', () => {
    startTake('')
    hear('do the same')
    hear('do the same like how Claude does it', true)
    expect(composer.text).toBe('do the same like how Claude does it')
  })

  it('joins them to an existing draft with one space, at the caret the take began from', () => {
    startTake('Fix the build')
    hear('and the tests', true)
    expect(composer.text).toBe('Fix the build and the tests')
  })

  it('adds no second space after a draft that already ends in one', () => {
    startTake('Fix the build ')
    hear('and the tests', true)
    expect(composer.text).toBe('Fix the build and the tests')
  })

  it('moves a single word in', () => {
    startTake('')
    hear('hello', true)
    expect(composer.text).toBe('hello')
  })

  it('leaves the composer alone when nothing was recognised', () => {
    startTake('Fix the build')
    hear('', true)
    expect(composer.text).toBe('Fix the build')
    startTake('')
    hear('   ', true)
    expect(composer.text).toBe('')
  })

  it('keeps the words heard so far when the engine fails mid-take, as the Claude app does', () => {
    // Claude's Error(partialText) lands the partial text in the draft too (k35 case 2, `cdw`).
    startTake('Fix the build')
    hear('and the tests')
    act(() => {
      engine.onError?.(new Error('Microphone interrupted'))
    })
    expect(composer.text).toBe('Fix the build and the tests')
    expect(seen.toasts).toEqual(['Microphone interrupted'])
  })
})

describe('Cancel discards the take', () => {
  it('leaves the draft as it was and puts none of the words in', () => {
    const take = startTake('Fix the build')
    hear('and the tests')
    act(() => {
      take.model().cancelDictation()
    })
    expect(engine.cancels).toBe(1)
    expect(composer.text).toBe('Fix the build')
    // A final that races the cancel does not bring the words back.
    hear('and the tests', true)
    expect(composer.text).toBe('Fix the build')
  })
})

describe('Send dictation while recording', () => {
  it('has the final words in the draft by the time the take reports itself over', () => {
    // The composer's Send dictation stops the take and sends the draft once the row goes down
    // (use-composer-dictation-row.ts). Both engines deliver the final transcript and go idle in
    // one callback, so the words must be in the draft from that same callback.
    const take = startTake('')
    hear('ship it')
    act(() => {
      take.model().stopDictation()
    })
    expect(composer.text).toBe('')
    hear('ship it now', true)
    expect(composer.text).toBe('ship it now')
  })
})
