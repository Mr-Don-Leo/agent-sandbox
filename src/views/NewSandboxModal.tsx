import { useState } from "react";
import { backend, isMock } from "../backend";
import {
  BLOCKABLE_COMMANDS,
  DEFAULT_POLICY,
  KNOWN_IMAGES,
  NetworkMode,
  Policy,
  WorkspaceMode,
} from "../types";
import { Checkbox, Dropdown, Field, Modal, Segmented } from "../ui/controls";

export function NewSandboxModal(props: {
  onClose: () => void;
  onCreate: (name: string, policy: Policy) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState<Policy>({ ...DEFAULT_POLICY });
  const [hostDraft, setHostDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (changes: Partial<Policy>) =>
    setPolicy((p) => ({ ...p, ...changes }));

  const addHost = () => {
    const host = hostDraft.trim().toLowerCase();
    if (!host || policy.network.allowed_hosts.includes(host)) return;
    patch({
      network: {
        ...policy.network,
        allowed_hosts: [...policy.network.allowed_hosts, host],
      },
    });
    setHostDraft("");
  };

  const create = async () => {
    if (!name.trim()) {
      setError("Give the sandbox a name.");
      return;
    }
    if (!policy.workspace_path.trim()) {
      setError("Choose a workspace folder to expose to the agent.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onCreate(name.trim(), policy);
      props.onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New Sandbox"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create Sandbox"}
          </button>
        </>
      }
    >
      {error && <div className="banner">{error}</div>}

      <div className="grid-2">
        <Field label="Name">
          <input
            className="input"
            value={name}
            placeholder="my-agent-run"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Base image">
          <Dropdown
            ariaLabel="Base image"
            value={policy.image}
            options={KNOWN_IMAGES}
            onChange={(image) => patch({ image })}
          />
        </Field>
      </div>

      <Field
        label="Workspace"
        hint="The project folder the agent works on. Copy mode clones it into the container so the original is untouched until you apply changes."
      >
        <div className="row">
          <input
            className="input mono"
            value={policy.workspace_path}
            placeholder="/home/you/projects/my-app"
            onChange={(e) => patch({ workspace_path: e.target.value })}
          />
          {!isMock && (
            <button
              className="btn"
              onClick={async () => {
                const picked = await backend.pickFolder();
                if (picked) patch({ workspace_path: picked });
              }}
            >
              Browse…
            </button>
          )}
        </div>
      </Field>

      <Field label="Workspace access">
        <Segmented<WorkspaceMode>
          ariaLabel="Workspace access"
          value={policy.workspace_mode}
          options={[
            { value: "copy", label: "Disposable copy" },
            { value: "ro", label: "Read-only" },
            { value: "rw", label: "Read-write" },
          ]}
          onChange={(workspace_mode) => patch({ workspace_mode })}
        />
      </Field>

      <Field label="Network">
        <Segmented<NetworkMode>
          ariaLabel="Network"
          value={policy.network.mode}
          options={[
            { value: "none", label: "No network" },
            { value: "allowlist", label: "Allowlist" },
            { value: "full", label: "Full access" },
          ]}
          onChange={(mode) => patch({ network: { ...policy.network, mode } })}
        />
      </Field>

      {policy.network.mode === "allowlist" && (
        <Field
          label="Allowed hosts"
          hint="Only these hosts are reachable, via the sandbox's egress proxy."
        >
          <div className="chip-row">
            {policy.network.allowed_hosts.map((host) => (
              <span className="chip" key={host}>
                {host}
                <button
                  aria-label={`Remove ${host}`}
                  onClick={() =>
                    patch({
                      network: {
                        ...policy.network,
                        allowed_hosts: policy.network.allowed_hosts.filter(
                          (h) => h !== host,
                        ),
                      },
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="input mono"
              style={{ width: 220, flex: "none" }}
              value={hostDraft}
              placeholder="registry.npmjs.org"
              onChange={(e) => setHostDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addHost();
              }}
              onBlur={addHost}
            />
          </div>
        </Field>
      )}

      <Field label="Blocked commands" hint="Best-effort PATH shims inside the container; combine with network and filesystem policy for real containment.">
        <div className="checkbox-grid">
          {BLOCKABLE_COMMANDS.map((cmd) => (
            <Checkbox
              key={cmd.value}
              checked={policy.blocked_commands.includes(cmd.value)}
              label={<span className="mono">{cmd.value}</span>}
              sub={cmd.sub}
              onChange={(checked) =>
                patch({
                  blocked_commands: checked
                    ? [...policy.blocked_commands, cmd.value]
                    : policy.blocked_commands.filter((c) => c !== cmd.value),
                })
              }
            />
          ))}
        </div>
      </Field>

      <div className="grid-2">
        <Field label="CPU limit" hint="Cores available to the container.">
          <Dropdown
            ariaLabel="CPU limit"
            value={policy.cpus === null ? "unlimited" : String(policy.cpus)}
            options={[
              { value: "1", label: "1 core" },
              { value: "2", label: "2 cores" },
              { value: "4", label: "4 cores" },
              { value: "unlimited", label: "Unlimited" },
            ]}
            onChange={(v) => patch({ cpus: v === "unlimited" ? null : Number(v) })}
          />
        </Field>
        <Field label="Memory limit">
          <Dropdown
            ariaLabel="Memory limit"
            value={policy.memory_mb === null ? "unlimited" : String(policy.memory_mb)}
            options={[
              { value: "1024", label: "1 GB" },
              { value: "2048", label: "2 GB" },
              { value: "4096", label: "4 GB" },
              { value: "8192", label: "8 GB" },
              { value: "unlimited", label: "Unlimited" },
            ]}
            onChange={(v) =>
              patch({ memory_mb: v === "unlimited" ? null : Number(v) })
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
