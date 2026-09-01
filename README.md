# AgentSandbox

Safely execute coding agents inside disposable Docker containers with
filesystem, network, and command policies. Linux desktop app built with
Tauri 2 + React.

## How it works

Each sandbox is a Docker container idling on `sleep infinity`; agent commands
run in it via `docker exec` under the sandbox's policy:

- **Filesystem** — the workspace is exposed as a *disposable copy* (`docker cp`
  into the container; the host original is untouched), *read-only* mount, or
  *read-write* mount. For disposable copies, **Review changes** shows a colored
  diff of what the agent did (build artifacts excluded) and **Apply to host**
  syncs it back — deletions included, `.git` never touched.
- **Network** — *no network* (`--network none`), *full access*, or *allowlist*:
  the container joins an internal (no-egress) Docker network whose only way out
  is a filtering HTTP CONNECT proxy sidecar that refuses hosts not on the
  allowlist (subdomains of allowed hosts are permitted).
- **Commands** — blocked commands (e.g. `sudo`, `git push`) become read-only
  PATH shims inside the container that refuse with exit 126. Two-word entries
  block only that subcommand and delegate everything else to the real binary.
  Shims are best-effort guardrails, not a security boundary — real containment
  comes from the container plus the filesystem and network policy.
- **Resources** — optional `--cpus` / `--memory` limits, and
  `--security-opt no-new-privileges` on every sandbox.

Sandboxes are self-describing: the policy is stored as a JSON label on the
container, so the app needs no local database and survives restarts.

Commands stream their output live and can be stopped mid-run (the app records
the run's PID inside the container and TERMs it). **Open Terminal** launches
your terminal emulator with an interactive shell in the sandbox, and the run
input keeps per-sandbox history (↑/↓).

## Repository layout

- `src/` — React frontend. Tokens-only theming (`src/styles/tokens.css`) with
  three skins (`apple` light/dark, `cyberpunk`, `xp`) and fully custom
  controls (dropdowns, checkboxes, toggles, segmented controls, modals) so
  nothing falls back to native WebKitGTK widgets. In a plain browser
  (`npm run dev` without the Tauri shell) Docker calls are mocked.
- `src-tauri/core/` — `agentsandbox-core`: pure policy engine (policy →
  `docker run` args, shim generation, proxy program + host matching). No
  process spawning; unit-tested without a Docker daemon.
- `src-tauri/src/` — Tauri shell: commands that drive the `docker` CLI
  (create/start/stop/remove/exec, status, listing).

## Development

Requirements: Node 20+, Rust stable, Docker, and Tauri's Linux system
dependencies (`webkit2gtk4.1-devel`, `gtk3-devel`, `librsvg2-devel` on Fedora).

```sh
npm install
npm run tauri dev        # full app (needs webkit2gtk)
npm run dev              # frontend only, mocked backend
npm run build            # type-check + bundle frontend
cd src-tauri && cargo test -p agentsandbox-core   # policy engine tests
```

`npm run tauri build` produces deb/rpm/AppImage bundles.
