use futures_util::{pin_mut, TryStreamExt};
use postgres_native_tls::MakeTlsConnector;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Instant};
use tokio::sync::Mutex;
use tokio_postgres::{types::Kind, CancelToken, Client, SimpleQueryMessage};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    /// Legacy flag: true meant "require TLS and verify the certificate".
    pub tls: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_mode: Option<TlsMode>,
    /// Name from the frontend's fixed swatch palette; absent means neutral.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TlsMode {
    Disable,
    /// Encrypt, but accept any certificate and host name.
    Require,
    VerifyFull,
}
impl Connection {
    pub fn tls_mode(&self) -> TlsMode {
        self.tls_mode.unwrap_or(if self.tls {
            TlsMode::VerifyFull
        } else {
            TlsMode::Disable
        })
    }
}
pub const CONNECTION_COLORS: [&str; 8] = [
    "gray", "blue", "teal", "green", "amber", "orange", "rose", "violet",
];
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbError {
    pub message: String,
    pub code: Option<String>,
    pub detail: Option<String>,
    pub hint: Option<String>,
    pub disconnected: bool,
}
impl From<tokio_postgres::Error> for DbError {
    fn from(e: tokio_postgres::Error) -> Self {
        let d = e.as_db_error();
        Self {
            message: d
                .map(|d| d.message().to_owned())
                .unwrap_or_else(|| e.to_string()),
            code: d.map(|d| d.code().code().to_owned()),
            detail: d.and_then(|d| d.detail().map(str::to_owned)),
            hint: d.and_then(|d| d.hint().map(str::to_owned)),
            disconnected: e.is_closed()
                || d.is_some_and(|d| {
                    d.code().code().starts_with("08")
                        || ["57P01", "57P02", "57P03"].contains(&d.code().code())
                }),
        }
    }
}
impl DbError {
    pub fn message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
            detail: None,
            hint: None,
            disconnected: false,
        }
    }
}
pub struct Session {
    pub client: Mutex<Client>,
    pub cancel: CancelToken,
    pub active: Mutex<Option<String>>,
    pub tls: MakeTlsConnector,
}
impl Session {
    pub async fn connect(c: &Connection, password: &str) -> Result<Arc<Self>, DbError> {
        let mut config = tokio_postgres::Config::new();
        config
            .host(&c.host)
            .port(c.port)
            .dbname(&c.database)
            .user(&c.username)
            .password(password)
            .application_name("Kasane")
            .connect_timeout(std::time::Duration::from_secs(10))
            .ssl_mode(if c.tls_mode() == TlsMode::Disable {
                tokio_postgres::config::SslMode::Disable
            } else {
                tokio_postgres::config::SslMode::Require
            });
        let mut builder = native_tls::TlsConnector::builder();
        if c.tls_mode() == TlsMode::Require {
            builder
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true);
        }
        let tls = MakeTlsConnector::new(
            builder
                .build()
                .map_err(|e| DbError::message(e.to_string()))?,
        );
        let (client, connection) = config.connect(tls.clone()).await?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client.batch_execute("SET DateStyle = 'ISO, YMD'; SET TimeZone = 'UTC'; SET bytea_output = 'hex'; SET extra_float_digits = 3").await?;
        let cancel = client.cancel_token();
        Ok(Arc::new(Self {
            client: Mutex::new(client),
            cancel,
            active: Mutex::new(None),
            tls,
        }))
    }
    /// Server version string, for the connection dialog's test result.
    pub async fn server_version(&self) -> Result<String, DbError> {
        let client = self.client.lock().await;
        let rows = client.simple_query("SHOW server_version").await?;
        Ok(rows
            .iter()
            .find_map(|m| match m {
                SimpleQueryMessage::Row(r) => r.get(0).map(str::to_owned),
                _ => None,
            })
            .unwrap_or_default())
    }
    pub async fn execute(&self, request_id: &str, sql: &str) -> Result<QueryResult, DbError> {
        self.execute_with_limits(request_id, sql, 1000, 8 * 1024 * 1024)
            .await
    }
    pub async fn catalog(&self) -> Result<QueryResult, DbError> {
        self.execute_with_limits("catalog", CATALOG, 100_000, 16 * 1024 * 1024)
            .await
    }
    pub async fn relation_structure(
        &self,
        schema: &str,
        relation: &str,
    ) -> Result<RelationStructure, DbError> {
        let client = self.client.lock().await;
        let row = client
            .query_opt(
                include_str!("relation_structure.sql"),
                &[&schema, &relation],
            )
            .await?
            .ok_or_else(|| DbError::message("Relation no longer exists."))?;
        let structure: &str = row.try_get("structure")?;
        serde_json::from_str(structure).map_err(|e| DbError::message(e.to_string()))
    }
    async fn execute_with_limits(
        &self,
        request_id: &str,
        sql: &str,
        max_rows: usize,
        max_bytes: usize,
    ) -> Result<QueryResult, DbError> {
        let client = self.client.lock().await;
        if client.is_closed() {
            let mut e = DbError::message(
                "Session disconnected. Reconnect explicitly; no SQL has been replayed.",
            );
            e.disconnected = true;
            return Err(e);
        }
        *self.active.lock().await = Some(request_id.to_owned());
        let result = self.execute_locked(&client, sql, max_rows, max_bytes).await;
        *self.active.lock().await = None;
        result
    }
    async fn execute_locked(
        &self,
        client: &Client,
        sql: &str,
        max_rows: usize,
        max_bytes: usize,
    ) -> Result<QueryResult, DbError> {
        let start = Instant::now();
        // Describe without executing. One statement per execution avoids hidden batches and preserves type OIDs.
        let statement = client.prepare(sql).await?;
        let columns = statement
            .columns()
            .iter()
            .map(|c| Column {
                name: c.name().to_owned(),
                data_type: c.type_().name().to_owned(),
                oid: c.type_().oid(),
                is_enum: matches!(c.type_().kind(), Kind::Enum(_)),
            })
            .collect();
        // PostgreSQL's text protocol preserves numeric precision, timestamp microseconds, bytea, arrays and unknown types.
        let stream = client.simple_query_raw(sql).await?;
        pin_mut!(stream);
        let mut rows = Vec::new();
        let mut bytes = 0;
        let mut count = 0u64;
        let mut affected = 0u64;
        let mut truncated = false;
        while let Some(message) = stream.try_next().await? {
            match message {
                SimpleQueryMessage::Row(row) => {
                    count += 1;
                    let size: usize = (0..row.len()).map(|i| row.get(i).map_or(0, str::len)).sum();
                    if !truncated && rows.len() < max_rows && bytes + size <= max_bytes {
                        rows.push(
                            (0..row.len())
                                .map(|i| row.get(i).map(str::to_owned))
                                .collect(),
                        );
                        bytes += size;
                    } else {
                        truncated = true;
                    }
                }
                SimpleQueryMessage::CommandComplete(n) => affected = n,
                _ => {}
            }
        }
        Ok(QueryResult {
            columns,
            rows,
            duration_ms: start.elapsed().as_secs_f64() * 1000.0,
            returned_rows: count.to_string(),
            affected_rows: affected.to_string(),
            truncated,
            bytes,
        })
    }
    pub async fn cancel(&self, request_id: &str) -> Result<(), DbError> {
        let active = self.active.lock().await;
        if active.as_deref() == Some(request_id) {
            self.cancel.cancel_query(self.tls.clone()).await?;
        }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub oid: u32,
    pub is_enum: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<Option<String>>>,
    pub duration_ms: f64,
    pub returned_rows: String,
    pub affected_rows: String,
    pub truncated: bool,
    pub bytes: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationStructure {
    comment: Option<String>,
    view_definition: Option<String>,
    columns: Vec<StructureColumn>,
    constraints: Vec<StructureConstraint>,
    indexes: Vec<StructureIndex>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StructureColumn {
    name: String,
    data_type: String,
    required: bool,
    primary_key: bool,
    default_expression: Option<String>,
    generated_expression: Option<String>,
    identity: Option<String>,
    comment: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct StructureConstraint {
    name: String,
    definition: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct StructureIndex {
    name: String,
    method: String,
    definition: String,
    valid: bool,
}

pub const CATALOG: &str = "SELECT n.nspname AS schema, c.relname AS name, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE 'table' END AS kind, a.attname AS column, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull::text AS required, (SELECT k.ordinality::text FROM pg_catalog.pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality) WHERE i.indrelid=c.oid AND i.indisprimary AND k.attnum=a.attnum) AS primary_key_position, CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint::text END AS estimated_rows, fk.sch AS fk_schema, fk.rel AS fk_table, fk.col AS fk_column FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN LATERAL (SELECT tn.nspname AS sch, t.relname AS rel, ta.attname AS col FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class t ON t.oid=con.confrelid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.relnamespace JOIN pg_catalog.pg_attribute ta ON ta.attrelid=t.oid AND ta.attnum=con.confkey[1] WHERE con.conrelid=c.oid AND con.contype='f' AND cardinality(con.conkey)=1 AND con.conkey[1]=a.attnum ORDER BY con.conname LIMIT 1) fk ON true WHERE c.relkind IN ('r','v','m','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' ORDER BY n.nspname,c.relname,a.attnum";

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_tls_flag_maps_to_mode() {
        let parse = |json: &str| serde_json::from_str::<Connection>(json).unwrap();
        let base = r#""id":"x","name":"n","host":"h","port":5432,"database":"d","username":"u""#;
        assert_eq!(
            parse(&format!("{{{base},\"tls\":false}}")).tls_mode(),
            TlsMode::Disable
        );
        assert_eq!(
            parse(&format!("{{{base},\"tls\":true}}")).tls_mode(),
            TlsMode::VerifyFull
        );
        assert_eq!(
            parse(&format!("{{{base},\"tls\":true,\"tlsMode\":\"require\"}}")).tls_mode(),
            TlsMode::Require
        );
    }
    #[tokio::test]
    #[ignore = "requires make db-up db-seed"]
    async fn postgres_vertical_slice() {
        let c = Connection {
            id: "test".into(),
            name: "test".into(),
            host: "127.0.0.1".into(),
            port: 55432,
            database: "kasane_dev".into(),
            username: "kasane".into(),
            tls: false,
            tls_mode: None,
            color: None,
        };
        let s = Session::connect(&c, "kasane_dev_only").await.unwrap();
        let structure = s
            .relation_structure("commerce", "order_items")
            .await
            .unwrap();
        assert!(structure.columns.iter().any(|c| {
            c.name == "total"
                && c.generated_expression
                    .as_deref()
                    .is_some_and(|e| e.contains("unit_price"))
        }));
        assert!(structure
            .constraints
            .iter()
            .any(|c| c.definition == "PRIMARY KEY (order_id, line_number)"));
        assert!(structure
            .constraints
            .iter()
            .any(|c| c.definition.contains("FOREIGN KEY (order_id)")));
        assert!(structure
            .indexes
            .iter()
            .any(|i| i.name == "order_items_product_idx" && i.method == "btree"));
        let view = s
            .relation_structure("commerce", "order_summary")
            .await
            .unwrap();
        assert!(view.view_definition.is_some());
        assert!(s.relation_structure("lab", "Odd table").await.is_ok());
        assert!(s.relation_structure("lab", "missing").await.is_err());
        let catalog = s.catalog().await.unwrap();
        let item_keys: Vec<_> = catalog
            .rows
            .iter()
            .filter(|row| {
                row[0].as_deref() == Some("commerce")
                    && row[1].as_deref() == Some("order_items")
                    && row[6].is_some()
            })
            .map(|row| (row[3].as_deref().unwrap(), row[6].as_deref().unwrap()))
            .collect();
        assert_eq!(item_keys, vec![("order_id", "1"), ("line_number", "2")]);
        let r = s
            .execute("types", "SELECT * FROM lab.type_samples WHERE id=1")
            .await
            .unwrap();
        assert_eq!(r.rows[0][1].as_deref(), Some("9223372036854775807"));
        assert_eq!(
            r.rows[0][2].as_deref(),
            Some("123456789012345678901234567890.123456789012345678901234567890")
        );
        assert_eq!(r.rows[0][8].as_deref(), Some("\\x0001ffdeadbeef"));
        assert!(r.rows[0][9].is_none());
        assert_eq!(r.rows[0][10].as_deref(), Some(""));
        assert!(r.columns.iter().any(|c| c.data_type == "numeric"));
        s.execute("create", "CREATE TEMP TABLE notebook_test (v text)")
            .await
            .unwrap();
        s.execute(
            "insert",
            "INSERT INTO notebook_test VALUES ('same session')",
        )
        .await
        .unwrap();
        assert_eq!(
            s.execute("read", "SELECT * FROM notebook_test")
                .await
                .unwrap()
                .rows[0][0]
                .as_deref(),
            Some("same session")
        );
        let r = s
            .execute("bounded", "SELECT * FROM lab.wide_results")
            .await
            .unwrap();
        assert_eq!(r.columns.len(), 81);
        assert!(r.truncated);
        assert!(r.rows.len() <= 1000);
        assert!(r.bytes <= 8 * 1024 * 1024);
        assert!(s
            .execute("error", "SELECT missing FROM commerce.orders")
            .await
            .unwrap_err()
            .code
            .is_some());
        let running = s.clone();
        let task =
            tokio::spawn(async move { running.execute("sleep", "SELECT pg_sleep(30)").await });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        s.cancel("sleep").await.unwrap();
        assert_eq!(
            task.await.unwrap().unwrap_err().code.as_deref(),
            Some("57014")
        );
        assert!(s.execute("after_cancel", "SELECT 1").await.is_ok());
        s.execute("counter", "CREATE TEMP TABLE write_counter (v integer)")
            .await
            .unwrap();
        let written = s
            .execute(
                "write",
                "INSERT INTO write_counter SELECT generate_series(1,2000) RETURNING v",
            )
            .await
            .unwrap();
        assert!(written.truncated);
        assert_eq!(written.affected_rows, "2000");
        assert_eq!(
            s.execute("count", "SELECT count(*) FROM write_counter")
                .await
                .unwrap()
                .rows[0][0]
                .as_deref(),
            Some("2000")
        );
        let other = Session::connect(&c, "kasane_dev_only").await.unwrap();
        assert_eq!(
            other
                .execute("isolation", "SELECT * FROM notebook_test")
                .await
                .unwrap_err()
                .code
                .as_deref(),
            Some("42P01")
        );
        let lost = other
            .execute(
                "disconnect",
                "SELECT pg_terminate_backend(pg_backend_pid())",
            )
            .await
            .unwrap_err();
        assert!(lost.disconnected);
        assert!(
            other
                .execute("no_retry", "SELECT 1")
                .await
                .unwrap_err()
                .disconnected
        );
    }
}
