//! Printing, PDF export and default-app handling, which each platform does its own way.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use tauri::{Runtime, WebviewWindow};

/// Writes the page to a paginated PDF at `to`, using the page's print styles.
pub async fn export_pdf<R: Runtime>(window: &WebviewWindow<R>, to: PathBuf) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    imp::export_pdf(window, to, tx)?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(120)).unwrap_or_else(|_| Err("Timed out writing the PDF.".into()))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub use imp::{make_default_app, open_in_editor, print};

// MARK: - macOS

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, Sel};
    use objc2::{class, msg_send};
    use objc2_foundation::{NSRect, NSString, NSURL};
    use std::ffi::c_void;

    /// NSPrintInfo set up the way the Swift app did: fit to width, comfortable margins.
    unsafe fn print_info() -> Retained<AnyObject> {
        let shared: *mut AnyObject = msg_send![class!(NSPrintInfo), sharedPrintInfo];
        let info: Retained<AnyObject> = Retained::from_raw(msg_send![shared, copy]).expect("NSPrintInfo copy");
        let _: () = msg_send![&*info, setHorizontalPagination: 1usize]; // NSPrintingPaginationModeFit
        let _: () = msg_send![&*info, setVerticalPagination: 0usize]; // Automatic
        let _: () = msg_send![&*info, setTopMargin: 48.0f64];
        let _: () = msg_send![&*info, setBottomMargin: 48.0f64];
        let _: () = msg_send![&*info, setLeftMargin: 54.0f64];
        let _: () = msg_send![&*info, setRightMargin: 54.0f64];
        info
    }

    unsafe fn run(webview: *mut AnyObject, window: *mut AnyObject, info: &AnyObject, show_panels: bool) {
        let op: *mut AnyObject = msg_send![webview, printOperationWithPrintInfo: info];
        if op.is_null() {
            return;
        }
        // WKWebView's print view starts out zero-sized, which prints blank pages.
        let view: *mut AnyObject = msg_send![op, view];
        if !view.is_null() {
            let bounds: NSRect = msg_send![webview, bounds];
            let _: () = msg_send![view, setFrame: bounds];
        }
        let _: () = msg_send![op, setShowsPrintPanel: Bool::new(show_panels)];
        let _: () = msg_send![op, setShowsProgressPanel: Bool::new(show_panels)];
        let _: () = msg_send![
            op,
            runOperationModalForWindow: window,
            delegate: std::ptr::null_mut::<AnyObject>(),
            didRunSelector: None::<Sel>,
            contextInfo: std::ptr::null_mut::<c_void>()
        ];
    }

    pub fn print<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
        window
            .with_webview(|wv| unsafe {
                let info = print_info();
                run(wv.inner() as *mut AnyObject, wv.ns_window() as *mut AnyObject, &info, true);
            })
            .map_err(|e| e.to_string())
    }

    pub fn export_pdf<R: Runtime>(window: &WebviewWindow<R>, to: PathBuf, done: mpsc::Sender<Result<(), String>>) -> Result<(), String> {
        window
            .with_webview(move |wv| unsafe {
                let info = print_info();
                let _: () = msg_send![&*info, setJobDisposition: &*NSString::from_str("NSPrintSaveJob")];
                let url = NSURL::fileURLWithPath(&NSString::from_str(&to.to_string_lossy()));
                let dict: *mut AnyObject = msg_send![&*info, dictionary];
                let key = NSString::from_str("NSPrintJobSavingURL");
                let _: () = msg_send![dict, setObject: &*url, forKey: &*key];
                run(wv.inner() as *mut AnyObject, wv.ns_window() as *mut AnyObject, &info, false);
                // Without panels the save happens before the sheet machinery returns.
                let _ = done.send(Ok(()));
            })
            .map_err(|e| e.to_string())
    }

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(content_type: *const c_void, role: u32, bundle_id: *const c_void) -> i32;
    }

    pub fn make_default_app(bundle_id: &str) -> Result<String, String> {
        const ALL_ROLES: u32 = 0xFFFF_FFFF;
        let handler = NSString::from_str(bundle_id);
        let mut failed = vec![];
        for uti in ["net.daringfireball.markdown"] {
            let ty = NSString::from_str(uti);
            // NSString is toll-free bridged with CFString.
            let status = unsafe {
                LSSetDefaultRoleHandlerForContentType(
                    Retained::as_ptr(&ty) as *const c_void,
                    ALL_ROLES,
                    Retained::as_ptr(&handler) as *const c_void,
                )
            };
            if status != 0 {
                failed.push(format!("{uti} (error {status})"));
            }
        }
        if failed.is_empty() {
            Ok("Double-clicking a .md file in Finder will open it here.".into())
        } else {
            Err(failed.join("\n"))
        }
    }

    /// The user's default text editor, as chosen in Finder.
    pub fn open_in_editor(path: &Path) -> Result<(), String> {
        std::process::Command::new("/usr/bin/open").arg("-t").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

// MARK: - Windows

#[cfg(windows)]
mod imp {
    use super::*;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2PrintSettings, ICoreWebView2_7};
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    /// Windows prints through the page's own `window.print()`; nothing to do here.
    pub fn print<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
        window.eval("window.print()").map_err(|e| e.to_string())
    }

    pub fn export_pdf<R: Runtime>(window: &WebviewWindow<R>, to: PathBuf, done: mpsc::Sender<Result<(), String>>) -> Result<(), String> {
        window
            .with_webview(move |wv| unsafe {
                let started = (|| -> windows::core::Result<()> {
                    let core: ICoreWebView2_7 = wv.controller().CoreWebView2()?.cast()?;
                    let reply = done.clone();
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
                        let _ = reply.send(match (result, ok) {
                            (Ok(()), true) => Ok(()),
                            (Err(e), _) => Err(e.message()),
                            _ => Err("The PDF couldn't be written.".into()),
                        });
                        Ok(())
                    }));
                    core.PrintToPdf(&HSTRING::from(to.as_os_str()), None::<&ICoreWebView2PrintSettings>, &handler)
                })();
                if let Err(e) = started {
                    let _ = done.send(Err(e.message()));
                }
            })
            .map_err(|e| e.to_string())
    }

    /// Windows doesn't let apps claim file types; send the user to the Settings page instead.
    pub fn make_default_app(_bundle_id: &str) -> Result<String, String> {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:defaultapps")
            .spawn()
            .map(|_| "In Settings, search for “.md” and choose MDReader.".into())
            .map_err(|e| e.to_string())
    }

    /// VS Code when it's on the PATH, otherwise Notepad.
    pub fn open_in_editor(path: &Path) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let code = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).map(|d| d.join("code.cmd")).find(|c| c.is_file()))
            .flatten();
        if let Some(code) = code {
            // std escapes arguments for .cmd files, so unusual file names are safe here.
            if std::process::Command::new(code).arg(path).creation_flags(CREATE_NO_WINDOW).spawn().is_ok() {
                return Ok(());
            }
        }
        std::process::Command::new("notepad.exe").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

// MARK: - Other platforms (Linux builds, untested)

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use super::*;

    pub fn print<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
        window.print().map_err(|e| e.to_string())
    }

    pub fn export_pdf<R: Runtime>(_: &WebviewWindow<R>, _: PathBuf, _: mpsc::Sender<Result<(), String>>) -> Result<(), String> {
        Err("PDF export isn't available on this platform; use Print and choose “Print to File”.".into())
    }

    pub fn make_default_app(_: &str) -> Result<String, String> {
        Err("Use your desktop's settings to choose the default app for Markdown files.".into())
    }

    pub fn open_in_editor(path: &Path) -> Result<(), String> {
        std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}
