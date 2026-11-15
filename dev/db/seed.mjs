import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { client } from "./config.mjs";
const scale = Number(process.env.SEED_SCALE ?? 1);
if (!Number.isInteger(scale) || scale < 1 || scale > 20)
  throw new Error("SEED_SCALE must be an integer from 1 to 20");
faker.seed(20261115);
faker.setDefaultRefDate("2026-11-01T00:00:00Z");
const db = client();
const start = performance.now();
async function insert(table, columns, rows) {
  for (let offset = 0; offset < rows.length; offset += 250) {
    const batch = rows.slice(offset, offset + 250);
    const values = batch.flat();
    const placeholders = batch
      .map(
        (row, i) =>
          `(${row.map((_, j) => `$${i * columns.length + j + 1}`).join(",")})`,
      )
      .join(",");
    await db.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`,
      values,
    );
  }
  console.log(`${table}: ${rows.length.toLocaleString()} rows`);
}
const date = () => faker.date.between({ from: "2025-01-01", to: "2026-10-31" });
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(20261115)");
  await db.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await insert(
    "commerce.customers",
    ["email", "name", "country", "created_at", "archived_at", "metadata"],
    Array.from({ length: 1000 * scale }, (_, i) => [
      `customer.${i + 1}@example.test`,
      faker.person.fullName(),
      faker.location.countryCode(),
      date(),
      i % 10 === 0 ? date() : null,
      JSON.stringify({
        tier: faker.helpers.arrayElement(["free", "pro", "team"]),
        source: "synthetic",
      }),
    ]),
  );
  await insert(
    "commerce.categories",
    ["id", "parent_id", "name"],
    Array.from({ length: 12 }, (_, i) => [
      i + 1,
      i < 3 ? null : (i % 3) + 1,
      `Category ${i + 1}`,
    ]),
  );
  const products = Array.from({ length: 250 }, (_, i) => [
    i + 1,
    (i % 12) + 1,
    `SKU-${String(i + 1).padStart(5, "0")}`,
    faker.commerce.productName(),
    faker.commerce.price({ min: 5, max: 2000 }),
    ["new", i % 2 ? "home" : "office"],
    JSON.stringify({
      color: faker.color.human(),
      weight: faker.number.int({ min: 1, max: 100 }),
    }),
  ]);
  await insert(
    "commerce.products",
    ["id", "category_id", "sku", "name", "price", "tags", "attributes"],
    products,
  );
  const orders = Array.from({ length: 8000 * scale }, (_, i) => {
    const ordered = date();
    const status = faker.helpers.arrayElement([
      "pending",
      "paid",
      "shipped",
      "cancelled",
    ]);
    return [
      i + 1,
      faker.number.int({ min: 1, max: 1000 * scale }),
      status,
      ordered,
      status === "shipped" ? new Date(ordered.getTime() + 86400000) : null,
      JSON.stringify({
        street: faker.location.streetAddress(),
        city: faker.location.city(),
      }),
      i % 7 ? null : faker.lorem.paragraph(),
    ];
  });
  await insert(
    "commerce.orders",
    [
      "id",
      "customer_id",
      "status",
      "ordered_at",
      "shipped_at",
      "shipping_address",
      "notes",
    ],
    orders,
  );
  const items = orders.flatMap((order) =>
    Array.from({ length: 3 }, (_, i) => {
      const product = faker.helpers.arrayElement(products);
      return [
        order[0],
        i + 1,
        product[0],
        faker.number.int({ min: 1, max: 5 }),
        product[4],
      ];
    }),
  );
  await insert(
    "commerce.order_items",
    ["order_id", "line_number", "product_id", "quantity", "unit_price"],
    items,
  );
  // Derive payments from exact PostgreSQL decimals instead of JS floating point arithmetic.
  await db.query(`INSERT INTO commerce.payments
    SELECT md5('payment-' || o.id)::uuid, o.id, sum(i.total), 'USD', o.ordered_at, 'demo-' || o.id
    FROM commerce.orders o JOIN commerce.order_items i ON i.order_id=o.id
    WHERE o.status IN ('paid','shipped') GROUP BY o.id`);
  await insert(
    "commerce.events",
    ["id", "customer_id", "occurred_at", "kind", "payload"],
    Array.from({ length: 15000 * scale }, (_, i) => [
      i + 1,
      i % 11 ? faker.number.int({ min: 1, max: 1000 * scale }) : null,
      new Date(Date.UTC(2025, 0, 1) + i * 60000),
      faker.helpers.arrayElement(["page_view", "search", "checkout"]),
      JSON.stringify({
        path: faker.internet.url(),
        device: faker.helpers.arrayElement(["desktop", "mobile"]),
      }),
    ]),
  );
  const columns = Array.from(
    { length: 80 },
    (_, i) => `field_${String(i + 1).padStart(2, "0")}`,
  );
  await db.query(
    `CREATE TABLE lab.wide_results (id integer PRIMARY KEY, ${columns.map((c) => `${c} text`).join(",")})`,
  );
  await db.query(
    `INSERT INTO lab.wide_results SELECT n, ${columns.map((_, i) => (i % 13 === 0 ? `CASE WHEN n % 7 = 0 THEN NULL ELSE repeat('long value 重ね ' || n || ' ', 100) END` : `'column ${i + 1} · row ' || n`)).join(",")} FROM generate_series(1, ${5000 * scale}) AS n`,
  );
  await db.query("COMMIT");
  await db.query("ANALYZE");
  console.log(
    `Seed ${20261115}, scale ${scale}; completed in ${((performance.now() - start) / 1000).toFixed(2)}s`,
  );
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
