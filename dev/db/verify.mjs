import assert from "node:assert/strict";
import { client } from "./config.mjs";
const db = client();
try {
  await db.connect();
  const {
    rows: [counts],
  } = await db.query(`SELECT
    (SELECT count(*)::int FROM commerce.customers) AS customers,
    (SELECT count(*)::int FROM commerce.orders) AS orders,
    (SELECT count(*)::int FROM commerce.order_items) AS items,
    (SELECT count(*)::int FROM commerce.payments) AS payments,
    (SELECT count(*)::int FROM commerce.events) AS events,
    (SELECT count(*)::int FROM lab.wide_results) AS wide`);
  assert(counts.customers >= 1000);
  assert.equal(counts.orders, counts.customers * 8);
  assert.equal(counts.items, counts.orders * 3);
  assert.equal(counts.events, counts.customers * 15);
  assert.equal(counts.wide, counts.customers * 5);
  assert(counts.payments > 0);
  const {
    rows: [sample],
  } = await db.query(`SELECT large_integer::text, exact_decimal::text,
    encode(binary_value,'hex') AS binary, optional_text, empty_text,
    timestamp_utc::text AS timestamp, length(long_text)::int AS text_length,
    (json_value->>'large') AS json_large FROM lab.type_samples WHERE id=1`);
  assert.equal(sample.large_integer, "9223372036854775807");
  assert.equal(
    sample.exact_decimal,
    "123456789012345678901234567890.123456789012345678901234567890",
  );
  assert.equal(sample.binary, "0001ffdeadbeef");
  assert.equal(sample.optional_text, null);
  assert.equal(sample.empty_text, "");
  assert.equal(sample.json_large, "9223372036854775807");
  assert(sample.timestamp.includes(".123456"));
  assert(sample.text_length > 90000);
  const {
    rows: [relations],
  } = await db.query(`SELECT count(*)::int AS count FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='commerce' AND c.contype='f'`);
  assert.equal(relations.count, 7);
  const { rows: indexes } = await db.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='commerce'`,
  );
  assert(indexes.some((r) => r.indexdef.includes("USING gin")));
  assert(indexes.some((r) => r.indexdef.includes("USING brin")));
  assert(indexes.some((r) => r.indexdef.includes("WHERE")));
  const {
    rows: [totals],
  } = await db.query(`SELECT count(*)::int AS bad FROM commerce.payments p
    JOIN commerce.order_summary o ON o.id=p.order_id WHERE p.amount <> o.total`);
  assert.equal(totals.bad, 0);
  const {
    rows: [width],
  } = await db.query(
    `SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='lab' AND table_name='wide_results'`,
  );
  assert.equal(width.count, 81);
  console.log("Verified:", counts);
  console.log(
    `${relations.count} foreign keys; ${indexes.length} indexes; exact types, generated totals, 81-column grid fixture OK`,
  );
} finally {
  await db.end();
}
