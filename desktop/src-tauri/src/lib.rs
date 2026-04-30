use std::{
    collections::HashMap,
    io::{Error as IoError, ErrorKind, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Command as StdCommand, Stdio},
    str,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Default)]
struct ServerState(Mutex<ServerStatus>);

struct ServerRuntime {
    url: String,
    child: CommandChild,
}

#[derive(Default)]
struct ServerStatus {
    runtime: Option<ServerRuntime>,
    startup_error: Option<String>,
}

/// 与 ServerState 平级的 adapter 子进程状态。
///
/// adapter sidecar（claude-sidecar adapters --feishu --telegram）的生命周期
/// 跟 server 不同：它没有 HTTP 端口可探活，没配凭据时会自己干净退出，
/// 而且需要支持运行时热重启 —— 用户在设置页保存飞书 / Telegram 凭据后，
/// 前端会通过 invoke('restart_adapters_sidecar') 来重启它，让新凭据生效。
#[derive(Default)]
struct AdapterState(Mutex<Option<CommandChild>>);

#[derive(Default)]
struct TerminalState {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, TerminalSession>>,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Serialize, Clone)]
struct TerminalSpawnResult {
    session_id: u32,
    shell: String,
    cwd: String,
}

#[derive(Serialize, Clone)]
struct TerminalOutputPayload {
    session_id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExitPayload {
    session_id: u32,
    code: u32,
    signal: Option<String>,
}

#[tauri::command]
fn get_server_url(state: State<'_, ServerState>) -> Result<String, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "desktop server state is unavailable".to_string())?;

    if let Some(runtime) = guard.runtime.as_ref() {
        return Ok(runtime.url.clone());
    }

    Err(guard
        .startup_error
        .clone()
        .unwrap_or_else(|| "desktop server did not start".to_string()))
}

/// 前端在设置页保存飞书 / Telegram 凭据后调用，触发 adapter sidecar 热重启。
///
/// 流程：
///   1. kill 当前 adapter 子进程（如果在跑）
///   2. spawn 新的 adapter 子进程
///   3. 新 sidecar 内部的 loadConfig() 会读到最新的 ~/.claude/adapters.json
///      并重新建立 WebSocket 连接到飞书 / Telegram
///
/// 凭据缺失时 sidecar 自己会 warn + skip + 退出，所以这里不需要前置检查。
#[tauri::command]
fn restart_adapters_sidecar(app: AppHandle) -> Result<(), String> {
    stop_adapters_sidecar(&app);
    spawn_and_track_adapters_sidecar(&app);
    Ok(())
}

#[tauri::command]
fn prepare_for_update_install(app: AppHandle) -> Result<(), String> {
    stop_server_sidecar(&app);
    stop_adapters_sidecar(&app);

    #[cfg(target_os = "windows")]
    {
        kill_windows_sidecars();
    }

    // Give Windows a short moment to release executable file handles before the
    // updater starts replacing bundled sidecars in the install directory.
    std::thread::sleep(Duration::from_millis(750));
    Ok(())
}

#[tauri::command]
fn terminal_spawn(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<TerminalSpawnResult, String> {
    let cwd_path = resolve_terminal_cwd(cwd)?;
    let shell = default_shell();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("open terminal pty: {err}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(cwd_path.as_os_str());
    for (key, value) in terminal_environment(&shell) {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| format!("spawn terminal shell: {err}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("clone terminal reader: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("open terminal writer: {err}"))?;
    let killer = child.clone_killer();
    let session_id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "terminal state is unavailable".to_string())?;
        sessions.insert(
            session_id,
            TerminalSession {
                master: pair.master,
                writer: Mutex::new(writer),
                killer: Mutex::new(killer),
            },
        );
    }

    let output_app = app.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut pending_utf8 = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = decode_terminal_output(&mut pending_utf8, &buffer[..n]);
                    if !data.is_empty() {
                        let _ = output_app.emit(
                            "terminal-output",
                            TerminalOutputPayload { session_id, data },
                        );
                    }
                }
                Err(err) => {
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputPayload {
                            session_id,
                            data: format!("\r\n[terminal read error: {err}]\r\n"),
                        },
                    );
                    break;
                }
            }
        }
        if !pending_utf8.is_empty() {
            let data = String::from_utf8_lossy(&pending_utf8).to_string();
            let _ = output_app.emit(
                "terminal-output",
                TerminalOutputPayload { session_id, data },
            );
        }
    });

    let exit_app = app.clone();
    thread::spawn(move || {
        let status = child.wait();
        if let Some(state) = exit_app.try_state::<TerminalState>() {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(&session_id);
            }
        }
        match status {
            Ok(status) => {
                let _ = exit_app.emit(
                    "terminal-exit",
                    TerminalExitPayload {
                        session_id,
                        code: status.exit_code(),
                        signal: status.signal().map(ToString::to_string),
                    },
                );
            }
            Err(err) => {
                let _ = exit_app.emit(
                    "terminal-output",
                    TerminalOutputPayload {
                        session_id,
                        data: format!("\r\n[terminal wait error: {err}]\r\n"),
                    },
                );
            }
        }
    });

    Ok(TerminalSpawnResult {
        session_id,
        shell,
        cwd: cwd_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn terminal_write(
    state: State<'_, TerminalState>,
    session_id: u32,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "terminal session is not running".to_string())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "terminal writer is unavailable".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|err| format!("write terminal input: {err}"))?;
    writer
        .flush()
        .map_err(|err| format!("flush terminal input: {err}"))?;
    Ok(())
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "terminal session is not running".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("resize terminal: {err}"))?;
    Ok(())
}

#[tauri::command]
fn terminal_kill(state: State<'_, TerminalState>, session_id: u32) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "terminal state is unavailable".to_string())?;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        let mut killer = session
            .killer
            .lock()
            .map_err(|_| "terminal killer is unavailable".to_string())?;
        killer
            .kill()
            .map_err(|err| format!("kill terminal shell: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    #[cfg(target_os = "windows")]
    {
        // Windows: use explorer to open folder
        StdCommand::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|err| format!("open folder: {err}"))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        // macOS: use open command
        StdCommand::new("open")
            .arg(&path)
            .spawn()
            .map_err(|err| format!("open folder: {err}"))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        // Linux: try xdg-open first, then fallback
        let result = StdCommand::new("xdg-open")
            .arg(&path)
            .spawn();
        if result.is_err() {
            // Try gnome-open
            let _ = StdCommand::new("gnome-open")
                .arg(&path)
                .spawn();
        }
    }
    
    Ok(())
}

fn decode_terminal_output(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    let mut output = String::new();

    loop {
        match str::from_utf8(pending) {
            Ok(text) => {
                output.push_str(text);
                pending.clear();
                break;
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to > 0 {
                    let text = str::from_utf8(&pending[..valid_up_to])
                        .expect("valid_up_to marks a valid UTF-8 prefix");
                    output.push_str(text);
                    pending.drain(..valid_up_to);
                    continue;
                }

                match err.error_len() {
                    Some(error_len) => {
                        output.push('\u{fffd}');
                        pending.drain(..error_len);
                    }
                    None => break,
                }
            }
        }
    }

    output
}

fn terminal_environment(shell: &str) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    env.extend(login_shell_environment(shell));
    ensure_utf8_locale(&mut env);
    env
}

fn ensure_utf8_locale(env: &mut HashMap<String, String>) {
    let fallback = default_utf8_locale();
    for key in ["LANG", "LC_CTYPE", "LC_ALL"] {
        let needs_fallback = env
            .get(key)
            .map(|value| !is_utf8_locale(value))
            .unwrap_or(true);
        if needs_fallback {
            env.insert(key.to_string(), fallback.to_string());
        }
    }
}

fn is_utf8_locale(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "");
    normalized.contains("utf8")
}

fn default_utf8_locale() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "en_US.UTF-8"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "C.UTF-8"
    }
    #[cfg(not(unix))]
    {
        "C.UTF-8"
    }
}

#[cfg(not(target_os = "windows"))]
fn login_shell_environment(shell: &str) -> HashMap<String, String> {
    let Ok(mut child) = StdCommand::new(shell)
        .args(["-l", "-c", "env -0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return HashMap::new();
    };

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return HashMap::new();
                }
                let mut stdout = Vec::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_end(&mut stdout);
                }
                return parse_env_block(&stdout);
            }
            Ok(None) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return HashMap::new();
            }
            Err(_) => return HashMap::new(),
        }
    }
}

#[cfg(target_os = "windows")]
fn login_shell_environment(_shell: &str) -> HashMap<String, String> {
    HashMap::new()
}

fn parse_env_block(bytes: &[u8]) -> HashMap<String, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter_map(|entry| {
            if entry.is_empty() {
                return None;
            }
            let equals = entry.iter().position(|byte| *byte == b'=')?;
            if equals == 0 {
                return None;
            }
            let key = String::from_utf8_lossy(&entry[..equals]).to_string();
            let value = String::from_utf8_lossy(&entry[equals + 1..]).to_string();
            Some((key, value))
        })
        .collect()
}

fn resolve_terminal_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    let path = match cwd.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    }) {
        Some(path) => path,
        None => home_dir().unwrap_or(
            std::env::current_dir().map_err(|err| format!("resolve current directory: {err}"))?,
        ),
    };

    if path.is_dir() {
        Ok(path)
    } else {
        Err(format!("terminal cwd does not exist: {}", path.display()))
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if PathBuf::from("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
    }
}

fn reserve_local_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|err| format!("bind local port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("read local port: {err}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn wait_for_server(url_host: &str, port: u16) -> Result<(), String> {
    let addr: SocketAddr = format!("{url_host}:{port}")
        .parse()
        .map_err(|err| format!("parse server address: {err}"))?;
    let deadline = Instant::now() + Duration::from_secs(10);

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(format!(
        "desktop server did not start listening on {url_host}:{port} within 10 seconds"
    ))
}

fn resolve_app_root(_app: &AppHandle) -> Result<PathBuf, String> {
    // 历史用途：此前 sidecar launcher 用 dynamic file:// import 加载磁盘上
    // 的 src/server/index.ts 和 preload.ts，所以 Tauri 必须把整个 src/ +
    // node_modules/ 当 Resource 一起 ship 到 .app/Contents/Resources/app/。
    //
    // 现在 launcher 改成静态 import + bun build --compile 整棵静态打进二进制，
    // sidecar 不再读磁盘上的 src/ 或 node_modules/。CLAUDE_APP_ROOT 现在
    // 只剩一个名义上的"app 安装根目录"作用，给 conversationService 在
    // spawn CLI 子进程时通过 --app-root 透传。
    //
    // 我们直接用当前可执行文件所在目录作为 app_root：
    //   Dev:  desktop/src-tauri/target/<profile>/  （rust 跑出来的 binary 那一层）
    //   Prod: <App>.app/Contents/MacOS/             （sidecar 二进制的同级目录）
    let exe = std::env::current_exe().map_err(|err| format!("resolve current exe path: {err}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "current exe has no parent dir".to_string())?
        .to_path_buf();
    Ok(dir)
}

fn start_server_sidecar(app: &AppHandle) -> Result<ServerRuntime, String> {
    let host = "127.0.0.1";
    let port = reserve_local_port()?;
    let url = format!("http://{host}:{port}");
    let app_root = resolve_app_root(app)?;
    let app_root_arg = app_root.to_string_lossy().to_string();

    // 单一合并 sidecar：第一个参数选 server / cli / adapters 模式。
    let sidecar = app
        .shell()
        .sidecar("claude-sidecar")
        .map_err(|err| format!("resolve sidecar: {err}"))?
        .args([
            "server",
            "--app-root",
            &app_root_arg,
            "--host",
            host,
            "--port",
            &port.to_string(),
        ]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("spawn server sidecar: {err}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    println!("[claude-server] {}", line.trim_end());
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprintln!("[claude-server] {}", line.trim_end());
                }
                _ => {}
            }
        }
    });

    wait_for_server(host, port)?;

    Ok(ServerRuntime { url, child })
}

fn stop_server_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<ServerState>() else {
        return;
    };

    let Ok(mut guard) = state.0.lock() else {
        return;
    };

    if let Some(runtime) = guard.runtime.take() {
        let _ = runtime.child.kill();
    }
}

/// 启动 adapter sidecar。返回 Result 主要为了把"无法 spawn"和"spawn 后立刻
/// 退出（凭据缺失）"区分开 —— 后者不算错误，是正常 default 状态。
fn start_adapters_sidecar(app: &AppHandle) -> Result<CommandChild, String> {
    let app_root = resolve_app_root(app)?;
    let app_root_arg = app_root.to_string_lossy().to_string();

    // adapter 内部的 WsBridge 默认连 ws://127.0.0.1:3456，但桌面端的 server
    // 用的是 reserve_local_port() 拿到的动态端口。这里把实际端口通过
    // ADAPTER_SERVER_URL env var 传过去 —— adapters/common/config.ts 的
    // loadConfig() 会读它。
    //
    // 如果 server 还没起来 / 没拿到 URL，回退到 3456 作为最后兜底（adapter
    // 自己有重连逻辑，等 server 上线就能连上）。
    let server_http_url = app
        .try_state::<ServerState>()
        .and_then(|state| {
            state
                .0
                .lock()
                .ok()
                .and_then(|guard| guard.runtime.as_ref().map(|r| r.url.clone()))
        })
        .unwrap_or_else(|| "http://127.0.0.1:3456".to_string());
    // WsBridge 直接 `new WebSocket('${serverUrl}/ws/...')`，必须传 ws://；
    // 不会自动从 http 转。
    let server_ws_url = if let Some(rest) = server_http_url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if let Some(rest) = server_http_url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else {
        server_http_url.clone()
    };

    let sidecar = app
        .shell()
        .sidecar("claude-sidecar")
        .map_err(|err| format!("resolve sidecar: {err}"))?
        .env("ADAPTER_SERVER_URL", &server_ws_url)
        .args([
            "adapters",
            "--app-root",
            &app_root_arg,
            "--feishu",
            "--telegram",
        ]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("spawn adapter sidecar: {err}"))?;

    // 用一个 async task 把 sidecar 的 stdout/stderr 转发出来。它退出时
    // 整个 task 也会自然结束。
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    println!("[claude-adapters] {}", line.trim_end());
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprintln!("[claude-adapters] {}", line.trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    // exit code != 0 是常态：用户没配凭据时 sidecar 内部会
                    // warn + skip + process.exit(1)。这里只 info 一行，
                    // 不要当错误冒泡。
                    println!(
                        "[claude-adapters] sidecar exited (code={:?}, signal={:?})",
                        payload.code, payload.signal
                    );
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// spawn adapter sidecar 并把 child handle 存进 AdapterState。
/// 在启动 + 重启路径里复用，集中处理"无法 spawn"的日志。
fn spawn_and_track_adapters_sidecar(app: &AppHandle) {
    match start_adapters_sidecar(app) {
        Ok(child) => {
            if let Some(state) = app.try_state::<AdapterState>() {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(child);
                }
            }
        }
        Err(err) => {
            eprintln!("[desktop] failed to start adapter sidecar: {err}");
        }
    }
}

fn stop_adapters_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<AdapterState>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
}

#[cfg(target_os = "windows")]
fn kill_windows_sidecars() {
    for image_name in [
        "claude-sidecar-x86_64-pc-windows-msvc.exe",
        "claude-sidecar-aarch64-pc-windows-msvc.exe",
        "claude-sidecar.exe",
    ] {
        let _ = StdCommand::new("taskkill")
            .args(["/F", "/T", "/IM", image_name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_terminal_output, default_utf8_locale, ensure_utf8_locale, parse_env_block};
    use std::collections::HashMap;

    #[test]
    fn terminal_output_decoder_preserves_split_chinese_characters() {
        let mut pending = Vec::new();
        let bytes = "安装 Skills 成功\n".as_bytes();

        assert_eq!(decode_terminal_output(&mut pending, &bytes[..2]), "");
        assert_eq!(decode_terminal_output(&mut pending, &bytes[2..4]), "安");
        assert_eq!(
            decode_terminal_output(&mut pending, &bytes[4..]),
            "装 Skills 成功\n"
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_output_decoder_keeps_incomplete_suffix_pending() {
        let mut pending = Vec::new();
        let bytes = "中文".as_bytes();

        assert_eq!(decode_terminal_output(&mut pending, &bytes[..4]), "中");
        assert_eq!(pending, bytes[3..4]);
        assert_eq!(decode_terminal_output(&mut pending, &bytes[4..]), "文");
        assert!(pending.is_empty());
    }

    #[test]
    fn parse_env_block_reads_nul_delimited_values() {
        let env =
            parse_env_block(b"PATH=/opt/homebrew/bin:/usr/bin\0NODE_PATH=/tmp/node\0EMPTY=\0");

        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        assert_eq!(env.get("NODE_PATH").map(String::as_str), Some("/tmp/node"));
        assert_eq!(env.get("EMPTY").map(String::as_str), Some(""));
    }

    #[test]
    fn terminal_environment_forces_utf8_locale_when_shell_uses_c_locale() {
        let mut env = HashMap::from([
            ("LANG".to_string(), "C".to_string()),
            ("LC_CTYPE".to_string(), "POSIX".to_string()),
            ("LC_ALL".to_string(), "C".to_string()),
        ]);

        ensure_utf8_locale(&mut env);

        assert_eq!(
            env.get("LANG").map(String::as_str),
            Some(default_utf8_locale())
        );
        assert_eq!(
            env.get("LC_CTYPE").map(String::as_str),
            Some(default_utf8_locale())
        );
        assert_eq!(
            env.get("LC_ALL").map(String::as_str),
            Some(default_utf8_locale())
        );
    }

    #[test]
    fn terminal_environment_keeps_existing_utf8_locale() {
        let mut env = HashMap::from([
            ("LANG".to_string(), "zh_CN.UTF-8".to_string()),
            ("LC_CTYPE".to_string(), "en_US.UTF8".to_string()),
            ("LC_ALL".to_string(), "C.UTF-8".to_string()),
        ]);

        ensure_utf8_locale(&mut env);

        assert_eq!(env.get("LANG").map(String::as_str), Some("zh_CN.UTF-8"));
        assert_eq!(env.get("LC_CTYPE").map(String::as_str), Some("en_US.UTF8"));
        assert_eq!(env.get("LC_ALL").map(String::as_str), Some("C.UTF-8"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(ServerState::default())
        .manage(AdapterState::default())
        .manage(TerminalState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            restart_adapters_sidecar,
            prepare_for_update_install,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_kill,
            open_path
        ]);

    // macOS: native menu bar (traffic-light overlay style)
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| {
            let about_item =
                MenuItemBuilder::with_id("nav_about", "关于 Claude Code Haha").build(app)?;
            let settings_item = MenuItemBuilder::with_id("nav_settings", "设置...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "Claude Code Haha")
                .item(&about_item)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .build()
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "nav_about" => {
                let _ = app.emit("native-menu-navigate", "about");
            }
            "nav_settings" => {
                let _ = app.emit("native-menu-navigate", "settings");
            }
            _ => {}
        });

    let app = builder
        .setup(|app| {
            let state = app.state::<ServerState>();
            let mut guard = state
                .0
                .lock()
                .map_err(|_| IoError::new(ErrorKind::Other, "server state lock poisoned"))?;

            match start_server_sidecar(&app.handle()) {
                Ok(runtime) => {
                    guard.runtime = Some(runtime);
                    guard.startup_error = None;
                }
                Err(err) => {
                    eprintln!("[desktop] failed to start local server: {err}");
                    guard.runtime = None;
                    guard.startup_error = Some(err);
                }
            }
            drop(guard);

            // server 起来之后再起 adapter sidecar —— start_adapters_sidecar
            // 内部会从 ServerState 读 server URL 注入 ADAPTER_SERVER_URL env，
            // 让 adapter 连上动态端口。
            spawn_and_track_adapters_sidecar(&app.handle());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            stop_server_sidecar(app_handle);
            stop_adapters_sidecar(app_handle);
        }
    });
}
