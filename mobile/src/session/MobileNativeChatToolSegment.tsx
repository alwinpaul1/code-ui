import type { ComponentProps } from 'react'
import { isAgentOnlyRun } from './mobile-native-chat-agent-run'
import { artifactSegmentView } from './mobile-native-chat-artifact-segment'
import { MobileNativeChatAgentRun } from './MobileNativeChatAgentRun'
import { MobileNativeChatArtifactSegment } from './MobileNativeChatArtifactCard'
import { ToolRun } from './MobileNativeChatToolRun'

/** One run of a turn's work: a run of nothing but Agent calls is the Claude
 *  app's "Running agent" row, an Artifact call that publishes or opens a page
 *  its card (a18.java), anything else the ordinary tool run. */
export function MobileNativeChatToolSegment(props: ComponentProps<typeof ToolRun>) {
  if (isAgentOnlyRun(props.blocks)) {
    return <MobileNativeChatAgentRun blocks={props.blocks} revertScope={props.revertScope} styles={props.styles} />
  }
  const artifact = artifactSegmentView(props.blocks)
  // A call with no answer is publishing only while it is the turn's live call. A transcript's calls
  // carry no lifecycle state, so one the turn never answered (Esc, a crash) would otherwise spin on
  // a settled turn for good (review 2026-10-16); it is drawn as the plain row it ended as.
  const stalled = artifact !== null && (artifact.kind === 'publishing' || artifact.kind === 'opening') && (!props.activeCall || props.activeCall !== props.blocks[0])
  if (artifact && !stalled) {
    return <MobileNativeChatArtifactSegment view={artifact} blocks={props.blocks} revertScope={props.revertScope} styles={props.styles} />
  }
  return <ToolRun {...props} />
}
