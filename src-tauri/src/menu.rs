//! The menu bar. Every item just forwards its id to the page as a "menu" event; the page
//! also handles the same shortcuts itself, since a focused webview doesn't always let
//! them reach the menu.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let sep = || PredefinedMenuItem::separator(app);
    let mac = cfg!(target_os = "macos");

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open", "Open…", Some("CmdOrCtrl+O"))?)
        .item(&item("open-tab", "Open in New Tab…", Some("CmdOrCtrl+T"))?)
        .item(&sep()?)
        .item(&item("close-tab", "Close Tab", Some("CmdOrCtrl+W"))?)
        .item(&sep()?)
        .item(&item("export-pdf", "Export as PDF…", Some("CmdOrCtrl+Shift+E"))?)
        .item(&item("print", "Print…", Some("CmdOrCtrl+P"))?);
    let file = if mac {
        file.build()?
    } else {
        file.item(&sep()?)
            .item(&item("make-default", "Make MDReader the Default Markdown App…", None)?)
            .item(&sep()?)
            .item(&PredefinedMenuItem::quit(app, Some("Exit"))?)
            .build()?
    };

    let mut edit = SubmenuBuilder::new(app, "Edit");
    if mac {
        edit = edit.copy().select_all().separator();
    }
    let edit = edit
        .item(&item("find", "Find…", Some("CmdOrCtrl+F"))?)
        .item(&item("find-next", "Find Next", Some("CmdOrCtrl+G"))?)
        .item(&item("find-prev", "Find Previous", Some("CmdOrCtrl+Shift+G"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("toggle-sidebar", "Toggle Sidebar", Some(if mac { "Ctrl+Cmd+S" } else { "Ctrl+Shift+S" }))?)
        .item(&item("reload", "Reload", Some("CmdOrCtrl+R"))?)
        .item(&sep()?)
        .item(&item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?)
        .item(&item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&sep()?)
        .item(&item("appearance", "Appearance…", None)?)
        .item(&sep()?)
        .item(&item("next-tab", "Show Next Tab", Some("Ctrl+Tab"))?)
        .item(&item("prev-tab", "Show Previous Tab", Some("Ctrl+Shift+Tab"))?);
    let view = if mac { view.separator().fullscreen().build()? } else { view.build()? };

    let menu = Menu::new(app)?;
    if mac {
        let about = AboutMetadataBuilder::new().name(Some("MDReader")).version(Some(app.package_info().version.to_string())).build();
        let app_menu = SubmenuBuilder::new(app, "MDReader")
            .about(Some(about))
            .separator()
            .item(&item("make-default", "Make MDReader the Default Markdown App", None)?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu.append(&app_menu)?;
    }
    menu.append(&file)?;
    menu.append(&edit)?;
    menu.append(&view)?;
    if mac {
        // No Close Window item: ⌘W closes the current tab (and the window once no tabs are left).
        let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
        menu.append(&window)?;
    }
    Ok(menu)
}
