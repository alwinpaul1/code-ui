import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 2026-10-16. Which module hands what to the loading screens is a defect of structure (CLAUDE.md
// rule 6): the screens are tested in mobile-session-loading-state.test.tsx and
// claude-transcript-loading-view.test.tsx, and these pin that the route actually feeds them the
// tapped row's hint and the connection's trouble. Comments stripped, so the "why" notes above the
// code cannot satisfy a match.
function code(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join('\n')
}

describe("the tapped row's Claude hint reaches the loading screens", () => {
  it('the host list opens a row on the path that carries it', () => {
    expect(code('../host-screen/use-host-worktree-actions.ts')).toMatch(
      /navigateFromHostList\(worktreeSessionPath\(hostId, item\)\)/
    )
  })

  it('the session screen reads it from its route and spends it once the tabs load', () => {
    expect(code('use-mobile-session-foundation.ts')).toMatch(/agent: routeAgentParam/)
    const presentation = code('use-mobile-session-presentation.ts')
    expect(presentation).toMatch(
      /useSessionRouteAgentHint\(\{\s*worktreeId,\s*param: routeAgentParam,\s*terminalsLoaded,\s*clearParam: clearRouteAgentHint\s*\}\)/
    )
    expect(presentation).toMatch(/router\.setParams\(\{ agent: undefined \}\)/)
    expect(presentation).toMatch(
      /mobileSessionLoadingScreen\(\{\s*terminalsLoaded,\s*visibleTabCount: visibleTabs\.length,\s*routeAgentHint\s*\}\)/
    )
  })

  it('the session screen draws its loading screen from it, ahead of every other state', () => {
    expect(code('MobileSessionActiveContent.tsx')).toMatch(
      /const content = sessionLoadingScreen \? \(\s*<MobileSessionLoadingState screen=\{sessionLoadingScreen\} trouble=\{loadingConnectionTroubleState \?\? null\} \/>\s*\) : showEmptyState/
    )
  })

  it('the host check draws Clawd on it when nothing is cached', () => {
    expect(code('../../app/h/_layout.tsx')).toMatch(
      /sessionRouteOpensClaude\(pathname, hostId, readSessionRouteAgentHint\(agent\)\) \? \(\s*<ClaudeTranscriptLoading \/>/
    )
  })
})

describe("the connection's trouble reaches the loading screens", () => {
  it("the session screen derives it from the header's own verdict and hands it to everything it draws", () => {
    expect(code('use-mobile-session-presentation.ts')).toMatch(
      /useLoadingConnectionTroubleState\(\s*connectionVerdict,\s*hostName,\s*hostId,\s*forceReconnectHost\s*\)/
    )
    expect(code('MobileSessionActiveContent.tsx')).toMatch(
      /<LoadingConnectionTroubleContext\.Provider value=\{loadingConnectionTroubleState \?\? null\}>\s*\{content\}\s*<\/LoadingConnectionTroubleContext\.Provider>/
    )
  })

  it("the chat's loading reads it, Clawd and the spinner alike", () => {
    const loading = code('ClaudeTranscriptLoading.tsx')
    expect(loading.match(/useLoadingConnectionTroubleContext\(\)/g)).toHaveLength(2)
  })
})
