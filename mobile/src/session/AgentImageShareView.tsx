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
      <View style={style}>{children}</View>
    </AgentImageShareContext.Provider>
  )
}
