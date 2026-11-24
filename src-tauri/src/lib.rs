//! MDReader: a quiet reader for Markdown files and EPUB books.
//!
//! The window hosts a single page (`src/index.html`) that renders documents and draws all
//! of the app's chrome. This side opens files, unpacks books, watches for changes, serves
//! local files to the page over the `doc:` scheme, and does what only the OS can.

mod docs;
mod epub;
#[cfg(target_os = "macos")]
mod menu;
mod platform;
mod watch;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

/// Files the OS asked us to open before the page was ready to receive them.
#[derive(Default)]
struct Launch(Mutex<Option<Vec<String>>>);

/// Hands files to the page, or holds them until it asks.
fn open_files<R: Runtime>(app: &AppHandle<R>, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    let launch = app.state::<Launch>();
    let mut pending = launch.0.lock().unwrap();
    match pending.as_mut() {
        Some(list) => list.extend(files),
        None => {
            let _ = app.emit("open-files", files);
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Document paths among command-line arguments.
fn files_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a))
        .filter(|p| p.exists())
        .map(|p| std::path::absolute(&p).unwrap_or(p).to_string_lossy().into_owned())
        .collect()
}

// MARK: - Commands

#[tauri::command]
fn take_launch_files(launch: State<Launch>) -> Vec<String> {
    launch.0.lock().unwrap().take().unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    platform: &'static str,
    home: String,
    version: String,
}

#[tauri::command]
fn app_info<R: Runtime>(app: AppHandle<R>) -> AppInfo {
    AppInfo {
        platform: std::env::consts::OS,
        home: app.path().home_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
async fn open_document(path: String) -> Result<docs::Document, String> {
    // Unzipping a book can take a moment; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(move || docs::open(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn close_book(book_id: String) {
    epub::discard(&book_id);
}

#[tauri::command]
fn watch_file<R: Runtime>(app: AppHandle<R>, watchers: State<watch::Watchers>, path: String) -> Result<(), String> {
    watchers.watch(&app, Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn unwatch_file(watchers: State<watch::Watchers>, path: String) {
    watchers.unwatch(Path::new(&path));
}

/// Follows a clicked link. Returns the path when it's a document the reader should open in a
/// tab; anything else is handed to the system.
#[tauri::command]
fn follow_link<R: Runtime>(app: AppHandle<R>, href: String) -> Result<Option<String>, String> {
    if let Some(path) = docs::path_for_url(&href) {
        if docs::has_extension(&path, docs::READER_EXTENSIONS) || path.is_dir() && path.join("META-INF").is_dir() {
            return Ok(Some(path.to_string_lossy().into_owned()));
        }
        return app.opener().open_path(path.to_string_lossy(), None::<&str>).map(|_| None).map_err(|e| e.to_string());
    }
    let lower = href.to_ascii_lowercase();
    if ["http://", "https://", "mailto:"].iter().any(|s| lower.starts_with(s)) {
        app.opener().open_url(href, None::<&str>).map_err(|e| e.to_string())?;
    }
    Ok(None)
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read(&path).map(|b| docs::decode_text(&b)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_documents<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    let mut all: Vec<&str> = docs::MARKDOWN_EXTENSIONS.to_vec();
    all.extend(["txt", "text", "epub"]);
    app.dialog()
        .file()
        .set_title("Open")
        .add_filter("Markdown and EPUB", &all)
        .add_filter("Markdown", docs::MARKDOWN_EXTENSIONS)
        .add_filter("EPUB Books", &["epub"])
        .add_filter("All Files", &["*"])
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
async fn pick_themes<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    app.dialog()
        .file()
        .set_title("Import VS Code Theme")
        .add_filter("VS Code Color Theme", &["json"])
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn print_page<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    platform::print(&window)
}

/// Asks where to save, then writes the page there. Returns false if the user cancelled.
#[tauri::command]
async fn export_pdf<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, name: String, dir: Option<String>) -> Result<bool, String> {
    let mut dialog = app.dialog().file().set_title("Export as PDF").add_filter("PDF", &["pdf"]).set_file_name(&name);
    if let Some(dir) = dir.filter(|d| Path::new(d).is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    let Some(target) = dialog.blocking_save_file().and_then(|f| f.into_path().ok()) else { return Ok(false) };
    let target: PathBuf = if docs::has_extension(&target, &["pdf"]) { target } else { target.with_extension("pdf") };
    platform::export_pdf(&window, target).await.map(|_| true)
}

#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_in_editor(path: String) -> Result<(), String> {
    platform::open_in_editor(Path::new(&path))
}

#[tauri::command]
async fn make_default_app<R: Runtime>(app: AppHandle<R>) {
    // Windows only lets the user change defaults, so there the "success" is opening Settings.
    let done = if cfg!(windows) { "Choose MDReader in Settings" } else { "MDReader is now your Markdown app" };
    let dialog = match platform::make_default_app(&app.config().identifier) {
        Ok(message) => app.dialog().message(message).title(done).kind(MessageDialogKind::Info),
        Err(error) => app.dialog().message(error).title("Couldn't change the default app").kind(MessageDialogKind::Warning),
    };
    dialog.blocking_show();
}

#[tauri::command]
async fn alert<R: Runtime>(app: AppHandle<R>, title: String, message: String) {
    app.dialog().message(message).title(title).kind(MessageDialogKind::Warning).blocking_show();
}

// MARK: - App

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Books left unpacked by a run that didn't quit cleanly.
    let _ = std::fs::remove_dir_all(epub::books_dir());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(not(target_os = "macos"))]
    {
        // A second launch (double-clicking another file) hands its files to this window.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            open_files(app, files_from_args(argv, Path::new(&cwd)));
        }));
    }

    // No menu bar except macOS's system one; see menu.rs.
    #[cfg(target_os = "macos")]
    {
        builder = builder.menu(menu::build);
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Launch(Mutex::new(Some(vec![]))))
        .manage(watch::Watchers::default())
        .register_asynchronous_uri_scheme_protocol("doc", docs::protocol)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let files = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                open_files(window.app_handle(), files);
            }
        })
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            open_files(app.handle(), files_from_args(std::env::args(), &cwd));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_launch_files,
            app_info,
            open_document,
            close_book,
            watch_file,
            unwatch_file,
            follow_link,
            read_text,
            pick_documents,
            pick_themes,
            print_page,
            export_pdf,
            reveal,
            open_in_editor,
            make_default_app,
            alert,
        ])
        .build(tauri::generate_context!())
        .expect("error while building MDReader");

    app.run(|_app, _event| {
        // Finder sends files (double-clicked, or dropped on the Dock icon) as an event.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let files = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
            open_files(_app, files);
        }
    });
}
