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
  'components/DraggableDetailSheet.tsx',
  'session/MobileBackgroundTasksPulse.tsx',
  // The working footer's mark (claude-working-mark.ts), its rolling figures (claude-rolling-text.ts)
  // and its verb that changes on a clock (claude-working-footer-spec.ts).
  'session/ClaudeWorkingMark.tsx',
  'session/ClaudeRollingText.tsx',
  'session/use-claude-working-verb.ts',
  // The running rows' label sweep (agent, command and tool rows alike).
  'session/MobileNativeChatShimmerText.tsx',
  'session/MobileNativeChatTurnStatus.tsx',
  'ui/StatusPulse.tsx',
  // The two onboarding sites already honoured the setting through a hook of
  // their own; they read the shared one now, so there is one answer app-wide.
  'onboarding/NotificationOnboardingPreview.tsx',
  '../app/mobile-onboarding.tsx',
  // The alert keeps its own (spring | crossfade) vocabulary over the shared hook.
  'ui/alert/use-alert-motion.ts',
  // Dictation: the waveform scrolls by itself; the composer's swap to the recording row and the
  // row's centre crossfade run when a take changes state, not under a finger.
  'components/DictationWaveform.tsx',
  'session/MobileNativeChatDictationRow.tsx',
  'session/use-composer-dictation-row.ts',
  // The live caption above the recording row comes and goes as words arrive.
  'session/MobileNativeChatDictationCaption.tsx',
  // The Claude app's motion in the transcript (claude-motion-spec.ts): a running workflow's dot
  // pulses on its own.
  'session/use-agent-pulse-style.ts',
  // Clawd dancing while a Claude tab's transcript loads (claude-transcript-loading-spec.ts).
  'session/ClaudeTranscriptLoading.tsx'
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
    expect(MOTION_SITES.length).toBeGreaterThanOrEqual(13)
  })
})
