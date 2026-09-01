import { useEffect, useRef, useState } from "react";
import { backend } from "../backend";
import { RunLine, Sandbox } from "../types";
import { Modal } from "../ui/controls";
import { DiffModal } from "./DiffModal";

const STATUS_PILL: Record<Sandbox["status"], string> = {
  running: "pill-success",
  stopped: "pill",
  creating: "pill-warning",
  error: "pill-danger",
};

function describeNetwork(sandbox: Sandbox): string {
  const net = sandbox.policy.network;
  if (net.mode === "none") return "No network";
  if (net.mode === "full") return "Full access";
  return `Allowlist (${net.allowed_hosts.length} hosts)`;
}

export function SandboxDetail(props: {
  sandbox: Sandbox;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const { sandbox } = props;
  const [lines, setLines] = useState<RunLine[]>([]);
  const [command, setCommand] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);
  // Guards against events from a run started on a previously viewed sandbox.
  const activeRunRef = useRef<string | null>(null);
  const running = runId !== null;

  useEffect(() => {
    setLines([]);
    setCommand("");
    setRunId(null);
    setShowDiff(false);
    setConfirmDelete(false);
    activeRunRef.current = null;
  }, [sandbox.id]);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [lines]);

  const append = (line: RunLine) => setLines((prev) => [...prev, line]);

  const run = async () => {
    const cmd = command.trim();
    if (!cmd || running) return;
    setCommand("");
    const id = crypto.randomUUID();
    setRunId(id);
    activeRunRef.current = id;
    append({ kind: "cmd", text: `$ ${cmd}` });

    const isCurrent = () => activeRunRef.current === id;
    try {
      await backend.execStream(sandbox.id, id, cmd, {
        onLine: (kind, text) => {
          if (isCurrent()) append({ kind, text });
        },
        onDone: (exitCode, blocked) => {
          if (!isCurrent()) return;
          if (blocked) append({ kind: "meta", text: "blocked by command policy" });
          else if (exitCode !== 0) append({ kind: "meta", text: `exit code ${exitCode}` });
          setRunId(null);
          activeRunRef.current = null;
        },
      });
    } catch (e) {
      if (isCurrent()) {
        append({ kind: "err", text: String(e) });
        setRunId(null);
        activeRunRef.current = null;
      }
    }
  };

  const stopRun = () => {
    if (runId) backend.execStop(sandbox.id, runId).catch(() => {});
  };

  const toggleRunning = async () => {
    if (sandbox.status === "running") await backend.stopSandbox(sandbox.id);
    else await backend.startSandbox(sandbox.id);
    props.onChanged();
  };

  const remove = async () => {
    await backend.removeSandbox(sandbox.id);
    props.onRemoved();
  };

  return (
    <>
      <div className="main-header">
        <div>
          <div className="row">
            <h1>{sandbox.name}</h1>
            <span className={`pill ${STATUS_PILL[sandbox.status]}`}>
              <span className="dot" />
              {sandbox.status}
            </span>
          </div>
          <div className="subtitle mono selectable">{sandbox.id}</div>
        </div>
        <div className="row">
          <button className="btn" onClick={toggleRunning}>
            {sandbox.status === "running" ? "Stop" : "Start"}
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      <div className="main-body">
        <div className="detail-grid">
          <div className="card summary-card">
            <span className="summary-title">Image</span>
            <span className="summary-value mono selectable">{sandbox.policy.image}</span>
          </div>
          <div className="card summary-card">
            <span className="summary-title">Workspace</span>
            <span className="summary-value mono selectable">
              {sandbox.policy.workspace_path || "—"}
            </span>
            <div className="summary-list">
              {sandbox.policy.workspace_mode === "copy" && "Disposable copy"}
              {sandbox.policy.workspace_mode === "ro" && "Read-only mount"}
              {sandbox.policy.workspace_mode === "rw" && "Read-write mount"}
            </div>
            {sandbox.policy.workspace_mode === "copy" &&
              sandbox.policy.workspace_path && (
                <div>
                  <button className="btn btn-sm" onClick={() => setShowDiff(true)}>
                    Review changes
                  </button>
                </div>
              )}
          </div>
          <div className="card summary-card">
            <span className="summary-title">Network</span>
            <span className="summary-value">{describeNetwork(sandbox)}</span>
            {sandbox.policy.network.mode === "allowlist" && (
              <div className="summary-list selectable">
                {sandbox.policy.network.allowed_hosts.map((host) => (
                  <span className="mono" key={host}>
                    {host}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="card summary-card">
            <span className="summary-title">Command policy</span>
            <span className="summary-value">
              {sandbox.policy.blocked_commands.length} blocked
            </span>
            <div className="summary-list selectable">
              {sandbox.policy.blocked_commands.map((cmd) => (
                <span className="mono" key={cmd}>
                  {cmd}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="run-panel">
          <h2>Run</h2>
          <div className="console selectable" ref={consoleRef}>
            {lines.length === 0 && (
              <span className="line-meta">
                Commands run inside the container under this sandbox's policy.
              </span>
            )}
            {lines.map((line, i) => (
              <div key={i} className={`line-${line.kind}`}>
                {line.text}
              </div>
            ))}
            {running && (
              <span className="typing-dots" aria-label="Running">
                <span />
                <span />
                <span />
              </span>
            )}
            {!running && lines.length > 0 && <span className="console-cursor" />}
          </div>
          <div className="run-input-row">
            <input
              className="input mono"
              placeholder="npm test"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
              disabled={sandbox.status !== "running"}
            />
            {running ? (
              <button className="btn btn-danger" onClick={stopRun}>
                Stop
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={run}
                disabled={sandbox.status !== "running"}
              >
                Run
              </button>
            )}
          </div>
        </div>
      </div>

      {showDiff && (
        <DiffModal
          sandboxId={sandbox.id}
          workspacePath={sandbox.policy.workspace_path}
          onClose={() => setShowDiff(false)}
        />
      )}

      {confirmDelete && (
        <Modal
          title="Delete sandbox?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={remove}>
                Delete “{sandbox.name}”
              </button>
            </>
          }
        >
          <p>
            The container and any un-applied workspace changes inside it are
            destroyed. The host folder is not touched.
          </p>
        </Modal>
      )}
    </>
  );
}
