use crate::policy::{NetworkMode, Policy, WorkspaceMode};
use crate::proxy::PROXY_PORT;
use crate::shim::SHIM_DIR;

/// Where the agent's project lives inside the container.
pub const WORKSPACE_DIR: &str = "/workspace";

/// Label marking containers managed by this app.
pub const APP_LABEL: &str = "agentsandbox";

pub fn container_name(id: &str) -> String {
    format!("asb-{id}")
}

pub fn network_name(id: &str) -> String {
    format!("asb-net-{id}")
}

pub fn proxy_container_name(id: &str) -> String {
    format!("asb-proxy-{id}")
}

/// Arguments for `docker run` creating the sandbox container. The container
/// idles on `sleep infinity`; agent commands arrive via `docker exec`.
pub fn run_args(
    id: &str,
    name: &str,
    policy: &Policy,
    shim_host_dir: Option<&str>,
) -> Vec<String> {
    let policy_json =
        serde_json::to_string(policy).expect("policy serialization cannot fail");

    let mut args: Vec<String> = vec![
        "run".into(),
        "-d".into(),
        "--name".into(),
        container_name(id),
        "--label".into(),
        format!("{APP_LABEL}=1"),
        "--label".into(),
        format!("{APP_LABEL}.name={name}"),
        "--label".into(),
        format!("{APP_LABEL}.policy={policy_json}"),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "-w".into(),
        WORKSPACE_DIR.into(),
    ];

    match policy.network.mode {
        NetworkMode::None => {
            args.push("--network".into());
            args.push("none".into());
        }
        NetworkMode::Full => {}
        NetworkMode::Allowlist => {
            let proxy_url =
                format!("http://{}:{}", proxy_container_name(id), PROXY_PORT);
            args.push("--network".into());
            args.push(network_name(id));
            for var in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
                args.push("--env".into());
                args.push(format!("{var}={proxy_url}"));
            }
            args.push("--env".into());
            args.push("NO_PROXY=localhost,127.0.0.1".into());
        }
    }

    match policy.workspace_mode {
        WorkspaceMode::Ro => {
            args.push("-v".into());
            args.push(format!("{}:{WORKSPACE_DIR}:ro", policy.workspace_path));
        }
        WorkspaceMode::Rw => {
            args.push("-v".into());
            args.push(format!("{}:{WORKSPACE_DIR}", policy.workspace_path));
        }
        // Copy mode: no mount; the caller `docker cp`s the workspace in after
        // the container exists, so the host original is never exposed.
        WorkspaceMode::Copy => {}
    }

    if let Some(shim_dir) = shim_host_dir {
        args.push("-v".into());
        args.push(format!("{shim_dir}:{SHIM_DIR}:ro"));
        args.push("--env".into());
        args.push(format!(
            "PATH={SHIM_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        ));
    }

    if let Some(cpus) = policy.cpus {
        args.push("--cpus".into());
        args.push(format!("{cpus}"));
    }
    if let Some(memory_mb) = policy.memory_mb {
        args.push("--memory".into());
        args.push(format!("{memory_mb}m"));
    }

    args.push(policy.image.clone());
    args.push("sleep".into());
    args.push("infinity".into());
    args
}

/// Arguments for `docker run` starting the allowlist egress proxy sidecar.
/// It joins the internal sandbox network here and is connected to the default
/// bridge afterwards (`docker network connect bridge <proxy>`), making it the
/// sandbox's only route out.
pub fn proxy_run_args(id: &str, proxy_image: &str) -> Vec<String> {
    vec![
        "run".into(),
        "-d".into(),
        "--name".into(),
        proxy_container_name(id),
        "--label".into(),
        format!("{APP_LABEL}=1"),
        "--label".into(),
        format!("{APP_LABEL}.role=proxy"),
        "--label".into(),
        format!("{APP_LABEL}.owner={id}"),
        "--network".into(),
        network_name(id),
        proxy_image.into(),
        "python".into(),
        "-c".into(),
        // Program text appended by the caller (kept out of these args so tests
        // can assert the wiring without the full script).
        String::new(),
    ]
}

/// Arguments to execute one shell command inside the sandbox.
pub fn exec_args(id: &str, command: &str) -> Vec<String> {
    vec![
        "exec".into(),
        container_name(id),
        "sh".into(),
        "-lc".into(),
        command.into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::NetworkPolicy;

    fn policy() -> Policy {
        Policy {
            image: "ubuntu:24.04".into(),
            workspace_path: "/home/u/proj".into(),
            workspace_mode: WorkspaceMode::Copy,
            network: NetworkPolicy {
                mode: NetworkMode::None,
                allowed_hosts: vec![],
            },
            blocked_commands: vec!["sudo".into()],
            cpus: Some(2.0),
            memory_mb: Some(2048),
        }
    }

    fn pair_present(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2)
            .any(|w| w[0] == flag && w[1] == value)
    }

    #[test]
    fn no_network_mode_disables_networking() {
        let args = run_args("abc", "demo", &policy(), None);
        assert!(pair_present(&args, "--network", "none"));
        assert!(!args.iter().any(|a| a.starts_with("HTTP_PROXY")));
    }

    #[test]
    fn full_network_mode_omits_network_flags() {
        let mut p = policy();
        p.network.mode = NetworkMode::Full;
        let args = run_args("abc", "demo", &p, None);
        assert!(!args.contains(&"--network".to_string()));
    }

    #[test]
    fn allowlist_mode_joins_internal_network_with_proxy_env() {
        let mut p = policy();
        p.network.mode = NetworkMode::Allowlist;
        let args = run_args("abc", "demo", &p, None);
        assert!(pair_present(&args, "--network", "asb-net-abc"));
        assert!(args.contains(&"HTTPS_PROXY=http://asb-proxy-abc:3128".to_string()));
    }

    #[test]
    fn copy_mode_never_mounts_the_workspace() {
        let args = run_args("abc", "demo", &policy(), None);
        assert!(!args.contains(&"-v".to_string()));
    }

    #[test]
    fn readonly_mode_mounts_with_ro_flag() {
        let mut p = policy();
        p.workspace_mode = WorkspaceMode::Ro;
        let args = run_args("abc", "demo", &p, None);
        assert!(pair_present(&args, "-v", "/home/u/proj:/workspace:ro"));
    }

    #[test]
    fn shim_dir_is_mounted_readonly_and_leads_path() {
        let args = run_args("abc", "demo", &policy(), Some("/data/shims/abc"));
        assert!(pair_present(&args, "-v", "/data/shims/abc:/opt/agentsandbox/shims:ro"));
        let path_env = args
            .iter()
            .find(|a| a.starts_with("PATH="))
            .expect("PATH env set");
        assert!(path_env.starts_with("PATH=/opt/agentsandbox/shims:"));
    }

    #[test]
    fn resource_limits_and_image_are_applied() {
        let args = run_args("abc", "demo", &policy(), None);
        assert!(pair_present(&args, "--cpus", "2"));
        assert!(pair_present(&args, "--memory", "2048m"));
        let image_pos = args.iter().position(|a| a == "ubuntu:24.04").unwrap();
        assert_eq!(&args[image_pos + 1..], &["sleep", "infinity"]);
    }

    #[test]
    fn policy_label_roundtrips() {
        let args = run_args("abc", "demo", &policy(), None);
        let label = args
            .iter()
            .find(|a| a.starts_with("agentsandbox.policy="))
            .unwrap();
        let json = label.trim_start_matches("agentsandbox.policy=");
        let parsed: Policy = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.image, "ubuntu:24.04");
    }
}
