import type { ProjectConfigFileState } from '../use-project-config-file'
import type { ProjectMemoryRelativePath } from '../project-config-paths'

/** What the chooser row for one CLAUDE.md candidate shows, derived from its
 *  own `useProjectConfigFile` state — pure so the "which of the three exist,
 *  which need Create" decision is testable without rendering three hooks. */
export type ProjectMemorySummary =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'present'; byteLength: number; empty: boolean }

export function summarizeProjectMemoryFile(
  relativePath: ProjectMemoryRelativePath,
  state: ProjectConfigFileState
): ProjectMemorySummary {
  switch (state.status) {
    case 'loading':
      return { kind: 'loading' }
    case 'missing':
      return { kind: 'missing' }
    case 'too-large':
      return { kind: 'present', byteLength: state.byteLength, empty: false }
    case 'error':
      return { kind: 'unavailable', message: state.message }
    case 'ready':
      // UTF-8 bytes, the unit the host's too-large byteLength is in: `content.length` counts
      // UTF-16 code units, so an em dash or an umlaut read smaller than the file is.
      return {
        kind: 'present',
        byteLength: new TextEncoder().encode(state.content).byteLength,
        empty: state.content.trim().length === 0
      }
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

const KIB = 1024
const MIB = 1024 * 1024

/**
 * Bytes below 1 KB ("1 byte", "23 bytes"), whole KB below 1 MB, and MB to one place above. A size
 * whose KB rounds up to 1024 is shown in MB, so the row never reads "1024 KB".
 */
function formatMemoryFileSize(byteLength: number): string {
  if (byteLength < KIB) {
    return byteLength === 1 ? '1 byte' : `${byteLength} bytes`
  }
  const kib = Math.round(byteLength / KIB)
  return kib < KIB ? `${kib} KB` : `${(byteLength / MIB).toFixed(1)} MB`
}

/** One human line for the chooser row, keyed off the summary above. */
export function describeProjectMemorySummary(summary: ProjectMemorySummary): string {
  switch (summary.kind) {
    case 'loading':
      return 'Checking…'
    case 'missing':
      return 'Not created yet'
    case 'unavailable':
      return summary.message
    case 'present':
      return summary.empty ? 'Empty file' : formatMemoryFileSize(summary.byteLength)
    default: {
      const _exhaustive: never = summary
      return _exhaustive
    }
  }
}
