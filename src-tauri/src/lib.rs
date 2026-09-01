use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Emitter;

use agentsandbox_core::{docker, proxy, shim, sync, NetworkMode, Policy, Sandbox, SandboxStatus, WorkspaceMode};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct DockerStatus {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct ExecLine {
    run_id: String,
    kind: String,
    text: String,
}

#[derive(Clone, Serialize)]
struct ExecDone {
    run_id: String,
    exit_code: i32,
    blocked: bool,
}

fn docker(args: &[String]) -> Result<String, String> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .map_err(|e| format!("failed to invoke docker: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
fn docker_status() -> DockerStatus {
    match docker(&["version".into(), "--format".into(), "{{.Server.Version}}".into()]) {
        Ok(version) => DockerStatus {
            available: true,
            version: Some(version.trim().to_string()),
            error: None,
        },
        Err(error) => DockerStatus {
            available: false,
            version: None,
            error: Some(error.trim().to_string()),
        },
    }
}

#[tauri::command]
fn list_sandboxes() -> Result<Vec<Sandbox>, String> {
    // Container names (asb-<id>) are the canonical sandbox id everywhere —
    // create_sandbox returns them and every docker command accepts them.
    let format = concat!(
        "{{.Names}}\x1f{{.State}}\x1f{{.CreatedAt}}\x1f",
        "{{.Label \"agentsandbox.name\"}}\x1f{{.Label \"agentsandbox.policy\"}}"
    );
    let out = docker(&[
        "ps".into(),
        "-a".into(),
        "--filter".into(),
        "label=agentsandbox=1".into(),
        "--filter".into(),
        "name=asb-".into(),
        "--format".into(),
        format.into(),
    ])?;

    let mut sandboxes = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() != 5 || parts[3].is_empty() {
            continue; // proxy sidecars carry no name label
        }
        let Ok(policy) = serde_json::from_str::<Policy>(parts[4]) else {
            continue;
        };
        let status = match parts[1] {
            "running" => SandboxStatus::Running,
            "created" | "exited" | "paused" => SandboxStatus::Stopped,
            _ => SandboxStatus::Error,
        };
        sandboxes.push(Sandbox {
            id: parts[0].to_string(),
            name: parts[3].to_string(),
            status,
            created_at: parts[2].to_string(),
            policy,
        });
    }
    Ok(sandboxes)
}

fn shim_dir_for(app: &tauri::AppHandle, sandbox_id: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("shims")
        .join(sandbox_id);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

fn write_shims(dir: &PathBuf, scripts: &HashMap<String, String>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    for (bin, script) in scripts {
        let path = dir.join(bin);
        fs::write(&path, script).map_err(|e| e.to_string())?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn create_sandbox(app: tauri::AppHandle, name: String, policy: Policy) -> Result<Sandbox, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let id = format!("{nanos:x}");

    // Command shims (best-effort guardrails; see core::shim).
    let shim_scripts: HashMap<String, String> =
        shim::shims_for(&policy.blocked_commands).into_iter().collect();
    let shim_host_dir = if shim_scripts.is_empty() {
        None
    } else {
        let dir = shim_dir_for(&app, &id)?;
        write_shims(&dir, &shim_scripts)?;
        Some(dir.to_string_lossy().into_owned())
    };

    // Allowlist mode: internal network + filtering egress proxy sidecar.
    if policy.network.mode == NetworkMode::Allowlist {
        docker(&[
            "network".into(),
            "create".into(),
            "--internal".into(),
            docker::network_name(&id),
        ])?;
        let mut proxy_args = docker::proxy_run_args(&id, proxy::PROXY_IMAGE);
        *proxy_args.last_mut().unwrap() = proxy::proxy_program(&policy.network.allowed_hosts);
        docker(&proxy_args)?;
        // The proxy needs a way out; the sandbox stays internal-only.
        docker(&[
            "network".into(),
            "connect".into(),
            "bridge".into(),
            docker::proxy_container_name(&id),
        ])?;
    }

    let args = docker::run_args(&id, &name, &policy, shim_host_dir.as_deref());
    docker(&args)?;

    if policy.workspace_mode == WorkspaceMode::Copy && !policy.workspace_path.is_empty() {
        docker(&[
            "cp".into(),
            format!("{}/.", policy.workspace_path),
            format!("{}:{}", docker::container_name(&id), docker::WORKSPACE_DIR),
        ])?;
    }

    Ok(Sandbox {
        id: docker::container_name(&id),
        name,
        status: SandboxStatus::Running,
        created_at: String::new(),
        policy,
    })
}

#[tauri::command]
fn start_sandbox(id: String) -> Result<(), String> {
    docker(&["start".into(), id]).map(|_| ())
}

#[tauri::command]
fn stop_sandbox(id: String) -> Result<(), String> {
    docker(&["stop".into(), "-t".into(), "3".into(), id]).map(|_| ())
}

#[tauri::command]
fn remove_sandbox(id: String) -> Result<(), String> {
    docker(&["rm".into(), "-f".into(), id.clone()]).map(|_| ())?;

    // The allowlist sidecar network and proxy are named after the sandbox id
    // embedded in the container name (asb-<sandbox-id>); remove them too.
    if let Some(sandbox_id) = id.strip_prefix("asb-") {
        let _ = docker(&[
            "rm".into(),
            "-f".into(),
            docker::proxy_container_name(sandbox_id),
        ]);
        let _ = docker(&[
            "network".into(),
            "rm".into(),
            docker::network_name(sandbox_id),
        ]);
    }
    Ok(())
}

fn policy_of(id: &str) -> Result<Policy, String> {
    let json = docker(&[
        "inspect".into(),
        "--format".into(),
        r#"{{index .Config.Labels "agentsandbox.policy"}}"#.into(),
        id.to_string(),
    ])?;
    serde_json::from_str(json.trim()).map_err(|e| format!("unreadable sandbox policy: {e}"))
}

/// Stage the container workspace into a fresh temp dir; caller must remove it.
fn stage_workspace(id: &str) -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let staged = std::env::temp_dir().join(format!("agentsandbox-staged-{nanos:x}"));
    fs::create_dir_all(&staged).map_err(|e| e.to_string())?;
    docker(&sync::stage_args(id, &staged.to_string_lossy()))
        .map_err(|e| {
            let _ = fs::remove_dir_all(&staged);
            e
        })?;
    Ok(staged)
}

fn copy_mode_workspace(policy: &Policy) -> Result<String, String> {
    if policy.workspace_mode != WorkspaceMode::Copy {
        return Err("Change review is only available for disposable-copy workspaces".into());
    }
    if policy.workspace_path.trim().is_empty() {
        return Err("This sandbox has no workspace folder".into());
    }
    Ok(policy.workspace_path.clone())
}

const DIFF_LIMIT_BYTES: usize = 400_000;

#[derive(Serialize)]
pub struct WorkspaceDiff {
    diff: String,
    truncated: bool,
    summary: sync::DiffSummary,
}

#[tauri::command]
fn workspace_diff(id: String) -> Result<WorkspaceDiff, String> {
    let host = copy_mode_workspace(&policy_of(&id)?)?;
    let staged = stage_workspace(&id)?;
    let staged_str = staged.to_string_lossy().into_owned();

    let output = Command::new("diff")
        .args(sync::diff_args(&host, &staged_str))
        .output()
        .map_err(|e| format!("failed to invoke diff: {e}"));
    let result = match output {
        Ok(out) if out.status.code() == Some(0) || out.status.code() == Some(1) => {
            // Temp-dir paths mean nothing to the user; label the two sides.
            let mut diff = String::from_utf8_lossy(&out.stdout)
                .replace(&staged_str, "sandbox")
                .replace(&host, "host");
            let truncated = diff.len() > DIFF_LIMIT_BYTES;
            if truncated {
                diff.truncate(DIFF_LIMIT_BYTES);
                diff.push_str("\n… diff truncated …\n");
            }
            Ok(WorkspaceDiff { summary: sync::summarize_diff(&diff), diff, truncated })
        }
        Ok(out) => Err(String::from_utf8_lossy(&out.stderr).into_owned()),
        Err(e) => Err(e),
    };

    let _ = fs::remove_dir_all(&staged);
    result
}

#[tauri::command]
fn apply_workspace(id: String) -> Result<(), String> {
    let host = copy_mode_workspace(&policy_of(&id)?)?;
    let staged = stage_workspace(&id)?;
    let staged_str = staged.to_string_lossy().into_owned();

    let have_rsync = Command::new("rsync")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success());
    let (program, args) = if have_rsync {
        ("rsync", sync::apply_args_rsync(&staged_str, &host))
    } else {
        ("cp", sync::apply_args_cp(&staged_str, &host))
    };
    let result = Command::new(program)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to invoke {program}: {e}"))
        .and_then(|out| {
            if out.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).into_owned())
            }
        });

    let _ = fs::remove_dir_all(&staged);
    result
}

fn sandbox_id_of(container: &str) -> &str {
    container.strip_prefix("asb-").unwrap_or(container)
}

/// Start a command in the sandbox and stream its output as `exec:line`
/// events, finishing with one `exec:done`. Returns immediately.
#[tauri::command]
fn exec_stream(
    app: tauri::AppHandle,
    id: String,
    run_id: String,
    command: String,
) -> Result<(), String> {
    let run_id = docker::sanitize_run_id(&run_id);
    let mut child = Command::new("docker")
        .args(docker::exec_stream_args(sandbox_id_of(&id), &run_id, &command))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to invoke docker: {e}"))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let saw_marker = Arc::new(AtomicBool::new(false));

    let err_app = app.clone();
    let err_run_id = run_id.clone();
    let err_marker = saw_marker.clone();
    let err_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.contains(shim::BLOCKED_MARKER) {
                err_marker.store(true, Ordering::Relaxed);
            }
            let _ = err_app.emit(
                "exec:line",
                ExecLine { run_id: err_run_id.clone(), kind: "err".into(), text: line },
            );
        }
    });

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app.emit(
                "exec:line",
                ExecLine { run_id: run_id.clone(), kind: "out".into(), text: line },
            );
        }
        let _ = err_thread.join();
        let exit_code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        let blocked =
            exit_code == shim::BLOCKED_EXIT_CODE && saw_marker.load(Ordering::Relaxed);
        let _ = app.emit("exec:done", ExecDone { run_id, exit_code, blocked });
    });

    Ok(())
}

/// Open the user's terminal emulator with an interactive shell in the
/// sandbox, so they can poke around beyond one-off commands.
#[tauri::command]
fn open_terminal(id: String) -> Result<(), String> {
    let exec = format!("docker exec -it {id} sh");
    let candidates: &[(&str, Vec<String>)] = &[
        ("x-terminal-emulator", vec!["-e".into(), format!("sh -c '{exec}'")]),
        ("gnome-terminal", vec!["--".into(), "sh".into(), "-c".into(), exec.clone()]),
        ("konsole", vec!["-e".into(), "sh".into(), "-c".into(), exec.clone()]),
        ("ptyxis", vec!["--".into(), "sh".into(), "-c".into(), exec.clone()]),
        ("xterm", vec!["-e".into(), "sh".into(), "-c".into(), exec.clone()]),
    ];
    for (term, args) in candidates {
        if Command::new(*term).args(args).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(format!(
        "No terminal emulator found — run manually: {exec}"
    ))
}

/// Kill a streaming run inside the container; the closing streams end the
/// corresponding `exec_stream` naturally.
#[tauri::command]
fn exec_stop(id: String, run_id: String) -> Result<(), String> {
    docker(&docker::exec_kill_args(
        sandbox_id_of(&id),
        &docker::sanitize_run_id(&run_id),
    ))
    .map(|_| ())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            docker_status,
            list_sandboxes,
            create_sandbox,
            start_sandbox,
            stop_sandbox,
            remove_sandbox,
            exec_stream,
            exec_stop,
            open_terminal,
            workspace_diff,
            apply_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentSandbox");
}
