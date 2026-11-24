//! Live reload: tells the page when an open file changes on disk.
//!
//! Each file's folder is watched rather than the file itself, so editors that save by
//! writing a new file and renaming it over the old one are still noticed.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<PathBuf, RecommendedWatcher>>);

impl Watchers {
    pub fn watch<R: Runtime>(&self, app: &AppHandle<R>, path: &Path) -> notify::Result<()> {
        let mut map = self.0.lock().unwrap();
        if map.contains_key(path) || !path.is_file() {
            return Ok(());
        }
        let Some(dir) = path.parent() else { return Ok(()) };
        let name = path.file_name().map(OsString::from).unwrap_or_default();
        let generation = Arc::new(AtomicU64::new(0));
        let app = app.clone();
        let reported = path.to_string_lossy().into_owned();

        let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else { return };
            if matches!(event.kind, EventKind::Access(_)) || !event.paths.iter().any(|p| same_name(p, &name)) {
                return;
            }
            // Saves arrive as bursts of events; report once things settle.
            let ticket = generation.fetch_add(1, Ordering::SeqCst) + 1;
            let (generation, app, reported) = (generation.clone(), app.clone(), reported.clone());
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(150));
                if generation.load(Ordering::SeqCst) == ticket {
                    let _ = app.emit("doc-changed", reported);
                }
            });
        })?;
        watcher.watch(dir, RecursiveMode::NonRecursive)?;
        map.insert(path.to_path_buf(), watcher);
        Ok(())
    }

    pub fn unwatch(&self, path: &Path) {
        self.0.lock().unwrap().remove(path);
    }
}

fn same_name(path: &Path, name: &OsString) -> bool {
    match path.file_name() {
        Some(n) if cfg!(any(windows, target_os = "macos")) => n.to_string_lossy().to_lowercase() == name.to_string_lossy().to_lowercase(),
        Some(n) => n == name,
        None => false,
    }
}
