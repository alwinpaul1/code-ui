import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { barrierAfterWrite } from '../storage/refused-write-log'
import { fontFamily } from '../theme/tokens'

/**
 * How the chat transcript is read: its text size, its two faces, and whether a code block wraps.
 * The Claude Android app's own four settings (1.261009.20, decompiled 2026-10-14):
 *
 *   text size   `code_transcript_text_size`  small | medium | large, default medium. The factors
 *               are Small 0.85, Medium 1.0, Large 1.15 (s230.java:641-652), applied as the
 *               transcript's font scale (gsw(f, density)); labels in gd9.java:52-66.
 *   prose font  `code_prose_font`  anthropic_sans | system, default anthropic_sans. Each option's
 *               label is drawn in its own face (gd9.java case 23: the first in the body style,
 *               "System" in `FontFamily.Default`). The row is not drawn when the app-wide font
 *               style is not the default.
 *   code font   `code_mono_font`  system | jetbrains_mono, default system. Each label is drawn in
 *               its own face too (gd9.java `d`: `FontFamily.Monospace`, or the theme's mono face).
 *   wrap        `code_line_wrap_enabled`, default off.
 *
 * Where Code UI differs, on purpose: it ships Instrument Sans, not Anthropic Sans, so that is the
 * first transcript option (the face the transcript has always drawn, so the default changes
 * nothing). It keeps JetBrains Mono as the default code face for the same reason; the Claude app
 * defaults to the system face. Only faces the app already ships, or the phone does, are offered.
 */

export type ChatTextSize = 'small' | 'medium' | 'large'
export type ChatTranscriptFont = 'instrument_sans' | 'system'
export type ChatCodeFont = 'jetbrains_mono' | 'system'

export type ChatReadingSettings = {
  textSize: ChatTextSize
  transcriptFont: ChatTranscriptFont
  codeFont: ChatCodeFont
  wrapLongLines: boolean
}

export const CHAT_TEXT_SIZES: readonly ChatTextSize[] = ['small', 'medium', 'large']
export const CHAT_TRANSCRIPT_FONTS: readonly ChatTranscriptFont[] = ['instrument_sans', 'system']
export const CHAT_CODE_FONTS: readonly ChatCodeFont[] = ['system', 'jetbrains_mono']

/** The transcript's font scale for each size (s230.java:641-652). */
export const CHAT_TEXT_SCALE: Readonly<Record<ChatTextSize, number>> = {
  small: 0.85,
  medium: 1,
  large: 1.15
}

export const DEFAULT_CHAT_READING_SETTINGS: ChatReadingSettings = {
  textSize: 'medium',
  transcriptFont: 'instrument_sans',
  codeFont: 'jetbrains_mono',
  wrapLongLines: false
}

export const CHAT_READING_STORAGE_KEY = 'orca:chatReading'

/** Every weight's face, as a plain string: a system face is not one of the literals `fontFamily`
 *  declares. */
export type ChatFontFaces = Readonly<Record<keyof typeof fontFamily, string>>

/** The faces for a transcript font. Instrument Sans is the theme's own, untouched. The system
 *  face has no semibold file: Android's `sans-serif-medium` is the weight nearest it. The code
 *  face is the code font's to set (chatCodeFont), so `mono` stays the theme's here. */
export function chatTranscriptFonts(font: ChatTranscriptFont): ChatFontFaces {
  if (font === 'instrument_sans') {
    return fontFamily
  }
  return {
    regular: 'sans-serif',
    medium: 'sans-serif-medium',
    semibold: 'sans-serif-medium',
    bold: 'sans-serif-medium',
    mono: fontFamily.mono
  }
}

/** The faces the transcript's Markdown is set in: the transcript font's weights, and the code
 *  font's face for everything monospace. */
export function chatReadingFaces(
  settings: Pick<ChatReadingSettings, 'transcriptFont' | 'codeFont'>
): ChatFontFaces {
  return { ...chatTranscriptFonts(settings.transcriptFont), mono: chatCodeFont(settings.codeFont) }
}

/** The face code is drawn in: the bundled JetBrains Mono, or the platform's monospace. */
export function chatCodeFont(font: ChatCodeFont): string {
  return font === 'jetbrains_mono' ? fontFamily.mono : 'monospace'
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback
}

/** What a stored string says, each field read on its own: a value this build does not know (a
 *  later build's, a hand-edited one) costs that field its default and nothing else. */
export function parseChatReadingSettings(raw: string | null): ChatReadingSettings {
  let parsed: unknown = null
  try {
    parsed = raw === null ? null : JSON.parse(raw)
  } catch {
    parsed = null
  }
  const record: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  return {
    textSize: oneOf(record.textSize, CHAT_TEXT_SIZES, DEFAULT_CHAT_READING_SETTINGS.textSize),
    transcriptFont: oneOf(
      record.transcriptFont,
      CHAT_TRANSCRIPT_FONTS,
      DEFAULT_CHAT_READING_SETTINGS.transcriptFont
    ),
    codeFont: oneOf(record.codeFont, CHAT_CODE_FONTS, DEFAULT_CHAT_READING_SETTINGS.codeFont),
    wrapLongLines:
      typeof record.wrapLongLines === 'boolean'
        ? record.wrapLongLines
        : DEFAULT_CHAT_READING_SETTINGS.wrapLongLines
  }
}

// Memory copy, one write barrier and subscribers: the settings live on one screen and the chat
// that obeys them on another, and an open chat follows a change without a remount (the same shape
// as Focus view and Expand tool calls, session-view-preferences.ts).
let memory: ChatReadingSettings | null = null
let writeBarrier: Promise<void> | null = null
/** Counts saves, so a read that began before one does not put back what it overtook. */
let saveGeneration = 0
const listeners = new Set<() => void>()

function setMemory(next: ChatReadingSettings): void {
  if (
    memory !== null &&
    memory.textSize === next.textSize &&
    memory.transcriptFont === next.transcriptFont &&
    memory.codeFont === next.codeFont &&
    memory.wrapLongLines === next.wrapLongLines
  ) {
    return
  }
  memory = next
  for (const listener of listeners) {
    listener()
  }
}

/** The last loaded or saved settings, or null before the first read. */
export function peekChatReadingSettings(): ChatReadingSettings | null {
  return memory
}

export function subscribeChatReadingSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reads the stored settings into memory. Storage that cannot be read reads as the defaults: a
 *  transcript that cannot know how it is read is the transcript as it was. */
export async function loadChatReadingSettings(): Promise<ChatReadingSettings> {
  await writeBarrier
  const generation = saveGeneration
  let raw: string | null = null
  try {
    raw = await AsyncStorage.getItem(CHAT_READING_STORAGE_KEY)
  } catch {
    raw = null
  }
  if (generation !== saveGeneration && memory !== null) {
    // Overtaken by a save: what was read is older than what memory holds.
    return memory
  }
  const settings = parseChatReadingSettings(raw)
  setMemory(settings)
  return settings
}

/**
 * Changes some of the settings: in memory at once, on disk behind every earlier write. The whole
 * record is written, so a change made before the first read waits for that read: writing a lone
 * field over the defaults would put the others back.
 */
export async function saveChatReadingSettings(patch: Partial<ChatReadingSettings>): Promise<void> {
  if (memory === null) {
    await loadChatReadingSettings()
  }
  saveGeneration += 1
  const next: ChatReadingSettings = { ...(memory ?? DEFAULT_CHAT_READING_SETTINGS), ...patch }
  setMemory(next)
  const write = (writeBarrier ?? Promise.resolve()).then(() =>
    AsyncStorage.setItem(CHAT_READING_STORAGE_KEY, JSON.stringify(next))
  )
  const barrier = barrierAfterWrite(write, 'chat reading settings', 'save')
  writeBarrier = barrier
  void barrier.then(() => {
    if (writeBarrier === barrier) {
      writeBarrier = null
    }
  })
  return write
}

/** Test-only: the memory outlives a test's hooks; this is a process restart. */
export function resetChatReadingSettingsForTests(): void {
  memory = null
  writeBarrier = null
  saveGeneration = 0
  listeners.clear()
}

/** How the transcript is read, live: an open chat follows the Settings screen without a remount.
 *  Before the first read it answers the defaults, and asks storage once so the answer corrects
 *  itself. */
export function useChatReadingSettings(): ChatReadingSettings {
  const value = useSyncExternalStore(
    subscribeChatReadingSettings,
    peekChatReadingSettings,
    peekChatReadingSettings
  )
  useEffect(() => {
    if (value === null) {
      void loadChatReadingSettings()
    }
  }, [value])
  return value ?? DEFAULT_CHAT_READING_SETTINGS
}

/** The transcript's font scale for the reader's chosen size. */
export function useChatTextScale(): number {
  return CHAT_TEXT_SCALE[useChatReadingSettings().textSize]
}

export type ChatReadingPreference = {
  settings: ChatReadingSettings
  setTextSize: (size: ChatTextSize) => void
  setTranscriptFont: (font: ChatTranscriptFont) => void
  setCodeFont: (font: ChatCodeFont) => void
  setWrapLongLines: (wrap: boolean) => void
}

/** The Settings screen's side: optimistic in memory, ordered on disk, and put back to what
 *  storage holds when the write is refused. */
export function useChatReadingPreference(): ChatReadingPreference {
  const settings = useChatReadingSettings()
  const change = useCallback((patch: Partial<ChatReadingSettings>) => {
    void saveChatReadingSettings(patch).catch(() => loadChatReadingSettings())
  }, [])
  return {
    settings,
    setTextSize: useCallback((textSize: ChatTextSize) => change({ textSize }), [change]),
    setTranscriptFont: useCallback((transcriptFont: ChatTranscriptFont) => change({ transcriptFont }), [change]),
    setCodeFont: useCallback((codeFont: ChatCodeFont) => change({ codeFont }), [change]),
    setWrapLongLines: useCallback((wrapLongLines: boolean) => change({ wrapLongLines }), [change])
  }
}
