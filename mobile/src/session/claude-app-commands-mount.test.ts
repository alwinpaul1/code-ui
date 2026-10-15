import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Which component hands the composer a matched Claude tab's own `/` list, and which publish the
// sheets the Claude app's `/diff` and `/workflows` open, is a matter of structure (CLAUDE.md rule
// 6): read from the code, comments stripped.
function code(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join('\n')
}

describe('where the app’s slash commands are wired', () => {
  it('the overlay hands the composer the session’s own list when no structured surface reports one', () => {
    expect(code('MobileNativeChatOverlay.tsx')).toMatch(
      /sessionCommands=\{controller\.nativeChatCommandSurface\?\.sessionCommands \?\? controller\.nativeChatSessionCommands\}/
    )
  })

  it('the tasks provider publishes Background tasks for /workflows, and the pill row the changes for /diff', () => {
    expect(code('MobileNativeChatTasksProvider.tsx')).toMatch(/useClaudeAppCommandSheet\('workflows', openSheet\)/)
    expect(code('MobileSessionPillRow.tsx')).toMatch(/useClaudeAppCommandSheet\('diff', useCallback\(\(\) => handlePanelTap\('sourceControl'\)/)
  })
})
