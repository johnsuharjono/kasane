use crate::db::DbError;
use crate::{atomic_write, err, valid_id};
use serde::{Deserialize, Serialize};
use std::path::Path;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SQLDocument {
    pub version: u8,
    pub id: String,
    pub title: String,
    pub connection_id: Option<String>,
    pub source: String,
}
fn validate(d: &SQLDocument) -> Result<(), DbError> {
    valid_id(&d.id)?;
    if let Some(id) = &d.connection_id {
        valid_id(id)?;
    }
    if d.version != 1
        || d.title.trim().is_empty()
        || d.title.len() > 200
        || d.source.len() > 1024 * 1024
    {
        return Err(err(
            "Invalid SQL document: use a title up to 200 bytes and SQL up to 1 MiB",
        ));
    }
    Ok(())
}
pub async fn save(root: &Path, d: &SQLDocument) -> Result<(), DbError> {
    validate(d)?;
    atomic_write(
        &root.join(format!("{}.sql.json", d.id)),
        &serde_json::to_vec_pretty(d).map_err(err)?,
    )
    .await
}
pub async fn list(root: &Path) -> Result<Vec<SQLDocument>, DbError> {
    let mut entries = tokio::fs::read_dir(root).await.map_err(err)?;
    let mut list = vec![];
    while let Some(entry) = entries.next_entry().await.map_err(err)? {
        if entry.file_name().to_string_lossy().ends_with(".sql.json") {
            let d: SQLDocument =
                serde_json::from_slice(&tokio::fs::read(entry.path()).await.map_err(err)?)
                    .map_err(err)?;
            validate(&d)?;
            list.push(d);
        }
    }
    list.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(list)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn app_data_documents_round_trip() {
        let root = std::env::temp_dir().join(format!("kasane-documents-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&root).await.unwrap();
        let mut d = SQLDocument {
            version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            title: "Revenue".into(),
            connection_id: Some(uuid::Uuid::new_v4().to_string()),
            source: "SELECT 9223372036854775807; -- 重ね".into(),
        };
        save(&root, &d).await.unwrap();
        d.title = "Renamed".into();
        save(&root, &d).await.unwrap();
        let docs = list(&root).await.unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].title, "Renamed");
        assert_eq!(docs[0].source, d.source);
        assert_eq!(docs[0].connection_id, d.connection_id);
        let raw = tokio::fs::read_to_string(root.join(format!("{}.sql.json", d.id)))
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 5);
        d.id = "../escape".into();
        assert!(save(&root, &d).await.is_err());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
