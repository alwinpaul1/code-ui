/**
 * Android opens a photo-library pick with no permission step (Metro picks
 * this file over `photo-library-permission.ts` on Android).
 *
 * The picker `launchImageLibraryAsync` opens here is PickVisualMedia: the
 * system photo picker, or ACTION_OPEN_DOCUMENT where a device has none. It
 * needs no permission on any version and grants read access to exactly what
 * the user picks. The request it used to wait for could not change that:
 * expo-image-picker 57.0.16 (ImagePickerModule.kt, getMediaLibraryPermissions)
 * asks for nothing from API 33 up and answers `granted`, and below 33 it asks
 * for READ/WRITE_EXTERNAL_STORAGE, which app.json's blockedPermissions strips
 * from the manifest, so there it can only be refused. On the phone it was a
 * JS -> native -> JS round trip in front of every Photos launch, its reply
 * queued behind whatever the chat's JS thread was doing (2026-09-27).
 */
export const requestPhotoLibraryPermission = null
