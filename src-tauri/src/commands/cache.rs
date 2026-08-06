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
    if changed {
        let _ = super::config::persist_config(app, &config);
    }
}

fn repos_tsv(config: &AppConfig) -> Result<PathBuf, String> {
    Ok(goto_dirs(config)?.0.join("repos.tsv"))
}

/// Which goto-repo directory a file lives in.
#[derive(Clone, Copy)]
enum CacheDir {
    /// `~/.cache/goto-repo` — holds repos.tsv and sort.
    Cache,
    /// `~/.config/goto-repo` — holds history.
    Config,
}

/// The WSL POSIX cache/config dirs, for the `wsl.exe cat` read fallback. Present
/// only on Windows when resolving the default (non-override) path — an explicit
/// `cache_path` override has no known POSIX equivalent.
#[cfg(target_os = "windows")]
fn wsl_posix_dirs(config: &AppConfig) -> Option<(String, String)> {
    if config.cache_path.as_deref().map(|path| !path.trim().is_empty()).unwrap_or(false) {
        return None;
    }
    let distro = resolve_distro(config);
    let home = match config.wsl_home.as_deref() {
        Some(cached) if !cached.trim().is_empty() => cached.to_string(),
        _ => wsl_home(&distro).ok()?,
    };
    Some((
        format!("{}/.cache/goto-repo", home),
        format!("{}/.config/goto-repo", home),
    ))
}

/// No WSL fallback off Windows — the direct read is already the real file.
#[cfg(not(target_os = "windows"))]
fn wsl_posix_dirs(_config: &AppConfig) -> Option<(String, String)> {
    None
}

/// Read a file's contents via `wsl.exe -d <distro> -- cat <posix>`. Immune to the
/// Windows-side 9P directory cache going stale — which makes a file that exists in
/// WSL read as "not found" over the `\\wsl.localhost` UNC share (the file is
/// rewritten inside WSL by `find-repo --rebuild`, so Windows caches an old view of
/// the directory and never sees the current inode).
#[cfg(target_os = "windows")]
fn wsl_cat(distro: &str, posix_path: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let output = Command::new("wsl")
        .args(["-d", distro, "--", "cat", posix_path])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map_err(|err| format!("wsl cat {} failed: {}", posix_path, err))?;
    if !output.status.success() {
        return Err(format!(
            "wsl cat {} exited {}",
            posix_path,
            output.status.code().unwrap_or(-1)
        ));
    }
    Ok(super::repos::decode_wsl_output(&output.stdout))
}

/// Write to a WSL file via `wsl.exe -d <distro> -- tee [-a] <posix>`, feeding the
/// content on stdin. The write-direction counterpart to `wsl_cat`: the stale 9P
/// directory cache that hides a file from a UNC read fails a UNC write too. `tee`
/// takes the path as a plain argv element, so no shell quoting is involved.
#[cfg(target_os = "windows")]
fn wsl_write(distro: &str, posix_path: &str, content: &str, append: bool) -> Result<(), String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;

    let mut args = vec!["-d", distro, "--", "tee"];
    if append {
        args.push("-a");
    }
    args.push(posix_path);
    let mut child = Command::new("wsl")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|err| format!("wsl tee {} failed: {}", posix_path, err))?;
    // Dropping the handle at the end of this statement closes the pipe, so `tee`
    // sees EOF and exits instead of blocking the wait below.
    child
        .stdin
        .take()
        .ok_or("wsl tee: stdin unavailable")?
        .write_all(content.as_bytes())
        .map_err(|err| format!("wsl tee {} write failed: {}", posix_path, err))?;
    let status = child
        .wait()
        .map_err(|err| format!("wsl tee {} wait failed: {}", posix_path, err))?;
    if !status.success() {
        return Err(format!(
            "wsl tee {} exited {}",
            posix_path,
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn wsl_mkdir_p(distro: &str, posix_dir: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let output = Command::new("wsl")
        .args(["-d", distro, "--", "mkdir", "-p", posix_dir])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map_err(|err| format!("wsl mkdir {} failed: {}", posix_dir, err))?;
    if !output.status.success() {
        return Err(format!(
            "wsl mkdir {} exited {}",
            posix_dir,
            output.status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

/// `stat` a WSL file via `wsl.exe` — returns (size_bytes, mtime_unix). Lets the
/// Data tab report a present file honestly when the UNC metadata read is blinded
/// by a stale 9P cache.
#[cfg(target_os = "windows")]
fn wsl_stat(distro: &str, posix_path: &str) -> Option<(u64, u64)> {
    use std::os::windows::process::CommandExt;
    let output = Command::new("wsl")
        .args(["-d", distro, "--", "stat", "-c", "%s %Y", posix_path])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = super::repos::decode_wsl_output(&output.stdout);
    let mut parts = text.trim().split_whitespace();
    let size = parts.next()?.parse::<u64>().ok()?;
    let mtime = parts.next()?.parse::<u64>().ok()?;
    Some((size, mtime))
}

/// Read a goto-repo file as a string. Tries the direct path first (UNC on Windows,
/// native elsewhere — fast, no subprocess); on Windows, if that fails, falls back
/// to `wsl.exe cat` so a stale 9P cache can't hide a file that genuinely exists.
fn read_cache_string(config: &AppConfig, which: CacheDir, file_name: &str) -> Result<String, String> {
    let (cache_dir, config_dir) = goto_dirs(config)?;
    let dir = match which {
        CacheDir::Cache => cache_dir,
        CacheDir::Config => config_dir,
    };
    let path = dir.join(file_name);
    let direct = std::fs::read_to_string(&path);
    #[cfg(target_os = "windows")]
    if let Err(direct_err) = &direct {
        if let Some((cache_posix, config_posix)) = wsl_posix_dirs(config) {
            let posix_dir = match which {
                CacheDir::Cache => cache_posix,
                CacheDir::Config => config_posix,
            };
            let posix_path = format!("{}/{}", posix_dir, file_name);
            if let Ok(content) = wsl_cat(&resolve_distro(config), &posix_path) {
                log::info!(
                    "read_cache_string: direct read of {} failed ({}); used wsl.exe cat",
                    path.display(),
                    direct_err
                );
                return Ok(content);
            }
        }
    }
    direct.map_err(|err| format!("Cannot read {}: {}", path.display(), err))
}

fn write_direct(path: &Path, content: &str, append: bool) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if !append {
        return std::fs::write(path, content);
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(content.as_bytes())
}

/// Write a goto-repo file, mirroring `read_cache_string` in the other direction:
/// direct write first (UNC on Windows, native elsewhere); on Windows, if that
/// fails, fall back to `wsl.exe tee` so a stale 9P cache can't silently drop a
/// write to the shared sort mode or history.
fn write_cache_string(
    config: &AppConfig,
    which: CacheDir,
    file_name: &str,
    content: &str,
    append: bool,
) -> Result<(), String> {
    let (cache_dir, config_dir) = goto_dirs(config)?;
    let dir = match which {
        CacheDir::Cache => cache_dir,
        CacheDir::Config => config_dir,
    };
    let path = dir.join(file_name);
    let direct = write_direct(&path, content, append);
    #[cfg(target_os = "windows")]
    if let Err(direct_err) = &direct {
        if let Some((cache_posix, config_posix)) = wsl_posix_dirs(config) {
            let posix_dir = match which {
                CacheDir::Cache => cache_posix,
                CacheDir::Config => config_posix,
            };
            let posix_path = format!("{}/{}", posix_dir, file_name);
            let distro = resolve_distro(config);
            // Retry once behind `mkdir -p`, for the first write into a goto-repo
            // dir that does not exist yet.
            let written = wsl_write(&distro, &posix_path, content, append).or_else(|_| {
                wsl_mkdir_p(&distro, &posix_dir)
                    .and_then(|_| wsl_write(&distro, &posix_path, content, append))
            });
            if written.is_ok() {
                log::info!(
                    "write_cache_string: direct write of {} failed ({}); used wsl.exe tee",
                    path.display(),
                    direct_err
                );
                return Ok(());
            }
        }
    }
    direct.map_err(|err| format!("Cannot write {}: {}", path.display(), err))
}

/// Sentinel that separates files in a batched `wsl.exe` read. Line-framed rather
/// than byte-framed because `decode_wsl_output` may re-encode the stream, which
/// would invalidate any byte count taken on the WSL side.
const BATCH_MARK: &str = "@@repo-launcher:";

/// Split a batched read's output back into per-file contents. Kept apart from the
/// spawn so the framing is testable on any platform: a mis-split here would hand
/// one file's bytes to another parser, which no type would catch.
fn parse_batch_output(text: &str, wanted: &[(String, String)]) -> HashMap<String, String> {
    let mut by_path: HashMap<String, String> = HashMap::new();
    let mut current: Option<String> = None;
    let mut buffer = String::new();
    for line in text.lines() {
        if let Some(path) = line
            .strip_prefix(BATCH_MARK)
            .and_then(|rest| rest.strip_suffix("@@"))
        {
            if let Some(previous) = current.take() {
                by_path.insert(previous, std::mem::take(&mut buffer));
            }
            current = Some(path.to_string());
            continue;
        }
        if current.is_some() {
            buffer.push_str(line);
            buffer.push('\n');
        }
    }
    if let Some(previous) = current {
        by_path.insert(previous, buffer);
    }
    // Re-key by the caller's file name, dropping anything that came back empty
    // (an unreadable file emits its marker and no content).
    wanted
        .iter()
        .filter_map(|(name, posix)| {
            by_path
                .get(posix)
                .filter(|content| !content.trim().is_empty())
                .map(|content| (name.clone(), content.clone()))
        })
        .collect()
}

/// Read several WSL files in ONE `wsl.exe` spawn. Each spawn cold-costs ~100ms and
/// the popup needs three files, so reading them separately triples the startup
/// penalty on a machine whose UNC share is unusable. Missing files are simply
/// absent from the returned map.
#[cfg(target_os = "windows")]
fn wsl_cat_many(distro: &str, posix_paths: &[(String, String)]) -> Result<HashMap<String, String>, String> {
    use std::os::windows::process::CommandExt;
    if posix_paths.is_empty() {
        return Ok(HashMap::new());
    }
    // `$@` keeps every path a separate argv element, so no quoting is involved.
    let script = format!(
        r#"for p in "$@"; do printf '{}%s@@\n' "$p"; if [ -r "$p" ]; then cat "$p"; fi; done"#,
        BATCH_MARK
    );
    let mut command = Command::new("wsl");
    command.args(["-d", distro, "--", "bash", "-lc", &script, "_"]);
    for (_, posix) in posix_paths {
        command.arg(posix);
    }
    let output = command
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map_err(|err| format!("wsl batch read failed: {}", err))?;
    if !output.status.success() {
        return Err(format!(
            "wsl batch read exited {}",
            output.status.code().unwrap_or(-1)
        ));
    }
    let text = super::repos::decode_wsl_output(&output.stdout);
    Ok(parse_batch_output(&text, posix_paths))
}

/// The three goto-repo files the popup needs, read together.
struct CacheBundle {
    repos_tsv: Option<String>,
    sort: Option<String>,
    history: Option<String>,
    /// True when the direct (UNC) path failed and `wsl.exe` supplied the contents —
    /// surfaced in the Data tab so the degraded mode isn't invisible.
    used_fallback: bool,
}

/// Read repos.tsv + sort + history in as few round trips as possible: direct reads
/// first, then a SINGLE batched `wsl.exe` call for whatever the direct path
/// couldn't produce.
fn read_cache_bundle(config: &AppConfig) -> CacheBundle {
    // Deliberately NOT read_cache_string: its per-file wsl.exe fallback would spawn
    // once per file. Read the direct path only, then pool every miss into one call.
    let raw = |dir: CacheDir, name: &str| -> Option<String> {
        let dirs = goto_dirs(config).ok()?;
        let base = match dir {
            CacheDir::Cache => dirs.0,
            CacheDir::Config => dirs.1,
        };
        std::fs::read_to_string(base.join(name)).ok()
    };
    let bundle = CacheBundle {
        repos_tsv: raw(CacheDir::Cache, "repos.tsv"),
        sort: raw(CacheDir::Cache, "sort"),
        history: raw(CacheDir::Config, "history"),
        used_fallback: false,
    };
    #[cfg(target_os = "windows")]
    let bundle = fill_bundle_from_wsl(config, bundle);
    bundle
}

/// Fill whatever the direct read couldn't produce, in a single `wsl.exe` spawn.
#[cfg(target_os = "windows")]
fn fill_bundle_from_wsl(config: &AppConfig, mut bundle: CacheBundle) -> CacheBundle {
    if bundle.repos_tsv.is_some() && bundle.sort.is_some() && bundle.history.is_some() {
        return bundle;
    }
    let Some((cache_posix, config_posix)) = wsl_posix_dirs(config) else {
        return bundle;
    };
    let mut wanted: Vec<(String, String)> = Vec::new();
    if bundle.repos_tsv.is_none() {
        wanted.push(("repos.tsv".into(), format!("{}/repos.tsv", cache_posix)));
    }
    if bundle.sort.is_none() {
        wanted.push(("sort".into(), format!("{}/sort", cache_posix)));
    }
    if bundle.history.is_none() {
        wanted.push(("history".into(), format!("{}/history", config_posix)));
    }
    let started = Instant::now();
    match wsl_cat_many(&resolve_distro(config), &wanted) {
        Ok(found) => {
            bundle.used_fallback = true;
            log::info!(
                "read_cache_bundle: {} of {} file(s) via one wsl.exe batch in {} ms",
                found.len(),
                wanted.len(),
                started.elapsed().as_millis()
            );
            if let Some(content) = found.get("repos.tsv") {
                bundle.repos_tsv = Some(content.clone());
            }
            if let Some(content) = found.get("sort") {
                bundle.sort = Some(content.clone());
            }
            if let Some(content) = found.get("history") {
                bundle.history = Some(content.clone());
            }
        }
        Err(err) => log::info!("read_cache_bundle: batch read failed ({})", err),
    }
    bundle
}

/// The full ranked list, from a single bundle read. Rebuilds once and retries when
/// repos.tsv is genuinely unreadable (not merely hidden behind a stale 9P cache).
fn ranked_repos(config: &AppConfig) -> Result<Vec<Repo>, String> {
    let started = Instant::now();
    let mut bundle = read_cache_bundle(config);
    if bundle.repos_tsv.is_none() {
        log::info!("ranked_repos: no cache readable; rebuilding once");
        let _ = run_rebuild(config, true);
        bundle = read_cache_bundle(config);
    }
    let content = bundle
        .repos_tsv
        .ok_or_else(|| "Cannot read repos.tsv from the goto-repo cache".to_string())?;
    let repos = parse_cache(&content, &resolve_distro(config));
    let mode = bundle.sort.as_deref().map(parse_sort_mode).unwrap_or(DEFAULT_SORT_MODE);
    let stats = bundle.history.as_deref().map(parse_history_stats).unwrap_or_default();
    log::info!(
        "ranked_repos: {} repos ready in {} ms (fallback={})",
        repos.len(),
        started.elapsed().as_millis(),
        bundle.used_fallback
    );
    Ok(rank_with(mode, &stats, repos))
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

/// path -> (usage count, most-recent timestamp), aggregated from history.
fn parse_history_stats(content: &str) -> HashMap<String, (u64, u64)> {
    let mut stats: HashMap<String, (u64, u64)> = HashMap::new();
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
    read_cache_string(config, CacheDir::Cache, "sort")
        .ok()
        .map(|raw| parse_sort_mode(&raw))
        .unwrap_or(DEFAULT_SORT_MODE)
}

const DEFAULT_SORT_MODE: u8 = 2;

fn parse_sort_mode(raw: &str) -> u8 {
    raw.trim()
        .parse::<u8>()
        .ok()
        .filter(|mode| *mode <= 3)
        .unwrap_or(DEFAULT_SORT_MODE)
}

fn write_sort_mode(config: &AppConfig, mode: u8) -> Result<(), String> {
    write_cache_string(config, CacheDir::Cache, "sort", &mode.to_string(), false)
}

/// Pure ranking core, mirroring rank-repos.sh: 0 = alpha (by path), 1 = recent
/// (max history ts desc), 2 = most-used (count desc), 3 = type (by kind asc, then
/// path). The sort is stable, so ties keep cache order (akin to find-repo's
/// fzf --tiebreak=index).
fn rank_by(mode: u8, mut repos: Vec<Repo>, stats: &HashMap<String, (u64, u64)>) -> Vec<Repo> {
    match mode {
        1 | 2 => repos.sort_by(|left, right| {
            let left_stat = stats.get(&left.path).copied().unwrap_or((0, 0));
            let right_stat = stats.get(&right.path).copied().unwrap_or((0, 0));
            let key = |stat: (u64, u64)| if mode == 1 { stat.1 } else { stat.0 };
            key(right_stat).cmp(&key(left_stat))
        }),
        3 => repos.sort_by(|left, right| {
            left.kind.cmp(&right.kind).then_with(|| left.path.cmp(&right.path))
        }),
        _ => repos.sort_by(|left, right| left.path.cmp(&right.path)),
    }
    repos
}

fn rank_with(mode: u8, stats: &HashMap<String, (u64, u64)>, mut repos: Vec<Repo>) -> Vec<Repo> {
    // Attach usage stats to every repo so the table view can show/sort by them.
    for repo in repos.iter_mut() {
        if let Some((uses, last)) = stats.get(&repo.path) {
            repo.uses = *uses;
            repo.last_used = *last;
        }
    }
    rank_by(mode, repos, stats)
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
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|dur| dur.as_secs())
        .unwrap_or(0);
    let line = format!("{}\t{}\n", ts, repo_path);
    write_cache_string(config, CacheDir::Config, "history", &line, true)
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Read the goto-repo cache and return it ranked by the shared sort mode.
#[tauri::command]
pub fn read_repos(app: AppHandle) -> Result<Vec<Repo>, String> {
    let config = load_config(&app)?;
    ranked_repos(&config)
}

/// Rebuild the cache (blocking, delegates to goto-repo) then return it ranked.
#[tauri::command]
pub fn refresh_repos(app: AppHandle) -> Result<Vec<Repo>, String> {
    let config = load_config(&app)?;
    run_rebuild(&config, true)?;
    ranked_repos(&config)
}

/// Age of repos.tsv in seconds, or None when it can't be determined — an unknown
/// age counts as stale. Falls back to `wsl.exe stat` on Windows for the same reason
/// reads do: a stale 9P cache fails the UNC metadata read, and every popup open
/// would then rebuild the whole projects tree.
fn repos_tsv_age_secs(config: &AppConfig) -> Option<u64> {
    let path = repos_tsv(config).ok()?;
    let direct = std::fs::metadata(&path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .map(|age| age.as_secs());
    #[cfg(target_os = "windows")]
    if direct.is_none() {
        if let Some((cache_posix, _)) = wsl_posix_dirs(config) {
            let posix_path = format!("{}/repos.tsv", cache_posix);
            if let Some((_, mtime)) = wsl_stat(&resolve_distro(config), &posix_path) {
                let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
                return Some(now.saturating_sub(mtime));
            }
        }
    }
    direct
}

/// Kick a non-blocking background rebuild if the cache is older than the TTL.
#[tauri::command]
pub fn maybe_refresh(app: AppHandle) -> Result<(), String> {
    let config = load_config(&app)?;
    let stale = repos_tsv_age_secs(&config)
        .map(|age| age > config.cache_ttl_seconds)
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
    let next = (read_sort_mode(&config) + 1) % 4;
    write_sort_mode(&config, next)?;
    ranked_repos(&config)
}

/// Set the shared sort mode to a specific value (0 alpha / 1 recent / 2 most-used)
/// and return the re-ranked repos — used when a table header is clicked, so it
/// stays in sync with the Ctrl+S sort (both write the same shared `sort` file).
#[tauri::command]
pub fn set_sort(app: AppHandle, mode: u8) -> Result<Vec<Repo>, String> {
    let config = load_config(&app)?;
    write_sort_mode(&config, mode.min(3))?;
    ranked_repos(&config)
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
    /// True when the cache had to be read through `wsl.exe` because the direct
    /// (UNC) path was unreadable. Everything still works, but each read costs a
    /// subprocess — worth showing rather than leaving the app silently degraded.
    pub uses_wsl_fallback: bool,
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

/// Stat a goto-repo file for the Data tab. On Windows, if the direct (UNC) read
/// reports the file absent, re-check via `wsl.exe stat` so a stale 9P cache
/// doesn't make a present file look missing (matching what the read path does).
fn goto_file_stat(direct: &Path, posix_path: Option<String>, distro: &str) -> PathStat {
    let stat = path_stat(direct);
    #[cfg(target_os = "windows")]
    if !stat.exists {
        if let Some(posix) = &posix_path {
            if let Some((size, mtime)) = wsl_stat(distro, posix) {
                return PathStat {
                    path: direct.display().to_string(),
                    exists: true,
                    size,
                    modified_unix: mtime,
                };
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (posix_path, distro);
    stat
}

/// Everything that drives the app: the goto-repo files it reads, their sizes, the
/// resolved distro, the sort mode, and the most-used paths from history.
#[tauri::command]
pub fn data_info(app: AppHandle) -> Result<DataInfo, String> {
    let config = load_config(&app)?;
    let (cache_dir, config_dir) = goto_dirs(&config)?;
    let distro = resolve_distro(&config);
    let (cache_posix, config_posix) = match wsl_posix_dirs(&config) {
        Some((cache, config_dir)) => (Some(cache), Some(config_dir)),
        None => (None, None),
    };
    let posix_join = |dir: &Option<String>, name: &str| dir.as_ref().map(|dir| format!("{}/{}", dir, name));
    let bundle = read_cache_bundle(&config);
    let repos = bundle
        .repos_tsv
        .as_deref()
        .map(|content| parse_cache(content, &distro))
        .unwrap_or_default();
    let stats = bundle
        .history
        .as_deref()
        .map(parse_history_stats)
        .unwrap_or_default();
    let sort_mode = bundle
        .sort
        .as_deref()
        .map(parse_sort_mode)
        .unwrap_or(DEFAULT_SORT_MODE);
    let labels = ["alpha", "recent", "most-used", "type"];

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
        cache_dir: cache_dir.display().to_string(),
        config_dir: config_dir.display().to_string(),
        repos_tsv: goto_file_stat(&cache_dir.join("repos.tsv"), posix_join(&cache_posix, "repos.tsv"), &distro),
        sort_file: goto_file_stat(&cache_dir.join("sort"), posix_join(&cache_posix, "sort"), &distro),
        history_file: goto_file_stat(&config_dir.join("history"), posix_join(&config_posix, "history"), &distro),
        log_file: path_stat(&log_path),
        distro,
        repo_count: repos.len(),
        sort_mode,
        sort_label: labels.get(sort_mode as usize).unwrap_or(&"?").to_string(),
        unique_paths: stats.len(),
        history_entries: stats.values().map(|(uses, _)| *uses).sum(),
        top_used: top,
        uses_wsl_fallback: bundle.used_fallback,
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
        repo_kind(path, "repo")
    }

    fn repo_kind(path: &str, kind: &str) -> Repo {
        Repo {
            kind: kind.into(),
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
    fn rank_type_sorts_by_kind_then_path() {
        let repos = vec![
            repo_kind("/z", "wt"),
            repo_kind("/a", "repo"),
            repo_kind("/b", "dir"),
            repo_kind("/c", "repo"),
        ];
        let ranked = rank_by(3, repos, &HashMap::new());
        assert_eq!(
            ranked.iter().map(|item| item.path.as_str()).collect::<Vec<_>>(),
            vec!["/b", "/a", "/c", "/z"] // dir, repo (a,c), wt — kind asc, path tiebreak
        );
    }

    /// The write side of the cache, end to end: a sort mode survives a round trip,
    /// a second write replaces rather than appends, and history appends into the
    /// sibling `.config` dir. Covers the direct path only — the `wsl.exe` fallback
    /// is Windows-only and needs a real distro.
    #[test]
    fn write_cache_string_round_trips_sort_and_history() {
        let root =
            std::env::temp_dir().join(format!("repo-launcher-write-test-{}", std::process::id()));
        let cache_dir = root.join(".cache").join("goto-repo");
        let config = AppConfig {
            cache_path: Some(cache_dir.to_string_lossy().into_owned()),
            ..Default::default()
        };

        // Nothing exists yet — the write has to create the directory.
        write_cache_string(&config, CacheDir::Cache, "sort", "3", false).unwrap();
        assert_eq!(read_sort_mode(&config), 3);
        write_cache_string(&config, CacheDir::Cache, "sort", "1", false).unwrap();
        assert_eq!(read_sort_mode(&config), 1, "second write must replace, not append");

        append_history(&config, "/home/me/a").unwrap();
        append_history(&config, "/home/me/a").unwrap();
        append_history(&config, "/home/me/b").unwrap();
        let bundle = read_cache_bundle(&config);
        assert_eq!(bundle.sort.as_deref().map(parse_sort_mode), Some(1));
        let stats = bundle
            .history
            .as_deref()
            .map(parse_history_stats)
            .expect("history must be readable through the bundle");
        assert_eq!(stats.get("/home/me/a").map(|(uses, _)| *uses), Some(2));
        assert_eq!(stats.get("/home/me/b").map(|(uses, _)| *uses), Some(1));
        assert!(
            root.join(".config").join("goto-repo").join("history").exists(),
            "history belongs in the sibling .config dir"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    fn wanted() -> Vec<(String, String)> {
        vec![
            ("repos.tsv".into(), "/home/me/.cache/goto-repo/repos.tsv".into()),
            ("sort".into(), "/home/me/.cache/goto-repo/sort".into()),
            ("history".into(), "/home/me/.config/goto-repo/history".into()),
        ]
    }

    #[test]
    fn parse_batch_output_splits_each_file_at_its_marker() {
        let text = concat!(
            "@@repo-launcher:/home/me/.cache/goto-repo/repos.tsv@@\n",
            "2 repos\nrepo\t/home/me/a\nrepo\t/home/me/b\n",
            "@@repo-launcher:/home/me/.cache/goto-repo/sort@@\n",
            "3\n",
            "@@repo-launcher:/home/me/.config/goto-repo/history@@\n",
            "111\t/home/me/a\n",
        );
        let found = parse_batch_output(text, &wanted());
        assert_eq!(found.len(), 3);
        assert_eq!(parse_sort_mode(&found["sort"]), 3);
        assert_eq!(parse_cache(&found["repos.tsv"], "Ubuntu").len(), 2);
        assert_eq!(
            parse_history_stats(&found["history"]).get("/home/me/a").map(|(uses, _)| *uses),
            Some(1)
        );
    }

    #[test]
    fn parse_batch_output_omits_a_file_that_produced_no_content() {
        // An unreadable file emits its marker and nothing else; it must be absent
        // rather than present-and-empty, so the caller can tell them apart.
        let text = concat!(
            "@@repo-launcher:/home/me/.cache/goto-repo/repos.tsv@@\n",
            "1 repos\nrepo\t/home/me/a\n",
            "@@repo-launcher:/home/me/.cache/goto-repo/sort@@\n",
            "@@repo-launcher:/home/me/.config/goto-repo/history@@\n",
            "111\t/home/me/a\n",
        );
        let found = parse_batch_output(text, &wanted());
        assert!(!found.contains_key("sort"), "empty file must not be reported as read");
        assert!(found.contains_key("repos.tsv") && found.contains_key("history"));
    }

    #[test]
    fn parse_batch_output_keeps_content_that_looks_like_a_marker_prefix() {
        // A repo path can legitimately start with '@@' — only an exact
        // marker-wrapped line may split a section.
        let text = concat!(
            "@@repo-launcher:/home/me/.cache/goto-repo/repos.tsv@@\n",
            "1 repos\nrepo\t/home/me/@@repo-launcher:not-a-marker\n",
            "@@repo-launcher:/home/me/.cache/goto-repo/sort@@\n",
            "1\n",
        );
        let found = parse_batch_output(text, &wanted());
        let repos = parse_cache(&found["repos.tsv"], "Ubuntu");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].path, "/home/me/@@repo-launcher:not-a-marker");
        assert_eq!(parse_sort_mode(&found["sort"]), 1);
    }

    #[test]
    fn rank_ties_keep_cache_order() {
        // Equal stats -> stable sort preserves input order.
        let ranked = rank_by(2, vec![repo("/first"), repo("/second")], &HashMap::new());
        assert_eq!(ranked[0].path, "/first");
        assert_eq!(ranked[1].path, "/second");
    }
}
