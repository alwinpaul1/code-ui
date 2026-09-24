import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every key the page is handed on `init` is written through the one path that notes the mirror.
 *
 * The hybrid shell builds `init` synchronously from `readMirroredStorage`, so a saver that writes
 * its key straight to AsyncStorage stores the value and leaves the map behind it: the next page
 * load is handed the value from before the user's change, and it looks like the setting did not
 * take. Before #21977 that was every one of these savers. The source census beside this file
 * counts the modules; this is the check that each saver, called for real, lands in the map.
 *
 * One case per allowlisted exact key and per prefix, and the first case holds the table to the
 * allowlist, so a key added to `page-storage-keys.ts` without a row here fails by name.
 */

const store = vi.hoisted(() => ({ held: new Map<string, string>() }))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.held.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.held.set(key, value)
    },
    removeItem: async (key: string) => {
      store.held.delete(key)
    },
    multiGet: async (keys: readonly string[]) =>
      keys.map((key) => [key, store.held.get(key) ?? null] as const),
    getAllKeys: async () => [...store.held.keys()]
  }
}))
// CustomKeyModal.tsx is a component module; its saver is what this needs, so the view layer it
// imports is stubbed to nothing.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  Switch: 'Switch',
  StyleSheet: { create: <T>(styles: T) => styles, absoluteFill: {} },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android }
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

import { saveCustomKeys } from '../components/CustomKeyModal'
import {
  PAGE_STORAGE_EXACT_KEYS,
  PAGE_STORAGE_KEY_PREFIXES
} from '../mobile-web-shell/page-storage-keys'
import {
  getOrCreateMobileStructuredSendOperation,
  resetMobileStructuredSendOperationJournalForTests
} from '../session/mobile-structured-send-operation-journal'
import { saveTerminalAccessoryLayout } from '../terminal/terminal-accessory-layout'
import { writeLastVisitedWorktree } from '../worktree/last-visited-worktree-repo'
import { readMirroredStorage } from './mirrored-storage-keys'
import {
  saveDisabledTerminalLiveInputHandles,
  saveHostDockWidth,
  saveHostSidebarWidth,
  savePinnedIds,
  saveTerminalAutocompleteEnabled,
  saveTerminalLinkOpenMode,
  saveTerminalTextScale
} from './preferences'
import {
  resetSessionViewPreferenceMemoryForTests,
  saveDefaultSessionView,
  updateSessionViewOverride
} from './session-view-preferences'

const NOW = 1_900_000_000_000

/** Lets a fire-and-forget saver's write and read-back settle before the case looks. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
  }
}

type Row = {
  /** The allowlist entry: an exact key, or a prefix the written key starts with. */
  allowlisted: string
  /** The key the saver writes, which for a prefix carries the ids the saver was given. */
  written: string
  save: () => Promise<void>
}

const ROWS: readonly Row[] = [
  {
    allowlisted: 'orca:last-visited-worktree',
    written: 'orca:last-visited-worktree',
    save: async () => {
      writeLastVisitedWorktree({ hostId: 'host-1', worktreeId: 'repo-1::/work/tree' })
      await settle()
    }
  },
  {
    allowlisted: 'orca:hostSidebarWidth',
    written: 'orca:hostSidebarWidth',
    save: () => saveHostSidebarWidth(300)
  },
  {
    allowlisted: 'orca:hostDockWidth',
    written: 'orca:hostDockWidth',
    save: () => saveHostDockWidth(480)
  },
  {
    allowlisted: 'orca:terminal-accessory-layout',
    written: 'orca:terminal-accessory-layout',
    save: () => saveTerminalAccessoryLayout({ orderedBuiltInIds: [], visibleBuiltInIds: [] })
  },
  {
    allowlisted: 'orca:custom-accessory-keys',
    written: 'orca:custom-accessory-keys',
    save: () => saveCustomKeys([{ id: 'k1', label: 'ls', bytes: 'ls', enter: true }])
  },
  {
    allowlisted: 'orca:defaultSessionView',
    written: 'orca:defaultSessionView',
    save: () => saveDefaultSessionView('chat')
  },
  {
    allowlisted: 'orca:mobileStructuredSendOperations:v1',
    written: 'orca:mobileStructuredSendOperations:v1',
    save: async () => {
      await getOrCreateMobileStructuredSendOperation({
        operationKey: 'a'.repeat(64),
        callerIdentity: 'mobile-device-a',
        payloadFingerprint: 'b'.repeat(64),
        attachmentPaths: [],
        createOperationId: () => `${NOW}-${'8'.repeat(32)}`,
        now: NOW
      })
    }
  },
  {
    allowlisted: 'orca:terminalTextScale',
    written: 'orca:terminalTextScale',
    save: () => saveTerminalTextScale(1.25)
  },
  {
    allowlisted: 'orca:terminalAutocompleteEnabled',
    written: 'orca:terminalAutocompleteEnabled',
    save: () => saveTerminalAutocompleteEnabled(true)
  },
  {
    allowlisted: 'orca:terminalLinkOpenMode',
    written: 'orca:terminalLinkOpenMode',
    save: () => saveTerminalLinkOpenMode('phone-browser')
  },
  {
    allowlisted: 'orca:pins:',
    written: 'orca:pins:host-1',
    save: () => savePinnedIds('host-1', new Set(['wt-a', 'wt-b']))
  },
  {
    allowlisted: 'orca:nativeChatTabs:',
    written: 'orca:nativeChatTabs:host-1:wt-1',
    save: () => updateSessionViewOverride('host-1', 'wt-1', 'tab-1', 'chat')
  },
  {
    allowlisted: 'orca:terminalLiveInputDisabled:',
    written: 'orca:terminalLiveInputDisabled:host-1:wt-1',
    save: () => saveDisabledTerminalLiveInputHandles('host-1', 'wt-1', new Set(['handle-1']))
  }
]

beforeEach(() => {
  store.held.clear()
  resetMobileStructuredSendOperationJournalForTests()
  resetSessionViewPreferenceMemoryForTests()
})

describe('a page-visible setting saved on the phone', () => {
  it('has a row for every key the page is handed, and no row for one it is not', () => {
    expect(ROWS.map((row) => row.allowlisted).sort()).toEqual(
      [...PAGE_STORAGE_EXACT_KEYS, ...PAGE_STORAGE_KEY_PREFIXES].sort()
    )
  })

  for (const row of ROWS) {
    it(`reaches the next page load for ${row.allowlisted}`, async () => {
      await row.save()
      // The saver wrote the key it is rowed for and nothing else, so the case below is about it.
      expect([...store.held.keys()]).toEqual([row.written])
      const stored = store.held.get(row.written)
      expect(stored).toBeDefined()
      expect(readMirroredStorage([row.written]), `${row.written} was stored past the mirror`).toEqual(
        { [row.written]: stored }
      )
    })
  }
})
