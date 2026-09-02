import { useSyncExternalStore } from "react";
import { backend } from "./backend";
import { RunLine } from "./types";

// Run sessions live outside React so a command started in a sandbox keeps
// streaming (and its console history survives) while the user is on another
// screen. Views subscribe to the session for the sandbox they show.

export interface RunSession {
  lines: RunLine[];
  runId: string | null;
  history: string[];
}

const MAX_LINES = 5000;
const EMPTY_SESSION: RunSession = { lines: [], runId: null, history: [] };

const sessions = new Map<string, RunSession>();
const listeners = new Set<() => void>();
// Cached so useSyncExternalStore sees a stable identity between changes.
let activeIds: string[] = [];

function getSession(sandboxId: string): RunSession {
  return sessions.get(sandboxId) ?? EMPTY_SESSION;
}

function notify() {
  const next: string[] = [];
  sessions.forEach((session, id) => {
    if (session.runId !== null) next.push(id);
  });
  if (next.length !== activeIds.length || next.some((id, i) => id !== activeIds[i])) {
    activeIds = next;
  }
  listeners.forEach((listener) => listener());
}

function update(sandboxId: string, patch: Partial<RunSession>) {
  sessions.set(sandboxId, { ...getSession(sandboxId), ...patch });
  notify();
}

export function appendLine(sandboxId: string, line: RunLine) {
  const lines = [...getSession(sandboxId).lines, line];
  update(sandboxId, {
    lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines,
  });
}

export async function startRun(sandboxId: string, cmd: string): Promise<void> {
  const session = getSession(sandboxId);
  if (!cmd || session.runId !== null) return;
  const id = crypto.randomUUID();
  update(sandboxId, { runId: id });
  appendLine(sandboxId, { kind: "cmd", text: `$ ${cmd}` });

  const isCurrent = () => getSession(sandboxId).runId === id;
  try {
    await backend.execStream(sandboxId, id, cmd, {
      onLine: (kind, text) => {
        if (isCurrent()) appendLine(sandboxId, { kind, text });
      },
      onDone: (exitCode, blocked) => {
        if (!isCurrent()) return;
        if (blocked) {
          appendLine(sandboxId, { kind: "meta", text: "blocked by command policy" });
        } else if (exitCode !== 0) {
          appendLine(sandboxId, { kind: "meta", text: `exit code ${exitCode}` });
        }
        update(sandboxId, { runId: null });
      },
    });
  } catch (e) {
    if (isCurrent()) {
      appendLine(sandboxId, { kind: "err", text: String(e) });
      update(sandboxId, { runId: null });
    }
  }
}

export function stopRun(sandboxId: string) {
  const { runId } = getSession(sandboxId);
  if (runId) backend.execStop(sandboxId, runId).catch(() => {});
}

export function pushHistory(sandboxId: string, cmd: string) {
  update(sandboxId, { history: [...getSession(sandboxId).history, cmd] });
}

/** Forget a removed sandbox's console so a future sandbox can't inherit it. */
export function dropSession(sandboxId: string) {
  if (sessions.delete(sandboxId)) notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunSession(sandboxId: string): RunSession {
  return useSyncExternalStore(subscribe, () => getSession(sandboxId));
}

/** Ids of sandboxes with a command currently running, for ambient indicators. */
export function useActiveRunIds(): string[] {
  return useSyncExternalStore(subscribe, () => activeIds);
}
