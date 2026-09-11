import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { TerminalView, type TerminalViewRef } from 'expo-libghostty'
import { consumeAgentHudBeacons } from '../src/session/agent-hud-beacon'
import { TerminalWebView, type TerminalWebViewHandle } from '../src/terminal/TerminalWebView'
import {
  normalizeTerminalSnapshotForReplay,
  scheduleTerminalStreamReplay,
  selectTerminalStreamCaptureSnapshot,
  type TerminalStreamCapture
} from '../src/terminal/terminal-stream-capture'
import { createTerminalWriteCoalescer } from '../src/terminal/terminal-write-coalescer'
import { DEFAULT_TERMINAL_THEME } from '../src/terminal/terminal-webview-html/theme'
import { colors } from '../src/theme/mobile-theme'

/**
 * Stage 0 of the ghostty migration: replay a RECORDED terminal stream — the
 * host's phone-fitted snapshot, then every chunk at its arrival time — into
 * either engine, so both are measured under the same production load.
 *
 * Record with `pnpm exec tsx scripts/capture-terminal-stream.ts` into
 * captures/stage0.json (bundled by the require below), build, open
 * `codeui://ghostty-spike`, pick an engine, Load, Stream, then scroll.
 *
 * Measurement harness only: not linked from the app, single dark palette.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const CAPTURES: Record<CaptureName, TerminalStreamCapture> = {
  // Claude Code 2.1.x on its alternate screen: 51 s of a streamed answer,
  // sync-output-wrapped full-screen repaints. Nothing to scroll (alt screen).
  claude: require('../captures/stage0-claude.json') as TerminalStreamCapture,
  // Codex 0.153.4: main screen, no mouse tracking, sync-output frames, its
  // transcript in PTY scrollback — the local-scrollback agent case.
  codex: require('../captures/stage0-codex.json') as TerminalStreamCapture,
  // A shell whose scrollback the host trimmed to 518 lines, plus a live output
  // loop. Real PTY bytes but filler content: a scrollback-init specimen only.
  shell: require('../captures/stage0-shell.json') as TerminalStreamCapture
}
/* eslint-enable @typescript-eslint/no-require-imports */
const CAPTURE_HANDLE = 'stage0-replay'

type CaptureName = 'claude' | 'codex' | 'shell'
type Engine = 'ghostty' | 'xterm'
type Phase = 'idle' | 'loading' | 'ready' | 'streaming' | 'done'

const GHOSTTY_THEME = {
  background: DEFAULT_TERMINAL_THEME.background,
  foreground: DEFAULT_TERMINAL_THEME.foreground,
  cursorColor: DEFAULT_TERMINAL_THEME.cursor,
  selectionBackground: DEFAULT_TERMINAL_THEME.selectionBackground,
  selectionForeground: DEFAULT_TERMINAL_THEME.selectionForeground,
  palette: [
    DEFAULT_TERMINAL_THEME.black,
    DEFAULT_TERMINAL_THEME.red,
    DEFAULT_TERMINAL_THEME.green,
    DEFAULT_TERMINAL_THEME.yellow,
    DEFAULT_TERMINAL_THEME.blue,
    DEFAULT_TERMINAL_THEME.magenta,
    DEFAULT_TERMINAL_THEME.cyan,
    DEFAULT_TERMINAL_THEME.white,
    DEFAULT_TERMINAL_THEME.brightBlack,
    DEFAULT_TERMINAL_THEME.brightRed,
    DEFAULT_TERMINAL_THEME.brightGreen,
    DEFAULT_TERMINAL_THEME.brightYellow,
    DEFAULT_TERMINAL_THEME.brightBlue,
    DEFAULT_TERMINAL_THEME.brightMagenta,
    DEFAULT_TERMINAL_THEME.brightCyan,
    DEFAULT_TERMINAL_THEME.brightWhite
  ].map((color) => color ?? null)
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) {
    return 0
  }
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

function Spinner() {
  const spin = useRef(new Animated.Value(0)).current
  useEffect(() => {
    // Why native driver: the animation runs on the UI thread, so a UI-thread
    // hold (a snapshot parse, a paint) freezes it and screenrecord sees the gap.
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true
      })
    )
    loop.start()
    return () => loop.stop()
  }, [spin])
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />
}

export default function GhosttySpike() {
  const ghosttyRef = useRef<TerminalViewRef>(null)
  const xtermRef = useRef<TerminalWebViewHandle>(null)
  const [engine, setEngine] = useState<Engine>('ghostty')
  const [captureName, setCaptureName] = useState<CaptureName>('shell')
  const CAPTURE = CAPTURES[captureName]
  const [generation, setGeneration] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [loop, setLoop] = useState(true)
  const [spinner, setSpinner] = useState(true)
  const [initMs, setInitMs] = useState<number | null>(null)
  const [chunks, setChunks] = useState(0)
  const [passes, setPasses] = useState(0)
  const [ghosttyWriteMs, setGhosttyWriteMs] = useState<{ p50: number; p90: number; max: number } | null>(
    null
  )
  const writeSamplesRef = useRef<number[]>([])
  const replayRef = useRef<{ cancel: () => void } | null>(null)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase

  const init = useMemo(() => selectTerminalStreamCaptureSnapshot(CAPTURE), [CAPTURE])
  const snapshot = useMemo(() => normalizeTerminalSnapshotForReplay(init.serialized), [init])
  const dataChunks = useMemo(
    () => CAPTURE.events.filter((event) => event.type === 'data').length,
    [CAPTURE]
  )
  const captureSeconds = useMemo(() => {
    const last = CAPTURE.events[CAPTURE.events.length - 1]
    return last ? last.t / 1000 : 0
  }, [CAPTURE])

  const deliver = useCallback(
    (data: string) => {
      if (engine === 'xterm') {
        xtermRef.current?.write(data)
        return
      }
      const view = ghosttyRef.current
      if (!view) {
        return
      }
      const started = performance.now()
      void view.writeText(data).then(() => {
        writeSamplesRef.current.push(performance.now() - started)
      })
    },
    [engine]
  )
  // Why the coalescer: production batches chunks at ~20 Hz before any engine
  // sees them; replaying through it keeps the bridge load identical.
  const coalescer = useMemo(() => createTerminalWriteCoalescer(deliver), [deliver])
  useEffect(() => () => coalescer.clear(), [coalescer])

  const stop = useCallback(() => {
    replayRef.current?.cancel()
    replayRef.current = null
    coalescer.clear()
  }, [coalescer])

  const load = useCallback(async () => {
    stop()
    writeSamplesRef.current = []
    setGhosttyWriteMs(null)
    setChunks(0)
    setPasses(0)
    setInitMs(null)
    setPhase('loading')
    const cols = init.cols ?? 80
    const rows = init.rows ?? 24
    if (engine === 'xterm') {
      const ref = xtermRef.current
      if (!ref) {
        setPhase('idle')
        return
      }
      const started = performance.now()
      ref.init(cols, rows, snapshot, false)
      await ref.awaitReady()
      setInitMs(performance.now() - started)
      setPhase('ready')
      return
    }
    // Why remount: the library has no reset; a fresh native view is the init.
    setGeneration((value) => value + 1)
    // The new view registers on its first onResize; writeText queues until then.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const view = ghosttyRef.current
    if (!view) {
      setPhase('idle')
      return
    }
    const started = performance.now()
    await view.writeText(snapshot)
    setInitMs(performance.now() - started)
    setPhase('ready')
  }, [engine, init, snapshot, stop])

  const startPass = useCallback(() => {
    replayRef.current = scheduleTerminalStreamReplay(CAPTURE.events, {
      write: (chunk) => {
        // Why: production strips the agents' HUD beacon before any engine
        // sees the bytes; the replay must not hand either engine an OSC 7777.
        coalescer.write(consumeAgentHudBeacons(CAPTURE_HANDLE, chunk))
        setChunks((value) => value + 1)
      },
      done: () => {
        coalescer.flushNow()
        setPasses((value) => value + 1)
        const samples = writeSamplesRef.current
        if (samples.length > 0) {
          setGhosttyWriteMs({
            p50: percentile(samples, 0.5),
            p90: percentile(samples, 0.9),
            max: Math.max(...samples)
          })
        }
        if (loop && phaseRef.current === 'streaming') {
          startPass()
          return
        }
        setPhase('done')
      }
    })
  }, [CAPTURE, coalescer, loop])

  const stream = useCallback(() => {
    if (phase === 'streaming') {
      stop()
      setPhase('ready')
      return
    }
    setPhase('streaming')
    startPass()
  }, [phase, startPass, stop])

  useEffect(() => () => stop(), [stop])

  const switchEngine = useCallback(
    (next: Engine) => {
      if (next === engine) {
        return
      }
      stop()
      setPhase('idle')
      setInitMs(null)
      setEngine(next)
    },
    [engine, stop]
  )

  const switchCapture = useCallback(
    (next: CaptureName) => {
      if (next === captureName) {
        return
      }
      stop()
      setPhase('idle')
      setInitMs(null)
      setCaptureName(next)
    },
    [captureName, stop]
  )

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.row}>
        <Pressable
          onPress={() => switchEngine('ghostty')}
          style={[styles.button, engine === 'ghostty' && styles.buttonActive]}
        >
          <Text style={styles.buttonText}>Ghostty</Text>
        </Pressable>
        <Pressable
          onPress={() => switchEngine('xterm')}
          style={[styles.button, engine === 'xterm' && styles.buttonActive]}
        >
          <Text style={styles.buttonText}>xterm</Text>
        </Pressable>
        <Pressable onPress={() => void load()} style={styles.button}>
          <Text style={styles.buttonText}>Load</Text>
        </Pressable>
        <Pressable
          onPress={stream}
          disabled={phase === 'idle' || phase === 'loading'}
          style={[styles.button, phase === 'streaming' && styles.buttonActive]}
        >
          <Text style={styles.buttonText}>{phase === 'streaming' ? 'Stop' : 'Stream'}</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() => switchCapture('shell')}
          style={[styles.chip, captureName === 'shell' && styles.chipActive]}
        >
          <Text style={styles.chipText}>shell scrollback</Text>
        </Pressable>
        <Pressable
          onPress={() => switchCapture('claude')}
          style={[styles.chip, captureName === 'claude' && styles.chipActive]}
        >
          <Text style={styles.chipText}>claude alt-screen</Text>
        </Pressable>
        <Pressable
          onPress={() => switchCapture('codex')}
          style={[styles.chip, captureName === 'codex' && styles.chipActive]}
        >
          <Text style={styles.chipText}>codex</Text>
        </Pressable>
        <Pressable onPress={() => setLoop((value) => !value)} style={styles.chip}>
          <Text style={styles.chipText}>loop {loop ? 'on' : 'off'}</Text>
        </Pressable>
        <Pressable onPress={() => setSpinner((value) => !value)} style={styles.chip}>
          <Text style={styles.chipText}>spinner {spinner ? 'on' : 'off'}</Text>
        </Pressable>
        {spinner ? <Spinner /> : null}
      </View>
      <Text style={styles.stats}>
        {CAPTURE.placeholder ? 'PLACEHOLDER CAPTURE — record it first. ' : ''}
        {`${captureName} ${init.cols ?? '?'}x${init.rows ?? '?'}, snapshot ${(snapshot.length / 1024).toFixed(0)}k units, ${dataChunks} chunks / ${captureSeconds.toFixed(1)}s`}
      </Text>
      <Text style={styles.stats}>
        {`${engine} ${phase}`}
        {initMs !== null ? ` · init ${initMs.toFixed(0)}ms` : ''}
        {` · ${chunks} chunks · pass ${passes}`}
        {ghosttyWriteMs
          ? ` · writeText p50 ${ghosttyWriteMs.p50.toFixed(1)} p90 ${ghosttyWriteMs.p90.toFixed(1)} max ${ghosttyWriteMs.max.toFixed(0)}ms`
          : ''}
      </Text>
      <View style={styles.terminal}>
        {engine === 'ghostty' ? (
          <TerminalView
            key={generation}
            ref={ghosttyRef}
            style={styles.fill}
            fontSize={13}
            theme={GHOSTTY_THEME}
            onInput={() => undefined}
            onResize={() => undefined}
          />
        ) : (
          <TerminalWebView
            ref={xtermRef}
            style={styles.fill}
            terminalTheme={{ mode: 'dark', theme: DEFAULT_TERMINAL_THEME }}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.terminalBg },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 8, alignItems: 'center' },
  button: {
    backgroundColor: '#3A3937',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8
  },
  buttonActive: { backgroundColor: '#C96442' },
  buttonText: { color: 'white', fontWeight: '600' },
  chip: { backgroundColor: '#2a2f4a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  chipActive: { backgroundColor: '#414868' },
  chipText: { color: colors.textSecondary, fontSize: 12 },
  spinner: { width: 18, height: 18, backgroundColor: '#7aa2f7', borderRadius: 3 },
  stats: { color: colors.textSecondary, fontSize: 11, paddingHorizontal: 8, paddingTop: 6 },
  terminal: { flex: 1, marginTop: 8 },
  fill: { flex: 1 }
})
