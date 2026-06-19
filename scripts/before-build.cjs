/**
 * Desktop bundles ship precompiled renderer assets. Returning false here tells
 * electron-builder to skip the node_modules collector/install step, which
 * avoids workspace dependency graph explosions and keeps packaging
 * deterministic across environments.
 *
 * Runtime dependencies that the main process needs (electron-updater, etc.)
 * are staged into build/native-deps/ by stage-native-deps.cjs and shipped
 * via the extraResources config.  main.cjs resolves them from
 * process.resourcesPath/native-deps at runtime.
 */
module.exports = async function beforeBuild() {
  return false
}
