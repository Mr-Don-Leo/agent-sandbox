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

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  blocked: boolean;
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

export const KNOWN_IMAGES: { value: string; sub: string }[] = [
  { value: "ubuntu:24.04", sub: "Minimal Ubuntu LTS" },
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
