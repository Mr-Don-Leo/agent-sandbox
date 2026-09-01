import { useCallback, useEffect, useState } from "react";
import { backend, isMock } from "./backend";
import { applyTheme, loadSkin, loadThemePref, Skin, ThemePref, watchSystemTheme } from "./theme";
import { Policy, Sandbox } from "./types";
import { NewSandboxModal } from "./views/NewSandboxModal";
import { SandboxDetail } from "./views/SandboxDetail";
import { SandboxesView } from "./views/SandboxesView";
import { SettingsView } from "./views/SettingsView";

type View = { kind: "list" } | { kind: "sandbox"; id: string } | { kind: "settings" };

const STATUS_COLOR: Record<Sandbox["status"], string> = {
  running: "var(--success)",
  stopped: "var(--text-tertiary)",
  creating: "var(--warning)",
  error: "var(--danger)",
};

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [themePref, setThemePref] = useState<ThemePref>(loadThemePref);
  const [skin, setSkin] = useState<Skin>(loadSkin);

  useEffect(() => {
    applyTheme(themePref, skin);
    return watchSystemTheme(() => applyTheme(themePref, skin));
  }, [themePref, skin]);

  const refresh = useCallback(async () => {
    try {
      setSandboxes(await backend.listSandboxes());
    } catch (e) {
      setDockerError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    backend.dockerStatus().then((status) => {
      if (!status.available) setDockerError(status.error ?? "Docker is not available.");
    });
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const createSandbox = async (name: string, policy: Policy) => {
    const sandbox = await backend.createSandbox(name, policy);
    await refresh();
    setView({ kind: "sandbox", id: sandbox.id });
  };

  const current =
    view.kind === "sandbox" ? sandboxes.find((s) => s.id === view.id) : undefined;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logo">AS</span>
          <span className="name">AgentSandbox</span>
        </div>

        <button
          className={`sidebar-item${view.kind === "list" ? " active" : ""}`}
          onClick={() => setView({ kind: "list" })}
        >
          <span className="label">All sandboxes</span>
          <span className="pill">{sandboxes.length}</span>
        </button>

        <div className="sidebar-section">Sandboxes</div>
        {sandboxes.map((sandbox) => (
          <button
            key={sandbox.id}
            className={`sidebar-item${
              view.kind === "sandbox" && view.id === sandbox.id ? " active" : ""
            }`}
            onClick={() => setView({ kind: "sandbox", id: sandbox.id })}
          >
            <span
              className="status-dot"
              style={{ background: STATUS_COLOR[sandbox.status] }}
            />
            <span className="label">{sandbox.name}</span>
          </button>
        ))}

        <div className="sidebar-footer">
          <button
            className={`sidebar-item${view.kind === "settings" ? " active" : ""}`}
            onClick={() => setView({ kind: "settings" })}
          >
            <span className="label">Settings</span>
          </button>
          {isMock && (
            <div className="sidebar-section" title="Docker calls are mocked">
              Browser preview
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {view.kind === "list" && (
          <SandboxesView
            sandboxes={sandboxes}
            dockerError={dockerError}
            onOpen={(id) => setView({ kind: "sandbox", id })}
            onNew={() => setShowNew(true)}
          />
        )}
        {view.kind === "sandbox" &&
          (current ? (
            <SandboxDetail
              sandbox={current}
              onChanged={refresh}
              onRemoved={() => {
                setView({ kind: "list" });
                refresh();
              }}
            />
          ) : (
            <div className="empty-state">
              <h2>Sandbox not found</h2>
              <button className="btn" onClick={() => setView({ kind: "list" })}>
                Back to list
              </button>
            </div>
          ))}
        {view.kind === "settings" && (
          <SettingsView
            themePref={themePref}
            skin={skin}
            onThemePref={setThemePref}
            onSkin={setSkin}
          />
        )}
      </main>

      {showNew && (
        <NewSandboxModal onClose={() => setShowNew(false)} onCreate={createSandbox} />
      )}
    </div>
  );
}
