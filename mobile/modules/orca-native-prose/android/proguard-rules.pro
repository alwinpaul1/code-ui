# Expo builds a module's view by reflection, getConstructor(Context) (ViewDefinitionBuilder.kt).
# expo-modules-core keeps that constructor only for ExpoView subclasses, and NativeProseTextView is
# a TextView. Without this, a minified build would draw Expo's error view in its place.
-keep class expo.modules.orcanativeprose.NativeProseTextView {
  public <init>(android.content.Context);
}
