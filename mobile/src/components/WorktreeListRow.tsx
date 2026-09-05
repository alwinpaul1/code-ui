import { memo } from 'react'
import {
  Bell,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  Monitor,
  Server
} from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { parseExecutionHostId, type ExecutionHostId } from '../../../src/shared/execution-host'
import type { RepoIcon } from '../../../src/shared/repo-icon'
import type { AgentWorkingMode } from '../../../src/shared/agent-status-types'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { triggerMediumImpact } from '../platform/haptics'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { AgentSpinner } from './AgentSpinner'
import { MobileRepoIcon } from './MobileRepoIcon'
import { WorktreeAgentList } from './WorktreeAgentList'
import { WorktreeMetaGlyphs, prStateColor } from './WorktreeMetaGlyphs'

// Strip the refs/heads/ prefix for display, matching the desktop sidebar
// (WorktreeCardHelpers.formatBranchName).
function displayBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

// Minimal row shape needed for rendering — a structural subset of the screen's
// Worktree so this component stays decoupled from the screen's local type.
export type WorktreeListRowItem = {
  workspaceKind?: 'git' | 'folder-workspace'
  worktreeId: string
  hostId?: ExecutionHostId
  /** Present only when the list spans hosts; names the host this row runs on. */
  hostContextLabel?: string
  /** Resolved host for the display label; present when legacy rows omit hostId. */
  hostContextHostId?: ExecutionHostId
  repo: string
  branch: string
  displayName: string
  path?: string
  liveTerminalCount: number
  preview: string
  unread: boolean
  isActive?: boolean
  linkedPR: { number: number; state: string } | null
  linkedIssue?: number | null
  linkedLinearIssue?: string | null
  linkedGitLabMR?: number | null
  linkedGitLabIssue?: number | null
  comment?: string
  lineageDepth?: number
  lineageChildCount?: number
  lineageCollapsed?: boolean
  agents?: RuntimeWorktreeAgentRow[]
  workingMode?: AgentWorkingMode
}

type WorktreeRollupStatus = 'working' | 'active' | 'permission' | 'done' | 'inactive'

type Props<T extends WorktreeListRowItem> = {
  item: T
  isReadOnly: boolean
  now: number
  repoColor: string
  repoIcon?: RepoIcon | null
  // When the list is already grouped under this repo's section header, the row
  // omits its own repo icon+name to avoid the redundant "📁 orca" on every row.
  hideRepo?: boolean
  status: WorktreeRollupStatus
  onPress: (item: T) => void
  onLongPress?: (item: T) => void
  onToggleLineage?: (item: T) => void
}

function Badge({ children }: { children: React.ReactNode }) {
  const { colors, radius, space } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: colors.bgRaised,
        paddingHorizontal: space.xs + 2,
        paddingVertical: 1,
        borderRadius: radius.xs
      }}
    >
      {children}
    </View>
  )
}

function WorktreeListRowComponent<T extends WorktreeListRowItem>({
  item,
  isReadOnly,
  now,
  repoColor,
  repoIcon,
  hideRepo = false,
  status,
  onPress,
  onLongPress,
  onToggleLineage
}: Props<T>) {
  const { colors, fonts, radius, space } = useTheme()
  const isFolderWorkspace = item.workspaceKind === 'folder-workspace'
  const folderMeta = item.comment?.trim() || item.path || 'Folder'
  const metaText = isFolderWorkspace ? folderMeta : displayBranch(item.branch)
  const lineageDepth = Math.max(0, item.lineageDepth ?? 0)
  const lineageChildCount = item.lineageChildCount ?? 0

  return (
    <Pressable
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: space.md,
        paddingLeft: space.lg + lineageDepth * 18,
        paddingRight: space.lg,
        // Reserve the active accent bar width so active/inactive rows align.
        borderLeftWidth: 3,
        borderLeftColor: item.isActive ? colors.accent : 'transparent',
        backgroundColor: pressed
          ? colors.bgRaised
          : item.isActive
            ? colors.bgPanel
            : 'transparent',
        opacity: isReadOnly ? 0.6 : 1
      })}
      disabled={isReadOnly}
      onPress={() => onPress(item)}
      onLongPress={
        onLongPress
          ? () => {
              triggerMediumImpact()
              onLongPress(item)
            }
          : undefined
      }
      delayLongPress={400}
    >
      <View
        style={{
          width: 20,
          alignItems: 'center',
          paddingTop: 5,
          marginRight: space.sm,
          gap: 4
        }}
      >
        <AgentSpinner status={status} workingMode={item.workingMode} />
        {item.unread && (
          <Bell size={10} color={colors.warning} fill={colors.warning} style={{ marginTop: 2 }} />
        )}
      </View>

      <View style={{ flex: 1, marginRight: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Txt
            variant="body"
            weight={item.unread ? 'bold' : 'semibold'}
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {item.displayName || item.repo}
          </Txt>
          {item.linkedPR && (
            <Badge>
              <GitPullRequest size={10} color={prStateColor(item.linkedPR.state)} />
              <Txt variant="caption" style={{ color: prStateColor(item.linkedPR.state) }}>
                #{item.linkedPR.number}
              </Txt>
            </Badge>
          )}
          {isFolderWorkspace && (
            <Badge>
              <Txt variant="caption" tone="secondary">
                Folder
              </Txt>
            </Badge>
          )}
          <WorktreeMetaGlyphs
            comment={item.comment}
            linkedLinearIssue={item.linkedLinearIssue}
            linkedGitLabMR={item.linkedGitLabMR}
            linkedIssue={item.linkedIssue}
            linkedGitLabIssue={item.linkedGitLabIssue}
          />
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: space.xs + 2 }}
        >
          {lineageDepth > 0 && (
            <Badge>
              <GitBranch size={10} color={colors.textMuted} />
              <Txt variant="caption" tone="muted">
                Child
              </Txt>
            </Badge>
          )}
          {item.hostContextLabel ? (
            <View style={{ flexShrink: 1, maxWidth: 140 }}>
              <Badge>
                {/* Rows from hosts that predate hostId stamping are local: a remote row always carries one. */}
                {(parseExecutionHostId(item.hostContextHostId ?? item.hostId)?.kind ?? 'local') ===
                'local' ? (
                  <Monitor size={10} color={colors.textMuted} />
                ) : (
                  <Server size={10} color={colors.textMuted} />
                )}
                <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {item.hostContextLabel}
                </Txt>
              </Badge>
            </View>
          ) : null}
          {/* Repo glyph+name only when not already grouped under this repo;
              MobileRepoIcon falls back to a Folder (matching desktop's default)
              rather than a bare colored dot. */}
          {!hideRepo && (
            <>
              <MobileRepoIcon repoIcon={repoIcon} size={11} color={repoColor} />
              <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ maxWidth: 110 }}>
                {item.repo}
              </Txt>
            </>
          )}
          <Txt
            variant="caption"
            tone="muted"
            numberOfLines={1}
            style={{ fontFamily: fonts.mono, flexShrink: 1 }}
          >
            {metaText}
          </Txt>
        </View>
        {/* Only agents get a secondary activity line, matching desktop. A plain
            terminal's shell-output tail is intentionally not surfaced here. */}
        {item.agents && item.agents.length > 0 ? (
          <WorktreeAgentList agents={item.agents} now={now} unvisited={item.unread} />
        ) : null}
        {lineageChildCount > 0 && onToggleLineage ? (
          <Pressable
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginTop: space.xs + 2,
              backgroundColor: colors.bgRaised,
              paddingHorizontal: space.sm,
              paddingVertical: 4,
              borderRadius: radius.xs
            }}
            onPress={(event) => {
              event.stopPropagation()
              onToggleLineage(item)
            }}
          >
            {item.lineageCollapsed ? (
              <ChevronRight size={12} color={colors.textSecondary} />
            ) : (
              <ChevronDown size={12} color={colors.textSecondary} />
            )}
            <GitBranch size={12} color={colors.textSecondary} />
            <Txt variant="caption" weight="semibold" tone="secondary">
              {lineageChildCount} {lineageChildCount === 1 ? 'child' : 'children'}
            </Txt>
          </Pressable>
        ) : null}
      </View>

      {item.liveTerminalCount > 0 && (
        <View
          style={{
            minWidth: 22,
            height: 22,
            paddingHorizontal: 6,
            borderRadius: 11,
            backgroundColor: colors.bgRaised,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1
          }}
        >
          <Txt variant="caption" weight="semibold" tone="secondary">
            {item.liveTerminalCount}
          </Txt>
        </View>
      )}
    </Pressable>
  )
}

export const WorktreeListRow = memo(WorktreeListRowComponent) as typeof WorktreeListRowComponent
