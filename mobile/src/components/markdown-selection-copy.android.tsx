import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core'
import { useCallback, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { processColor, type NativeSyntheticEvent, type ViewProps } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { useChatTextSelectionReport } from './chat-text-selectable-context'
import { chatSelectionColors } from './chat-selection-colors'
import { encodePillCopyNativeId, SELECTION_COPY_MODULE } from './markdown-pill-copy-id'

/**
 * Android (Metro picks this file over markdown-selection-copy.tsx): a Markdown document is wrapped
 * in modules/orca-selection-copy's view, whose Texts select as the Claude app's do: a menu of only
 * Copy and Select all, handles and highlight in the theme's accent (chat-selection-colors.ts),
 * and a code pill copied as its words instead of U+FFFC (SelectionCopyRootView.kt). Each pill's View carries its span on its nativeID
 * (markdown-pill-copy-id.ts), which is where that copy reads it.
 *
 * It wraps the document's own root View rather than stand in for it. expo-modules-core 57.0.16
 * reads collapsableChildren the other way round from a View (ExpoViewShadowNode.h), so an Expo
 * view makes each child keep its own children: a prose Text directly under it would keep its pill
 * Views, and Fabric cannot put a view inside a TextView. Under the root View, a Text's pills are
 * mounted into that View as before, whichever way Expo reads the flag. The cost is one native
 * view per document.
 *
 * The module ships in the same APK as this JavaScript. Were it ever missing, the document is not
 * wrapped, and a Copy keeps U+FFFC as before, rather than mount a view that is not there.
 */
type SelectionCopyViewProps = ViewProps & {
  /** Android colour ints (processColor); absent, the platform's colours. */
  selectionHandleColor?: number
  selectionHighlightColor?: number
  /** A Text inside opened (`active`) or closed its selection's action mode (SelectionCopyRootView.kt). */
  onSelectionChange?: (event: NativeSyntheticEvent<{ active: boolean }>) => void
  /** False while the chat scrolls: the root makes its Texts not long-clickable, so a hold starts
   *  no selection, and one already open stays (SelectionCopyRootView.applyHoldSelects). */
  holdSelects?: boolean
}

function selectionCopyView(): ComponentType<SelectionCopyViewProps> | null {
  if (requireOptionalNativeModule(SELECTION_COPY_MODULE) === null) {
    console.warn(
      `${SELECTION_COPY_MODULE} is not in this build: a Copy from a Markdown Text keeps U+FFFC for each code pill`
    )
    return null
  }
  return requireNativeViewManager<SelectionCopyViewProps>(SELECTION_COPY_MODULE)
}

const SelectionCopyView = selectionCopyView()

/**
 * With the root in the tree, a scroll's guard against a stray hold (2026-09-12) is the root's,
 * and the Texts never have `selectable` switched off: that is what ended a held selection on the
 * first drag of the transcript (2026-10-14).
 */
export const MARKDOWN_ROOT_GUARDS_HOLDS = SelectionCopyView !== null

/** processColor gives an Android colour int for any colour the theme writes; anything it cannot
 *  read is left out, and the native view keeps the platform's colour for it. */
function colorInt(color: string | null): number | undefined {
  const processed = color === null ? null : processColor(color)
  return typeof processed === 'number' ? processed : undefined
}

export function MarkdownSelectionRoot({
  children,
  holdSelects = true
}: {
  children: ReactNode
  holdSelects?: boolean
}): ReactNode {
  const { colors } = useTheme()
  // In the chat, the document says when it holds a selection, so a scroll does not switch its
  // Texts' `selectable` off and end it (chat-text-selectable-context.ts, 2026-10-14). One owner
  // per document; one that unmounts with a selection open releases it, or every later scroll
  // in the chat would keep selection on.
  const report = useChatTextSelectionReport()
  const owner = useRef({}).current
  const live = useRef(false)
  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<{ active: boolean }>) => {
      live.current = event.nativeEvent.active === true
      report?.(owner, live.current)
    },
    [owner, report]
  )
  useEffect(
    () => () => {
      if (live.current) {
        live.current = false
        // Rule 9: a selection lost to the row unmounting (FlashList left it behind) says so.
        console.warn('[selection] dropped: the reply holding it unmounted')
        report?.(owner, false)
      }
    },
    [owner, report]
  )
  if (!SelectionCopyView) {
    return children
  }
  const selection = chatSelectionColors(colors)
  return (
    <SelectionCopyView
      selectionHandleColor={colorInt(selection.handle)}
      selectionHighlightColor={colorInt(selection.highlight)}
      onSelectionChange={onSelectionChange}
      holdSelects={holdSelects}
    >
      {children}
    </SelectionCopyView>
  )
}

export function pillCopyNativeId(span: string, piece: number): string | undefined {
  return encodePillCopyNativeId(span, piece)
}
