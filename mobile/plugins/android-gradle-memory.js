const { withGradleProperties } = require('expo/config-plugins')

// Why: the prebuild template sets `org.gradle.jvmargs=-Xmx2048m`, and with
// Expo SDK 57 / React Native 0.86 the release `mergeDexRelease` step runs out
// of that heap ("D8: java.lang.OutOfMemoryError: Java heap space", measured
// locally on 2026-09-09 after 8m29s). `android/` is generated, so the only
// place this can live durably — for the release workflow as much as for a
// laptop — is a config plugin.
const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m'

module.exports = function withAndroidGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    const entry = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs'
    )
    if (entry && entry.type === 'property') {
      entry.value = JVM_ARGS
    } else {
      cfg.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS })
    }
    return cfg
  })
}
