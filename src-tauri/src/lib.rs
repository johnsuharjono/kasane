mod db;
mod menu;
mod sql_documents;
use db::{Connection, DbError, QueryResult, Session};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tauri::{Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

struct AppState {
    root: PathBuf,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    files: Mutex<()>,
}
fn err(e: impl std::fmt::Display) -> DbError {
    DbError::message(e.to_string())
}
fn valid_id(id: &str) -> Result<(), DbError> {
    Uuid::parse_str(id).map(|_| ()).map_err(err)
}
async fn connections(s: &AppState) -> Result<Vec<Connection>, DbError> {
    match tokio::fs::read(s.root.join("connections.json")).await {
        Ok(data) => serde_json::from_slice(&data).map_err(err),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(err(e)),
    }
}
async fn atomic_write(path: &std::path::Path, data: &[u8]) -> Result<(), DbError> {
    let tmp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    tokio::fs::write(&tmp, data).await.map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(err)?;
    }
    tokio::fs::rename(&tmp, path).await.map_err(err)
}
#[tauri::command]
async fn list_connections(state: State<'_, AppState>) -> Result<Vec<Connection>, DbError> {
    connections(&state).await
}
#[tauri::command]
async fn save_connection(
    state: State<'_, AppState>,
    connection: Connection,
    password: Option<String>,
) -> Result<(), DbError> {
    valid_id(&connection.id)?;
    let _guard = state.files.lock().await;
    if let Some(password) = password {
        let id = connection.id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            security_framework::passwords::set_generic_password(
                "app.kasane.desktop",
                &id,
                password.as_bytes(),
            )
        })
        .await
        .map_err(err)?
        .map_err(err)?;
    }
    let mut list = connections(&state).await?;
    list.retain(|c| c.id != connection.id);
    list.push(connection);
    atomic_write(
        &state.root.join("connections.json"),
        &serde_json::to_vec_pretty(&list).map_err(err)?,
    )
    .await
}
#[tauri::command]
async fn delete_connection(state: State<'_, AppState>, id: String) -> Result<(), DbError> {
    valid_id(&id)?;
    let _guard = state.files.lock().await;
    let key = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        security_framework::passwords::delete_generic_password("app.kasane.desktop", &key)
    })
    .await
    .map_err(err)?
    .or_else(|e| if e.code() == -25300 { Ok(()) } else { Err(e) })
    .map_err(err)?;
    let mut list = connections(&state).await?;
    list.retain(|c| c.id != id);
    atomic_write(
        &state.root.join("connections.json"),
        &serde_json::to_vec_pretty(&list).map_err(err)?,
    )
    .await
}
#[tauri::command]
async fn open_session(
    state: State<'_, AppState>,
    connection_id: String,
    session_id: String,
) -> Result<(), DbError> {
    valid_id(&session_id)?;
    if state.sessions.lock().await.contains_key(&session_id) {
        return Err(err("Session already exists"));
    }
    let c = connections(&state)
        .await?
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| err("Connection not found"))?;
    let password = tauri::async_runtime::spawn_blocking(move || {
        security_framework::passwords::get_generic_password("app.kasane.desktop", &connection_id)
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    let session = Session::connect(&c, &String::from_utf8(password).map_err(err)?).await?;
    state.sessions.lock().await.insert(session_id, session);
    Ok(())
}
async fn session(s: &AppState, id: &str) -> Result<Arc<Session>, DbError> {
    s.sessions
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| err("Session unavailable. Connect explicitly before executing SQL."))
}
#[tauri::command]
async fn execute_sql(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
    sql: String,
) -> Result<QueryResult, DbError> {
    if sql.len() > 1024 * 1024 {
        return Err(err("SQL exceeds the 1 MiB editor execution limit"));
    }
    session(&state, &session_id)
        .await?
        .execute(&request_id, &sql)
        .await
}
#[tauri::command]
async fn cancel_query(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
) -> Result<(), DbError> {
    session(&state, &session_id)
        .await?
        .cancel(&request_id)
        .await
}
#[tauri::command]
async fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), DbError> {
    let removed = state.sessions.lock().await.remove(&session_id);
    if let Some(s) = removed {
        let active = s.active.lock().await.clone();
        if let Some(id) = active {
            s.cancel(&id).await?;
        }
    }
    Ok(())
}
#[tauri::command]
async fn get_catalog(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<QueryResult, DbError> {
    session(&state, &session_id).await?.catalog().await
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Notebook {
    version: u8,
    id: String,
    title: String,
    connection_id: Option<String>,
    cells: Vec<Cell>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct Cell {
    id: String,
    kind: String,
    source: String,
}
#[tauri::command]
async fn save_notebook(state: State<'_, AppState>, notebook: Notebook) -> Result<(), DbError> {
    valid_id(&notebook.id)?;
    if notebook.version != 1
        || notebook.cells.len() > 500
        || notebook
            .cells
            .iter()
            .any(|c| !["sql", "markdown"].contains(&c.kind.as_str()))
    {
        return Err(err("Unsupported notebook format"));
    }
    let data = serde_json::to_vec_pretty(&notebook).map_err(err)?;
    if data.len() > 10 * 1024 * 1024 {
        return Err(err("Notebook exceeds 10 MiB"));
    }
    let _guard = state.files.lock().await;
    atomic_write(
        &state
            .root
            .join("notebooks")
            .join(format!("{}.kasane.json", notebook.id)),
        &data,
    )
    .await
}
#[tauri::command]
async fn list_notebooks(state: State<'_, AppState>) -> Result<Vec<Notebook>, DbError> {
    let mut entries = tokio::fs::read_dir(state.root.join("notebooks"))
        .await
        .map_err(err)?;
    let mut list = vec![];
    while let Some(entry) = entries.next_entry().await.map_err(err)? {
        if entry
            .file_name()
            .to_string_lossy()
            .ends_with(".kasane.json")
        {
            let notebook: Notebook =
                serde_json::from_slice(&tokio::fs::read(entry.path()).await.map_err(err)?)
                    .map_err(err)?;
            if notebook.version != 1 {
                return Err(err("Unsupported notebook version"));
            }
            list.push(notebook);
        }
    }
    list.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(list)
}
#[tauri::command]
async fn list_sql_documents(
    state: State<'_, AppState>,
) -> Result<Vec<sql_documents::SQLDocument>, DbError> {
    sql_documents::list(&state.root.join("sql-documents")).await
}
#[tauri::command]
async fn save_sql_document(
    state: State<'_, AppState>,
    document: sql_documents::SQLDocument,
) -> Result<(), DbError> {
    let _guard = state.files.lock().await;
    sql_documents::save(&state.root.join("sql-documents"), &document).await
}
fn sql_path(path: &str) -> Result<PathBuf, DbError> {
    let path = PathBuf::from(path);
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("sql"))
    {
        return Err(err("Choose an absolute .sql file path"));
    }
    Ok(path)
}
#[tauri::command]
async fn read_sql_file(path: String) -> Result<String, DbError> {
    let file = tokio::fs::File::open(sql_path(&path)?).await.map_err(err)?;
    use tokio::io::AsyncReadExt;
    let mut source = String::new();
    file.take(1024 * 1024 + 1)
        .read_to_string(&mut source)
        .await
        .map_err(err)?;
    if source.len() > 1024 * 1024 {
        return Err(err("SQL file exceeds 1 MiB"));
    }
    Ok(source)
}
#[tauri::command]
async fn write_sql_file(path: String, source: String) -> Result<(), DbError> {
    if source.len() > 1024 * 1024 {
        return Err(err("SQL file exceeds 1 MiB"));
    }
    atomic_write(&sql_path(&path)?, source.as_bytes()).await
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            menu::install(app)?;
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(root.join("notebooks"))?;
            std::fs::create_dir_all(root.join("sql-documents"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(
                    root.join("sql-documents"),
                    std::fs::Permissions::from_mode(0o700),
                )?;
                std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
                std::fs::set_permissions(
                    root.join("notebooks"),
                    std::fs::Permissions::from_mode(0o700),
                )?;
            }
            app.manage(AppState {
                root,
                sessions: Mutex::new(HashMap::new()),
                files: Mutex::new(()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sql_documents,
            save_sql_document,
            read_sql_file,
            write_sql_file,
            list_connections,
            save_connection,
            delete_connection,
            open_session,
            close_session,
            execute_sql,
            cancel_query,
            get_catalog,
            save_notebook,
            list_notebooks
        ])
        .run(tauri::generate_context!())
        .expect("Kasane could not start");
}

#[cfg(test)]
mod file_tests {
    use super::*;
    #[tokio::test]
    async fn sql_file_round_trip_and_limits() {
        let path = std::env::temp_dir().join(format!("kasane-{}.sql", Uuid::new_v4()));
        let name = path.to_string_lossy().into_owned();
        let source = "-- 重ね\nSELECT 9223372036854775807, NULL;\n".to_owned();
        write_sql_file(name.clone(), source.clone()).await.unwrap();
        assert_eq!(read_sql_file(name.clone()).await.unwrap(), source);
        assert!(write_sql_file(name.clone(), "x".repeat(1024 * 1024 + 1))
            .await
            .is_err());
        assert_eq!(read_sql_file(name.clone()).await.unwrap(), source);
        assert!(read_sql_file(name.replace(".sql", ".env")).await.is_err());
        tokio::fs::write(&path, "x".repeat(1024 * 1024 + 1))
            .await
            .unwrap();
        assert!(read_sql_file(name).await.is_err());
        tokio::fs::remove_file(&path).await.unwrap();
    }
}
