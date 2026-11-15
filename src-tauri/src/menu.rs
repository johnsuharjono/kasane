use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem as Native, Submenu},
    App, Manager,
};

pub fn install(app: &App) -> tauri::Result<()> {
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(
                app,
                "new-query",
                "New SQL Document",
                true,
                Some("CmdOrCtrl+T"),
            )?,
            &MenuItem::with_id(
                app,
                "new-notebook",
                "New Notebook",
                true,
                Some("CmdOrCtrl+Shift+T"),
            )?,
            &MenuItem::with_id(app, "open-sql", "Import SQL…", true, Some("CmdOrCtrl+O"))?,
            &Native::separator(app)?,
            &MenuItem::with_id(
                app,
                "save-notebook",
                "Save Document",
                true,
                Some("CmdOrCtrl+S"),
            )?,
            &MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
        ],
    )?;
    app.set_menu(Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Kasane",
                true,
                &[
                    &Native::about(app, None, None)?,
                    &Native::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        "settings",
                        "Settings…",
                        true,
                        Some("CmdOrCtrl+Comma"),
                    )?,
                    &Native::separator(app)?,
                    &Native::services(app, None)?,
                    &Native::separator(app)?,
                    &Native::hide(app, None)?,
                    &Native::hide_others(app, None)?,
                    &Native::show_all(app, None)?,
                    &Native::separator(app)?,
                    &Native::quit(app, None)?,
                ],
            )?,
            &file,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &Native::undo(app, None)?,
                    &Native::redo(app, None)?,
                    &Native::separator(app)?,
                    &Native::cut(app, None)?,
                    &Native::copy(app, None)?,
                    &Native::paste(app, None)?,
                    &Native::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "View", true, &[&Native::fullscreen(app, None)?])?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[&Native::minimize(app, None)?, &Native::maximize(app, None)?],
            )?,
        ],
    )?)?;
    app.on_menu_event(|app, event| {
        let action = match event.id().as_ref() {
            "settings" => "settings",
            "open-sql" => "open-sql",
            "new-query" => "new-query",
            "new-notebook" => "new-notebook",
            "save-notebook" => "save-notebook",
            "close-tab" => "close-tab",
            _ => return,
        };
        // Only constant, app-owned action names enter this script. No SQL or user text is evaluated.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval(format!(
                "window.dispatchEvent(new CustomEvent('kasane-menu',{{detail:'{action}'}}))"
            ));
        }
    });
    Ok(())
}
