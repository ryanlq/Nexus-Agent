# Nexus Agent Desktop

> Native desktop shell for **Nexus Agent**, built on Electron + Vite + React.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=nodedotjs)
![License](https://img.shields.io/badge/license-See%20upstream-blue)

## About

**Nexus Agent Desktop** is the desktop client module of the [Nexus Agent / Agent Gateway](https://github.com/ryanlq/agent-gateway) project. It provides a cross-platform native window, IPC bridge, local/remote gateway bootstrap, profile management, installer, updater, and a rich chat UI on top of the Nexus Agent backend (an agent-gateway server wrapping installed CLI agents such as Claude Code, Pi, Codex, etc.).

## Lineage

> This project is **derived from [Hermes Agent](https://github.com/NousResearch/hermes-agent)** by [Nous Research](https://nousresearch.com).
>
> Nexus Agent Desktop was created by **extracting the desktop/client module from the original Hermes Agent repository**, and reworking it as a standalone project under the **Nexus Agent** brand.
>
> - Upstream source: [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)
> - Upstream desktop module path (historical): `apps/desktop` inside the Hermes Agent monorepo
> - Desktop shell author (original): Nous Research
>
> We gratefully acknowledge Nous Research and the Hermes Agent contributors for the original work this project is built upon. The backend CLI, Python runtime, gateway protocols, and many of the design decisions still originate from Hermes Agent.

### What was carried over

- The Electron + Vite + React desktop shell (main process, preload, renderer)
- Installer / bootstrap / self-update flow for the local backend
- Local + remote gateway connection model, OAuth sign-in, session tokens
- Chat UI components (composer, thread, preview pane, tool approval, prompt overlays)
- Settings panels (model, gateway, MCP, toolsets, messaging, profiles, crons)
- i18n infrastructure (English + Chinese)

### What changed in the Nexus Agent fork

- Package name: `hermes-desktop` → `nexus-agent`
- Brand strings: "Hermes" / "Hermes Desktop" → "Nexus Agent"
- Config directory: `~/.hermes` → `~/.nexus-agent`
- App ID: `com.nousresearch.hermes` → `com.nousresearch.nexus-agent`
- Environment variables: `HERMES_DESKTOP_*` → `NEXUS_AGENT_*`
- Home variable: `HERMES_HOME` → `NEXUS_AGENT_HOME`
- IPC channel prefix: `hermes:*` → `nexus:*`
- Window API: `window.hermesDesktop` → `window.nexusAgent`
- Custom protocol: `hermes-media` → `nexus-media`
- Shared package: `@hermes/desktop-shared` → `@nexus-agent/desktop-shared`

TypeScript internal type names (e.g. `HermesConnection`, `HermesConfig`), the `hermes_cli` Python module references, and model names such as `hermes-4` are intentionally left untouched — they either belong to the upstream Hermes Agent codebase or are functional identifiers rather than brand strings.

## Project layout

```
hermes-desktop/         # this repo (working directory)
├── electron/           # Electron main process, bootstrap, hardening, IPC
├── src/                # React renderer (Vite + TypeScript)
│   ├── app/            # feature modules (chat, settings, messaging, gateway, …)
│   ├── components/     # shared UI components (assistant-ui, chat, overlays)
│   ├── i18n/           # en.ts / zh.ts translation dictionaries
│   ├── lib/            # utilities
│   └── store/          # nanostores state (boot, onboarding, updates, …)
├── shared/             # @nexus-agent/desktop-shared (renderer ↔ main types)
├── scripts/            # build, install helpers, profiling, test harness
├── assets/             # native app icons (icns / ico / png)
├── public/             # static web assets bundled into the renderer
└── package.json        # nexus-agent, main = electron/main.cjs
```

## Requirements

- **Node.js** `>= 24` (required by `@icons-pack/react-simple-icons@13.x`)
- A working Nexus Agent backend installation (resolved via `NEXUS_AGENT_HOME`, default `~/.nexus-agent`; the legacy `HERMES_HOME` / `~/.hermes` path is still detected for migration)
- On Windows: **Git for Windows** (provides Git Bash, required by the terminal tool)

## Getting started

```bash
# install dependencies
npm install

# run renderer + electron in dev mode (HMR on :5174)
npm run dev

# run against the local agent-gateway checkout
npm run dev:gateway

# production build + packaged electron
npm run build
npm run dist           # all platforms detected by electron-builder
npm run dist:mac       # macOS only (.app / .dmg / .zip)
npm run dist:win       # Windows only (NSIS / MSI)
npm run dist:linux     # Linux only (AppImage / deb / rpm)
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXUS_AGENT_HOME` | Override the per-user install root (default: `~/.nexus-agent` or `%LOCALAPPDATA%\nexus-agent`). |
| `NEXUS_AGENT_DEV_SERVER` | Point the packaged app at a dev renderer URL (e.g. `http://127.0.0.1:5174`). |
| `NEXUS_AGENT_BOOT_FAKE` | Drive the boot overlay through a scripted progress sequence for UI work. |
| `NEXUS_AGENT_BOOT_FAKE_STEP_MS` | Milliseconds per fake boot step. |
| `NEXUS_AGENT_AGENT_GATEWAY_ROOT` | Path to a local agent-gateway checkout (used by `npm run dev:gateway`). |
| `NEXUS_AGENT_DESKTOP_REMOTE_URL` / `NEXUS_AGENT_DESKTOP_REMOTE_TOKEN` | Force the desktop to attach to a remote gateway. |

## Testing

```bash
npm run test:desktop:platforms   # node --test over electron/*.test.cjs
npm run test:desktop:fresh       # install sandbox + launch packaged app
npm run test:desktop:existing    # launch packaged app against current PATH
npm run test:desktop:all         # everything
```

## Acknowledgements

- **[Nous Research](https://nousresearch.com)** — original author of Hermes Agent and its desktop shell.
- **[Hermes Agent](https://github.com/NousResearch/hermes-agent)** — the upstream project this fork was extracted from.
- The open-source Electron, Vite, React, nanostores, and assistant-ui ecosystems that power the UI.

## License

See the upstream Hermes Agent license for terms that apply to the portions derived from `NousResearch/hermes-agent`. Any additional work in this fork is licensed by its own contributors under the same terms unless otherwise noted.
