use std::collections::BTreeMap;

/// Directory inside the container where shims are mounted (prepended to PATH).
pub const SHIM_DIR: &str = "/opt/agentsandbox/shims";

/// Exit code shims use when refusing a command, mirrored by the exec handler.
pub const BLOCKED_EXIT_CODE: i32 = 126;

/// Marker printed to stderr by shims so callers can distinguish a policy block
/// from an ordinary command failure.
pub const BLOCKED_MARKER: &str = "agentsandbox: blocked by command policy:";

/// Turn a blocked-commands policy into PATH shim scripts, one per binary.
///
/// A bare entry ("sudo") blocks the binary outright. A two-word entry
/// ("git push") shims the binary and only refuses that first subcommand,
/// delegating everything else to the real executable found later in PATH.
/// Shims are best-effort guardrails, not a security boundary — real
/// containment comes from the container, filesystem, and network policy.
pub fn shims_for(blocked_commands: &[String]) -> BTreeMap<String, String> {
    let mut full_block: Vec<&str> = Vec::new();
    let mut sub_blocks: BTreeMap<&str, Vec<&str>> = BTreeMap::new();

    for entry in blocked_commands {
        let mut words = entry.split_whitespace();
        match (words.next(), words.next()) {
            (Some(bin), None) => full_block.push(bin),
            (Some(bin), Some(sub)) => sub_blocks.entry(bin).or_default().push(sub),
            (None, _) => {}
        }
    }

    let mut shims = BTreeMap::new();

    for bin in &full_block {
        shims.insert(
            bin.to_string(),
            format!(
                "#!/bin/sh\n\
                 echo \"{marker} {bin}\" >&2\n\
                 exit {code}\n",
                marker = BLOCKED_MARKER,
                bin = bin,
                code = BLOCKED_EXIT_CODE,
            ),
        );
    }

    for (bin, subs) in &sub_blocks {
        // A full block on the same binary wins over subcommand blocks.
        if full_block.contains(bin) {
            continue;
        }
        let checks = subs
            .iter()
            .map(|sub| {
                format!(
                    "if [ \"$1\" = \"{sub}\" ]; then\n\
                     \x20\x20echo \"{marker} {bin} {sub}\" >&2\n\
                     \x20\x20exit {code}\n\
                     fi\n",
                    marker = BLOCKED_MARKER,
                    code = BLOCKED_EXIT_CODE,
                )
            })
            .collect::<String>();
        shims.insert(
            bin.to_string(),
            format!(
                "#!/bin/sh\n\
                 {checks}\
                 clean_path=$(echo \"$PATH\" | tr ':' '\\n' | grep -vx '{shim_dir}' | paste -sd:)\n\
                 real=$(PATH=\"$clean_path\" command -v {bin} 2>/dev/null)\n\
                 if [ -z \"$real\" ]; then\n\
                 \x20\x20echo \"{bin}: not found\" >&2\n\
                 \x20\x20exit 127\n\
                 fi\n\
                 exec \"$real\" \"$@\"\n",
                shim_dir = SHIM_DIR,
            ),
        );
    }

    shims
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn bare_command_gets_full_block() {
        let shims = shims_for(&strings(&["sudo"]));
        let script = &shims["sudo"];
        assert!(script.contains("exit 126"));
        assert!(script.contains(BLOCKED_MARKER));
        assert!(!script.contains("exec"));
    }

    #[test]
    fn subcommand_block_delegates_other_uses() {
        let shims = shims_for(&strings(&["git push"]));
        let script = &shims["git"];
        assert!(script.contains("if [ \"$1\" = \"push\" ]"));
        assert!(script.contains("exec \"$real\""));
        assert!(script.contains(SHIM_DIR));
    }

    #[test]
    fn multiple_subcommands_share_one_shim() {
        let shims = shims_for(&strings(&["git push", "git remote"]));
        assert_eq!(shims.len(), 1);
        let script = &shims["git"];
        assert!(script.contains("\"push\""));
        assert!(script.contains("\"remote\""));
    }

    #[test]
    fn full_block_wins_over_subcommand_block() {
        let shims = shims_for(&strings(&["git", "git push"]));
        let script = &shims["git"];
        assert!(!script.contains("exec"));
    }

    #[test]
    fn empty_policy_yields_no_shims() {
        assert!(shims_for(&[]).is_empty());
    }
}
