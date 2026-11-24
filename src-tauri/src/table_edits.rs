use crate::db::{DbError, Session};
use bytes::BytesMut;
use serde::Deserialize;
use std::collections::HashSet;
use tokio_postgres::types::{to_sql_checked, Format, IsNull, ToSql, Type};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowUpdate {
    key: Vec<String>,
    table_oid: String,
    tuple: String,
    version: String,
    cells: Vec<CellUpdate>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CellUpdate {
    column: String,
    value: Option<String>,
}

// PostgreSQL parses text parameters with the target type's own input function.
#[derive(Debug)]
struct TextParam<'a>(Option<&'a str>);
impl ToSql for TextParam<'_> {
    fn to_sql(
        &self,
        _: &Type,
        out: &mut BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Sync + Send>> {
        match self.0 {
            Some(value) => {
                out.extend_from_slice(value.as_bytes());
                Ok(IsNull::No)
            }
            None => Ok(IsNull::Yes),
        }
    }

    fn accepts(_: &Type) -> bool {
        true
    }

    fn encode_format(&self, _: &Type) -> Format {
        Format::Text
    }

    to_sql_checked!();
}

fn ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

const UPDATE_METADATA: &str = "
SELECT
    COALESCE((
        SELECT array_agg(a.attname::text ORDER BY k.ordinality)
        FROM pg_catalog.pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE i.indrelid = c.oid AND i.indisprimary AND k.ordinality <= i.indnkeyatts
    ), ARRAY[]::text[]) AS keys,
    ARRAY(
        SELECT a.attname::text FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attgenerated = '' AND a.attidentity = ''
          AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'UPDATE')
    ) AS editable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname::text = $1 AND c.relname::text = $2 AND c.relkind IN ('r', 'p')
  AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')";

impl Session {
    pub async fn apply_table_updates(
        &self,
        schema: &str,
        relation: &str,
        rows: Vec<RowUpdate>,
    ) -> Result<(), DbError> {
        if rows.is_empty() || rows.len() > 1000 {
            return Err(DbError::message(
                "Apply between 1 and 1,000 rows at a time.",
            ));
        }
        let value_bytes: usize = rows
            .iter()
            .map(|row| {
                row.key.iter().map(String::len).sum::<usize>()
                    + row
                        .cells
                        .iter()
                        .map(|cell| cell.value.as_ref().map_or(0, String::len))
                        .sum::<usize>()
            })
            .sum();
        if value_bytes > 1024 * 1024 {
            return Err(DbError::message(
                "Table changes exceed the 1 MiB batch limit.",
            ));
        }
        let mut client = self.client.lock().await;
        let transaction = client.transaction().await?;
        let metadata = transaction
            .query_opt(UPDATE_METADATA, &[&schema, &relation])
            .await?
            .ok_or_else(|| DbError::message("Table is no longer available for editing."))?;
        let keys: Vec<String> = metadata.try_get("keys")?;
        let editable: Vec<String> = metadata.try_get("editable")?;
        if keys.is_empty() {
            return Err(DbError::message("Table editing requires a primary key."));
        }

        let target = format!("{}.{}", ident(schema), ident(relation));
        let mut seen = HashSet::new();
        for row in &rows {
            if row.key.len() != keys.len()
                || row.cells.is_empty()
                || !seen.insert((&row.table_oid, &row.key))
            {
                return Err(DbError::message(
                    "Invalid or duplicate row in the change batch.",
                ));
            }

            let row_label = || {
                keys.iter()
                    .zip(&row.key)
                    .map(|(column, value)| {
                        let abbreviated: String = value.chars().take(80).collect();
                        format!("{column}={abbreviated}")
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let mut columns = HashSet::new();
            for cell in &row.cells {
                if keys.contains(&cell.column)
                    || !editable.contains(&cell.column)
                    || !columns.insert(&cell.column)
                {
                    return Err(DbError::message(format!(
                        "{} is no longer editable for row {}.",
                        cell.column,
                        row_label()
                    )));
                }
            }

            let mut params: Vec<TextParam<'_>> = row
                .cells
                .iter()
                .map(|cell| TextParam(cell.value.as_deref()))
                .collect();
            let assignments = row
                .cells
                .iter()
                .enumerate()
                .map(|(i, cell)| format!("{} = ${}", ident(&cell.column), i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let mut predicates = Vec::new();
            for (column, value) in keys.iter().zip(&row.key) {
                params.push(TextParam(Some(value)));
                predicates.push(format!("{} = ${}", ident(column), params.len()));
            }
            for (column, value) in [
                ("tableoid", &row.table_oid),
                ("ctid", &row.tuple),
                ("xmin", &row.version),
            ] {
                params.push(TextParam(Some(value)));
                predicates.push(format!("{column} = ${}", params.len()));
            }
            let sql = format!(
                "UPDATE {target} SET {assignments} WHERE {}",
                predicates.join(" AND ")
            );
            let bound = params
                .iter()
                .map(|p| p as &(dyn ToSql + Sync))
                .collect::<Vec<_>>();
            let affected = transaction.execute(&sql, &bound).await.map_err(|e| {
                let mut error = DbError::from(e);
                error.message = format!("Row {}: {}", row_label(), error.message);
                error
            })?;
            if affected != 1 {
                return Err(DbError::message(format!(
                    "Couldn’t update row {}. It may have changed or may no longer be visible. No changes were applied.",
                    row_label()
                )));
            }
        }
        transaction.commit().await.map_err(|e| {
            let mut error = DbError::from(e);
            if error.disconnected {
                error.message = "Connection lost during commit. The outcome is unknown. Refresh and verify the affected rows before trying again.".into();
            }
            error
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Connection;

    #[tokio::test]
    #[ignore = "requires make db-up db-seed"]
    async fn updates_use_original_rows_and_roll_back_the_whole_batch() {
        let connection = Connection {
            id: "edits".into(),
            name: "edits".into(),
            host: "127.0.0.1".into(),
            port: 55432,
            database: "kasane_dev".into(),
            username: "kasane".into(),
            tls: false,
            tls_mode: None,
            color: None,
        };
        let session = Session::connect(&connection, "kasane_dev_only")
            .await
            .unwrap();
        let sql = |source| session.execute("edit-test", source);
        sql(r#"CREATE TEMP TABLE edits (
            "tenant id" bigint, id integer, detail jsonb, amount numeric, note text,
            derived numeric GENERATED ALWAYS AS (amount + 1) STORED,
            PRIMARY KEY ("tenant id", id) INCLUDE (note)
        )"#)
        .await
        .unwrap();
        sql(r#"INSERT INTO edits VALUES (9223372036854775807, 1, '{}', 10, 'old'), (9223372036854775807, 2, '{}', 20, 'old')"#).await.unwrap();
        let schema = sql("SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()")
            .await
            .unwrap()
            .rows[0][0]
            .clone()
            .unwrap();
        let snapshot =
            || sql(r#"SELECT "tenant id", id, tableoid, ctid, xmin FROM edits ORDER BY id"#);
        let original = snapshot().await.unwrap().rows;
        let update = |snapshot: &[Option<String>], column: &str, value: Option<&str>| RowUpdate {
            key: snapshot[..2].iter().map(|v| v.clone().unwrap()).collect(),
            table_oid: snapshot[2].clone().unwrap(),
            tuple: snapshot[3].clone().unwrap(),
            version: snapshot[4].clone().unwrap(),
            cells: vec![CellUpdate {
                column: column.into(),
                value: value.map(str::to_owned),
            }],
        };

        let error = session
            .apply_table_updates(
                &schema,
                "edits",
                vec![
                    update(&original[0], "note", Some("should roll back")),
                    update(&original[1], "amount", Some("invalid numeric")),
                ],
            )
            .await
            .unwrap_err();
        assert_eq!(error.code.as_deref(), Some("22P02"));
        assert_eq!(
            sql("SELECT note FROM edits WHERE id = 1")
                .await
                .unwrap()
                .rows[0][0]
                .as_deref(),
            Some("old")
        );

        sql("UPDATE edits SET amount = 21 WHERE id = 2")
            .await
            .unwrap();
        let error = session
            .apply_table_updates(
                &schema,
                "edits",
                vec![
                    update(&original[0], "note", Some("also rolls back")),
                    update(&original[1], "note", Some("outdated")),
                ],
            )
            .await
            .unwrap_err();
        assert!(error.message.contains("may have changed"));
        assert_eq!(
            sql("SELECT note FROM edits WHERE id = 1")
                .await
                .unwrap()
                .rows[0][0]
                .as_deref(),
            Some("old")
        );

        let current = snapshot().await.unwrap().rows;
        let error = session
            .apply_table_updates(
                &schema,
                "edits",
                vec![update(&current[0], "derived", Some("1"))],
            )
            .await
            .unwrap_err();
        assert!(error.message.contains("no longer editable"));
        let mut first = update(&current[0], "note", None);
        first.cells.push(CellUpdate {
            column: "amount".into(),
            value: Some("12345678901234567890.123456789".into()),
        });
        session
            .apply_table_updates(
                &schema,
                "edits",
                vec![
                    first,
                    update(
                        &current[1],
                        "detail",
                        Some(r#"{"value":9223372036854775807}"#),
                    ),
                ],
            )
            .await
            .unwrap();
        let after = sql("SELECT note, amount::text, detail->>'value' FROM edits ORDER BY id")
            .await
            .unwrap()
            .rows;
        assert_eq!(after[0][0], None);
        assert_eq!(
            after[0][1].as_deref(),
            Some("12345678901234567890.123456789")
        );
        assert_eq!(after[1][2].as_deref(), Some("9223372036854775807"));
    }
}
