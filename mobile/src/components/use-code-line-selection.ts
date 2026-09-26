import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme } from '../theme/theme-context'
import {
  extendFileReaderLineSelection,
  fileReaderLineSelectionRange,
  isFileReaderLineSelected,
  startFileReaderLineSelection,
  type FileReaderLineRange,
  type FileReaderLineSelection
} from '../session/mobile-file-reader-line-selection'
import type { MobileCodeLineInteraction } from './MobileCodeViewLine'

export type CodeLineSelection = {
  /** The selected lines, first to last; null with nothing selected. */
  range: FileReaderLineRange | null
  /** Whether a long-press has opened the line bar (a range or not). */
  open: boolean
  clear: () => void
  lineProps: (lineNumber: number) => MobileCodeLineInteraction
  /** Changes whenever the rows have to redraw. */
  extraData: unknown
}

/**
 * Long-press a line to select it, tap another to extend (VS Code's Alt+K
 * parity), for the code viewer's rows. `canOpen` wires the long-press;
 * `canRange` whether lines can be ranged and highlighted: a pretty-printed
 * JSON file's numbers are not the file's, so the file tab opens its bar for
 * the whole file alone there. Native text selection is off while a
 * selection is open, so a tap extends it rather than arming the OS's.
 */
export function useCodeLineSelection({
  canOpen,
  canRange,
  resetKey
}: {
  canOpen: boolean
  canRange: boolean
  /** A new file: a selection made on one must not carry onto the next. */
  resetKey: string
}): CodeLineSelection {
  const { syntax } = useTheme()
  const [selection, setSelection] = useState<FileReaderLineSelection>(null)
  useEffect(() => {
    setSelection(null)
  }, [resetKey])
  // The code palette's own fill: every code colour and the selected line's
  // number read on it at 4.5:1 in both schemes (syntax-palette.ts).
  const highlightStyle = useMemo(() => ({ backgroundColor: syntax.selection }), [syntax.selection])
  const lineProps = useCallback(
    (lineNumber: number): MobileCodeLineInteraction => ({
      selectable: canOpen ? selection === null : undefined,
      highlighted: canRange && isFileReaderLineSelected(selection, lineNumber),
      highlightStyle,
      onLongPress: canOpen ? () => setSelection(startFileReaderLineSelection(lineNumber)) : undefined,
      onPress:
        canRange && selection
          ? () => setSelection(extendFileReaderLineSelection(selection, lineNumber))
          : undefined
    }),
    [canOpen, canRange, highlightStyle, selection]
  )
  const clear = useCallback(() => setSelection(null), [])
  return {
    range: canRange ? fileReaderLineSelectionRange(selection) : null,
    open: canOpen && selection !== null,
    clear,
    lineProps,
    extraData: selection
  }
}
