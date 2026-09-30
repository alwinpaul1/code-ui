import { applyLiveTranscript, paintSpokenAtCursor, type DictationPaint } from '../hooks/mobile-live-transcript'
import {
  appendBufferedDictation,
  routeDictationTranscript
} from '../terminal/terminal-live-dictation-routing'
import { typeLiveTranscript, type PtyDictationTarget } from './live-terminal-dictation'

/** Where a phone-recogniser transcript lands: the chat composer, the buffered command box, or (live
 *  terminal input) the PTY line itself, revised with backspaces (`live-terminal-dictation.ts`). */
export type LiveDictationTarget = { kind: 'chat' } | { kind: 'buffered' } | PtyDictationTarget

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
  typeLiveTranscript(target, text, sendLiveTerminalInput)
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
  /** Whether the dock draws the command box `setInput` writes, asked when the words land
   *  (`isDictationCommandBoxOnScreen`), never a flag read before an await. */
  commandBoxOnScreen: () => boolean
  /** `useClipboardWriter().writeText`: rejects when the pasteboard refuses. */
  copyToClipboard: (text: string) => Promise<void>
}

/** The session refs that say whether the dock's buffered command box is on screen. */
export type DictationCommandBoxView = {
  /** Set by the dock's own ref callback while the buffered field is mounted, null once it is not. */
  readonly commandInputRef: { readonly current: unknown }
  readonly activeHandleRef: { readonly current: string | null }
  readonly liveInputTerminalHandlesRef: { readonly current: ReadonlySet<string> }
}

/**
 * Whether words written with `setInput` would be in a box the user can see right now.
 *
 * The dock draws the buffered "Type a command…" box only with live input off, only under a terminal
 * tab in terminal view, and `setInput` writes the ACTIVE handle's draft or, with none, nothing.
 * The mounted field is the dock's own answer to all of that; the handle checks cover the moment a
 * toggle has changed the refs and the dock has not re-rendered yet. Read at call time, so a
 * dictation that outlived a live-input toggle or a tab switch sees the dock as it is now.
 */
export function isDictationCommandBoxOnScreen(view: DictationCommandBoxView): boolean {
  const handle = view.activeHandleRef.current
  return (
    view.commandInputRef.current != null &&
    handle != null &&
    !view.liveInputTerminalHandlesRef.current.has(handle)
  )
}

/** The session state a desktop transcript is delivered through (the session hook's scope). */
export type DesktopDictationSession = DictationCommandBoxView & {
  readonly dictationRouteContextRef: { current: DesktopDictation['routeContext'] }
  readonly liveInputEnabled: boolean
  readonly flushPendingLiveInputBeforeExternalSend: (handle: string) => Promise<boolean>
  readonly setInput: InputUpdate
  readonly showToast: (message: string) => void
}

type DesktopDictationSurface = Pick<
  DesktopDictation,
  'showNativeChat' | 'setChatComposerText' | 'sendLiveTerminalInput' | 'copyToClipboard'
>

/**
 * One desktop transcript from the session: the route the dictation started on is taken once, so a
 * later transcript cannot reuse it, and whether the command box is on screen is asked of the dock
 * when the words land, not of the live-input flag this render read before the send was awaited.
 */
export function deliverSessionDesktopDictation(
  session: DesktopDictationSession,
  text: string,
  surface: DesktopDictationSurface
): void {
  const routeContext = session.dictationRouteContextRef.current
  session.dictationRouteContextRef.current = null
  deliverDesktopDictation({
    ...surface,
    text,
    showToast: session.showToast,
    routeContext,
    liveInputEnabled: session.liveInputEnabled,
    activeHandle: session.activeHandleRef.current,
    flushPending: session.flushPendingLiveInputBeforeExternalSend,
    setInput: session.setInput,
    commandBoxOnScreen: () => isDictationCommandBoxOnScreen(session)
  })
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
  // Buffered when the dictation started, but the user may have opened another tab, the chat view
  // or live input since. Then the draft is not drawn, or with no terminal handle not written at
  // all, and "Dictation inserted" pointed at nothing.
  if (!input.commandBoxOnScreen()) {
    void copyInstead(input, route.text, 'buffered dictation: the command box is not on screen')
    return
  }
  input.setInput((current) => appendBufferedDictation(current, route.text))
  input.showToast('Dictation inserted')
}

/** Toasted when the words did not go where they were meant to and the clipboard holds them. It
 *  follows the send's own "Input too large" when that was the reason, and does not contradict it. */
const DICTATION_COPIED_TOAST = 'Dictation not inserted — copied to the clipboard'
/** Toasted when the live insert failed and the command box is on screen by then, holding them. */
const DICTATION_KEPT_TOAST = 'Dictation not inserted — kept in the command box'
/** Toasted when the clipboard refused them too: nothing holds the words, and nothing claims to. */
const DICTATION_LOST_TOAST = 'Dictation not inserted, and it could not be copied'

/**
 * The words go to the PTY or, when that cannot happen, somewhere the user can reach now. Each of
 * these returned in silence before, and the words vanished (review, 2026-09-30): no handle, a flush
 * refused, and a send that came back false, which sendLiveTerminalInput does on a rejected RPC, a
 * dropped connection or a stale tab.
 *
 * 557c4233 then kept them in the buffered command draft. But with live input on, the dock draws the
 * live field and that box is not mounted: the words sat hidden under a toast pointing at a box that
 * was not there, and came back unasked when live input was switched off (review, 2026-09-30). So
 * the box only when the dock draws it once the send has answered; otherwise the clipboard, to paste
 * into the live field. A send that rejects after the desktop wrote the bytes can leave the words in
 * the PTY and on the clipboard; nothing is sent twice.
 */
async function insertLive(input: DesktopDictation, text: string): Promise<void> {
  const failed = await sendLive(input, text)
  if (failed === null) {
    input.showToast('Dictation inserted')
    return
  }
  const why = `live insert failed (${failed})`
  if (!input.commandBoxOnScreen()) {
    await copyInstead(input, text, `${why}; the command box is not on screen`)
    return
  }
  console.warn(`[dictation] ${why}; kept in the command box`)
  input.setInput((current) => appendBufferedDictation(current, text))
  input.showToast(DICTATION_KEPT_TOAST)
}

/** Null once the PTY took the words, otherwise why it did not. */
async function sendLive(input: DesktopDictation, text: string): Promise<string | null> {
  const handle = input.routeContext?.handle ?? input.activeHandle
  if (!handle) {
    return 'no terminal handle'
  }
  let step = 'flush of pending live input'
  try {
    if (!(await input.flushPending(handle))) {
      return `${step} refused`
    }
    step = 'send'
    if (await input.sendLiveTerminalInput(handle, text)) {
      return null
    }
    return 'send refused: not connected, a stale tab, a rejected RPC or too large'
  } catch (error) {
    return `${step} threw: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** The clipboard, for words no field on screen can take. When it refuses too, the console line
 *  names both failures and the toast says the words were neither inserted nor copied. */
async function copyInstead(input: DesktopDictation, text: string, why: string): Promise<void> {
  try {
    await input.copyToClipboard(text)
  } catch (error) {
    const refused = error instanceof Error ? error.message : String(error)
    console.warn(
      `[dictation] ${why}, and the clipboard refused the words too (${refused}); nothing holds them`
    )
    input.showToast(DICTATION_LOST_TOAST)
    return
  }
  console.warn(`[dictation] ${why}; copied to the clipboard`)
  input.showToast(DICTATION_COPIED_TOAST)
}
