import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { AgentImageShareContext, type AgentImageShare } from './agent-image-share-context'

/** The chat overlay's box, giving its rows what a refused picture's
 *  placeholder needs to ask the agent for it (agent-image-share-ask.ts). */
export function AgentImageShareView({
  share,
  style,
  children
}: {
  share: AgentImageShare | null
  style: StyleProp<ViewStyle>
  children: ReactNode
}) {
  return (
    <AgentImageShareContext.Provider value={share}>
      {/* Its own native view on Android, always: a View with no stacking context is flattened, and
          the chat's ground and every view drawn on it went loose into the terminal frame beside the
          terminal's own views, so a mount move there could put the terminal's navy between the
          ground and the words (0.9.146, chat-ground-not-under-terminal.test.tsx). */}
      <View style={style} collapsable={false}>
        {children}
      </View>
    </AgentImageShareContext.Provider>
  )
}
