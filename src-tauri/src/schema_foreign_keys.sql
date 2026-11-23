SELECT
    con.conname::text AS name,
    sn.nspname::text AS source_schema,
    s.relname::text AS source_table,
    tn.nspname::text AS target_schema,
    t.relname::text AS target_table,
    array_agg(sa.attname::text ORDER BY keys.position) AS source_columns,
    array_agg(ta.attname::text ORDER BY keys.position) AS target_columns
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class s ON s.oid = con.conrelid
JOIN pg_catalog.pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_catalog.pg_class t ON t.oid = con.confrelid
JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace
CROSS JOIN LATERAL unnest(con.conkey, con.confkey)
    WITH ORDINALITY AS keys(source_number, target_number, position)
JOIN pg_catalog.pg_attribute sa ON sa.attrelid = s.oid AND sa.attnum = keys.source_number
JOIN pg_catalog.pg_attribute ta ON ta.attrelid = t.oid AND ta.attnum = keys.target_number
WHERE con.contype = 'f'
  AND ((sn.nspname::text = $1 AND ($2::text IS NULL OR s.relname::text = $2))
    OR (tn.nspname::text = $1 AND ($2::text IS NULL OR t.relname::text = $2)))
GROUP BY con.oid, con.conname, sn.nspname, s.relname, tn.nspname, t.relname
ORDER BY sn.nspname, s.relname, con.conname, con.oid;
