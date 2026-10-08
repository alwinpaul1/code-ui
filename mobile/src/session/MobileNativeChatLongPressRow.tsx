import type { ReactNode } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'

/** A transcript row that answers a long press (Orca #22871's `Content`): on
 *  Android, where the transcript has no inline selection, the hold opens the
 *  message's actions sheet. Without a handler it stays a plain View, so
 *  platforms with inline selection keep their existing responder hierarchy. */
export function MobileNativeChatLongPressRow({
  onLongPress,
  style,
  testID,
  children
}: {
  onLongPress?: () => void
  style?: StyleProp<ViewStyle>
  testID?: string
  children: ReactNode
}): React.JSX.Element {
  return onLongPress ? (
    // Not accessible: a Pressable is by default, which would fold the whole
    // row into one TalkBack node; the plain View it replaces was not (review,
    // 2026-10-08).
    <Pressable onLongPress={onLongPress} style={style} testID={testID} accessible={false}>
      {children}
    </Pressable>
  ) : (
    <View style={style} testID={testID}>
      {children}
    </View>
  )
}
