import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { useHostClient } from '../../transport/client-context'
import { useHostMobileCapabilityVerdict } from '../../transport/host-mobile-capabilities'
import { useTheme, useThemedStyles, type Theme } from '../../theme/theme-context'
import { Txt } from '../../ui/Txt'
import { Button } from '../../ui/Button'
import { TextInputModal } from '../../components/TextInputModal'
import { ProjectConfigScreenChrome } from '../ProjectConfigScreenChrome'
import { ProjectConfigReadOnlyNotice } from '../ProjectConfigReadOnlyNotice'
import { useProjectConfigFile } from '../use-project-config-file'
import { PERMISSION_SETTINGS_RELATIVE_PATH, type PermissionRuleDestination } from '../project-config-paths'
import {
  PERMISSION_RULE_CATEGORIES,
  parsePermissionSettings,
  serializePermissionSettings,
  withPermissionRuleAdded,
  withPermissionRuleRemoved,
  type PermissionRuleCategory
} from './permission-rules-parse'
import { PermissionRuleSection } from './PermissionRuleSection'

const DESTINATIONS: { value: PermissionRuleDestination; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'local', label: 'Local' }
]

/**
 * Whether an edit here takes effect without restarting the session — proven,
 * not assumed, against the Claude Code 2.1.276 CLI binary
 * (~/.local/share/claude/versions/2.1.276, `strings` search 2026-09-18):
 *
 *   - A live settings watcher exists (`ya.rehome()` / `ya.notifyChange
 *     ('projectSettings', …)` runs on every `/cd`, re-targeting the watcher
 *     at the new directory and notifying the permission/hook layer of the
 *     change) — so an EDIT to a settings file the session is already
 *     watching is picked up live.
 *   - But: "the settings watcher isn't watching `.claude/` — it only
 *     watches directories that had a settings file when this session
 *     started. [...] Tell the user to open `/hooks` once (reloads config)
 *     or restart" — a file that did not exist yet when the session opened
 *     needs `/hooks` or a restart before its rules apply, even once it can
 *     be written.
 *
 * On a host whose mobile gate refuses `files.write` (Orca 1.4.205; see
 * project-config-file-error.ts) the screen is read-only and no save can
 * land, so this note describes what WOULD happen on a host that allows it —
 * worded that way on screen.
 */
const LIVE_EFFECT_NOTE =
  'Claude Code re-reads an existing settings file live. A file that did not exist yet when the session started needs /hooks or a restart before its rules apply.'

export function MobilePermissionRulesPanel({
  hostId,
  worktreeId,
  name = ''
}: {
  hostId: string
  worktreeId: string
  name?: string
}) {
  const { client } = useHostClient(hostId)
  // Whether this host lets a phone call files.write at all. Until it has
  // answered, neither Save nor the read-only line is drawn; once it refuses
  // the screen is a viewer — no add, remove or Save — and one line says so.
  // Create stays — files.createFile is on the host's mobile list.
  const writeVerdict = useHostMobileCapabilityVerdict(hostId, 'files.write')
  const canWrite = writeVerdict === 'allowed'
  const [destination, setDestination] = useState<PermissionRuleDestination>('project')
  const { state, setContent, refresh, save, create } = useProjectConfigFile({
    client,
    worktreeId,
    relativePath: PERMISSION_SETTINGS_RELATIVE_PATH[destination]
  })
  const [addingTo, setAddingTo] = useState<PermissionRuleCategory | null>(null)

  const styles = useThemedStyles(rulesStyles)
  const { colors } = useTheme()
  const parsed = state.status === 'ready' ? parsePermissionSettings(state.content) : null

  function commit(settings: Record<string, unknown>) {
    setContent(serializePermissionSettings(settings))
  }

  function addRule(category: PermissionRuleCategory, rule: string) {
    if (!parsed?.ok) {
      return
    }
    commit(withPermissionRuleAdded(parsed.settings, category, rule))
  }

  function removeRule(category: PermissionRuleCategory, rule: string) {
    if (!parsed?.ok) {
      return
    }
    commit(withPermissionRuleRemoved(parsed.settings, category, rule))
  }

  return (
    <ProjectConfigScreenChrome title="Permission Rules" subtitle={name || undefined}>
      <View style={styles.destinationRow}>
        {DESTINATIONS.map((option) => {
          const selected = destination === option.value
          return (
            <Pressable
              key={option.value}
              style={[styles.destination, selected && styles.destinationActive]}
              onPress={() => setDestination(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Txt variant="caption" weight={selected ? 'semibold' : 'regular'}>
                {option.label}
              </Txt>
            </Pressable>
          )
        })}
      </View>
      <Txt variant="caption" tone="muted" style={styles.destinationHint}>
        {destination === 'project'
          ? '.claude/settings.json — checked in, shared with the team.'
          : '.claude/settings.local.json — not checked in, this machine only.'}
      </Txt>
      <Txt variant="caption" tone="muted" style={styles.destinationHint}>
        {LIVE_EFFECT_NOTE}
      </Txt>

      {state.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : state.status === 'missing' ? (
        <View style={styles.center}>
          <Txt tone="secondary" align="center" style={styles.centerText}>
            {destination === 'project' ? '.claude/settings.json' : '.claude/settings.local.json'} does not exist
            yet.
          </Txt>
          <Button label="Create" onPress={() => void create()} style={{ marginTop: 12 }} />
        </View>
      ) : state.status === 'too-large' ? (
        <View style={styles.center}>
          <Txt tone="secondary" align="center" style={styles.centerText}>
            File too large for mobile preview.
          </Txt>
        </View>
      ) : state.status === 'error' ? (
        <View style={styles.center}>
          <Txt tone="danger" align="center" style={styles.centerText}>
            {state.message}
          </Txt>
          <Button label="Retry" variant="secondary" onPress={() => void refresh()} style={{ marginTop: 12 }} />
        </View>
      ) : !parsed ? null : !parsed.ok ? (
        <View style={styles.center}>
          <Txt tone="danger" align="center" style={styles.centerText}>
            {parsed.error.line ? `Line ${parsed.error.line}: ${parsed.error.message}` : parsed.error.message}
          </Txt>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            {PERMISSION_RULE_CATEGORIES.map((category) => (
              <PermissionRuleSection
                key={category}
                category={category}
                rules={parsed.rules[category]}
                readOnly={!canWrite}
                onAdd={() => setAddingTo(category)}
                onRemove={(rule) => removeRule(category, rule)}
              />
            ))}
          </ScrollView>
          {writeVerdict === 'forbidden' ? (
            <ProjectConfigReadOnlyNotice />
          ) : canWrite ? (
            <View style={styles.footer}>
              {state.saveError ? (
                <Txt tone="danger" variant="caption" style={{ marginBottom: 8 }}>
                  {state.saveError}
                </Txt>
              ) : null}
              <Button
                label={state.saving ? 'Saving…' : 'Save'}
                onPress={() => void save()}
                disabled={!state.isDirty || state.saving}
                loading={state.saving}
                block
              />
            </View>
          ) : null}
        </>
      )}

      {canWrite ? (
        <TextInputModal
          visible={addingTo !== null}
          title={addingTo ? `Add an ${addingTo} rule` : 'Add rule'}
          message="e.g. Bash(npm run *), Edit, Read(./src/**)"
          placeholder="Bash(npm run *)"
          onSubmit={(value) => {
            if (addingTo) {
              addRule(addingTo, value)
            }
            setAddingTo(null)
          }}
          onCancel={() => setAddingTo(null)}
        />
      ) : null}
    </ProjectConfigScreenChrome>
  )
}

function rulesStyles({ colors, radius, space }: Theme) {
  return {
    destinationRow: {
      flexDirection: 'row' as const,
      gap: space.xs,
      paddingHorizontal: space.md,
      marginBottom: space.xs
    },
    destination: {
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel
    },
    destinationActive: { backgroundColor: colors.bgRaised },
    destinationHint: { paddingHorizontal: space.md, marginBottom: space.sm },
    center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: space.lg },
    centerText: { maxWidth: 280 },
    list: { padding: space.md },
    footer: { padding: space.md, borderTopWidth: 1, borderTopColor: colors.border }
  }
}
