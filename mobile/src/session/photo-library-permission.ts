import { requestMediaLibraryPermissionsAsync } from 'expo-image-picker'

/** Asked before a photo-library pick opens its picker; null asks nothing. */
export type PhotoLibraryPermissionRequest = typeof requestMediaLibraryPermissionsAsync | null

/**
 * What a photo-library pick asks before it opens the picker. This file is
 * what iOS, the web shell and the test runner load, and on iOS the pick has
 * always asked first. On Android, Metro picks
 * `photo-library-permission.android.ts` instead, which asks nothing.
 */
export const requestPhotoLibraryPermission: PhotoLibraryPermissionRequest =
  requestMediaLibraryPermissionsAsync
