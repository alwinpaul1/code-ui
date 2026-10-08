import type { PickerOption } from '../components/PickerModal'
import type { MobileGroupMode, MobileSortMode } from './workspace-view-settings'

// Why: sort, grouping and filters are the desktop's own view settings (ui.get/ui.set), so a change
// here moves the desktop's sidebar too. CODE UI words it as "desktop", as the rest of the app does.
export const WORKSPACE_VIEW_SHARED_NOTE = 'Synced with your desktop'
// Show archived is phone-local (no PersistedUIState field), so the Filter sheet names the exception.
export const WORKSPACE_FILTER_SHARED_NOTE = 'Synced with your desktop, except Show archived'

export const WORKSPACE_SORT_OPTIONS: PickerOption<MobileSortMode>[] = [
  // Why: desktop and persisted state keep the `smart` key, while mobile shows the product label.
  {
    value: 'smart',
    label: 'Agent activity',
    subtitle: 'Agents that need attention, then recent activity'
  },
  { value: 'name', label: 'Name', subtitle: 'Alphabetical by name' },
  { value: 'recent', label: 'Recent', subtitle: 'Most recent output first' },
  { value: 'repo', label: 'Repo', subtitle: 'Repository, then workspace name' },
  { value: 'manual', label: 'Manual', subtitle: 'Desktop drag order' }
]

export const WORKSPACE_GROUP_OPTIONS: PickerOption<MobileGroupMode>[] = [
  { value: 'none', label: 'No Grouping' },
  { value: 'workspaceStatus', label: 'Status' },
  { value: 'repo', label: 'Repository' },
  { value: 'prStatus', label: 'PR Status' }
]
