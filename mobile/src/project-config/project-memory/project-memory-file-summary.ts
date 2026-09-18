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
      return { kind: 'present', byteLength: state.content.length, empty: state.content.trim().length === 0 }
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
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
      return summary.empty ? 'Empty file' : `${summary.byteLength} bytes`
    default: {
      const _exhaustive: never = summary
      return _exhaustive
    }
  }
}
