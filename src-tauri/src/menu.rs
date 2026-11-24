//! The macOS menu bar. Every app command lives in the window (toolbar buttons, the More and
//! Appearance menus, and keyboard shortcuts the page handles itself), so Windows and Linux get
//! no menu bar at all. macOS always shows one, and needs it for Copy, Select All, Hide and
//! Quit, so it gets only the standard system items.

use tauri::menu::{AboutMetadataBuilder, Menu, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadataBuilder::new().name(Some("MDReader")).version(Some(app.package_info().version.to_string())).build();
    let app_menu = SubmenuBuilder::new(app, "MDReader")
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
    // No Close Window item: ⌘W closes the current tab (and the window once no tabs are left).
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().fullscreen().build()?;
    let menu = Menu::new(app)?;
    menu.append(&app_menu)?;
    menu.append(&edit)?;
    menu.append(&window)?;
    Ok(menu)
}
