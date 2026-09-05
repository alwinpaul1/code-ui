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
      'react-native-pdf': fileURLToPath(new URL('./src/test/react-native-pdf-mock.ts', import.meta.url))
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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Why: this fork vendors only `src/shared` from the Orca monorepo. The PR
    // creation test imports a desktop renderer module that is not part of the
    // mobile app; the code under test itself does not.
    exclude: ['**/node_modules/**', 'src/source-control/mobile-pr-create.test.ts']
  }
})
