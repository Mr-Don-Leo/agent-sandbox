import type { DockerStatus, Policy, Sandbox, WorkspaceDiff } from "./types";

// In a Tauri window we call the Rust commands; in a plain browser (vite dev
// without the shell) we fall back to an in-memory mock so the UI stays usable.
const isTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface Backend {
  dockerStatus(): Promise<DockerStatus>;
  listSandboxes(): Promise<Sandbox[]>;
  createSandbox(name: string, policy: Policy): Promise<Sandbox>;
  startSandbox(id: string): Promise<void>;
  stopSandbox(id: string): Promise<void>;
  removeSandbox(id: string): Promise<void>;
  execStream(id: string, runId: string, command: string, cb: ExecCallbacks): Promise<void>;
  execStop(id: string, runId: string): Promise<void>;
  workspaceDiff(id: string): Promise<WorkspaceDiff>;
  applyWorkspace(id: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  openTerminal(id: string): Promise<void>;
}

export interface ExecCallbacks {
  onLine(kind: "out" | "err", text: string): void;
  onDone(exitCode: number, blocked: boolean): void;
}

const tauriBackend: Backend = {
  dockerStatus: () => invoke("docker_status"),
  listSandboxes: () => invoke("list_sandboxes"),
  createSandbox: (name, policy) => invoke("create_sandbox", { name, policy }),
  startSandbox: (id) => invoke("start_sandbox", { id }),
  stopSandbox: (id) => invoke("stop_sandbox", { id }),
  removeSandbox: (id) => invoke("remove_sandbox", { id }),
  async execStream(id, runId, command, cb) {
    const { listen } = await import("@tauri-apps/api/event");
    type LineEvent = { run_id: string; kind: "out" | "err"; text: string };
    type DoneEvent = { run_id: string; exit_code: number; blocked: boolean };

    const unsubs: (() => void)[] = [];
    const cleanup = () => unsubs.splice(0).forEach((u) => u());

    unsubs.push(
      await listen<LineEvent>("exec:line", (e) => {
        if (e.payload.run_id === runId) cb.onLine(e.payload.kind, e.payload.text);
      }),
      await listen<DoneEvent>("exec:done", (e) => {
        if (e.payload.run_id !== runId) return;
        cleanup();
        cb.onDone(e.payload.exit_code, e.payload.blocked);
      }),
    );
    try {
      await invoke("exec_stream", { id, runId, command });
    } catch (e) {
      cleanup();
      throw e;
    }
  },
  execStop: (id, runId) => invoke("exec_stop", { id, runId }),
  workspaceDiff: (id) => invoke("workspace_diff", { id }),
  applyWorkspace: (id) => invoke("apply_workspace", { id }),
  async pickFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  },
  openTerminal: (id) => invoke("open_terminal", { id }),
};

// ── Mock backend for browser development ─────────────────────────────────
const mockSandboxes: Sandbox[] = [];
let mockId = 0;

function firstWordBlocked(command: string, policy: Policy): string | null {
  const trimmed = command.trim();
  for (const blocked of policy.blocked_commands) {
    if (trimmed === blocked || trimmed.startsWith(blocked + " ")) return blocked;
  }
  return null;
}

const mockBackend: Backend = {
  async dockerStatus() {
    return {
      available: false,
      version: null,
      error: "Running in browser preview — Docker calls are mocked.",
    };
  },
  async listSandboxes() {
    return [...mockSandboxes];
  },
  async createSandbox(name, policy) {
    const sandbox: Sandbox = {
      id: `mock-${++mockId}`,
      name,
      status: "running",
      created_at: new Date().toISOString(),
      policy,
    };
    mockSandboxes.push(sandbox);
    return sandbox;
  },
  async startSandbox(id) {
    const s = mockSandboxes.find((s) => s.id === id);
    if (s) s.status = "running";
  },
  async stopSandbox(id) {
    const s = mockSandboxes.find((s) => s.id === id);
    if (s) s.status = "stopped";
  },
  async removeSandbox(id) {
    const i = mockSandboxes.findIndex((s) => s.id === id);
    if (i >= 0) mockSandboxes.splice(i, 1);
  },
  async execStream(id, _runId, command, cb) {
    const s = mockSandboxes.find((s) => s.id === id);
    if (!s) throw new Error("sandbox not found");
    const blocked = firstWordBlocked(command, s.policy);
    if (blocked) {
      setTimeout(() => {
        cb.onLine("err", `agentsandbox: blocked by command policy: ${blocked}`);
        cb.onDone(126, true);
      }, 250);
      return;
    }
    [1, 2, 3].forEach((n) =>
      setTimeout(() => cb.onLine("out", `(mock) ${command} — line ${n}`), n * 400),
    );
    setTimeout(() => cb.onDone(0, false), 1500);
  },
  async execStop() {},
  async workspaceDiff() {
    const diff = [
      "--- host/src/main.py",
      "+++ sandbox/src/main.py",
      "@@ -1,3 +1,4 @@",
      " import sys",
      "-print('hello')",
      "+print('hello, world')",
      "+print(sys.argv)",
    ].join("\n");
    return {
      diff,
      truncated: false,
      summary: { files: 1, additions: 2, deletions: 1 },
    };
  },
  async applyWorkspace() {},
  async pickFolder() {
    return null; // no native picker in the browser preview
  },
  async openTerminal() {
    throw new Error("Terminal is only available in the desktop app");
  },
};

export const backend: Backend = isTauri ? tauriBackend : mockBackend;
export const isMock = !isTauri;
