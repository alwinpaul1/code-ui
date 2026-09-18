import { View } from 'react-native'
import { useThemedStyles, type Theme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/**
 * The one line a project-config screen (MCP servers, permission rules,
 * project memory) shows in place of its editing controls when the host's
 * mobile-scope RPC gate refuses `files.write` — which Orca 1.4.205 does for
 * every phone (see transport/host-mobile-capabilities.ts). The screen stays a
 * viewer: no add, no edit, no remove, no Save. Creating a missing file still
 * works, because `files.createFile` is on the list.
 *
 * Painted from the live theme through `Txt` and `useThemedStyles`, never a
 * literal colour, so it reads in light and in dark.
 */
export const PROJECT_CONFIG_READ_ONLY_NOTICE = 'Read-only from the phone on this Orca version.'

export function ProjectConfigReadOnlyNotice() {
  const styles = useThemedStyles(noticeStyles)
  return (
    <View style={styles.footer}>
      <Txt variant="caption" tone="secondary">
        {PROJECT_CONFIG_READ_ONLY_NOTICE}
      </Txt>
    </View>
  )
}

function noticeStyles({ colors, space }: Theme) {
  return {
    footer: { padding: space.md, borderTopWidth: 1, borderTopColor: colors.border }
  }
}
