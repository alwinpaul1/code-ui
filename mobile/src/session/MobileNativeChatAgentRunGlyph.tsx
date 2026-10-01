import Svg, { Path } from 'react-native-svg'

/** Two linked diamonds, the Claude app's mark for a run of agents. */
export function AgentRunGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={14} viewBox="0 0 20 14" testID="agent-run-glyph">
      <Path d="M7 1 L13 7 L7 13 L1 7 Z M13 1 L19 7 L13 13 L7 7 Z" fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  )
}
