import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { PickerModal } from '../components/PickerModal'
import { fileTapMatchFolder } from './mobile-file-tap-name-lookup'
import type { FileTapMatchOffer } from './mobile-native-chat-open-file'
import type { FileTapMatchPickerModel } from './use-mobile-file-tap-handlers'

/** The row for a match that sits at the top of the workspace, which has no folder to show. */
export const FILE_TAP_MATCH_ROOT_LABEL = 'Workspace root'

function matchPickerTitle(offer: FileTapMatchOffer): string {
  return offer.complete
    ? `${offer.paths.length} files named ${offer.name}`
    : `Files named ${offer.name} (the desktop searched only part of the workspace)`
}

/**
 * Asks which file a bare chat tap meant when the name is in more than one folder, or whether the
 * lone match of a search that covered only part of the workspace is the one.
 *
 * Every row carries the same name, so each is labelled by its folder alone: that is the one thing
 * that tells them apart. `PickerModal` draws from `useTheme()`, so the sheet follows the
 * appearance setting in light and dark.
 *
 * The offer lands whenever the lookup finishes, which can be long after the tap. The drawer is a
 * native modal, so it would draw over whatever route the user has moved to since. It stays down
 * while the session screen is covered, and losing focus closes it, as the subagent viewer does.
 */
export function MobileFileTapMatchPicker({ picker }: { picker: FileTapMatchPickerModel }) {
  const offer = picker.offer
  // Focus as useFocusEffect reports it: the one router hook this domain may take
  // (session-router-seam-census.test.ts). Down until the screen has reported focus once.
  const [focused, setFocused] = useState(false)
  const { close } = picker
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => {
        setFocused(false)
        close()
      }
    }, [close])
  )
  return (
    <PickerModal
      visible={picker.visible && offer !== null && focused}
      title={offer ? matchPickerTitle(offer) : ''}
      options={(offer?.paths ?? []).map((relativePath) => ({
        value: relativePath,
        label: fileTapMatchFolder(relativePath) || FILE_TAP_MATCH_ROOT_LABEL
      }))}
      // No row is "current": the user has not opened any of them yet.
      selected=""
      onSelect={picker.pick}
      onClose={picker.close}
      onAfterClose={picker.afterClose}
    />
  )
}
