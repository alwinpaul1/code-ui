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

type DesktopDictation = {
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
}

export function deliverDesktopDictation(input: DesktopDictation): void {
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
    void insertLive(input, route.text)
    return
  }
  input.setInput((current) => appendBufferedDictation(current, route.text))
  input.showToast('Dictation inserted')
}

/** Toasted when the live insert could not land and the words went to the
 *  command box instead. It follows the send's own "Input too large" when
 *  that was the reason, and says nothing that contradicts it. */
const DICTATION_KEPT_TOAST = 'Dictation not inserted — kept in the command box'

/** The words go to the PTY, or, when that cannot happen, to the command box
 *  as the buffered route would put them. Each of these returned in silence
 *  before, and the words vanished (review, 2026-09-30): no handle, a flush
 *  refused, and a send that came back false, which sendLiveTerminalInput does
 *  on a rejected RPC, a dropped connection or a stale tab. */
async function insertLive(input: DesktopDictation, text: string): Promise<void> {
  const keepInBox = (why: string): void => {
    console.warn(`[dictation] live insert failed (${why}); kept in the command box`)
    input.setInput((current) => appendBufferedDictation(current, text))
    input.showToast(DICTATION_KEPT_TOAST)
  }
  const handle = input.routeContext?.handle ?? input.activeHandle
  if (!handle) {
    keepInBox('no terminal handle')
    return
  }
  let step = 'flush of pending live input'
  try {
    if (!(await input.flushPending(handle))) {
      keepInBox(`${step} refused`)
      return
    }
    step = 'send'
    if (await input.sendLiveTerminalInput(handle, text)) {
      input.showToast('Dictation inserted')
      return
    }
    keepInBox('send refused: not connected, a stale tab, a rejected RPC or too large')
  } catch (error) {
    keepInBox(`${step} threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}
