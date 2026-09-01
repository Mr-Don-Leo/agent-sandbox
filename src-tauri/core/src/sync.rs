/// Reviewing and applying changes from a disposable-copy workspace.
///
/// The container's `/workspace` is staged to a host temp dir with `docker cp`,
/// diffed against the original, and — on request — synced back over it.

/// Directories skipped both when diffing and when applying: build artifacts
/// that would drown the diff, plus `.git`, which the agent must never rewrite
/// on the host.
pub const SYNC_EXCLUDES: &[&str] = &[".git", "node_modules", "target", "dist", "__pycache__"];

/// `docker cp` arguments staging the container workspace into `staged_dir`.
pub fn stage_args(container: &str, staged_dir: &str) -> Vec<String> {
    vec![
        "cp".into(),
        format!("{container}:{}/.", crate::docker::WORKSPACE_DIR),
        staged_dir.into(),
    ]
}

/// `diff` arguments comparing the host workspace against the staged copy.
/// Exit code 0 = identical, 1 = differences, >1 = error.
pub fn diff_args(host_dir: &str, staged_dir: &str) -> Vec<String> {
    let mut args: Vec<String> = vec!["-ruN".into()];
    for exclude in SYNC_EXCLUDES {
        args.push(format!("--exclude={exclude}"));
    }
    args.push(host_dir.into());
    args.push(staged_dir.into());
    args
}

/// `rsync` arguments applying the staged copy over the host workspace,
/// including deletions. Excluded directories are left untouched on the host.
pub fn apply_args_rsync(staged_dir: &str, host_dir: &str) -> Vec<String> {
    let mut args: Vec<String> = vec!["-a".into(), "--delete".into()];
    for exclude in SYNC_EXCLUDES {
        args.push(format!("--exclude={exclude}"));
    }
    args.push(format!("{}/", staged_dir.trim_end_matches('/')));
    args.push(format!("{}/", host_dir.trim_end_matches('/')));
    args
}

/// Fallback when rsync is unavailable: `cp -a staged/. host/`. Overlays added
/// and modified files but cannot propagate deletions.
pub fn apply_args_cp(staged_dir: &str, host_dir: &str) -> Vec<String> {
    vec![
        "-a".into(),
        format!("{}/.", staged_dir.trim_end_matches('/')),
        format!("{}/", host_dir.trim_end_matches('/')),
    ]
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct DiffSummary {
    pub files: usize,
    pub additions: usize,
    pub deletions: usize,
}

/// Count changed files and +/- lines in unified diff output.
pub fn summarize_diff(diff: &str) -> DiffSummary {
    let mut summary = DiffSummary { files: 0, additions: 0, deletions: 0 };
    for line in diff.lines() {
        if line.starts_with("+++ ") {
            summary.files += 1;
        } else if line.starts_with("Only in ") {
            // `diff -r` reports unpairable binary/dir entries this way.
            summary.files += 1;
        } else if line.starts_with('+') && !line.starts_with("+++") {
            summary.additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            summary.deletions += 1;
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_args_exclude_artifacts_and_compare_both_dirs() {
        let args = diff_args("/home/u/proj", "/tmp/staged");
        assert_eq!(args[0], "-ruN");
        assert!(args.contains(&"--exclude=.git".to_string()));
        assert!(args.contains(&"--exclude=node_modules".to_string()));
        assert_eq!(&args[args.len() - 2..], &["/home/u/proj", "/tmp/staged"]);
    }

    #[test]
    fn rsync_apply_deletes_but_protects_git() {
        let args = apply_args_rsync("/tmp/staged", "/home/u/proj");
        assert!(args.contains(&"--delete".to_string()));
        assert!(args.contains(&"--exclude=.git".to_string()));
        assert_eq!(&args[args.len() - 2..], &["/tmp/staged/", "/home/u/proj/"]);
    }

    #[test]
    fn cp_fallback_overlays_staged_onto_host() {
        assert_eq!(
            apply_args_cp("/tmp/staged", "/home/u/proj"),
            ["-a", "/tmp/staged/.", "/home/u/proj/"]
        );
    }

    #[test]
    fn stage_pulls_workspace_contents() {
        assert_eq!(
            stage_args("asb-x", "/tmp/staged"),
            ["cp", "asb-x:/workspace/.", "/tmp/staged"]
        );
    }

    #[test]
    fn summarize_counts_files_and_line_changes() {
        let diff = "\
--- a/host/file.txt\n\
+++ b/sandbox/file.txt\n\
@@ -1,2 +1,2 @@\n\
-old line\n\
+new line\n\
+added line\n\
Only in /tmp/staged: brand-new.bin\n";
        assert_eq!(
            summarize_diff(diff),
            DiffSummary { files: 2, additions: 2, deletions: 1 }
        );
    }

    #[test]
    fn empty_diff_summarizes_to_zero() {
        assert_eq!(
            summarize_diff(""),
            DiffSummary { files: 0, additions: 0, deletions: 0 }
        );
    }
}
