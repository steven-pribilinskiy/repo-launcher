use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::config::{load_config, AppConfig};
use super::repos::{list_distros, Repo};

/// Resolve which WSL distro hosts the goto-repo cache. Config override wins;
/// else the first non-docker distro (autodetected once, then memoized to keep the
/// popup off the `wsl --list` spawn path); else "Ubuntu". Windows-relevant only.
pub fn resolve_distro(config: &AppConfig) -> String {
    if let Some(distro) = &config.wsl_distro {
        if !distro.trim().is_empty() {
            return distro.clone();
        }
    }
    static AUTO_DISTRO: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    AUTO_DISTRO
        .get_or_init(|| {
            let start = Instant::now();
            let distro = list_distros()
                .ok()
                .and_then(|distros| distros.into_iter().next())
                .unwrap_or_else(|| "Ubuntu".to_string());
            log::info!(
                "resolve_distro: autodetect via WSL registry took {} ms -> {}",
                start.elapsed().as_millis(),
                distro
            );
            distro
        })
        .clone()
}

/// Resolve the goto-repo cache dir (holds repos.tsv + sort) and config dir
/// (holds history). On Windows these are UNC paths into the WSL distro; on
/// Linux/macOS they are the native ~/.cache/goto-repo and ~/.config/goto-repo.
fn goto_dirs(config: &AppConfig) -> Result<(PathBuf, PathBuf), String> {
    if let Some(cache_path) = &config.cache_path {
        if !cache_path.trim().is_empty() {
            let cache_dir = PathBuf::from(cache_path);
            let config_dir = derive_config_dir(cache_path);
            return Ok((cache_dir, config_dir));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let distro = resolve_distro(config);
        // Use the cached $HOME when present; only spawn wsl.exe if we must.
        let home = match config.wsl_home.as_deref() {
            Some(cached) if !cached.trim().is_empty() => cached.to_string(),
            _ => wsl_home(&distro)?,
        };
        let base = format!("\\\\wsl.localhost\\{}", distro);
        let to_unc = |posix: String| -> PathBuf {
            PathBuf::from(format!("{}{}", base, posix.replace('/', "\\")))
        };
        Ok((
            to_unc(format!("{}/.cache/goto-repo", home)),
            to_unc(format!("{}/.config/goto-repo", home)),
        ))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().ok_or("Cannot resolve home dir")?;
        Ok((
            home.join(".cache").join("goto-repo"),
            home.join(".config").join("goto-repo"),
        ))
    }
}

/// If the cache dir override sits under a `.cache/goto-repo` segment, point the
/// config dir at the sibling `.config/goto-repo`; otherwise reuse the cache dir.
fn derive_config_dir(cache_path: &str) -> PathBuf {
    for (cache_seg, config_seg) in [("/.cache/", "/.config/"), ("\\.cache\\", "\\.config\\")] {
        if cache_path.contains(cache_seg) {
            return PathBuf::from(cache_path.replace(cache_seg, config_seg));
        }
    }
    PathBuf::from(cache_path)
}

#[cfg(target_os = "windows")]
fn wsl_home(distro: &str) -> Result<String, String> {
    static HOME_CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, String>>> =
        std::sync::OnceLock::new();
    let cache = HOME_CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()));
    if let Some(home) = cache.lock().unwrap().get(distro) {
        return Ok(home.clone());
    }

    use std::os::windows::process::CommandExt;
    let spawn = Instant::now();
    let output = Command::new("wsl")
        .args(["-d", distro, "--", "bash", "-lc", "printf %s \"$HOME\""])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — no console flash on startup
        .output()
        .map_err(|err| format!("Failed to query WSL home: {}", err))?;
    log::info!(
        "wsl_home: `wsl.exe` spawn for distro {} took {} ms",
        distro,
        spawn.elapsed().as_millis()
    );
    let home = super::repos::decode_wsl_output(&output.stdout)
        .trim()
        .trim_matches('\0')
        .to_string();
    if home.is_empty() {
        return Err(format!("Empty HOME for distro {}", distro));
    }
    cache.lock().unwrap().insert(distro.to_string(), home.clone());
    Ok(home)
}

/// First-launch priming: detect the WSL distro and $HOME once and persist them to
/// config, so later launches build the UNC cache path with zero wsl.exe spawns
/// (each spawn cold-starts the WSL VM — the dominant startup delay). Run off-thread.
#[cfg(target_os = "windows")]
pub fn prime_wsl_cache(app: &AppHandle) {
    let Ok(mut config) = load_config(app) else { return };
    let mut changed = false;
    if config.wsl_distro.as_deref().unwrap_or("").trim().is_empty() {
        if let Ok(Some(distro)) = list_distros().map(|distros| distros.into_iter().next()) {
            log::info!("startup: caching WSL distro '{}'", distro);
            config.wsl_distro = Some(distro);
            changed = true;
        }
    }
    if config.wsl_home.as_deref().unwrap_or("").trim().is_empty() {
        let distro = resolve_distro(&config);
        if let Ok(home) = wsl_home(&distro) {
            log::info!("startup: caching WSL home '{}'", home);
            config.wsl_home = Some(home);
            changed = true;
        }
    }
    // One-shot desktop shortcut: a genuinely fresh install (not yet onboarded) gets
    // one icon; existing users don't get a surprise. Either way mark it done so it's
    // never auto-created again — the user owns it via the Settings button afterwards.
    if !config.desktop_shortcut_initialized {
        if !config.onboarded {
            if let Err(error) = super::repos::create_desktop_shortcut() {
                log::warn!("desktop shortcut: {}", error);
            }
        }
        config.desktop_shortcut_initialized = true;
        changed = true;
    }
    if changed {
        let _ = super::config::persist_config(app, &config);
    }
}

fn repos_tsv(config: &AppConfig) -> Result<PathBuf, String> {
    Ok(goto_dirs(config)?.0.join("repos.tsv"))
}

fn sort_file(config: &AppConfig) -> Result<PathBuf, String> {
    Ok(goto_dirs(config)?.0.join("sort"))
}

fn history_file(config: &AppConfig) -> Result<PathBuf, String> {
    Ok(goto_dirs(config)?.1.join("history"))
}

/// Parse repos.tsv (skip the header line; lines are `<type>\t<path>`).
fn parse_cache(content: &str, distro: &str) -> Vec<Repo> {
    content
        .lines()
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let kind = parts.next().unwrap_or("").trim().to_string();
            let path = parts.next().unwrap_or("").trim().to_string();
            if path.is_empty() {
                None
            } else {
                Some(Repo {
                    kind,
                    path,
                    distro: distro.to_string(),
                    uses: 0,
                    last_used: 0,
                })
            }
        })
        .collect()
}

fn read_repo_cache(config: &AppConfig) -> Result<Vec<Repo>, String> {
    let tsv = repos_tsv(config)?;
    let distro = resolve_distro(config);
    if !tsv.exists() {
        // First run with no cache yet — build it once, blocking.
        let _ = run_rebuild(config, true);
    }
    let read = Instant::now();
    let content = std::fs::read_to_string(&tsv)
        .map_err(|err| format!("Cannot read {}: {}", tsv.display(), err))?;
    log::info!(
        "read_repo_cache: read {} ({} bytes) in {} ms",
        tsv.display(),
        content.len(),
        read.elapsed().as_millis()
    );
    Ok(parse_cache(&content, &distro))
}

/// path -> (usage count, most-recent timestamp), aggregated from history.
fn read_history_stats(config: &AppConfig) -> HashMap<String, (u64, u64)> {
    let mut stats: HashMap<String, (u64, u64)> = HashMap::new();
    let Ok(path) = history_file(config) else {
        return stats;
    };
    let Ok(content) = std::fs::read_to_string(path) else {
        return stats;
    };
    for line in content.lines() {
        let mut parts = line.splitn(2, '\t');
        let ts = parts.next().unwrap_or("").trim().parse::<u64>().unwrap_or(0);
        let repo_path = parts.next().unwrap_or("").trim();
        if repo_path.is_empty() {
            continue;
        }
        let entry = stats.entry(repo_path.to_string()).or_insert((0, 0));
        entry.0 += 1;
        if ts > entry.1 {
            entry.1 = ts;
        }
    }
    stats
}

pub fn read_sort_mode(config: &AppConfig) -> u8 {
    sort_file(config)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| raw.trim().parse::<u8>().ok())
        .filter(|mode| *mode <= 2)
        .unwrap_or(2)
}

fn write_sort_mode(config: &AppConfig, mode: u8) -> Result<(), String> {
    let path = sort_file(config)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(path, mode.to_string()).map_err(|err| err.to_string())
}

/// Pure ranking core, mirroring rank-repos.sh: 0 = alpha (by path), 1 = recent
/// (max history ts desc), 2 = most-used (count desc). The sort is stable, so ties
/// keep cache order (akin to find-repo's fzf --tiebreak=index).
fn rank_by(mode: u8, mut repos: Vec<Repo>, stats: &HashMap<String, (u64, u64)>) -> Vec<Repo> {
    match mode {
        1 | 2 => repos.sort_by(|left, right| {
            let left_stat = stats.get(&left.path).copied().unwrap_or((0, 0));
            let right_stat = stats.get(&right.path).copied().unwrap_or((0, 0));
            let key = |stat: (u64, u64)| if mode == 1 { stat.1 } else { stat.0 };
            key(right_stat).cmp(&key(left_stat))
        }),
        _ => repos.sort_by(|left, right| left.path.cmp(&right.path)),
    }
    repos
}

fn rank(config: &AppConfig, mut repos: Vec<Repo>) -> Vec<Repo> {
    let mode = read_sort_mode(config);
    let stats = read_history_stats(config);
    // Attach usage stats to every repo so the table view can show/sort by them.
    for repo in repos.iter_mut() {
        if let Some((uses, last)) = stats.get(&repo.path) {
            repo.uses = *uses;
            repo.last_used = *last;
        }
    }
    rank_by(mode, repos, &stats)
}

/// Build the rebuild command (program + args) from config or per-OS default.
fn rebuild_command(config: &AppConfig) -> Vec<String> {
    if let Some(cmd) = &config.rebuild_command {
        if !cmd.is_empty() {
            return cmd.clone();
        }
    }
    #[cfg(target_os = "windows")]
    {
        let distro = resolve_distro(config);
        vec![
            "wsl.exe".into(),
            "-d".into(),
            distro,
            "--".into(),
            "bash".into(),
            "-lc".into(),
            "find-repo --rebuild".into(),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec!["bash".into(), "-lc".into(), "find-repo --rebuild".into()]
    }
}

/// Run the goto-repo cache rebuild. `blocking` waits for completion (used when the
/// cache is missing or on explicit refresh); otherwise spawn-and-forget.
fn run_rebuild(config: &AppConfig, blocking: bool) -> Result<(), String> {
    let parts = rebuild_command(config);
    let (program, args) = parts.split_first().ok_or("Empty rebuild command")?;
    let mut command = Command::new(program);
    command.args(args);
    // CREATE_NO_WINDOW — the rebuild runs inside WSL; don't flash a console window
    // (e.g. the background maybe_refresh on a stale cache at startup).
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    if blocking {
        command
            .output()
            .map_err(|err| format!("Rebuild failed: {}", err))?;
    } else {
        command
            .spawn()
            .map_err(|err| format!("Rebuild failed: {}", err))?;
    }
    Ok(())
}

/// Append a usage record to the shared goto-repo history (feeds frecency ranking
/// for both this app and the `fr`/`g` shell tool).
pub fn append_history(config: &AppConfig, repo_path: &str) -> Result<(), String> {
    let path = history_file(config)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|dur| dur.as_secs())
        .unwrap_or(0);
    let line = format!("{}\t{}\n", ts, repo_path);
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| err.to_string())?;
    file.write_all(line.as_bytes()).map_err(|err| err.to_string())
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Read the goto-repo cache and return it ranked by the shared sort mode.
#[tauri::command]
pub fn read_repos(app: AppHandle) -> Result<Vec<Repo>, String> {
    let total = Instant::now();
    let config = load_config(&app)?;
    let repos = read_repo_cache(&config)?;
    let count = repos.len();
    let ranked = rank(&config, repos);
    log::info!(
        "read_repos: {} repos ready in {} ms (total)",
        count,
        total.elapsed().as_millis()
    );
    Ok(ranked)
}

/// Rebuild the cache (blocking, delegates to goto-repo) then return it ranked.
#[tauri::command]
pub fn refresh_repos(app: AppHandle) -> Result<Vec<Repo>, String> {
    let config = load_config(&app)?;
    run_rebuild(&config, true)?;
    let repos = read_repo_cache(&config)?;
    Ok(rank(&config, repos))
}

/// Kick a non-blocking background rebuild if the cache is older than the TTL.
#[tauri::command]
pub fn maybe_refresh(app: AppHandle) -> Result<(), String> {
    let config = load_config(&app)?;
    let tsv = repos_tsv(&config)?;
    let stale = std::fs::metadata(&tsv)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .map(|age| age.as_secs() > config.cache_ttl_seconds)
        .unwrap_or(true);
    if stale {
        run_rebuild(&config, false)?;
    }
    Ok(())
}

/// Current sort mode (0/1/2).
#[tauri::command]
pub fn get_sort(app: AppHandle) -> Result<u8, String> {
    let config = load_config(&app)?;
    Ok(read_sort_mode(&config))
}

/// Cycle the shared sort mode (alpha -> recent -> most-used) and return the
/// re-ranked repos. The change is written to the shared `sort` file, so `fr`/`g`
/// pick it up too.
#[tauri::command]
pub fn cycle_sort(app: AppHandle) -> Result<Vec<Repo>, String> {
    let config = load_config(&app)?;
    let next = (read_sort_mode(&config) + 1) % 3;
    write_sort_mode(&config, next)?;
    let repos = read_repo_cache(&config)?;
    Ok(rank(&config, repos))
}

// ── Data diagnostics ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PathStat {
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub modified_unix: u64,
}

#[derive(Serialize)]
pub struct TopUsed {
    pub path: String,
    pub uses: u64,
    pub last_unix: u64,
}

#[derive(Serialize)]
pub struct DataInfo {
    pub distro: String,
    pub cache_dir: String,
    pub config_dir: String,
    pub repos_tsv: PathStat,
    pub sort_file: PathStat,
    pub history_file: PathStat,
    pub log_file: PathStat,
    pub repo_count: usize,
    pub sort_mode: u8,
    pub sort_label: String,
    pub unique_paths: usize,
    pub history_entries: u64,
    pub top_used: Vec<TopUsed>,
}

fn path_stat(path: &Path) -> PathStat {
    let meta = std::fs::metadata(path).ok();
    PathStat {
        path: path.display().to_string(),
        exists: meta.is_some(),
        size: meta.as_ref().map(|meta| meta.len()).unwrap_or(0),
        modified_unix: meta
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|dur| dur.as_secs())
            .unwrap_or(0),
    }
}

/// Everything that drives the app: the goto-repo files it reads, their sizes, the
/// resolved distro, the sort mode, and the most-used paths from history.
#[tauri::command]
pub fn data_info(app: AppHandle) -> Result<DataInfo, String> {
    let config = load_config(&app)?;
    let (cache_dir, config_dir) = goto_dirs(&config)?;
    let repos = read_repo_cache(&config).unwrap_or_default();
    let stats = read_history_stats(&config);
    let sort_mode = read_sort_mode(&config);
    let labels = ["alpha", "recent", "most-used"];

    let mut top: Vec<TopUsed> = stats
        .iter()
        .map(|(path, (uses, last))| TopUsed {
            path: path.clone(),
            uses: *uses,
            last_unix: *last,
        })
        .collect();
    top.sort_by(|left, right| {
        right
            .uses
            .cmp(&left.uses)
            .then(right.last_unix.cmp(&left.last_unix))
    });
    top.truncate(12);

    // tauri-plugin-log writes <app_log_dir>/repo-launcher.log (file_name + ".log").
    let log_path = app
        .path()
        .app_log_dir()
        .map(|dir| dir.join("repo-launcher.log"))
        .unwrap_or_else(|_| PathBuf::from("repo-launcher.log"));

    Ok(DataInfo {
        distro: resolve_distro(&config),
        cache_dir: cache_dir.display().to_string(),
        config_dir: config_dir.display().to_string(),
        repos_tsv: path_stat(&cache_dir.join("repos.tsv")),
        sort_file: path_stat(&cache_dir.join("sort")),
        history_file: path_stat(&config_dir.join("history")),
        log_file: path_stat(&log_path),
        repo_count: repos.len(),
        sort_mode,
        sort_label: labels.get(sort_mode as usize).unwrap_or(&"?").to_string(),
        unique_paths: stats.len(),
        history_entries: stats.values().map(|(uses, _)| *uses).sum(),
        top_used: top,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cache_skips_header_and_trims_kind() {
        let tsv = "3 repos · 1 worktrees\nrepo\t/home/me/a\n  wt\t/home/me/b.worktrees/x\n dir\t/home/me/group\n\n";
        let repos = parse_cache(tsv, "Ubuntu");
        assert_eq!(repos.len(), 3);
        assert_eq!(repos[0].kind, "repo");
        assert_eq!(repos[0].path, "/home/me/a");
        assert_eq!(repos[1].kind, "wt");
        assert_eq!(repos[2].kind, "dir");
        assert_eq!(repos[0].distro, "Ubuntu");
    }

    fn repo(path: &str) -> Repo {
        Repo {
            kind: "repo".into(),
            path: path.into(),
            distro: "Ubuntu".into(),
            uses: 0,
            last_used: 0,
        }
    }

    #[test]
    fn rank_alpha_sorts_by_path() {
        let repos = vec![repo("/z"), repo("/a"), repo("/m")];
        let ranked = rank_by(0, repos, &HashMap::new());
        assert_eq!(
            ranked.iter().map(|item| item.path.as_str()).collect::<Vec<_>>(),
            vec!["/a", "/m", "/z"]
        );
    }

    #[test]
    fn rank_most_used_sorts_by_count_desc() {
        let mut stats = HashMap::new();
        stats.insert("/a".to_string(), (1u64, 100u64));
        stats.insert("/b".to_string(), (5u64, 50u64));
        let ranked = rank_by(2, vec![repo("/a"), repo("/b")], &stats);
        assert_eq!(ranked[0].path, "/b"); // higher count first
    }

    #[test]
    fn rank_recent_sorts_by_timestamp_desc() {
        let mut stats = HashMap::new();
        stats.insert("/a".to_string(), (1u64, 100u64));
        stats.insert("/b".to_string(), (5u64, 50u64));
        let ranked = rank_by(1, vec![repo("/a"), repo("/b")], &stats);
        assert_eq!(ranked[0].path, "/a"); // most recent ts first
    }

    #[test]
    fn rank_ties_keep_cache_order() {
        // Equal stats -> stable sort preserves input order.
        let ranked = rank_by(2, vec![repo("/first"), repo("/second")], &HashMap::new());
        assert_eq!(ranked[0].path, "/first");
        assert_eq!(ranked[1].path, "/second");
    }
}
