import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const vitestOxcConfig = { tsconfig: false } as never

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      // Why: component tests mock 'react-native' to a few string tags; the real
      // Reanimated entry then pulls Flow-typed RN internals Node cannot parse.
      // The mock renders plain views and resolves animations synchronously.
      'react-native-reanimated': fileURLToPath(
        new URL('./src/test/react-native-reanimated-mock.ts', import.meta.url)
      ),
      // Why: react-native-pdf is a native view with no Node entry.
      'react-native-pdf': fileURLToPath(new URL('./src/test/react-native-pdf-mock.ts', import.meta.url)),
      // Why: the rich-paste module imports `expo`, which has no Node entry either.
      '@codeui/expo-rich-paste': fileURLToPath(
        new URL('./src/test/expo-rich-paste-mock.ts', import.meta.url)
      ),
      // Why: react-native-svg's entry is TypeScript the Node runtime cannot parse.
      'react-native-svg': fileURLToPath(new URL('./src/test/react-native-svg-mock.ts', import.meta.url)),
      // Why: gesture-handler and safe-area-context require real 'react-native'
      // (Flow). Tool rows reach both through the detail sheet, so without these
      // every chat-message test failed at import with "Unexpected token
      // 'typeof'" and no stack.
      'react-native-gesture-handler': fileURLToPath(
        new URL('./src/test/react-native-gesture-handler-mock.ts', import.meta.url)
      ),
      'react-native-safe-area-context': fileURLToPath(
        new URL('./src/test/react-native-safe-area-context-mock.ts', import.meta.url)
      ),
      // Why: expo-image-manipulator's entry pulls Flow-typed RN internals; the
      // composer's photo resizer (mobile-photo-resize.ts) is reached by the
      // attachment hooks' tests.
      'expo-image-manipulator': fileURLToPath(
        new URL('./src/test/expo-image-manipulator-mock.ts', import.meta.url)
      )
    }
  },
  // Why: the app tsconfig intentionally excludes tests; Vite 8's OXC transform
  // otherwise fails before Vitest can run the test modules.
  oxc: vitestOxcConfig,
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    onConsoleLog: (log) => !log.includes('react-test-renderer is deprecated'),
    // .tsx too: component tests exist (react-test-renderer + mocked react-native) and were
    // silently never collected, so render-level regressions shipped untested.
    // scripts/ too: the tests-typecheck ratchet's own parser tests live under it (#21298) and had
    // no runnable test home otherwise — a test vitest never collects is not a gate.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    // Why: the 5 s default is a wall-clock budget, and two things here spend wall clock without
    // the test under it doing any more work. The RPC recording oracle (#20521, #20544) transpiles
    // product source through the TypeScript compiler API on every scenario, so whichever of its
    // tests runs first in a cold process absorbs the warmup — `b1` records in under a second warm
    // and timed out at 5277 ms cold. And it is CPU-bound for half a minute across four files, so
    // the rest of the pass runs starved: `e2ee-base64` round-trips 512 KB in well under a second
    // alone and took 7.0 s beside it, `agent-hud-launch-args` 5.9 s. Neither test got slower;
    // both waited. A timeout that fires only on a busy box names the wrong file, so the ceiling
    // moves instead of the tests. Upstream leaves this at the default and puts 30_000 on its own
    // reply-matrix tests — the same number, applied where this fork actually needs it.
    testTimeout: 30_000,
    // Why: this fork vendors only `src/shared` from the Orca monorepo. The PR
    // creation test imports a desktop renderer module that is not part of the
    // mobile app; the code under test itself does not.
    exclude: ['**/node_modules/**', 'src/source-control/mobile-pr-create.test.ts']
  }
})
