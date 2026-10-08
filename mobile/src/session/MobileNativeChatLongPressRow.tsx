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
    <Pressable onLongPress={onLongPress} style={style} testID={testID}>
      {children}
    </Pressable>
  ) : (
    <View style={style} testID={testID}>
      {children}
    </View>
  )
}
