import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

/** Every surface that runs motion of its own accord, not in answer to a
 *  finger: the loops (spinners, pulses, breathing labels) and the two
 *  drawers' arrivals. Each has to consult the OS setting; a hardcoded
 *  loop passes every automated check and still moves for the one user
 *  who asked it not to. Add a site here when you add one to the app. */
const MOTION_SITES = [
  'components/AgentSpinner.tsx',
  'components/AgentStateDot.tsx',
  'components/mounted-bottom-drawer.tsx',
  'components/RightDrawer.tsx',
  'session/MobileNativeChatAgentRun.tsx',
  'session/MobileBackgroundTasksPulse.tsx',
  'session/MobileNativeChatToolPulsingText.tsx',
  'session/MobileNativeChatTurnStatus.tsx',
  'ui/StatusPulse.tsx',
  // The two onboarding sites already honoured the setting through a hook of
  // their own; they read the shared one now, so there is one answer app-wide.
  'onboarding/NotificationOnboardingPreview.tsx',
  '../app/mobile-onboarding.tsx',
  // The alert keeps its own (spring | crossfade) vocabulary over the shared hook.
  'ui/alert/use-alert-motion.ts'
]

const HOOK_IMPORT = /import \{[^}]*\buseReducedMotion\b[^}]*\} from '[^']*use-reduced-motion'/

// 0.6.6 audit: reduced motion was honoured in four files, the onboarding
// pair and the alert, each through its own hook. Everything that spins,
// pulses or slides on its own kept moving with the setting on.
describe('reduced motion, app-wide', () => {
  it('every self-starting motion site reads the shared hook', () => {
    const missing = MOTION_SITES.filter((site) => {
      const source = readFileSync(join(SRC, site), 'utf8')
      // Match the import, not a comment that mentions the hook.
      return !HOOK_IMPORT.test(source)
    })
    expect(missing).toEqual([])
  })

  it('nothing still reaches for the onboarding-only hook, which stayed null for ever on a rejection', () => {
    const stragglers = MOTION_SITES.filter((site) =>
      /useReducedMotionEnabled/.test(readFileSync(join(SRC, site), 'utf8'))
    )
    expect(stragglers).toEqual([])
  })

  it('lists the sites it guards, so an emptied list cannot pass', () => {
    expect(MOTION_SITES.length).toBeGreaterThanOrEqual(12)
  })
})
