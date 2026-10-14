import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_READING_STORAGE_KEY,
  CHAT_TEXT_SCALE,
  DEFAULT_CHAT_READING_SETTINGS,
  chatCodeFont,
  chatTranscriptFonts,
  loadChatReadingSettings,
  parseChatReadingSettings,
  peekChatReadingSettings,
  resetChatReadingSettingsForTests,
  saveChatReadingSettings,
  useChatReadingPreference,
  useChatReadingSettings,
  type ChatReadingPreference,
  type ChatReadingSettings
} from './chat-reading-settings'
import { fontFamily } from '../theme/tokens'

// The Claude Android app's reading settings (1.261009.20, decompiled 2026-10-14):
//   text size   gd9.java:52-66 (labels), s230.java:641-652 (the factor): Small 0.85,
//               Medium 1.0, Large 1.15, stored as "code_transcript_text_size", default "medium"
//   wrap        a41.java:171: "code_line_wrap_enabled", default false
//   prose font  a41.java:172: "code_prose_font", "anthropic_sans" | "system", default anthropic_sans
//   code font   a41.java:184: "code_mono_font", "system" | "jetbrains_mono", default "system"
// Code UI ships Instrument Sans where Claude ships Anthropic Sans, and keeps JetBrains Mono as its
// default code face (it is what the transcript has always drawn), so the defaults here are the
// transcript as it already looks.

describe('the reading settings values', () => {
  it('maps Small, Medium and Large to 0.85, 1.0 and 1.15, the Claude app’s own factors', () => {
    expect(CHAT_TEXT_SCALE).toEqual({ small: 0.85, medium: 1, large: 1.15 })
  })

  it('defaults to the transcript as it looks today: medium, Instrument Sans, JetBrains Mono, no wrap', () => {
    expect(DEFAULT_CHAT_READING_SETTINGS).toEqual({
      textSize: 'medium',
      transcriptFont: 'instrument_sans',
      codeFont: 'jetbrains_mono',
      wrapLongLines: false
    })
  })
})

describe('reading what is stored', () => {
  it('reads an absent value as the defaults', () => {
    expect(parseChatReadingSettings(null)).toEqual(DEFAULT_CHAT_READING_SETTINGS)
  })

  it('reads text that is not JSON as the defaults', () => {
    expect(parseChatReadingSettings('{"textSize":')).toEqual(DEFAULT_CHAT_READING_SETTINGS)
    expect(parseChatReadingSettings('"large"')).toEqual(DEFAULT_CHAT_READING_SETTINGS)
  })

  it('keeps the fields that read and defaults only the one that does not', () => {
    const stored = JSON.stringify({
      textSize: 'huge',
      transcriptFont: 'system',
      codeFont: 'comic_sans',
      wrapLongLines: 'yes'
    })
    expect(parseChatReadingSettings(stored)).toEqual({
      ...DEFAULT_CHAT_READING_SETTINGS,
      transcriptFont: 'system'
    })
  })
})

describe('the faces a choice draws', () => {
  it('draws the transcript in Instrument Sans by default and leaves the theme’s faces alone', () => {
    expect(chatTranscriptFonts('instrument_sans')).toEqual(fontFamily)
  })

  it('draws the transcript in the system face when asked, every weight a face the phone has', () => {
    const system = chatTranscriptFonts('system')
    expect(system.regular).toBe('sans-serif')
    expect(system.medium).toBe('sans-serif-medium')
    expect(system.semibold).toBe('sans-serif-medium')
    // The code face is the code font's to choose, never the transcript font's.
    expect(system.mono).toBe(fontFamily.mono)
  })

  it('draws code in JetBrains Mono or the platform monospace', () => {
    expect(chatCodeFont('jetbrains_mono')).toBe(fontFamily.mono)
    expect(chatCodeFont('system')).toBe('monospace')
  })
})

describe('keeping the settings', () => {
  beforeEach(async () => {
    resetChatReadingSettingsForTests()
    await AsyncStorage.removeItem(CHAT_READING_STORAGE_KEY)
  })

  it('has nothing in memory before the first read', () => {
    expect(peekChatReadingSettings()).toBeNull()
  })

  it('reads the defaults when storage is empty and remembers them', async () => {
    await AsyncStorage.removeItem(CHAT_READING_STORAGE_KEY)
    expect(await loadChatReadingSettings()).toEqual(DEFAULT_CHAT_READING_SETTINGS)
    expect(peekChatReadingSettings()).toEqual(DEFAULT_CHAT_READING_SETTINGS)
  })

  it('keeps Small across a restart', async () => {
    await saveChatReadingSettings({ textSize: 'small' })
    resetChatReadingSettingsForTests()
    expect((await loadChatReadingSettings()).textSize).toBe('small')
  })

  it('keeps Large, the fonts and the wrap switch across a restart', async () => {
    await saveChatReadingSettings({
      textSize: 'large',
      transcriptFont: 'system',
      codeFont: 'system',
      wrapLongLines: true
    })
    resetChatReadingSettingsForTests()
    expect(await loadChatReadingSettings()).toEqual({
      textSize: 'large',
      transcriptFont: 'system',
      codeFont: 'system',
      wrapLongLines: true
    })
  })

  it('changing one setting keeps the others stored before it', async () => {
    await saveChatReadingSettings({ textSize: 'large' })
    resetChatReadingSettingsForTests()
    // Not read yet: the save must read what is stored before it writes over it.
    await saveChatReadingSettings({ wrapLongLines: true })
    resetChatReadingSettingsForTests()
    expect(await loadChatReadingSettings()).toMatchObject({ textSize: 'large', wrapLongLines: true })
  })

  it('treats storage that cannot be read as the defaults, without throwing', async () => {
    const original = AsyncStorage.getItem
    AsyncStorage.getItem = vi.fn().mockRejectedValue(new Error('locked'))
    try {
      expect(await loadChatReadingSettings()).toEqual(DEFAULT_CHAT_READING_SETTINGS)
    } finally {
      AsyncStorage.getItem = original
    }
  })
})

describe('the hooks', () => {
  let renderer: ReactTestRenderer | null = null
  let live: ChatReadingSettings | null = null
  let preference: ChatReadingPreference | null = null

  function Reader() {
    live = useChatReadingSettings()
    return null
  }
  function Switcher() {
    preference = useChatReadingPreference()
    return null
  }

  beforeEach(async () => {
    resetChatReadingSettingsForTests()
    await AsyncStorage.removeItem(CHAT_READING_STORAGE_KEY)
    live = null
    preference = null
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount(element: ReturnType<typeof createElement>): Promise<void> {
    await act(async () => {
      renderer = create(element)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('reads the defaults before storage has answered', async () => {
    await mount(createElement(Reader))
    expect(live).toEqual(DEFAULT_CHAT_READING_SETTINGS)
  })

  it('follows a change made from the settings screen while a chat stays mounted', async () => {
    await mount(createElement('div', null, createElement(Reader), createElement(Switcher)))
    await act(async () => {
      preference!.setTextSize('large')
      await Promise.resolve()
    })
    expect(live?.textSize).toBe('large')
  })

  it('goes back to what storage holds when the write is refused', async () => {
    await mount(createElement(Switcher))
    await saveChatReadingSettings({ textSize: 'small' })
    const original = AsyncStorage.setItem
    const refused = vi.fn().mockRejectedValue(new Error('disk full'))
    AsyncStorage.setItem = refused
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await act(async () => {
        preference!.setTextSize('large')
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    } finally {
      AsyncStorage.setItem = original
      warn.mockRestore()
    }
    expect(refused).toHaveBeenCalled()
    // The refused write left the old value on disk; the screen shows that, not the one it lost.
    expect(peekChatReadingSettings()?.textSize).toBe('small')
    expect(preference!.settings.textSize).toBe('small')
  })
})
