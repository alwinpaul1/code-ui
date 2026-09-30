import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, Switch } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue
} from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Type } from 'lucide-react-native'
import { spacing } from '../src/theme/mobile-theme'
import { useTheme, useThemedStyles } from '../src/theme/theme-context'
import { emptyHostsNoticeCopy, useLoadedHosts } from '../src/transport/use-loaded-hosts'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'
import { PickerModal, type PickerOption } from '../src/components/PickerModal'
import { TerminalShortcutSettings } from '../src/components/TerminalShortcutSettings'
import {
  TERMINAL_AUTO_RESTORE_FIT_UNREADABLE,
  claimTerminalAutoRestoreFitRead,
  isKnownTerminalAutoRestoreFit,
  readTerminalAutoRestoreFitReply,
  setTerminalAutoRestoreFitMsForHost,
  type TerminalAutoRestoreFitByHost,
  type TerminalAutoRestoreFitReadLedger,
  type TerminalAutoRestoreFitValue
} from '../src/terminal/terminal-auto-restore-fit-state'
import {
  AUTO_RESTORE_FIT_OPTIONS,
  TerminalAutoRestoreFitRow,
  restoreValueFromMs,
  type RestoreValue
} from '../src/terminal/TerminalAutoRestoreFitRow'
import { terminalSettingsScreenStyles } from '../src/terminal/terminal-settings-screen-styles'
import { setTerminalSettingsScrollEnabled } from '../src/terminal/terminal-settings-scroll-lock'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalTextScale,
  saveTerminalAutocompleteEnabled,
  saveTerminalTextScale
} from '../src/storage/preferences'

type TextSizeValue = 'smallest' | 'smaller' | 'default' | 'large' | 'larger' | 'largest'

// scale = baseline zoom the terminal WebView applies on top of fit-to-width.
// Keep in sync with TERMINAL_TEXT_SCALES; pinch-to-zoom snaps to these values.
const TEXT_SIZE_OPTIONS: (PickerOption<TextSizeValue> & { scale: number })[] = [
  { value: 'smallest', label: 'Smallest (50%)', scale: 0.5 },
  { value: 'smaller', label: 'Smaller (75%)', scale: 0.75 },
  { value: 'default', label: 'Default (100%)', scale: 1 },
  { value: 'large', label: 'Large (125%)', scale: 1.25 },
  { value: 'larger', label: 'Larger (150%)', scale: 1.5 },
  { value: 'largest', label: 'Largest (200%)', scale: 2 }
]

function textSizeValueFromScale(scale: number): TextSizeValue {
  return TEXT_SIZE_OPTIONS.find((o) => o.scale === scale)?.value ?? 'default'
}

function textSizeSummary(scale: number): string {
  return (TEXT_SIZE_OPTIONS.find((o) => o.scale === scale) ?? TEXT_SIZE_OPTIONS[0]!).label
}

export default function TerminalSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(terminalSettingsScreenStyles)
  const loadedHosts = useLoadedHosts()
  const { hosts, loaded: hostsLoaded } = loadedHosts
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts])
  const { clients: hostClients } = useFocusedSettingsHostClients(hostIds)
  const hostClientsById = useMemo(
    () => new Map(hostClients.map((entry) => [entry.hostId, entry.client])),
    [hostClients]
  )

  // Why: per-host current value, lazily fetched. We keep state at the
  // screen level rather than per-row so the picker can render at root
  // level — embedding PickerModal inside a row clipped its BottomDrawer
  // absoluteFill backdrop to the ScrollView content frame and made the
  // drawer appear cut-off.
  const [hostMs, setHostMs] = useState<TerminalAutoRestoreFitByHost>({})
  const [pickerHostId, setPickerHostId] = useState<string | null>(null)
  const readLedgerRef = useRef<TerminalAutoRestoreFitReadLedger>(new Map())
  // The latest read or write per desktop; an older answer landing after it is dropped.
  const readSeqRef = useRef(new Map<string, number>())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const beginHostRead = useCallback((hostId: string) => {
    const seq = (readSeqRef.current.get(hostId) ?? 0) + 1
    readSeqRef.current.set(hostId, seq)
    return (value: TerminalAutoRestoreFitValue) => {
      if (mountedRef.current && readSeqRef.current.get(hostId) === seq) {
        // Why: preserving object identity for an unchanged value avoids
        // rerendering every settings row again.
        setHostMs((prev) => setTerminalAutoRestoreFitMsForHost(prev, hostId, value))
      }
    }
  }, [])

  const [textScale, setTextScale] = useState(1)
  const [textSizePickerOpen, setTextSizePickerOpen] = useState(false)
  useEffect(() => {
    void loadTerminalTextScale().then(setTextScale)
  }, [])
  const selectTextSize = useCallback((value: TextSizeValue) => {
    const opt = TEXT_SIZE_OPTIONS.find((o) => o.value === value)
    if (!opt) {
      return
    }
    setTextScale(opt.scale)
    void saveTerminalTextScale(opt.scale)
  }, [])

  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false)
  // Why: a fast toggle before the initial load resolves must win — otherwise the
  // delayed read would clobber the user's choice with the stored (stale) value.
  const userToggledAutocompleteRef = useRef(false)
  useEffect(() => {
    let stale = false
    void loadTerminalAutocompleteEnabled().then((enabled) => {
      if (!stale && !userToggledAutocompleteRef.current) {
        setAutocompleteEnabled(enabled)
      }
    })
    return () => {
      stale = true
    }
  }, [])
  const toggleAutocomplete = useCallback((next: boolean) => {
    userToggledAutocompleteRef.current = true
    setAutocompleteEnabled(next)
    void saveTerminalAutocompleteEnabled(next)
  }, [])

  // Why: `hostClients` changes on every connection-state tick of every desktop. Each desktop is
  // read once per connection (claimTerminalAutoRestoreFitRead), and only while connected: a
  // failed read says "Couldn't read" and waits for the next connection instead of spinning, or
  // being drawn as the default. The answer is { ms } inside the reply envelope, not on it.
  useEffect(() => {
    for (const { hostId, client, state } of hostClients) {
      if (
        state !== 'connected' ||
        !claimTerminalAutoRestoreFitRead(readLedgerRef.current, hostId, client.getLastConnectedAt())
      ) {
        continue
      }
      const settle = beginHostRead(hostId)
      void client.sendRequest('terminal.getAutoRestoreFit').then(
        (reply) => settle(readTerminalAutoRestoreFitReply(reply)),
        () => settle(TERMINAL_AUTO_RESTORE_FIT_UNREADABLE)
      )
    }
  }, [beginHostRead, hostClients])

  async function selectValue(hostId: string, value: RestoreValue) {
    const client = hostClientsById.get(hostId) ?? null
    const opt = AUTO_RESTORE_FIT_OPTIONS.find((o) => o.value === value)
    if (!client || !opt) {
      return
    }
    const settle = beginHostRead(hostId)
    setHostMs((prev) => setTerminalAutoRestoreFitMsForHost(prev, hostId, opt.ms))
    let confirmed: TerminalAutoRestoreFitValue = TERMINAL_AUTO_RESTORE_FIT_UNREADABLE
    try {
      const reply = await client.sendRequest('terminal.setAutoRestoreFit', { ms: opt.ms })
      confirmed = readTerminalAutoRestoreFitReply(reply)
    } catch {
      // Whether the write landed is unknown: read back what the desktop has.
    }
    if (confirmed === TERMINAL_AUTO_RESTORE_FIT_UNREADABLE) {
      try {
        confirmed = readTerminalAutoRestoreFitReply(
          await client.sendRequest('terminal.getAutoRestoreFit')
        )
      } catch {
        // Still unknown: the row says "Couldn't read", never the optimistic pick.
      }
    }
    settle(confirmed)
  }

  const pickerHost = pickerHostId ? hosts.find((h) => h.id === pickerHostId) : null
  const pickerValue = pickerHost ? hostMs[pickerHost.id] : undefined
  const pickerKnown = isKnownTerminalAutoRestoreFit(pickerValue)
  // The picker only preselects a value the desktop answered; one that became unknown closes it.
  useEffect(() => {
    if (pickerHostId && !isKnownTerminalAutoRestoreFit(hostMs[pickerHostId])) {
      setPickerHostId(null)
    }
  }, [hostMs, pickerHostId])

  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const scrollOffsetY = useSharedValue(0)
  const scrollContentHeight = useSharedValue(0)
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollOffsetY.value = event.contentOffset.y
  })
  // Why: imperative toggle instead of state — a re-render while a drag gesture
  // is active would rebuild the row gestures and could cancel the drag.
  const setScrollEnabled = useCallback(
    (enabled: boolean) => {
      setTerminalSettingsScrollEnabled(scrollRef, enabled)
    },
    [scrollRef]
  )
  const handleDragActiveChange = useCallback(
    (active: boolean) => setScrollEnabled(!active),
    [setScrollEnabled]
  )

  return (
    <GestureHandlerRootView style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Terminal</Text>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => {
          scrollContentHeight.value = height
        }}
      >
        <Text style={styles.groupHeading}>WHEN YOU LEAVE THE APP</Text>

        {!hostsLoaded ? null : hosts.length === 0 ? (
          <View style={[styles.section, styles.sectionTopGap]}>
            <Text style={styles.emptyText}>
              {emptyHostsNoticeCopy(
                loadedHosts,
                'No paired desktops yet. Pair one to control terminal behavior.'
              )}
            </Text>
          </View>
        ) : (
          <View style={[styles.section, styles.sectionTopGap]}>
            {hosts.map((host, idx) => (
              <View key={host.id}>
                {idx > 0 && <View style={styles.separator} />}
                <TerminalAutoRestoreFitRow
                  disabled={
                    !hostClientsById.has(host.id) || !isKnownTerminalAutoRestoreFit(hostMs[host.id])
                  }
                  hostName={host.name}
                  value={hostMs[host.id]}
                  onPress={() => setPickerHostId(host.id)}
                  styles={styles}
                />
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.groupHeading, styles.inputGroupGap]}>TEXT SIZE</Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setTextSizePickerOpen(true)}
          >
            <Type size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Text size</Text>
              <Text style={styles.rowSublabel}>{textSizeSummary(textScale)}</Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        <Text style={[styles.groupHeading, styles.inputGroupGap]}>KEYBOARD INPUT</Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Autocomplete &amp; autocorrect</Text>
              <Text style={styles.rowSublabel}>{autocompleteEnabled ? 'On' : 'Off'}</Text>
            </View>
            <Switch
              value={autocompleteEnabled}
              onValueChange={toggleAutocomplete}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.text}
            />
          </View>
        </View>

        <TerminalShortcutSettings
          scrollRef={scrollRef}
          scrollOffsetY={scrollOffsetY}
          scrollContentHeight={scrollContentHeight}
          onDragActiveChange={handleDragActiveChange}
        />
      </Animated.ScrollView>

      <PickerModal<RestoreValue>
        visible={pickerHost != null && pickerKnown}
        title={pickerHost ? `Restore ${pickerHost.name}` : ''}
        options={AUTO_RESTORE_FIT_OPTIONS}
        selected={restoreValueFromMs(pickerKnown ? pickerValue : null)}
        onSelect={(v) => {
          if (pickerHost) {
            void selectValue(pickerHost.id, v)
          }
        }}
        onClose={() => setPickerHostId(null)}
      />

      <PickerModal<TextSizeValue>
        visible={textSizePickerOpen}
        title="Terminal text size"
        options={TEXT_SIZE_OPTIONS}
        selected={textSizeValueFromScale(textScale)}
        onSelect={selectTextSize}
        onClose={() => setTextSizePickerOpen(false)}
      />
    </GestureHandlerRootView>
  )
}
