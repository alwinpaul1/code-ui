import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { MobileFileImageZoom } from './MobileFileImageZoom'
import { useTheme, useThemedStyles } from '../theme/theme-context'
import type { MobileFilePreviewResult } from './mobile-file-preview-request'
import { MobileFileMarkdownPreview } from './MobileFileMarkdownPreview'
import { MobileFilePreviewEditableSource } from './MobileFilePreviewEditableSource'
import { MobileFilePreviewSourceText } from './MobileFilePreviewSourceText'
import { MobileFilePdfPreview } from './MobileFilePdfPreview'
import type { MobileFilePreviewLineColumn } from './mobile-file-preview-line-column'
import { filePreviewStyles } from './mobile-file-preview-styles'
import type { MarkdownImageResolver } from '../components/markdown-image-source'

type Props = {
  preview: MobileFilePreviewResult
  relativePath: string
  title: string
  editable: boolean
  draftContent: string
  saveError: string
  lineColumn: MobileFilePreviewLineColumn | null
  /** Names the document across opens for the PDF and markdown readers. */
  readingPositionKey: string | null
  /** Reads a markdown document's images off the host; null for a source
   *  (a terminal artifact) whose neighbours the phone cannot read. */
  resolveImage: MarkdownImageResolver | null
  imageWidth: number
  imageHeight: number
  onDraftChange: (content: string) => void
  onImageError: () => void
  /** Null where the only retry is a re-dial this document cannot make. */
  onRetry: (() => void) | null
}

export function MobileFilePreviewBody({ preview, ...options }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(filePreviewStyles)
  if (preview.status === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <Text style={styles.stateText}>{preview.message}</Text>
      </View>
    )
  }
  if (preview.status === 'error' || preview.status === 'waiting') {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{preview.message}</Text>
        {options.onRetry ? (
          <Pressable style={styles.retryButton} onPress={options.onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }
  if (preview.status === 'empty') {
    return options.editable ? (
      <EditablePreviewSource {...options} />
    ) : (
      <View style={styles.state}>
        <Text style={styles.stateText}>Empty file</Text>
      </View>
    )
  }
  if (preview.kind === 'image') {
    // Why not ScrollView's zoom props: they are iOS-only, so an image file
    // opened on the phone could not be zoomed at all (2026-09-19). The
    // gesture root is the screen's own: a file preview is not a Modal.
    return (
      <View style={styles.imageContainer}>
        <GestureHandlerRootView style={styles.imageScrollContent}>
          <MobileFileImageZoom
            uri={preview.dataUri}
            width={options.imageWidth}
            height={options.imageHeight}
            label={`${options.title} image`}
            onError={options.onImageError}
          />
        </GestureHandlerRootView>
      </View>
    )
  }
  if (preview.kind === 'pdf') {
    return (
      <MobileFilePdfPreview
        uri={preview.uri}
        fileName={options.relativePath || options.title}
        readingPositionKey={options.readingPositionKey}
      />
    )
  }
  if (preview.kind === 'markdown') {
    return options.editable ? (
      <EditablePreviewSource {...options} />
    ) : (
      <MobileFileMarkdownPreview
        relativePath={options.relativePath}
        content={preview.content}
        truncated={preview.truncated}
        initialLine={options.lineColumn?.line}
        readingPositionKey={options.readingPositionKey}
        resolveImage={options.resolveImage ?? undefined}
      />
    )
  }
  if (preview.kind === 'html') {
    return options.editable ? (
      <EditablePreviewSource {...options} />
    ) : (
      <MobileFilePreviewSourceText
        relativePath={options.relativePath}
        content={preview.content}
        truncated={preview.truncated}
        initialLine={options.lineColumn?.line}
      />
    )
  }
  if (options.editable) {
    return <EditablePreviewSource {...options} />
  }
  return (
    <MobileFilePreviewSourceText
      relativePath={options.relativePath}
      content={preview.content}
      truncated={preview.truncated}
      initialLine={options.lineColumn?.line}
    />
  )
}

function EditablePreviewSource(options: {
  title: string
  draftContent: string
  saveError: string
  lineColumn: MobileFilePreviewLineColumn | null
  onDraftChange: (content: string) => void
}) {
  return (
    <MobileFilePreviewEditableSource
      title={options.title}
      draftContent={options.draftContent}
      saveError={options.saveError}
      lineColumn={options.lineColumn}
      onDraftChange={options.onDraftChange}
    />
  )
}
