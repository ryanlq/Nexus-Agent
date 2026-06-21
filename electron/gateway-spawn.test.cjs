/**
 * Tests for electron/gateway-spawn.cjs.
 *
 * Run with: node --test electron/gateway-spawn.test.cjs
 * (Wired into npm test:desktop:platforms in package.json.)
 *
 * Guards the agent-gateway child env: the session token MUST land under the
 * name the gateway actually reads, and the dead HERMES_DASHBOARD_SESSION_TOKEN
 * name MUST NOT come back. That drift broke pooled local backends — every
 * request 401'd because the gateway generated its own mismatched token.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildGatewayChildEnv } = require('./gateway-spawn.cjs')

test('buildGatewayChildEnv sets the session token under the name the gateway reads', () => {
  const env = buildGatewayChildEnv({
    processEnv: { PATH: 'x' },
    home: '/home/nexus',
    token: 'tok-1',
    webDist: '/wd',
  })
  // agent-gateway __main__.py reads AGENT_GATEWAY_SESSION_TOKEN; any other name
  // is silently ignored and the gateway mints its own token → mismatch → 401.
  assert.equal(env.AGENT_GATEWAY_SESSION_TOKEN, 'tok-1')
})

test('buildGatewayChildEnv does NOT set the dead HERMES_DASHBOARD_SESSION_TOKEN name', () => {
  const env = buildGatewayChildEnv({
    processEnv: {},
    home: '/h',
    token: 't',
    webDist: '/w',
  })
  assert.equal('HERMES_DASHBOARD_SESSION_TOKEN' in env, false)
})

test('buildGatewayChildEnv pins home/webDist/unbuffered and merges process + backend env', () => {
  const env = buildGatewayChildEnv({
    processEnv: { PATH: 'x', INHERITED: 'keep' },
    home: '/home/nexus',
    token: 'tok',
    webDist: '/wd',
    backendEnv: { BACKEND_ONLY: 'b' },
  })
  assert.equal(env.NEXUS_AGENT_HOME, '/home/nexus')
  assert.equal(env.PYTHONUNBUFFERED, '1')
  assert.equal(env.HERMES_WEB_DIST, '/wd')
  assert.equal(env.PATH, 'x')
  assert.equal(env.INHERITED, 'keep')
  assert.equal(env.BACKEND_ONLY, 'b')
})

test('buildGatewayChildEnv overrides an inherited NEXUS_AGENT_HOME from process env', () => {
  // The pin must win over whatever process.env carries — that's the whole
  // point (the child must resolve the same home the desktop picked).
  const env = buildGatewayChildEnv({
    processEnv: { NEXUS_AGENT_HOME: '/wrong' },
    home: '/home/nexus',
    token: 't',
    webDist: '/w',
  })
  assert.equal(env.NEXUS_AGENT_HOME, '/home/nexus')
})
