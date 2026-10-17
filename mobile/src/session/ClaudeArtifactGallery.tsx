import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, TextInput, View, type ListRenderItemInfo } from 'react-native'
import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { subscribeAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import { useTheme } from '../theme/theme-context'
import { ScreenHeader } from '../ui/ScreenHeader'
import { Txt } from '../ui/Txt'
import {
  ARTIFACT_LIST_FILTERS,
  SEARCH_ARTIFACTS_HINT,
  SEARCH_DEBOUNCE_MS,
  artifactGalleryEmptyText,
  artifactRowLines,
  artifactThumbnailSource,
  artifactTypeLabel,
  sameArtifactTypeFilter,
  artifactTypeOptions,
  filterArtifactGallery,
  isDefaultArtifactGalleryFilters,
  type ArtifactListFilter,
  type ArtifactTypeFilter
} from './claude-artifact-gallery'
import { readClaudeArtifactAccounts, refreshClaudeArtifactList, useClaudeArtifactList, type ClaudeArtifactAccount } from './claude-artifact-list-store'
import type { ClaudeArtifactListItem } from './claude-artifacts'
import { ClaudeArtifactsGlyph } from './ClaudeArtifactsGlyph'
import { ClaudeCdsGlyph } from './ClaudeCdsGlyph'
import { openClaudeArtifact } from './open-claude-artifact'

export const ARTIFACT_GALLERY_TITLE = 'Artifacts'
export const ARTIFACT_GALLERY_NO_ACCOUNT = 'Sign in to an Anthropic account in Settings to see your artifacts.'

/** The signed-in accounts: null until read, and read again on every sign-in or sign-out. */
function useArtifactAccounts(): { accounts: ClaudeArtifactAccount[] | null; error: string | null; retry: () => void } {
  const [accounts, setAccounts] = useState<ClaudeArtifactAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reads, setReads] = useState(0)
  const retry = useCallback(() => setReads((count) => count + 1), [])
  useEffect(() => {
    let stale = false
    readClaudeArtifactAccounts().then(
      (next) => {
        if (!stale) {
          setAccounts(next)
          setError(null)
        }
      },
      (failure: unknown) => {
        const reason = failure instanceof Error && failure.message ? failure.message : 'the accounts could not be read'
        console.warn('[artifacts] the signed-in accounts could not be read', { reason })
        if (!stale) {
          setAccounts([])
          setError(reason)
        }
      }
    )
    return () => {
      stale = true
    }
  }, [reads])
  useEffect(() => subscribeAnthropicAccountsChanged(retry), [retry])
  return { accounts, error, retry }
}

type Picker = 'list' | 'type' | 'account' | null

/**
 * The account's Artifacts gallery, as the Claude Android app 1.261013.20 draws its Artifacts tab
 * (xo30.java, uo30.java, vf9.java, jbh.java): a search field, a list dropdown (All, Pinned, Yours,
 * Shared with you), a type dropdown when a row names a type, and one card per artifact. Tapping one
 * opens it in the in-app viewer (open-claude-artifact.ts).
 *
 * Code UI difference: with several Anthropic accounts signed in, an account picker sits beside the
 * dropdowns (the app has one account); it starts on the first, the primary.
 *
 * Not keyed to the relay's reconnects (stale-after-reconnect.ts): the list comes from claude.ai over
 * the phone's own network, not through the desktop.
 */
export function ClaudeArtifactGallery({ onBack }: { onBack: () => void }) {
  const { colors, space } = useTheme()
  const { accounts, error: accountsError, retry: retryAccounts } = useArtifactAccounts()
  const [chosenAccount, setChosenAccount] = useState<string | null>(null)
  const accountId = accounts?.some((account) => account.id === chosenAccount) ? chosenAccount : (accounts?.[0]?.id ?? null)
  const list = useClaudeArtifactList(accountId)

  const [listFilter, setListFilter] = useState<ArtifactListFilter>('all')
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>({ kind: 'all' })
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [typed])
  const [picker, setPicker] = useState<Picker>(null)
  const [pulling, setPulling] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => setNow(Date.now()), [list.loadedAt])

  const typeOptions = useMemo(() => artifactTypeOptions(list.items), [list.items])
  // A type that is no longer offered (another account, a refresh) is not kept as a hidden filter.
  const type: ArtifactTypeFilter =
    typeOptions?.some((option) => sameArtifactTypeFilter(option.filter, typeFilter)) === true ? typeFilter : { kind: 'all' }
  const filters = { list: listFilter, type, query }
  const rows = filterArtifactGallery(list.items, filters)

  const refresh = useCallback(() => {
    if (accountId) {
      setPulling(true)
      void refreshClaudeArtifactList(accountId, { force: true }).finally(() => setPulling(false))
    }
  }, [accountId])

  const pickerActions: ActionSheetAction[] =
    picker === 'list'
      ? ARTIFACT_LIST_FILTERS.map((option) => ({ label: option.label, selected: option.value === listFilter, onPress: () => setListFilter(option.value) }))
      : picker === 'type'
        ? (typeOptions ?? []).map((option) => ({
            label: option.label,
            selected: sameArtifactTypeFilter(option.filter, type),
            onPress: () => setTypeFilter(option.filter)
          }))
        : picker === 'account'
          ? (accounts ?? []).map((account) => ({ label: account.label, selected: account.id === accountId, onPress: () => setChosenAccount(account.id) }))
          : []

  let body: React.JSX.Element
  // Until a read has answered or failed, the spinner: the store starts its read after the first
  // draw, and an empty gallery saying "will show up here" before then would be a claim.
  if (accounts === null || (accountId !== null && list.loadedAt === null && (list.loading || list.error === null))) {
    body = (
      <View testID="artifact-gallery-loading" style={styles.centred}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    )
  } else if (accountsError !== null) {
    body = <GalleryError message={accountsError} onRetry={retryAccounts} />
  } else if (accountId === null) {
    body = (
      <View testID="artifact-gallery-no-account" style={styles.centred}>
        <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
          {ARTIFACT_GALLERY_NO_ACCOUNT}
        </Txt>
      </View>
    )
  } else if (list.error !== null && list.loadedAt === null) {
    body = <GalleryError message={list.error} onRetry={refresh} />
  } else {
    body = (
      <FlatList
        testID="artifact-gallery-list"
        data={rows}
        keyExtractor={(item) => item.uuid}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.bgPanel}
          />
        }
        ListHeaderComponent={list.error !== null && !list.loading ? <StaleListLine message={list.error} onRetry={refresh} /> : null}
        ListEmptyComponent={<GalleryEmpty text={artifactGalleryEmptyText(filters)} glyph={isDefaultArtifactGalleryFilters(filters)} />}
        renderItem={({ item }: ListRenderItemInfo<ClaudeArtifactListItem>) => (
          <ArtifactGalleryRow item={item} now={now} onPress={() => openClaudeArtifact({ url: item.url, title: item.title, accountId })} />
        )}
      />
    )
  }

  const chosenAccountLabel = accounts?.find((account) => account.id === accountId)?.label ?? ''
  return (
    <View testID="artifact-gallery" style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={ARTIFACT_GALLERY_TITLE} onBack={onBack} />
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.md,
            minHeight: 44,
            borderRadius: 999,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            backgroundColor: colors.bgPanel
          }}
        >
          <ClaudeCdsGlyph name="search" size={18} color={colors.textMuted} />
          <TextInput
            testID="artifact-gallery-search"
            value={typed}
            onChangeText={setTyped}
            placeholder={SEARCH_ARTIFACTS_HINT}
            placeholderTextColor={colors.textMuted}
            cursorColor={colors.caret}
            accessibilityLabel={SEARCH_ARTIFACTS_HINT}
            autoCorrect={false}
            returnKeyType="search"
            style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: space.sm }}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Dropdown
            testID="artifact-gallery-list-filter"
            label={ARTIFACT_LIST_FILTERS.find((option) => option.value === listFilter)!.label}
            accessibilityLabel="Choose artifacts to list"
            onPress={() => setPicker('list')}
          />
          {typeOptions !== null ? (
            <Dropdown testID="artifact-gallery-type-filter" label={artifactTypeLabel(type)} accessibilityLabel="Choose a type" onPress={() => setPicker('type')} />
          ) : null}
          {accounts !== null && accounts.length > 1 ? (
            <Dropdown testID="artifact-gallery-account" label={chosenAccountLabel} accessibilityLabel="Choose account" onPress={() => setPicker('account')} />
          ) : null}
        </View>
      </View>
      {body}
      <ActionSheetModal visible={picker !== null} actions={pickerActions} onClose={() => setPicker(null)} />
    </View>
  )
}

const styles = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }
})

function Dropdown({ testID, label, accessibilityLabel, onPress }: { testID: string; label: string; accessibilityLabel: string; onPress: () => void }) {
  const { colors, space } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: label }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        minHeight: 36,
        paddingHorizontal: space.md,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgRaised : colors.bgPanel
      })}
    >
      <Txt variant="label" weight="medium" numberOfLines={1}>
        {label}
      </Txt>
      <ClaudeCdsGlyph name="caretDown" size={14} color={colors.textSecondary} />
    </Pressable>
  )
}

function GalleryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme()
  return (
    <View testID="artifact-gallery-error" style={styles.centred}>
      <ClaudeCdsGlyph name="warningCircle" size={40} color={colors.textSecondary} />
      <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
        {message}
      </Txt>
      <RetryButton testID="artifact-gallery-retry" onPress={onRetry} />
    </View>
  )
}

function RetryButton({ testID, onPress }: { testID: string; onPress: () => void }) {
  const { colors, space } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        backgroundColor: pressed ? colors.bgRaised : colors.bgPanel
      })}
    >
      <Txt variant="label" weight="semibold">
        Retry
      </Txt>
    </Pressable>
  )
}

/** A later read failed while earlier rows are still shown: say so above them, beside a Retry. */
function StaleListLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors, space } = useTheme()
  return (
    <View testID="artifact-gallery-stale" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <ClaudeCdsGlyph name="warningCircle" size={16} color={colors.textSecondary} />
      <Txt variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={2}>
        {message}
      </Txt>
      <RetryButton testID="artifact-gallery-stale-retry" onPress={onRetry} />
    </View>
  )
}

function GalleryEmpty({ text, glyph }: { text: string; glyph: boolean }) {
  const { colors } = useTheme()
  return (
    <View testID="artifact-gallery-empty" style={styles.centred}>
      {glyph ? <ClaudeArtifactsGlyph size={40} color={colors.textSecondary} /> : null}
      <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
        {text}
      </Txt>
    </View>
  )
}

/** The thumbnail, or the artifacts glyph when the row has none or it does not load. */
function Thumbnail({ url }: { url: string | null }) {
  const { colors, radius } = useTheme()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  const source = failed ? null : artifactThumbnailSource(url)
  return (
    <View
      testID="artifact-gallery-thumb"
      style={{
        width: 112,
        height: 112,
        borderRadius: radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.bgRaised,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {source ? (
        <Image testID="artifact-gallery-thumb-image" source={source} resizeMode="cover" style={{ width: '100%', height: '100%' }} onError={() => setFailed(true)} />
      ) : (
        <ClaudeArtifactsGlyph testID="artifact-gallery-thumb-glyph" size={32} color={colors.textMuted} />
      )}
    </View>
  )
}

/** One artifact (jbh.java:174-420): thumbnail, then title, who, and when; a pin badge at the corner. */
function ArtifactGalleryRow({ item, now, onPress }: { item: ClaudeArtifactListItem; now: number; onPress: () => void }) {
  const { colors, space, radius } = useTheme()
  const lines = artifactRowLines(item, now)
  const spoken = [item.starred ? 'Pinned' : null, lines.title, lines.who?.label ?? null, lines.when].filter((part) => part !== null).join(', ')
  return (
    <Pressable
      testID={`artifact-gallery-row-${item.uuid}`}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Open artifact"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.bgRaised : colors.bgPanel
      })}
    >
      <Thumbnail url={item.thumbUrl} />
      <View style={{ flex: 1, minWidth: 0, minHeight: 72, justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Txt variant="body" weight="semibold" numberOfLines={1} style={{ paddingRight: item.starred ? space.md : 0 }}>
            {lines.title}
          </Txt>
          {lines.who ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              {lines.who.glyph ? <ClaudeCdsGlyph name={lines.who.glyph} size={14} color={colors.textSecondary} /> : null}
              <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                {lines.who.label}
              </Txt>
            </View>
          ) : null}
        </View>
        {lines.when ? (
          <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ marginTop: space.md }}>
            {lines.when}
          </Txt>
        ) : null}
      </View>
      {item.starred ? (
        <View
          testID="artifact-gallery-pinned"
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            backgroundColor: colors.bgPanel,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <ClaudeCdsGlyph name="pinFilled" size={14} color={colors.text} />
        </View>
      ) : null}
    </Pressable>
  )
}
