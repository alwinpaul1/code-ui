import { useMemo } from 'react'
import { chatReadingFaces, useChatReadingSettings, type ChatFontFaces } from '../settings/chat-reading-settings'
import { useTheme } from '../theme/theme-context'
import type { MarkdownTypography } from './mobile-markdown-prose-scale'

/**
 * The faces a Markdown surface is set in: the reader's transcript font and code font when the
 * surface is the chat transcript, the theme's own on every other (the PR sidebar, the file reader,
 * a plan card), which the setting is not about. One object per choice, so styles built from it are
 * rebuilt only when the choice changes.
 */
export function useMarkdownFonts(typography: MarkdownTypography): ChatFontFaces {
  const { fonts } = useTheme()
  const { transcriptFont, codeFont } = useChatReadingSettings()
  const follows = typography.followsReadingSettings === true
  return useMemo(
    () => (follows ? chatReadingFaces({ transcriptFont, codeFont }) : fonts),
    [follows, transcriptFont, codeFont, fonts]
  )
}
