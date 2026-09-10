import { describe, expect, it } from 'vitest'
import {
  briefToolArg,
  createToolInputDisplay,
  toolInputCommand
} from '../../../src/shared/native-chat-tool-summary'

// Orca #18760. The desktop now classifies a Codex `commandExecution` item by
// what the command actually did and publishes the class as the row's word
// (`read` / `search` / `list`), keeping the raw command for the expanded view
// and lifting the target under `query` / `path` / `directory`. These are the
// shapes that reach the phone from a host running that build.
const CODEX_SEARCH_ROW = {
  command: 'rg -n --hidden "useTheme" mobile/src',
  query: 'useTheme',
  directory: 'mobile/src'
}
const CODEX_LIST_ROW = {
  command: 'ls -la mobile/src/session',
  directory: 'mobile/src/session'
}
const CODEX_READ_ROW = {
  command: 'cat mobile/src/session/MobileNativeChatView.tsx',
  path: 'mobile/src/session/MobileNativeChatView.tsx'
}

describe('a classified Codex tool row', () => {
  it('reads by what it looked for, not by the shell text that ran it', () => {
    expect(createToolInputDisplay(CODEX_SEARCH_ROW).label).toBe('useTheme')
  })

  it('names the folder it listed instead of the raw argv', () => {
    expect(createToolInputDisplay(CODEX_LIST_ROW).label).toBe('mobile/src/session')
  })

  it('never offers a listed folder as a file to open', () => {
    expect(createToolInputDisplay(CODEX_LIST_ROW).filePath).toBeNull()
    expect(createToolInputDisplay(CODEX_SEARCH_ROW).filePath).toBeNull()
  })

  it('keeps a read row tappable, because its target really is a file', () => {
    const display = createToolInputDisplay(CODEX_READ_ROW)
    expect(display.filePath).toBe('mobile/src/session/MobileNativeChatView.tsx')
    expect(display.label).toBe('mobile/src/session/MobileNativeChatView.tsx')
  })

  it('summarizes a run by the search term, so the header matches the row', () => {
    expect(briefToolArg(CODEX_SEARCH_ROW)).toBe('useTheme')
    expect(briefToolArg(CODEX_LIST_ROW)).toBe('mobile/src/session')
  })

  it('still reports the command it ran, which is what tells it from a Claude row', () => {
    expect(toolInputCommand(CODEX_SEARCH_ROW)).toBe('rg -n --hidden "useTheme" mobile/src')
    // Claude's own `Read` shares the lowercased word and ran no command.
    expect(toolInputCommand({ file_path: 'a.ts' })).toBeNull()
    expect(toolInputCommand('not json at all')).toBeNull()
  })
})

describe('an unclassified tool row', () => {
  it('is byte-identical to before: a bare command still labels itself', () => {
    expect(createToolInputDisplay({ command: 'npm test' }).label).toBe('npm test')
    expect(briefToolArg({ command: 'npm test' })).toBe('npm test')
  })
})
