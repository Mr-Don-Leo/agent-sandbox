import { Sandbox } from "../types";

const STATUS_PILL: Record<Sandbox["status"], string> = {
  running: "pill-success",
  stopped: "pill",
  creating: "pill-warning",
  error: "pill-danger",
};

const NETWORK_LABEL = {
  none: "No network",
  allowlist: "Allowlist",
  full: "Full network",
} as const;

export function SandboxesView(props: {
  sandboxes: Sandbox[];
  dockerError: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <>
      <div className="main-header">
        <div>
          <h1>Sandboxes</h1>
          <div className="subtitle">
            Disposable containers for coding agents, each with its own policy.
          </div>
        </div>
        <button className="btn btn-primary" onClick={props.onNew}>
          + New Sandbox
        </button>
      </div>

      <div className="main-body">
        {props.dockerError && <div className="banner">⚠ {props.dockerError}</div>}

        {props.sandboxes.length === 0 ? (
          <div className="empty-state">
            <div className="big-icon">📦</div>
            <h2>No sandboxes yet</h2>
            <p>
              Create one to run a coding agent inside a disposable container with
              filesystem, network, and command policies.
            </p>
            <button className="btn btn-primary" onClick={props.onNew}>
              Create your first sandbox
            </button>
          </div>
        ) : (
          <div className="sandbox-grid">
            {props.sandboxes.map((sandbox) => (
              <div
                key={sandbox.id}
                className="card card-hoverable sandbox-card"
                onClick={() => props.onOpen(sandbox.id)}
              >
                <div className="card-top">
                  <span className="card-name">{sandbox.name}</span>
                  <span className={`pill ${STATUS_PILL[sandbox.status]}`}>
                    <span className="dot" />
                    {sandbox.status}
                  </span>
                </div>
                <div className="card-meta">
                  <span className="mono">{sandbox.policy.image}</span>
                  <span className="mono">{sandbox.policy.workspace_path || "no workspace"}</span>
                </div>
                <div className="card-pills">
                  <span className="pill pill-accent">
                    {NETWORK_LABEL[sandbox.policy.network.mode]}
                  </span>
                  <span className="pill">
                    {sandbox.policy.workspace_mode === "copy"
                      ? "disposable copy"
                      : sandbox.policy.workspace_mode === "ro"
                        ? "read-only fs"
                        : "read-write fs"}
                  </span>
                  {sandbox.policy.blocked_commands.length > 0 && (
                    <span className="pill">
                      {sandbox.policy.blocked_commands.length} cmds blocked
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
