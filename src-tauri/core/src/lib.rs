//! Policy engine for AgentSandbox: translates sandbox policies into Docker
//! invocations, command shims, and the allowlist egress proxy. Pure logic —
//! no process spawning — so it stays testable without a Docker daemon.

pub mod docker;
pub mod policy;
pub mod proxy;
pub mod shim;

pub use policy::{NetworkMode, NetworkPolicy, Policy, Sandbox, SandboxStatus, WorkspaceMode};
