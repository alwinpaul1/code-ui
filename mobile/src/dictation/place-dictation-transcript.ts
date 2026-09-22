import { applyLiveTranscript, paintSpokenAtCursor, type DictationPaint } from '../hooks/mobile-live-transcript'
import { liveDictationDelta } from '../hooks/mobile-live-dictation-delta'
import {
  appendBufferedDictation,
  routeDictationTranscript
} from '../terminal/terminal-live-dictation-routing'

export type LiveDictationTarget =
  | { kind: 'chat' }
  | { kind: 'buffered' }
  | { kind: 'pty'; handle: string; typed: string }

type ComposerUpdate = (update: () => string) => void
type InputUpdate = (update: (current: string) => string) => void

export function placeSpokenText(
  text: string,
  interim: string,
  target: LiveDictationTarget,
  prefix: string,
  suffix: string,
  base: string,
  setChatComposerText: ComposerUpdate,
  setInput: InputUpdate,
  sendLiveTerminalInput: (handle: string, bytes: string) => Promise<boolean>
): DictationPaint | null {
  if (target.kind === 'chat') {
    const painted = paintSpokenAtCursor(prefix, suffix, text, interim)
    setChatComposerText(() => painted.text)
    return painted.interim ? painted : null
  }
  placeLiveTranscript(text, base, target, setChatComposerText, setInput, sendLiveTerminalInput)
  return null
}

export function placeLiveTranscript(
  text: string,
  base: string,
  target: LiveDictationTarget,
  setChatComposerText: ComposerUpdate,
  setInput: InputUpdate,
  sendLiveTerminalInput: (handle: string, bytes: string) => Promise<boolean>
): void {
  if (target.kind === 'chat') {
    setChatComposerText(() => applyLiveTranscript(base, text))
    return
  }
  if (target.kind === 'buffered') {
    setInput(() => applyLiveTranscript(base, text))
    return
  }
  const delta = liveDictationDelta(target.typed, text)
  target.typed = text
  if (delta) {
    void sendLiveTerminalInput(target.handle, delta)
  }
}

export function deliverDesktopDictation(input: {
  text: string
  showNativeChat: boolean
  setChatComposerText: (update: (current: string) => string) => void
  showToast: (message: string) => void
  routeContext: { readonly handle: string | null; readonly liveInputEnabled: boolean } | null
  liveInputEnabled: boolean
  activeHandle: string | null
  flushPending: (handle: string) => Promise<boolean>
  sendLiveTerminalInput: (handle: string, bytes: string) => Promise<boolean>
  setInput: InputUpdate
}): void {
  // The visible composer owns the words. Terminal mode still follows live-input routing.
  if (input.showNativeChat) {
    input.setChatComposerText((current) => appendBufferedDictation(current, input.text))
    input.showToast('Dictation inserted')
    return
  }
  const route = routeDictationTranscript(
    input.text,
    input.routeContext?.liveInputEnabled ?? input.liveInputEnabled
  )
  if (route.kind === 'live-insert') {
    const insertHandle = input.routeContext?.handle ?? input.activeHandle
    if (!insertHandle) {
      return
    }
    void (async () => {
      const flushedPendingInput = await input.flushPending(insertHandle)
      if (!flushedPendingInput) {
        return
      }
      const sent = await input.sendLiveTerminalInput(insertHandle, route.text)
      if (sent) {
        input.showToast('Dictation inserted')
      }
    })()
    return
  }
  input.setInput((current) => appendBufferedDictation(current, route.text))
  input.showToast('Dictation inserted')
}
