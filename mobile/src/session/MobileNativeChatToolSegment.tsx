import type { ComponentProps } from 'react'
import { isAgentOnlyRun } from './mobile-native-chat-agent-run'
import { MobileNativeChatAgentRun } from './MobileNativeChatAgentRun'
import { ToolRun } from './MobileNativeChatToolRun'

/** One run of a turn's work: a run of nothing but Agent calls is the Claude
 *  app's "Running agent" row, anything else the ordinary tool run. */
export function MobileNativeChatToolSegment(props: ComponentProps<typeof ToolRun>) {
  if (isAgentOnlyRun(props.blocks)) {
    return <MobileNativeChatAgentRun blocks={props.blocks} trailing={props.trailing} styles={props.styles} />
  }
  return <ToolRun {...props} />
}
