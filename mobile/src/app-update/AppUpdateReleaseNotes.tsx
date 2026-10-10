import { ShieldCheck, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'

import { MobileMarkdown } from '../components/MobileMarkdown'
import { useTheme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import { Txt } from '../ui/Txt'
import { hasReleaseNoteSections, type ReleaseNoteGroup, type ReleaseNoteSection } from './release-notes-groups'
import { UpdateScrollRegion } from './update-card-parts'

/** Prose at 14 on the renderer's 15 base: a step under the card's body text,
 *  so the notes read as detail under the version rather than competing with
 *  it. The renderer's line height follows from its own inline-chip invariant
 *  (mobile-markdown-prose-scale.ts), which is why the leading is not set here. */
export const RELEASE_NOTES_TEXT_SCALE = 14 / 15

/** Each section's marker: an icon and the theme colour it is drawn in. */
export const RELEASE_NOTE_SECTION_MARKERS: Record<
  ReleaseNoteSection,
  { icon: LucideIcon; ink: (colors: ThemeColors) => string; fill: (colors: ThemeColors) => string }
> = {
  Features: { icon: Sparkles, ink: (c) => c.accentText, fill: (c) => c.accentSoft },
  Improvements: { icon: TrendingUp, ink: (c) => c.info, fill: (c) => c.bgRaised },
  'Security & Bug Fixes': { icon: ShieldCheck, ink: (c) => c.success, fill: (c) => c.successSoft }
}

function SectionTitle({ section }: { section: ReleaseNoteSection }) {
  const { colors, space } = useTheme()
  const marker = RELEASE_NOTE_SECTION_MARKERS[section]
  const Icon = marker.icon
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 }}>
      <View
        testID={`release-notes-marker-${section}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: marker.fill(colors)
        }}
      >
        <Icon size={15} color={marker.ink(colors)} strokeWidth={2.2} />
      </View>
      <Txt variant="label" weight="semibold" accessibilityRole="header">
        {section}
      </Txt>
    </View>
  )
}

/**
 * The release's notes in the card's scroll region. Notes written in the
 * section format draw as groups, each under its section's marker; anything
 * else (an older GitHub-generated body) draws as one markdown column, as it
 * always has. The words go through the same markdown renderer the .md tab and
 * the chat use either way. `markdown` and `groups` are memoised by the caller
 * on the body text, so the renderer's per-source parse cache sees one string
 * per release, not one per render.
 */
export function AppUpdateReleaseNotes({
  markdown,
  groups
}: {
  markdown: string
  groups: readonly ReleaseNoteGroup[]
}) {
  const { space } = useTheme()
  const sectioned = hasReleaseNoteSections(groups)
  return (
    <UpdateScrollRegion>
      {sectioned ? (
        <View style={{ gap: space.xl }}>
          {groups.map((group, index) => (
            <View key={`${group.section ?? 'text'}:${index}`} style={{ gap: space.sm + 2 }}>
              {group.section ? <SectionTitle section={group.section} /> : null}
              <MobileMarkdown content={group.markdown} textScale={RELEASE_NOTES_TEXT_SCALE} />
            </View>
          ))}
        </View>
      ) : (
        <MobileMarkdown content={markdown} textScale={RELEASE_NOTES_TEXT_SCALE} />
      )}
    </UpdateScrollRegion>
  )
}
