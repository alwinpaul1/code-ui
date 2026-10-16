import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { ClaudeArtifactsGlyph } from './ClaudeArtifactsGlyph'
import { refreshClaudeArtifactList, useClaudeArtifactAccountLabel, useClaudeArtifactList } from './claude-artifact-list-store'
import { MobileSheetTitleBar } from './MobileSheetTitleBar'
import { openClaudeArtifact } from './open-claude-artifact'
import { sessionArtifactRows, type ArtifactSheetRow, type SessionArtifact } from './session-artifacts'

/** The sheet's title (m74.java:179-190, "Artifacts"). */
export const SESSION_ARTIFACTS_TITLE = 'Artifacts'
/** What the account line says when the tab's account cannot be told (several signed in, none
 *  matched to this session): unknown, never a guess. */
export const SESSION_ARTIFACTS_ACCOUNT_UNKNOWN = 'Account not known'

/**
 * The session's Artifacts sheet, opened from the session bar's artifacts button as the Claude app
 * opens its own (ns30.java:610-660 → m74.java:179-190): a close cross, "Artifacts", and one card
 * per page this session published, subtitled "Artifact · claude.ai" (ds8.java:169). Tapping one
 * closes the sheet and opens the page in the viewer (open-claude-artifact.ts).
 *
 * Only the session's own pages, as in the app; the account's others are the gallery's (reported
 * 2026-10-16: a session that had made none listed all 8 of the account's). Above them, the account
 * the session belongs to, by name, or "Account not known" when it cannot be told.
 *
 * The account's list (claude-artifact-list-store.ts) is read every time the sheet opens, for the
 * pages' real titles only; when it cannot be read the rows keep the titles their calls stated.
 * `accountId` null: no list is read.
 *
 * Not keyed to the relay's reconnects (stale-after-reconnect.ts): the list comes from claude.ai over
 * the phone's own network, not through the desktop, so a relay coming up says nothing about it.
 */
export function MobileSessionArtifactsSheet({
  visible,
  onClose,
  artifacts,
  accountId
}: {
  visible: boolean
  onClose: () => void
  artifacts: readonly SessionArtifact[]
  accountId: string | null
}) {
  const { space } = useTheme()
  const list = useClaudeArtifactList(accountId)
  const accountLabel = useClaudeArtifactAccountLabel(accountId)
  useEffect(() => {
    if (visible && accountId) {
      void refreshClaudeArtifactList(accountId, { force: true })
    }
  }, [visible, accountId])
  const rows = sessionArtifactRows(artifacts, accountId ? list.items : [])
  const open = (row: ArtifactSheetRow) => {
    onClose()
    openClaudeArtifact({ url: row.url, title: row.title })
  }
  const accountLine = accountId === null ? SESSION_ARTIFACTS_ACCOUNT_UNKNOWN : accountLabel === null ? null : `Account: ${accountLabel}`
  return (
    <BottomDrawer
      visible={visible}
      onClose={onClose}
      dragContentToDismiss
      expandable
      header={<MobileSheetTitleBar title={SESSION_ARTIFACTS_TITLE} onClose={onClose} />}
    >
      <View testID="session-artifacts-sheet" style={{ paddingBottom: 16 }}>
        {accountLine !== null ? (
          <View testID="artifacts-account" style={{ marginBottom: space.sm }}>
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {accountLine}
            </Txt>
          </View>
        ) : null}
        <Section testID="artifacts-section-session" label="This session" rows={rows} onOpen={open} />
      </View>
    </BottomDrawer>
  )
}

function Section({
  testID,
  label,
  rows,
  onOpen
}: {
  testID: string
  label: string
  rows: readonly ArtifactSheetRow[]
  onOpen: (row: ArtifactSheetRow) => void
}) {
  const { space } = useTheme()
  if (rows.length === 0) {
    return null
  }
  return (
    <View testID={testID} style={{ gap: space.sm, marginBottom: space.md }}>
      <Txt variant="label" weight="semibold" tone="secondary">
        {`${label} (${rows.length})`}
      </Txt>
      {rows.map((row) => (
        <ArtifactRow key={row.uuid} row={row} onPress={() => onOpen(row)} />
      ))}
    </View>
  )
}

/**
 * One page, as a card: the violet artifacts glyph on a tile, the title, the subtitle. Drawn here
 * rather than with the chat's Artifact card (MobileNativeChatArtifactCard.tsx), which is a
 * published call's card with its own states; this row is only ever a page to open. The Outputs
 * sheet (MobileSessionOutputsSheet.tsx) lists its artifacts with the same card.
 */
export function ArtifactRow({ row, onPress, testID }: { row: ArtifactSheetRow; onPress: () => void; testID?: string }) {
  const { colors, space, radius } = useTheme()
  return (
    <Pressable
      testID={testID ?? `artifact-row-${row.uuid}`}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.subtitle}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgSunken : colors.bgRaised
      })}
    >
      <View
        testID="artifact-row-tile"
        style={{ width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPanel }}
      >
        <ClaudeArtifactsGlyph size={22} color={colors.mergedPurple} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="body" weight="semibold" numberOfLines={1}>
          {row.title}
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {row.subtitle}
        </Txt>
      </View>
    </Pressable>
  )
}
