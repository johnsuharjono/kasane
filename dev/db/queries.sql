-- Browsing and joins
SELECT * FROM commerce.order_summary ORDER BY ordered_at DESC LIMIT 500;
SELECT c.name, count(*) AS orders, sum(s.total) AS lifetime_value
FROM commerce.customers c JOIN commerce.orders o ON o.customer_id = c.id
JOIN commerce.order_summary s ON s.id = o.id
GROUP BY c.id ORDER BY lifetime_value DESC LIMIT 100;
-- Stress the grid (bounded by the future client's fetch policy)
SELECT * FROM lab.wide_results LIMIT 5000;
SELECT * FROM commerce.events ORDER BY id LIMIT 15000;
-- Preserve types and inspect long values
SELECT * FROM lab.type_samples;
SELECT * FROM lab."Odd table";
-- Cancellation
SELECT pg_sleep(30);
-- Notebook session continuity: run in separate SQL cells on the SAME session
CREATE TEMP TABLE session_probe (message text);
INSERT INTO session_probe VALUES ('Notebook session survived');
SELECT * FROM session_probe;
-- Structure source: includes generated columns, comments and defaults
SELECT table_schema, table_name, column_name, data_type, udt_name,
       is_nullable, column_default, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema IN ('commerce','lab') ORDER BY table_schema, table_name, ordinal_position;
-- Indexes: unique, composite/covering, partial, expression, GIN, BRIN
SELECT * FROM pg_indexes WHERE schemaname='commerce';
-- FK definitions preserve composite keys and update/delete actions
SELECT conrelid::regclass AS source, confrelid::regclass AS target,
       conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE contype='f' AND connamespace='commerce'::regnamespace;
