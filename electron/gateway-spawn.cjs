/**
 * gateway-spawn.cjs
 *
 * Pure, electron-free helper that builds the env object handed to a spawned
 * agent-gateway child. Both the primary backend (startGateway in main.cjs) and
 * the per-profile pool backends (spawnPoolBackend) route through this so the
 * two spawn paths can't drift again.
 *
 * Why centralize: the pool path previously set the session token under
 * HERMES_DASHBOARD_SESSION_TOKEN — a name the gateway never reads. agent-gateway
 * (__main__.py) only honors AGENT_GATEWAY_SESSION_TOKEN, so a pooled local
 * backend spawned with no token it could match, generated its own, and every
 * request from the desktop 401'd. Pinning the env in one place is both the fix
 * and the regression guard.
 *
 * Kept standalone (no `require('electron')`) so it's unit-testable with
 * `node --test`, same pattern as connection-config.cjs / backend-probes.cjs.
 */

// Build the child-process env for an agent-gateway backend. Pure: takes the
// pieces it needs, returns a plain object. Spread order matters and mirrors
// the pre-refactor blocks — processEnv < home < backendEnv < pinned gateway
// vars — so a backend may override inherited process env, but the gateway's
// own token/home/unbuffered pins always win.
function buildGatewayChildEnv({ processEnv, home, token, webDist, backendEnv = {} }) {
  return {
    ...processEnv,
    // Pin NEXUS_AGENT_HOME so Python's resolve_home() lands in the SAME place
    // our resolveNexusHome() picked — without this, the child can fall back to
    // a different default and split config / .env / sessions / logs across two
    // directories.
    NEXUS_AGENT_HOME: home,
    ...backendEnv,
    // agent-gateway reads its dashboard session token from this name
    // (os.environ.get("AGENT_GATEWAY_SESSION_TOKEN") in __main__.py). The
    // legacy HERMES_DASHBOARD_SESSION_TOKEN name is NOT honored — do not
    // reintroduce it; see gateway-spawn.test.cjs.
    AGENT_GATEWAY_SESSION_TOKEN: token,
    HERMES_WEB_DIST: webDist,
    // Force line-buffered output from Python — without this, the gateway's
    // logger writes sit in a 4KB block buffer and never reach rememberLog
    // while the child is alive (devtools shows nothing even on errors).
    PYTHONUNBUFFERED: '1',
  }
}

module.exports = { buildGatewayChildEnv }
