import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-09-23 review of the #21905 port: releasing the dictation button while the OS microphone
// prompt is still up (or a quick tap in hold mode) cancels the start, but the permission and the
// engine open became one call behind the capture seam, so the cancel was only noticed after the
// engine had opened. On Android that initialize sets MODE_IN_COMMUNICATION and takes transient
// exclusive audio focus: background audio paused and resumed for a dictation already cancelled.
// The fallback path only (the phone's own recognizer is a different hook).

type Grant = { granted: boolean; canAskAgain: boolean }

const rig = vi.hoisted(() => ({
  log: [] as string[],
  permission: (async () => ({ granted: true, canAskAgain: true })) as () => Promise<{
    granted: boolean
    canAskAgain: boolean
  }>
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'android' }
}))

vi.mock('@orca/expo-two-way-audio', () => ({
  requestMicrophonePermissionsAsync: () => {
    rig.log.push('permission')
    return rig.permission()
  },
  initialize: async () => {
    rig.log.push('initialize')
    return true
  },
  toggleRecording: (on: boolean) => {
    rig.log.push(`toggleRecording(${on})`)
    return true
  },
  tearDown: () => {
    rig.log.push('tearDown')
  },
  addExpoTwoWayAudioEventListener: () => ({ remove: () => undefined })
}))

vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: async () => undefined,
  deactivateKeepAwake: async () => undefined
}))

const client = {
  sendRequest: async (method: string) =>
    method === 'speech.dictation.finish'
      ? { id: 'r', ok: true, result: { text: 'hello' } }
      : { id: 'r', ok: true, result: {} },
  subscribe: () => () => undefined,
  getState: () => 'connected',
  getReconnectAttempt: () => 0,
  getLastConnectedAt: () => null,
  onStateChange: () => () => undefined,
  notifyForeground: () => undefined,
  updateTerminalSubscriptionViewport: () => undefined,
  close: () => undefined
}

type Dictation = { start: () => Promise<void>; cancel: () => Promise<void>; status: string }

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function mountDictation(): Promise<{ current: () => Dictation; root: ReactTestRenderer }> {
  const { useMobileDictation } = await import('./use-mobile-dictation')
  let latest: Dictation | null = null
  function Probe(): null {
    latest = useMobileDictation({
      client: client as never,
      enabled: true,
      onTranscript: () => undefined,
      onError: () => undefined
    }) as unknown as Dictation
    return null
  }
  let root!: ReactTestRenderer
  await act(async () => {
    root = create(createElement(Probe))
    await settle()
  })
  return { current: () => latest!, root }
}

function heldPermission(): (answer: Grant) => void {
  let answer!: (value: Grant) => void
  rig.permission = () =>
    new Promise<Grant>((resolve) => {
      answer = resolve
    })
  return (value) => answer(value)
}

describe('cancelling a dictation while the microphone prompt is up', () => {
  beforeEach(() => {
    rig.log.length = 0
    rig.permission = async () => ({ granted: true, canAskAgain: true })
  })

  it('never opens the audio engine once the start was cancelled, even when permission is then granted', async () => {
    const dictation = await mountDictation()
    const grant = heldPermission()
    let started: Promise<void> = Promise.resolve()
    await act(async () => {
      started = dictation.current().start().catch(() => undefined)
      await settle()
    })
    await act(async () => {
      await dictation.current().cancel()
      await settle()
    })
    await act(async () => {
      grant({ granted: true, canAskAgain: true })
      await started
      await settle()
    })

    expect(rig.log).not.toContain('initialize')
    expect(dictation.current().status).toBe('idle')
    await act(async () => dictation.root.unmount())
  })

  it('never opens the audio engine when the composer unmounts during the prompt', async () => {
    const dictation = await mountDictation()
    const grant = heldPermission()
    let started: Promise<void> = Promise.resolve()
    await act(async () => {
      started = dictation.current().start().catch(() => undefined)
      await settle()
    })
    await act(async () => {
      dictation.root.unmount()
      await settle()
    })
    await act(async () => {
      grant({ granted: true, canAskAgain: true })
      await started
      await settle()
    })

    expect(rig.log).not.toContain('initialize')
  })

  it('still opens the engine and records when nothing cancelled the start', async () => {
    const dictation = await mountDictation()
    await act(async () => {
      await dictation.current().start()
      await settle()
    })

    expect(rig.log).toEqual(['permission', 'initialize', 'toggleRecording(true)'])
    expect(dictation.current().status).toBe('recording')
    await act(async () => dictation.root.unmount())
  })
})
