/**
 * A mic tap with nobody signed in to Anthropic on the phone (reported 2026-10-14 with a screen
 * recording: the toast read "unstructured server error", from a token the app had taken out of the
 * desktop's Keychain through a hidden terminal). Signing in on the phone is mandatory (the user,
 * 2026-10-14), so a signed-out tap says so and opens Voice settings, and starts nothing: no
 * recogniser, no desktop dictation, no terminal on the desktop.
 *
 * Mounts the real `useMobileSessionNativeChatDictation` over the real engines, because the defect
 * was in the wiring between the mic and the engine choice rather than in either half.
 *
 * The desktop-refusal routing this file used to pin (a desktop refusing `speech.dictation.start`
 * opening the setup sheet) is unreachable now: signed in, the engine is always Anthropic.
 */
import { createElement, useRef } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeRpcClient, type FakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import type * as NativeChatSendError from './use-mobile-native-chat-send-error'

const seen = vi.hoisted(() => ({
  toasts: new Array<string>(),
  errorHaptics: 0,
  pushed: new Array<string>(),
  signedIn: false
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'ios' }
}))
vi.mock('@orca/expo-two-way-audio', () => ({
  addExpoTwoWayAudioEventListener: () => ({ remove: () => {} }),
  initialize: () => Promise.resolve(true),
  requestMicrophonePermissionsAsync: () => Promise.resolve({ granted: true }),
  tearDown: () => {},
  toggleRecording: () => true
}))
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: () => Promise.resolve(),
  deactivateKeepAwake: () => Promise.resolve()
}))
vi.mock('expo-router', () => ({ useFocusEffect: () => {} }))
vi.mock('../platform/haptics', () => ({
  triggerError: () => {
    seen.errorHaptics += 1
  }
}))
// Code UI addition: upstream's own `expo-speech-recognition` build resolves in this harness
// without help; here it drags in the real `expo` winter runtime unless stubbed. Unlike
// `use-mobile-live-transcription.test.ts`, this suite cannot inject a fake recognizer through the
// composed hook, so the module mock itself has to answer every call `useMobileLiveTranscription`
// makes unconditionally in its mount effect. `isRecognitionAvailable: () => false` routes this
// suite onto the desktop fallback path it means to test, which is what a phone with no recognizer
// does anyway.
vi.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    start: () => {},
    stop: () => {},
    abort: () => {},
    requestPermissionsAsync: async () => ({ granted: false }),
    isRecognitionAvailable: () => false,
    addListener: () => ({ remove: () => {} })
  }
}))

// The native-chat surface this hook composes with. None of it is on the mic's path, and reaching
// the real modules would pull the Expo runtime in behind them.
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
vi.mock('./use-mobile-native-chat-readability', () => ({
  useMobileNativeChatReadability: () => false
}))
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
    showNativeChat: false,
    showNativeChatRef: { current: false },
    setChatComposerText: () => {}
  })
}))
vi.mock('./use-mobile-send-completion-generation', () => ({
  useMobileSendCompletionGeneration: () => () => 0
}))

// The Anthropic engine's token store reads the keychain (expo-secure-store), whose native module
// does not exist under vitest. No phone sign-in is the state these routing tests run in.
vi.mock('../dictation/anthropic-auth-store', () => ({
  readCredential: async () =>
    seen.signedIn ? { accessToken: 'phone-token', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 } : null,
  refreshAccessToken: async () => null
}))

import { useMobileSessionNativeChatDictation } from './use-mobile-session-native-chat-dictation'

type Mounted = {
  readonly tap: () => void
  readonly setupSheetOpens: number[]
}

function mount(client: FakeRpcClient): Mounted {
  const setupSheetOpens: number[] = []
  const held: { start: (() => void) | null } = { start: null }

  function Probe(): null {
    const dictationRouteContextRef = useRef(null)
    const activeHandleRef = useRef('t1')
    const deviceTokenRef = useRef('dev')
    const diffCommentsRef = useRef([])
    const scope = {
      hostId: 'h1',
      worktreeId: 'w1',
      client,
      connState: 'connected',
      agentSessionPromptCancelSupported: true,
      setInput: () => {},
      liveInputTerminalHandles: new Set<string>(),
      activeHandle: 't1',
      activeSessionTabId: 'tab1',
      activeSessionTab: { id: 'tab1', type: 'terminal', terminal: 't1' },
      diffComments: [],
      diffCommentsRef,
      setShowDictationSetup: (next: boolean) => {
        if (next) {
          setupSheetOpens.push(setupSheetOpens.length + 1)
        }
      },
      setDictationMode: () => {},
      deviceTokenRef,
      dictationRouteContextRef,
      activeHandleRef,
      flushPendingLiveInputBeforeExternalSend: async () => true,
      canSend: true,
      liveInputEnabled: false,
      showToast: (message: string) => {
        seen.toasts.push(message)
      },
      resetLiveInputFocus: () => {},
      router: {
        push: (href: string) => {
          seen.pushed.push(href)
        }
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scope carries every member this hook destructures; the rest of the session model is unreachable from the mic path.
    const model = useMobileSessionNativeChatDictation(scope as never, async () => true)
    held.start = model.startDictation
    return null
  }

  act(() => {
    create(createElement(Probe))
  })
  return {
    tap: () => held.start?.(),
    setupSheetOpens
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve()
    }
  })
}

beforeEach(() => {
  seen.toasts.length = 0
  seen.errorHaptics = 0
  seen.pushed.length = 0
  seen.signedIn = false
})

describe('a mic tap with nobody signed in to Anthropic on the phone', () => {
  it('says so and opens Voice settings, and starts nothing', async () => {
    const rpc = createFakeRpcClient()
    const mounted = mount(rpc)
    await settle()
    await act(async () => mounted.tap())
    await settle()

    expect(seen.pushed).toEqual(['/voice-settings'])
    expect(seen.toasts).toEqual(['Sign in to Anthropic to dictate'])
    expect(rpc.requests.map((request) => request.method)).not.toContain('speech.dictation.start')
    expect(rpc.requests).toEqual([])
  })

  it('reads the store again at the tap, so a sign-in a moment ago is not sent to sign in again', async () => {
    const rpc = createFakeRpcClient()
    const mounted = mount(rpc)
    await settle()
    seen.signedIn = true
    await act(async () => mounted.tap())
    await settle()

    expect(seen.pushed).toEqual([])
    expect(seen.toasts).not.toContain('Sign in to Anthropic to dictate')
  })
})

describe('a mic tap with someone signed in on the phone', () => {
  it('does not send them to Voice settings', async () => {
    seen.signedIn = true
    const rpc = createFakeRpcClient()
    const mounted = mount(rpc)
    await settle()
    await act(async () => mounted.tap())
    await settle()

    expect(seen.pushed).toEqual([])
    expect(seen.toasts).not.toContain('Sign in to Anthropic to dictate')
    expect(rpc.requests.map((request) => request.method)).not.toContain('speech.dictation.start')
  })
})
