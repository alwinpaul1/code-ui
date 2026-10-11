import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../theme/theme-context'

/** User bubble text size; agent prose is set by MobileMarkdown. */
const IMAGE_TILE_HEIGHT = 176

export const TEXT_SIZE = 15
export const MONO_SIZE = 12
/** A sent prompt's words, as the Claude app sets a user message in a Code
 *  session: 15 on 1.4 em, a step under the replies' 17 (`jn7.E`,
 *  docs/claude-app-typography.md, 2026-10-11). */
export const USER_TEXT_SIZE = 15
export const USER_TEXT_LINE_HEIGHT = 21
/** A tool row's label and the status line: the app's most used style, 15 on
 *  1.4 em. */
export const CHAT_LABEL_SIZE = 15
export const CHAT_LABEL_LINE_HEIGHT = 21
/** The chevron at a tool row's end, in dp (the app's 16 dp `caretRight`). */
export const TOOL_RUN_CHEVRON_SIZE = 16

export function makeChatMessageStyles(theme: Theme) {
  const { colors, fonts, radius, space } = theme
  return StyleSheet.create({
    row: {
      paddingHorizontal: space.lg,
      paddingVertical: space.sm
    },
    rowUser: {
      alignItems: 'flex-end'
    },
    content: {
      maxWidth: '100%',
      gap: space.sm
    },
    // A Claude Code session draws a sent prompt as a card, not a bubble: 12
    // dp corners all round, a hairline, 12 dp by 14 dp of padding (`w030.b`,
    // docs/claude-app-typography.md, 2026-10-11). It was a bubble with a tail
    // corner from screenshots before.
    userBubble: {
      maxWidth: '86%',
      flexShrink: 1,
      backgroundColor: colors.userBubble,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.hairline,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 14
    },
    userText: {
      fontFamily: fonts.regular,
      color: colors.userBubbleText,
      fontSize: USER_TEXT_SIZE,
      lineHeight: USER_TEXT_LINE_HEIGHT,
      // A long harness paragraph used to paint past the bubble and get clipped.
      flexShrink: 1
    },
    controls: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      gap: space.xs,
      marginBottom: 2,
      opacity: 0.8
    },
    controlButton: {
      padding: 4
    },
    // "Rewind to here": icon plus a word, since an undo arrow alone does not
    // say what it undoes. Sits left of Copy in the sent prompt's controls.
    rewindControl: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      padding: 4,
      marginRight: space.xs
    },
    controlPressed: {
      opacity: 0.5
    },
    copied: {
      backgroundColor: colors.successSoft,
      borderRadius: radius.md
    },
    // A thought, the one message drawn beside a line (an open tool run and a
    // quote have their own). Thin and faint, the weight of the Claude app's
    // thinking line: 3 px in the strong colour read heavy beside it (2026-09-24).
    reasoning: {
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      paddingLeft: space.md
    },
    reasoningBody: {
      opacity: 0.85
    },
    reasoningToggle: {
      alignSelf: 'flex-start',
      paddingVertical: space.xs
    },
    toolRun: {
      marginTop: space.xs
    },
    toolRunHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm
    },
    // The Claude app's tool-run row: 12 dp corners, 8 dp in at the sides and
    // 6 dp above and below its label (`w55.b`).
    toolRunToggle: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 6
    },
    controlsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end'
    },
    // An agent turn's actions: at the left, under the text, the Claude app's place
    // for them. The button's own padding moves out so the icon meets the text edge.
    agentControlsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      marginTop: space.xs,
      marginLeft: -space.xs
    },
    // The app's label: 15 on 21 at 400, in its muted colour (`da20.a`).
    toolRunLabel: {
      flex: 1,
      fontFamily: fonts.regular,
      color: colors.chatMuted,
      fontSize: CHAT_LABEL_SIZE,
      lineHeight: CHAT_LABEL_LINE_HEIGHT
    },
    // A batch of calls reads as a list only if something marks where one member
    // ends. The tone step from name to argument is that mark: punctuation
    // cannot be, because tool names carry it too (`browser.open`, `tools/read`).
    toolRunMemberName: {
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: CHAT_LABEL_SIZE
    },
    toolRunMemberArg: {
      color: colors.chatMuted,
      fontFamily: fonts.regular,
      fontSize: CHAT_LABEL_SIZE
    },
    toolRunBody: {
      paddingLeft: space.sm + 2,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      marginTop: space.xs,
      gap: 2
    },
    toolLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: 4
    },
    toolName: {
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE + 1
    },
    toolPreview: {
      flex: 1,
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE
    },
    toolPreviewLink: {
      color: colors.accentText,
      textDecorationLine: 'underline'
    },
    toolDetail: {
      paddingLeft: space.lg + 4,
      paddingBottom: space.xs,
      gap: space.xs
    },
    mono: {
      color: colors.textSecondary,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5
    },
    toolResult: {
      borderRadius: radius.sm,
      backgroundColor: colors.codeBg,
      padding: space.md
    },
    toolResultError: {
      backgroundColor: colors.dangerSoft
    },
    imageRef: {
      color: colors.textSecondary,
      fontFamily: fonts.regular,
      fontSize: TEXT_SIZE
    },
    imageChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.md,
      // The panel, not bgRaised: bgRaised is the sent prompt's card colour,
      // and a chip inside the card vanished into it (review, 2026-10-11).
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border
    },
    // A row of image tiles: 3:4 tiles the Claude app's height, a sliver of the
    // next one showing so the row reads as scrollable.
    // Air between a picture and the caption under it, as the Claude app has.
    imageLead: {
      marginBottom: space.md
    },
    imageStripFrame: {
      height: IMAGE_TILE_HEIGHT + space.xs * 2,
      flexGrow: 0,
      alignSelf: 'stretch'
    },
    imageStrip: {
      flexDirection: 'row',
      gap: space.sm,
      paddingVertical: space.xs
    },
    // Bare pictures with rounded corners, no frame or fill: a border around a
    // letterboxed screenshot read as "a box with a small image in it".
    imageTile: {
      width: 132,
      height: IMAGE_TILE_HEIGHT,
      borderRadius: radius.lg
    },
    imageThumb: {
      width: '100%',
      borderRadius: radius.lg
    },
    // Orca #19226: what the row's own execution details look like — an MCP
    // call's server and tool, its exit code, and how long it took.
    toolNameServer: {
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE + 1
    },
    toolNameSeparator: {
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE + 1
    },
    toolNameTool: {
      color: colors.textSecondary,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE + 1
    },
    toolMeta: {
      flexDirection: 'row',
      gap: space.xs + 2
    },
    toolMetaText: {
      color: colors.textMuted,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE - 1
    },
    toolMetaFailed: {
      color: colors.danger
    },
    // A finished run's sentence hugs its words so the "+A −R" pill follows
    // them, and it is the one that shrinks and ellipsizes on a narrow row,
    // never the pill or the chevron (2026-09-26 screenshot).
    toolRunSentence: {
      flex: 0,
      flexShrink: 1
    },
    toolSearchResults: {
      gap: 2
    },
    toolSearchTitle: {
      color: colors.accentText,
      fontFamily: fonts.regular,
      fontSize: MONO_SIZE + 1,
      textDecorationLine: 'underline'
    },
    toolSearchUrl: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: MONO_SIZE - 1
    },
    diff: {
      borderRadius: radius.sm,
      backgroundColor: colors.codeBg,
      paddingVertical: space.xs,
      overflow: 'hidden'
    },
    diffLine: {
      color: colors.textSecondary,
      fontFamily: fonts.mono,
      fontSize: MONO_SIZE,
      lineHeight: MONO_SIZE + 5,
      paddingHorizontal: space.sm
    },
    diffAdd: {
      color: colors.diffAddText,
      backgroundColor: colors.diffAddBg
    },
    diffDel: {
      color: colors.diffDelText,
      backgroundColor: colors.diffDelBg
    },
    diffMeta: {
      color: colors.textMuted
    }
  })
}

export type ChatMessageStyles = ReturnType<typeof makeChatMessageStyles>

export function useChatMessageStyles(): ChatMessageStyles {
  const theme = useTheme()
  return useMemo(() => makeChatMessageStyles(theme), [theme])
}
