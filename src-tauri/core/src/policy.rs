use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceMode {
    /// Workspace is copied into the container; the host original is untouched.
    Copy,
    /// Workspace bind-mounted read-only.
    Ro,
    /// Workspace bind-mounted read-write.
    Rw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkMode {
    None,
    Allowlist,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPolicy {
    pub mode: NetworkMode,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    pub image: String,
    pub workspace_path: String,
    pub workspace_mode: WorkspaceMode,
    pub network: NetworkPolicy,
    #[serde(default)]
    pub blocked_commands: Vec<String>,
    pub cpus: Option<f64>,
    pub memory_mb: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SandboxStatus {
    Running,
    Stopped,
    Creating,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sandbox {
    pub id: String,
    pub name: String,
    pub status: SandboxStatus,
    pub created_at: String,
    pub policy: Policy,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_roundtrips_with_frontend_field_names() {
        let json = r#"{
            "image": "ubuntu:24.04",
            "workspace_path": "/home/u/proj",
            "workspace_mode": "copy",
            "network": {"mode": "allowlist", "allowed_hosts": ["registry.npmjs.org"]},
            "blocked_commands": ["sudo", "git push"],
            "cpus": 2.0,
            "memory_mb": 2048
        }"#;
        let policy: Policy = serde_json::from_str(json).unwrap();
        assert_eq!(policy.workspace_mode, WorkspaceMode::Copy);
        assert_eq!(policy.network.mode, NetworkMode::Allowlist);
        assert_eq!(policy.network.allowed_hosts, vec!["registry.npmjs.org"]);

        let back = serde_json::to_string(&policy).unwrap();
        let again: Policy = serde_json::from_str(&back).unwrap();
        assert_eq!(again.blocked_commands, vec!["sudo", "git push"]);
    }
}
