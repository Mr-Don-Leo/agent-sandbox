import { useEffect, useState } from "react";
import { backend } from "../backend";
import { WorkspaceDiff } from "../types";
import { Modal } from "../ui/controls";

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-file";
  if (line.startsWith("Only in ")) return "diff-file";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "diff-ctx";
}

export function DiffModal(props: {
  sandboxId: string;
  workspacePath: string;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    backend
      .workspaceDiff(props.sandboxId)
      .then(setDiff)
      .catch((e) => setError(String(e)));
  }, [props.sandboxId]);

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      await backend.applyWorkspace(props.sandboxId);
      setApplied(true);
    } catch (e) {
      setError(String(e));
    }
    setApplying(false);
    setConfirming(false);
  };

  const clean = diff !== null && diff.summary.files === 0 && diff.diff.trim() === "";

  return (
    <Modal
      title="Workspace changes"
      onClose={props.onClose}
      footer={
        applied ? (
          <button className="btn btn-primary" onClick={props.onClose}>
            Done
          </button>
        ) : confirming ? (
          <>
            <span className="field-hint" style={{ marginRight: "auto" }}>
              This overwrites files in {props.workspacePath} (deletions included;
              .git is never touched).
            </span>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className="btn btn-danger" onClick={apply} disabled={applying}>
              {applying ? "Applying…" : "Overwrite host files"}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={props.onClose}>
              Close
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setConfirming(true)}
              disabled={diff === null || clean}
            >
              Apply to host…
            </button>
          </>
        )
      }
    >
      {error && <div className="banner">{error}</div>}
      {applied && (
        <div className="banner banner-success">
          Changes applied to {props.workspacePath}.
        </div>
      )}

      {diff === null && !error ? (
        <div className="empty-state">
          <span className="typing-dots" aria-label="Loading diff">
            <span />
            <span />
            <span />
          </span>
          <p>Comparing sandbox against host…</p>
        </div>
      ) : diff !== null && clean ? (
        <div className="empty-state">
          <div className="big-icon">✓</div>
          <p>No changes — the sandbox workspace matches the host.</p>
        </div>
      ) : diff !== null ? (
        <>
          <div className="chip-row">
            <span className="pill pill-accent">{diff.summary.files} files</span>
            <span className="pill pill-success">+{diff.summary.additions}</span>
            <span className="pill pill-danger">−{diff.summary.deletions}</span>
            {diff.truncated && <span className="pill pill-warning">truncated</span>}
          </div>
          <div className="diff-view selectable">
            {diff.diff.split("\n").map((line, i) => (
              <div key={i} className={lineClass(line)}>
                {line || " "}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
