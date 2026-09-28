import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core'
import type { ComponentType, ReactNode } from 'react'
import type { ViewProps } from 'react-native'
import { encodePillCopyNativeId, SELECTION_COPY_MODULE } from './markdown-pill-copy-id'

/**
 * Android (Metro picks this file over markdown-selection-copy.tsx): a Markdown document is wrapped
 * in modules/orca-selection-copy's view, whose Texts copy a code pill as its words instead of
 * U+FFFC (SelectionCopyRootView.kt). Each pill's View carries its span on its nativeID
 * (markdown-pill-copy-id.ts), which is where that copy reads it.
 *
 * It wraps the document's own root View rather than stand in for it. expo-modules-core 57.0.16
 * reads collapsableChildren the other way round from a View (ExpoViewShadowNode.h), so an Expo
 * view makes each child keep its own children: a prose Text directly under it would keep its pill
 * Views, and Fabric cannot put a view inside a TextView. Under the root View, a Text's pills are
 * mounted into that View as before, whichever way Expo reads the flag. The cost is one native
 * view per document.
 *
 * The module ships in the same APK as this JavaScript. Were it ever missing, the document is not
 * wrapped, and a Copy keeps U+FFFC as before, rather than mount a view that is not there.
 */
function selectionCopyView(): ComponentType<ViewProps> | null {
  if (requireOptionalNativeModule(SELECTION_COPY_MODULE) === null) {
    console.warn(
      `${SELECTION_COPY_MODULE} is not in this build: a Copy from a Markdown Text keeps U+FFFC for each code pill`
    )
    return null
  }
  return requireNativeViewManager<ViewProps>(SELECTION_COPY_MODULE)
}

const SelectionCopyView = selectionCopyView()

export function MarkdownSelectionRoot({ children }: { children: ReactNode }): ReactNode {
  return SelectionCopyView ? <SelectionCopyView>{children}</SelectionCopyView> : children
}

export function pillCopyNativeId(span: string, piece: number): string | undefined {
  return encodePillCopyNativeId(span, piece)
}
