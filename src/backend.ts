import type { DockerStatus, ExecResult, Policy, Sandbox } from "./types";

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
  execInSandbox(id: string, command: string): Promise<ExecResult>;
}

const tauriBackend: Backend = {
  dockerStatus: () => invoke("docker_status"),
  listSandboxes: () => invoke("list_sandboxes"),
  createSandbox: (name, policy) => invoke("create_sandbox", { name, policy }),
  startSandbox: (id) => invoke("start_sandbox", { id }),
  stopSandbox: (id) => invoke("stop_sandbox", { id }),
  removeSandbox: (id) => invoke("remove_sandbox", { id }),
  execInSandbox: (id, command) => invoke("exec_in_sandbox", { id, command }),
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
  async execInSandbox(id, command) {
    const s = mockSandboxes.find((s) => s.id === id);
    if (!s) throw new Error("sandbox not found");
    const blocked = firstWordBlocked(command, s.policy);
    if (blocked) {
      return {
        exit_code: 126,
        stdout: "",
        stderr: `agentsandbox: '${blocked}' is blocked by this sandbox's command policy`,
        blocked: true,
      };
    }
    return {
      exit_code: 0,
      stdout: `(mock) executed in ${s.name}: ${command}`,
      stderr: "",
      blocked: false,
    };
  },
};

export const backend: Backend = isTauri ? tauriBackend : mockBackend;
export const isMock = !isTauri;
