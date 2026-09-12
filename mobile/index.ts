// Why a custom entry: the headless task must be registered when the bundle
// loads, and in a headless start nothing under app/ is ever rendered, so a
// registration inside a route module would never run.
import './src/background/background-link-task'
// Same reason: WorkManager starts the bundle headless for the update check.
import './src/app-update/background-update-check'
import 'expo-router/entry'
