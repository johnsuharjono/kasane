SELECT jsonb_build_object(
    'comment', obj_description(c.oid, 'pg_class'),
    'viewDefinition', CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END,
    'columns', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'name', a.attname,
            'dataType', format_type(a.atttypid, a.atttypmod),
            'required', a.attnotnull,
            'primaryKey', EXISTS (
                SELECT FROM pg_catalog.pg_constraint p
                WHERE p.conrelid = c.oid AND p.contype = 'p' AND a.attnum = ANY(p.conkey)
            ),
            'defaultExpression', CASE WHEN a.attgenerated = '' THEN pg_get_expr(d.adbin, d.adrelid) END,
            'generatedExpression', CASE WHEN a.attgenerated <> '' THEN pg_get_expr(d.adbin, d.adrelid) END,
            'identity', CASE a.attidentity WHEN 'a' THEN 'always' WHEN 'd' THEN 'by default' END,
            'comment', col_description(c.oid, a.attnum)
        ) ORDER BY a.attnum), '[]'::jsonb)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    ),
    'constraints', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'name', k.conname, 'definition', pg_get_constraintdef(k.oid, true)
        ) ORDER BY k.conname), '[]'::jsonb)
        FROM pg_catalog.pg_constraint k
        WHERE k.conrelid = c.oid
    ),
    'indexes', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'name', idx.relname, 'method', am.amname,
            'definition', pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid
        ) ORDER BY idx.relname), '[]'::jsonb)
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_catalog.pg_am am ON am.oid = idx.relam
        WHERE i.indrelid = c.oid
    )
)::text AS structure
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1::text AND c.relname = $2::text AND c.relkind IN ('r', 'p', 'v', 'm')
