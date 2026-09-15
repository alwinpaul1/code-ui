import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Code, Eye } from 'lucide-react-native'
import { MobileMarkdown } from './MobileMarkdown'
import { useTheme } from '../theme/theme-context'

type Props = {
  markdown: string
  /** The raw file, rendered by the caller's own syntax view. */
  renderSource: () => React.ReactNode
}

/**
 * A markdown file as a document, with a toggle back to the raw text.
 *
 * Markdown is the one kind of file here that is written to be READ rather than
 * edited — CLAUDE.md, the docs, a README — and the phone showed it as raw source
 * while the desktop had always rendered it (reported 2026-09-15). It reads
 * through the same `files.read` text path as any other file; only the view
 * differs, so nothing about loading or truncation changes.
 *
 * Same shape as `MobileHtmlPreview`, deliberately: two viewers that do the same
 * job should not have two different toolbars. Markdown needs no WebView, though
 * — it renders with the component the chat already uses, so a heading in a file
 * looks like a heading in a reply.
 */
export function MobileMarkdownPreview({ markdown, renderSource }: Props) {
  const { colors } = useTheme()
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const styles = stylesFor(colors)

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable
          style={[styles.toggle, mode === 'preview' && styles.toggleActive]}
          onPress={() => setMode('preview')}
          accessibilityLabel="Preview rendered markdown"
        >
          <Eye size={13} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.toggleText}>Preview</Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, mode === 'source' && styles.toggleActive]}
          onPress={() => setMode('source')}
          accessibilityLabel="View markdown source"
        >
          <Code size={13} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.toggleText}>Source</Text>
        </Pressable>
      </View>
      {mode === 'preview' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <MobileMarkdown content={markdown} />
        </ScrollView>
      ) : (
        renderSource()
      )}
    </View>
  )
}

function stylesFor(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1 },
    toolbar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8
    },
    toggleActive: { backgroundColor: colors.bgRaised },
    toggleText: { color: colors.textSecondary, fontSize: 12 },
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 32 }
  })
}
