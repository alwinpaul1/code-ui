// Why a custom entry: the headless task must be registered when the bundle
// loads, and in a headless start nothing under app/ is ever rendered, so a
// registration inside a route module would never run.
import './src/background/background-link-task'
import 'expo-router/entry'
