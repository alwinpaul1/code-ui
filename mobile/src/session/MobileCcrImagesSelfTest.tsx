import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import type { CcrPipelineDeps } from './ccr-session-pipeline'
import { runCcrSelfTest, type CcrSelfTestLine } from './ccr-session-self-test'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'

/**
 * "Check session images": runs the Anthropic path against the chat on screen
 * and lists each stage with ✓ or ✗ (ccr-session-self-test.ts). Colours come
 * from the theme, so it reads in light and dark alike.
 */
export function MobileCcrImagesSelfTest({
  visible,
  onClose,
  deps
}: {
  visible: boolean
  onClose: () => void
  deps?: CcrPipelineDeps
}) {
  const { space } = useTheme()
  const [lines, setLines] = useState<CcrSelfTestLine[] | null>(null)
  const [run, setRun] = useState(0)
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    if (!visible) {
      return
    }
    let active = true
    setLines(null)
    const injected = depsRef.current
    void (injected ? Promise.resolve(injected) : loadDefaultCcrPipelineDeps())
      .then((deps) => runCcrSelfTest(deps))
      .catch((error: unknown) => [{ ok: false, label: 'Check', detail: error instanceof Error ? error.message : String(error) }])
      .then((result) => {
        if (active) {
          setLines(result)
        }
      })
    return () => {
      active = false
    }
  }, [visible, run])

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={{ paddingBottom: space.lg, paddingHorizontal: space.xs, gap: space.sm }}>
        <Txt variant="heading" weight="semibold">
          Session images check
        </Txt>
        {lines === null ? (
          <Txt variant="body" tone="secondary" testID="ccr-self-test-running">
            Checking with Anthropic…
          </Txt>
        ) : (
          lines.map((line, index) => (
            <View key={`${index}:${line.label}`} style={{ flexDirection: 'row', gap: space.sm }} testID="ccr-self-test-line">
              <Txt variant="body" weight="semibold" tone={line.ok ? 'success' : 'danger'} accessibilityLabel={line.ok ? 'Passed' : 'Failed'}>
                {line.ok ? '✓' : '✗'}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="body" weight="semibold">
                  {line.label}
                </Txt>
                <Txt variant="body" tone="secondary" selectable>
                  {line.detail}
                </Txt>
              </View>
            </View>
          ))
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Close" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button label="Run again" variant="primary" onPress={() => setRun((count) => count + 1)} style={{ flex: 1 }} />
      </View>
    </BottomDrawer>
  )
}
