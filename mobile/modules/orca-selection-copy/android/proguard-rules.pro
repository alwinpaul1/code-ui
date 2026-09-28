# Expo builds a module's view by reflection, getConstructor(Context) (ViewDefinitionBuilder.kt).
# expo-modules-core keeps that constructor only for ExpoView subclasses, and SelectionCopyRootView
# is a ReactViewGroup. Without this, a minified build would draw Expo's error view in its place,
# which is no ViewGroup, and the document's View could not be added to it.
-keep class expo.modules.orcaselectioncopy.SelectionCopyRootView {
  public <init>(android.content.Context);
}
