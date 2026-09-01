export type WorkspaceMode = "copy" | "ro" | "rw";
export type NetworkMode = "none" | "allowlist" | "full";
export type SandboxStatus = "running" | "stopped" | "creating" | "error";

export interface NetworkPolicy {
  mode: NetworkMode;
  allowed_hosts: string[];
}

export interface Policy {
  image: string;
  workspace_path: string;
  workspace_mode: WorkspaceMode;
  network: NetworkPolicy;
  blocked_commands: string[];
  cpus: number | null;
  memory_mb: number | null;
}

export interface Sandbox {
  id: string;
  name: string;
  status: SandboxStatus;
  created_at: string;
  policy: Policy;
}

export interface DockerStatus {
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface DiffSummary {
  files: number;
  additions: number;
  deletions: number;
}

export interface WorkspaceDiff {
  diff: string;
  truncated: boolean;
  summary: DiffSummary;
}

export interface RunLine {
  kind: "cmd" | "out" | "err" | "meta";
  text: string;
}

export const DEFAULT_POLICY: Policy = {
  image: "ubuntu:24.04",
  workspace_path: "",
  workspace_mode: "copy",
  network: { mode: "none", allowed_hosts: [] },
  blocked_commands: ["sudo", "git push", "docker", "shutdown", "reboot"],
  cpus: 2,
  memory_mb: 2048,
};

export interface Preset {
  key: string;
  label: string;
  sub: string;
  policy: Policy;
  /** Command auto-run in the new sandbox's console right after creation. */
  bootstrap?: string;
}

export const PRESETS: Preset[] = [
  {
    key: "custom",
    label: "Custom",
    sub: "Start from defaults",
    policy: DEFAULT_POLICY,
  },
  {
    key: "claude-code",
    label: "Claude Code",
    sub: "Agent runner, allowlisted network",
    policy: {
      image: "node:22-bookworm",
      workspace_path: "",
      workspace_mode: "copy",
      network: {
        mode: "allowlist",
        allowed_hosts: [
          "api.anthropic.com",
          "claude.ai",
          "statsig.anthropic.com",
          "registry.npmjs.org",
          "github.com",
        ],
      },
      blocked_commands: ["sudo", "git push", "docker", "shutdown", "reboot"],
      cpus: 4,
      memory_mb: 4096,
    },
    bootstrap:
      "npm install -g @anthropic-ai/claude-code && " +
      "echo && echo 'Claude Code installed. Click \"Open Terminal\" and run: claude'",
  },
  {
    key: "locked-down",
    label: "Locked down",
    sub: "No network, everything blocked",
    policy: {
      image: "ubuntu:24.04",
      workspace_path: "",
      workspace_mode: "copy",
      network: { mode: "none", allowed_hosts: [] },
      blocked_commands: [
        "sudo",
        "git push",
        "docker",
        "shutdown",
        "reboot",
        "ssh",
        "scp",
        "curl",
        "wget",
        "npm publish",
      ],
      cpus: 2,
      memory_mb: 2048,
    },
  },
  {
    key: "full-trust",
    label: "Full trust",
    sub: "Live mount, open network",
    policy: {
      image: "ubuntu:24.04",
      workspace_path: "",
      workspace_mode: "rw",
      network: { mode: "full", allowed_hosts: [] },
      blocked_commands: [],
      cpus: null,
      memory_mb: null,
    },
  },
];

export const KNOWN_IMAGES: { value: string; sub: string }[] = [
  { value: "ubuntu:24.04", sub: "Minimal Ubuntu LTS" },
  { value: "alpine", sub: "Tiny busybox-based image" },
  { value: "node:22-bookworm", sub: "Node.js 22 toolchain" },
  { value: "python:3.12-bookworm", sub: "Python 3.12 toolchain" },
  { value: "rust:1-bookworm", sub: "Rust stable toolchain" },
  { value: "golang:1.23-bookworm", sub: "Go 1.23 toolchain" },
];

export const BLOCKABLE_COMMANDS: { value: string; sub: string }[] = [
  { value: "sudo", sub: "Privilege escalation" },
  { value: "git push", sub: "Publishing to remotes" },
  { value: "docker", sub: "Nested containers" },
  { value: "shutdown", sub: "Power control" },
  { value: "reboot", sub: "Power control" },
  { value: "ssh", sub: "Outbound shells" },
  { value: "scp", sub: "File exfiltration" },
  { value: "curl", sub: "Arbitrary downloads" },
  { value: "wget", sub: "Arbitrary downloads" },
  { value: "npm publish", sub: "Package publishing" },
];
