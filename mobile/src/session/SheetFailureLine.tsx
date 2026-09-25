import type { TextStyle } from 'react-native'
import { Txt } from '../ui/Txt'

/** Why the last thing a chat sheet was asked to do did not go through, said in
 *  the sheet (use-sheet-failure.ts). The chat's send-failure banner draws under
 *  the sheet's window, so this is the only place it can be read while the
 *  sheet is open. Announced like that banner, and in the same danger tone. */
export function SheetFailureLine({
  children,
  style
}: {
  children: string
  style?: TextStyle
}): React.JSX.Element {
  return (
    <Txt
      variant="caption"
      weight="semibold"
      tone="danger"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={style}
    >
      {children}
    </Txt>
  )
}
