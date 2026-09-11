import { useEffect, useState } from 'react'
import { loadTerminalEngine, type TerminalEngine } from './terminal-engine-preference'

/** The engine flag, read once per mount; 'webview' until storage answers so a
 *  pane never flips engines mid-life. */
export function useTerminalEngine(): TerminalEngine {
  const [engine, setEngine] = useState<TerminalEngine>('webview')
  useEffect(() => {
    let cancelled = false
    void loadTerminalEngine().then((loaded) => {
      if (!cancelled) {
        setEngine(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  return engine
}
