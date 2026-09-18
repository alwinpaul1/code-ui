import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { ChevronRight, FileText } from 'lucide-react-native'
import { useHostClient } from '../../transport/client-context'
import { useTheme, useThemedStyles, type Theme } from '../../theme/theme-context'
import { Txt } from '../../ui/Txt'
import { Button } from '../../ui/Button'
import { ProjectConfigScreenChrome } from '../ProjectConfigScreenChrome'
import { useProjectConfigFile } from '../use-project-config-file'
import { PROJECT_MEMORY_RELATIVE_PATHS, type ProjectMemoryRelativePath } from '../project-config-paths'
import { describeProjectMemorySummary, summarizeProjectMemoryFile } from './project-memory-file-summary'

/** Auto-memory (the desktop's own remembered-facts store) and the user's own
 *  ~/.claude/CLAUDE.md are outside the worktree jail — unreachable from the
 *  phone by the same rule every screen here follows, stated once here since
 *  this is the screen whose extension counterpart (the memory dialog) shows
 *  both scopes side by side. */
const OUT_OF_REACH_NOTE = 'Auto-memory and your personal ~/.claude/CLAUDE.md live outside the worktree and are not reachable from the phone.'

export function MobileProjectMemoryPanel({
  hostId,
  worktreeId,
  name = ''
}: {
  hostId: string
  worktreeId: string
  name?: string
}) {
  const { client } = useHostClient(hostId)
  // Three fixed candidates, three fixed hook calls — not dynamic, so this
  // does not break the rules of hooks. Reading all three up front, off one
  // shared client, is what lets the chooser say which exist before the user
  // picks one.
  const files: Record<ProjectMemoryRelativePath, ReturnType<typeof useProjectConfigFile>> = {
    'CLAUDE.md': useProjectConfigFile({ client, worktreeId, relativePath: 'CLAUDE.md' }),
    '.claude/CLAUDE.md': useProjectConfigFile({ client, worktreeId, relativePath: '.claude/CLAUDE.md' }),
    'CLAUDE.local.md': useProjectConfigFile({ client, worktreeId, relativePath: 'CLAUDE.local.md' })
  }
  const [selected, setSelected] = useState<ProjectMemoryRelativePath | null>(null)
  const styles = useThemedStyles(memoryStyles)
  const { colors } = useTheme()

  if (selected) {
    return (
      <ProjectMemoryEditor
        relativePath={selected}
        file={files[selected]}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <ProjectConfigScreenChrome title="Project Memory" subtitle={name || undefined}>
      <Txt variant="caption" tone="muted" style={styles.outOfReach}>
        {OUT_OF_REACH_NOTE}
      </Txt>
      <ScrollView contentContainerStyle={styles.list}>
        {PROJECT_MEMORY_RELATIVE_PATHS.map((relativePath) => {
          const summary = summarizeProjectMemoryFile(relativePath, files[relativePath].state)
          return (
            <Pressable key={relativePath} style={styles.row} onPress={() => setSelected(relativePath)}>
              <FileText size={16} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Txt weight="semibold">{relativePath}</Txt>
                <Txt variant="caption" tone="secondary">
                  {describeProjectMemorySummary(summary)}
                </Txt>
              </View>
              <ChevronRight size={16} color={colors.textMuted} />
            </Pressable>
          )
        })}
      </ScrollView>
    </ProjectConfigScreenChrome>
  )
}

function ProjectMemoryEditor({
  relativePath,
  file,
  onBack
}: {
  relativePath: ProjectMemoryRelativePath
  file: ReturnType<typeof useProjectConfigFile>
  onBack: () => void
}) {
  const { state, setContent, refresh, save, create } = file
  const styles = useThemedStyles(memoryStyles)
  const { colors } = useTheme()
  return (
    <ProjectConfigScreenChrome title={relativePath} subtitle="Project Memory">
      <Pressable onPress={onBack} style={styles.backRow}>
        <Txt variant="caption" tone="accent">
          ← All memory files
        </Txt>
      </Pressable>
      {state.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : state.status === 'missing' ? (
        <View style={styles.center}>
          <Txt tone="secondary" align="center" style={styles.centerText}>
            {relativePath} does not exist yet.
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
      ) : (
        <>
          <TextInput
            style={styles.editor}
            value={state.content}
            onChangeText={setContent}
            multiline
            placeholder="This file is empty."
            placeholderTextColor={colors.textMuted}
            textAlignVertical="top"
            editable={!state.saving}
          />
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
        </>
      )}
    </ProjectConfigScreenChrome>
  )
}

function memoryStyles({ colors, radius, space }: Theme) {
  return {
    outOfReach: { paddingHorizontal: space.md, marginBottom: space.sm },
    list: { padding: space.md, gap: space.sm },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: space.sm,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border
    },
    backRow: { padding: space.md },
    center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: space.lg },
    centerText: { maxWidth: 280 },
    editor: {
      flex: 1,
      margin: space.md,
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgPanel,
      color: colors.text
    },
    footer: { padding: space.md, borderTopWidth: 1, borderTopColor: colors.border }
  }
}
