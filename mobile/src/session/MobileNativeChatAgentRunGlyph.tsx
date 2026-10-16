import Svg, { Path } from 'react-native-svg'
import type { AgentRunIcon } from './mobile-native-chat-agent-run'
import { TOOL_RUN_ROW } from './claude-tool-run-row-spec'

// The Claude app's own outlines, from its icon font (com.anthropic.claude 1.261013.20,
// assets/cds_icon_symbols.ttf, 1000 units to the em, read with fontTools 2026-10-16). Both are
// symmetric about y = 500, so the font's y-up outline draws the same in SVG's y-down box.
const OUTLINES: Record<AgentRunIcon, string> = {
  // agentSimple, U+E11B: one diamond.
  agent:
    'M255 480Q247 488 247 500Q247 512 255 520L480 745Q488 753 500 753Q512 753 520 745L745 520Q753 512 753 500Q753 488 745 480L520 255Q512 247 500 247Q488 247 480 255ZM295 520 520 295Q512 303 500 303Q488 303 480 295L705 520Q697 512 697 500Q697 488 705 480L480 705Q488 697 500 697Q512 697 520 705L295 480Q303 488 303 500Q303 512 295 520Z',
  // agentsSimple, U+E11C: two linked diamonds.
  agents:
    'M380 795Q388 803 400 803Q412 803 420 795L695 520Q703 512 703 500Q703 488 695 480L420 205Q412 197 400 197Q388 197 380 205L105 480Q97 488 97 500Q97 512 105 520ZM420 755 145 480Q153 488 153 500Q153 512 145 520L420 245Q412 253 400 253Q388 253 380 245L655 520Q647 512 647 500Q647 488 655 480L380 755Q388 747 400 747Q412 747 420 755ZM480 305 520 345 600 265 835 500 600 735 520 655 480 695 580 795Q588 803 600 803Q612 803 620 795L895 520Q903 512 903 500Q903 488 895 480L620 205Q612 197 600 197Q588 197 580 205Z'
}

/** The leading icon of a running agent row: one diamond for one agent, two for several. The
 *  whole em in the app's 24 dp icon box, moved 2 left without moving the words, as i430.c draws
 *  it (claude-tool-run-row-spec.ts). */
export function AgentRunGlyph({ icon, color }: { icon: AgentRunIcon; color: string }) {
  const size = TOOL_RUN_ROW.leadingIconSize
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      style={{ transform: [{ translateX: TOOL_RUN_ROW.leadingIconNudge }] }}
      testID={`agent-run-glyph-${icon}`}
    >
      <Path d={OUTLINES[icon]} fill={color} />
    </Svg>
  )
}
