import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core'
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { processColor, type NativeSyntheticEvent, type ViewProps } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { useChatTextSelectionReport } from './chat-text-selectable-context'
import { useChatHeldSelections, useHeldSelectionFor, type HeldSelection } from './chat-held-selection'
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
  /** A Text inside opened (`active`) or closed its selection, or moved it: with `active`, where it
   *  is (SelectionCopyRootView.kt). */
  onSelectionChange?: (event: NativeSyntheticEvent<SelectionChange>) => void
  /** A selection this document held before its row went away: the root puts it back where the
   *  same words still stand (chat-held-selection.ts). */
  restoreSelection?: HeldSelection
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

type SelectionChange = { active: boolean } & Partial<HeldSelection>

function heldSelectionOf(change: SelectionChange): HeldSelection | null {
  const { run, start, end, words } = change
  return typeof run === 'number' && typeof start === 'number' && typeof end === 'number' && typeof words === 'string'
    ? { run, start, end, words }
    : null
}

export function MarkdownSelectionRoot({
  children,
  holdSelects = true,
  document
}: {
  children: ReactNode
  holdSelects?: boolean
  /** The chat document this is (MobileMarkdown's `identity`), for the selection held outside it. */
  document?: string
}): ReactNode {
  const { colors } = useTheme()
  // In the chat, the document says when it holds a selection, so a scroll does not switch its
  // Texts' `selectable` off and end it (chat-text-selectable-context.ts, 2026-10-14). One owner
  // per document; one that unmounts with a selection open releases it, or every later scroll
  // in the chat would keep selection on.
  const report = useChatTextSelectionReport()
  const held = useChatHeldSelections()
  const restore = useHeldSelectionFor(held, document)
  const owner = useRef({}).current
  const live = useRef(false)
  const [isLive, setIsLive] = useState(false)
  // A row being torn down still closes its selection natively, after React let go of it. That
  // close is the row leaving, not the reader dismissing, so it must not forget the selection.
  const mounted = useRef(true)
  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<SelectionChange>) => {
      if (!mounted.current) {
        return
      }
      const change = event.nativeEvent
      live.current = change.active === true
      setIsLive(live.current)
      report?.(owner, live.current)
      if (held && document !== undefined) {
        const where = live.current ? heldSelectionOf(change) : null
        if (where) {
          held.hold(document, where)
        } else if (!live.current) {
          held.release(document)
        }
      }
    },
    [document, held, owner, report]
  )
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (live.current) {
        live.current = false
        // Rule 9: the row went with a selection open. It stays held (chat-held-selection.ts) and
        // comes back when the row is drawn again; this line says where it went meanwhile.
        console.info('[selection] row unmounted holding a selection; kept to restore')
        report?.(owner, false)
      }
    }
  }, [owner, report])
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
      restoreSelection={isLive ? undefined : restore}
    >
      {children}
    </SelectionCopyView>
  )
}

export function pillCopyNativeId(span: string, piece: number): string | undefined {
  return encodePillCopyNativeId(span, piece)
}
