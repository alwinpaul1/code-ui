import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { Plus, Terminal as TerminalIcon, Trash2 } from 'lucide-react-native'
import { useHostClient } from '../../transport/client-context'
import { useHostMobileCapabilityVerdict } from '../../transport/host-mobile-capabilities'
import { useTheme, useThemedStyles, type Theme } from '../../theme/theme-context'
import { Txt } from '../../ui/Txt'
import { Button } from '../../ui/Button'
import { ConfirmModal } from '../../components/ConfirmModal'
import { ProjectConfigScreenChrome } from '../ProjectConfigScreenChrome'
import { ProjectConfigReadOnlyNotice } from '../ProjectConfigReadOnlyNotice'
import { useProjectConfigFile } from '../use-project-config-file'
import { MCP_CONFIG_RELATIVE_PATH } from '../project-config-paths'
import { maskedMcpServerEnvLines, parseMcpConfig, serializeMcpConfig, type McpServerEntry } from './mcp-config-parse'
import {
  EMPTY_MCP_SERVER_FORM,
  mcpServerEntryFromForm,
  mcpServerFormForEntry,
  type McpServerFormState
} from './mcp-server-form-fields'
import { McpServerForm } from './McpServerForm'
import { canShowMcpStatusOverlay, MCP_STATUS_NOT_SENT, openMcpStatusOverlayUnlessDialog } from './mcp-status-overlay'
import { mcpStatusSessionTabsRead } from './mcp-status-overlay-operations'
import { findMcpStatusTerminalCandidate, type McpStatusTerminalCandidate } from './mcp-status-terminal-lookup'

type EditingState = { mode: 'add' } | { mode: 'edit'; index: number }

export function MobileMcpServersPanel({
  hostId,
  worktreeId,
  name = ''
}: {
  hostId: string
  worktreeId: string
  name?: string
}) {
  const { client, state: connState } = useHostClient(hostId)
  // Whether this host lets a phone call files.write at all. Until it has
  // answered, neither Save nor the read-only line is drawn; once it refuses
  // the screen is a viewer — no add, edit, remove or Save — and one line
  // says so. Create stays — files.createFile is on the host's mobile list.
  const writeVerdict = useHostMobileCapabilityVerdict(hostId, 'files.write')
  const canWrite = writeVerdict === 'allowed'
  const { state, setContent, refresh, save, create } = useProjectConfigFile({
    client,
    worktreeId,
    relativePath: MCP_CONFIG_RELATIVE_PATH
  })
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [form, setForm] = useState<McpServerFormState>(EMPTY_MCP_SERVER_FORM)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  const [statusCandidate, setStatusCandidate] = useState<McpStatusTerminalCandidate | null>(null)
  // Show status looks at the terminal before it types (up to 2 s), and says
  // here, under the button, why nothing was typed.
  const [statusLooking, setStatusLooking] = useState(false)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)

  // One-shot, best-effort lookup for the optional "Show status in terminal"
  // button — see mcp-status-terminal-lookup.ts. Not a live subscription: a
  // turn that starts while this screen stays open can leave the button stale.
  useEffect(() => {
    if (!client || connState !== 'connected') {
      return
    }
    let cancelled = false
    void mcpStatusSessionTabsRead
      .request(client, { worktree: `id:${worktreeId}` })
      .then((response) => {
        if (cancelled) {
          return
        }
        const result = mcpStatusSessionTabsRead.interpret(response)
        setStatusCandidate(findMcpStatusTerminalCandidate(result))
        // A refusal was about the terminal the last lookup offered; it goes
        // with that lookup, and never outlives the button it was drawn under.
        setStatusNotice(null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, connState, worktreeId])

  const styles = useThemedStyles(mcpStyles)
  const { colors } = useTheme()
  const parsed = state.status === 'ready' ? parseMcpConfig(state.content) : null
  // The write carries the list as it was at the tap; no add, edit or remove until it lands.
  const saving = state.status === 'ready' && state.saving

  function commit(servers: McpServerEntry[]) {
    setContent(serializeMcpConfig(servers))
    setEditing(null)
  }

  function submitForm() {
    if (!parsed?.ok) {
      return
    }
    const entry = mcpServerEntryFromForm(form)
    if (!entry) {
      return
    }
    const servers = [...parsed.servers]
    if (editing?.mode === 'edit') {
      servers[editing.index] = entry
    } else {
      servers.push(entry)
    }
    commit(servers)
  }

  function confirmRemove() {
    if (removeIndex === null || !parsed?.ok) {
      return
    }
    const servers = parsed.servers.filter((_, i) => i !== removeIndex)
    setRemoveIndex(null)
    commit(servers)
  }

  const showStatusButton =
    statusCandidate !== null &&
    canShowMcpStatusOverlay({ agent: statusCandidate.agent, status: statusCandidate.status, structured: false })

  async function showStatus(terminal: string) {
    if (!client) {
      return
    }
    setStatusLooking(true)
    setStatusNotice(null)
    const { opened, refusal } = await openMcpStatusOverlayUnlessDialog({ client, terminal, deviceToken: null })
    setStatusLooking(false)
    setStatusNotice(refusal ?? (opened ? null : MCP_STATUS_NOT_SENT))
  }

  const statusNoticeCaption = statusNotice ? (
    <Txt tone="danger" variant="caption" style={{ marginBottom: 8 }}>
      {statusNotice}
    </Txt>
  ) : null

  return (
    <ProjectConfigScreenChrome title="MCP Servers" subtitle={name || undefined}>
      {state.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : state.status === 'missing' ? (
        <View style={styles.center}>
          <Txt tone="secondary" align="center" style={styles.centerText}>
            No .mcp.json in this worktree yet.
          </Txt>
          <Button label="Create .mcp.json" onPress={() => void create()} style={{ marginTop: 12 }} />
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
            {parsed.servers.length === 0 ? (
              <Txt tone="secondary" align="center" style={styles.emptyText}>
                No MCP servers configured.
              </Txt>
            ) : (
              parsed.servers.map((entry, index) => (
                <Pressable
                  key={entry.name}
                  style={[styles.row, saving && styles.disabled]}
                  disabled={!canWrite || saving}
                  onPress={() => {
                    setForm(mcpServerFormForEntry(entry))
                    setEditing({ mode: 'edit', index })
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold">{entry.name}</Txt>
                    <Txt variant="caption" tone="secondary">
                      {entry.config.kind === 'remote' ? entry.config.url : entry.config.command}
                    </Txt>
                    {maskedMcpServerEnvLines(entry.config).map((line) => (
                      <Txt key={line} variant="caption" tone="muted">
                        {line}
                      </Txt>
                    ))}
                  </View>
                  {canWrite ? (
                    <Pressable
                      accessibilityLabel={`Remove ${entry.name}`}
                      onPress={() => setRemoveIndex(index)}
                      disabled={saving}
                      style={saving ? styles.disabled : undefined}
                      hitSlop={8}
                    >
                      <Trash2 size={16} color={colors.danger} />
                    </Pressable>
                  ) : null}
                </Pressable>
              ))
            )}
          </ScrollView>

          {!canWrite ? (
            <>
              {showStatusButton && statusCandidate ? (
                <View style={styles.footer}>
                  {statusNoticeCaption}
                  <Button
                    label="Show status"
                    icon={TerminalIcon}
                    variant="secondary"
                    loading={statusLooking}
                    onPress={() => void showStatus(statusCandidate.terminal)}
                  />
                </View>
              ) : null}
              {writeVerdict === 'forbidden' ? <ProjectConfigReadOnlyNotice /> : null}
            </>
          ) : editing ? (
            <McpServerForm form={form} onChange={setForm} onCancel={() => setEditing(null)} onSubmit={submitForm} />
          ) : (
            <View style={styles.footer}>
              {state.saveError ? (
                <Txt tone="danger" variant="caption" style={{ marginBottom: 8 }}>
                  {state.saveError}
                </Txt>
              ) : null}
              {statusNoticeCaption}
              <View style={styles.footerRow}>
                <Button
                  label="Add server"
                  icon={Plus}
                  variant="secondary"
                  disabled={saving}
                  onPress={() => {
                    setForm(EMPTY_MCP_SERVER_FORM)
                    setEditing({ mode: 'add' })
                  }}
                  style={{ flex: 1 }}
                />
                {showStatusButton && statusCandidate ? (
                  <Button
                    label="Show status"
                    icon={TerminalIcon}
                    variant="secondary"
                    loading={statusLooking}
                    onPress={() => void showStatus(statusCandidate.terminal)}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
              <Button
                label={state.saving ? 'Saving…' : 'Save'}
                onPress={() => void save()}
                disabled={!state.isDirty || state.saving}
                loading={state.saving}
                block
                style={{ marginTop: 8 }}
              />
            </View>
          )}
        </>
      )}
      <ConfirmModal
        visible={removeIndex !== null}
        title="Remove server"
        message={removeIndex !== null && parsed?.ok ? `Remove "${parsed.servers[removeIndex]?.name}"?` : undefined}
        confirmLabel="Remove"
        destructive
        onConfirm={confirmRemove}
        onCancel={() => setRemoveIndex(null)}
      />
    </ProjectConfigScreenChrome>
  )
}

function mcpStyles({ colors, radius, space }: Theme) {
  return {
    center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: space.lg },
    centerText: { maxWidth: 280 },
    list: { padding: space.md, gap: space.sm },
    emptyText: { marginTop: space.xl },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: space.sm,
      padding: space.md,
      borderRadius: radius.md,
      backgroundColor: colors.bgPanel,
      borderWidth: 1,
      borderColor: colors.border
    },
    footer: { padding: space.md, borderTopWidth: 1, borderTopColor: colors.border },
    footerRow: { flexDirection: 'row' as const, gap: space.sm },
    // The same dim as a disabled Button, over the theme's own colours.
    disabled: { opacity: 0.5 }
  }
}
