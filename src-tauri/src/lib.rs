use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use agentsandbox_core::{docker, proxy, shim, NetworkMode, Policy, Sandbox, SandboxStatus, WorkspaceMode};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct DockerStatus {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct ExecResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
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

#[tauri::command]
fn exec_in_sandbox(id: String, command: String) -> Result<ExecResult, String> {
    let output = Command::new("docker")
        .args(["exec", id.as_str(), "sh", "-c", command.as_str()])
        .output()
        .map_err(|e| format!("failed to invoke docker: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let exit_code = output.status.code().unwrap_or(-1);
    Ok(ExecResult {
        exit_code,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        blocked: exit_code == shim::BLOCKED_EXIT_CODE && stderr.contains(shim::BLOCKED_MARKER),
        stderr,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            docker_status,
            list_sandboxes,
            create_sandbox,
            start_sandbox,
            stop_sandbox,
            remove_sandbox,
            exec_in_sandbox,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentSandbox");
}
