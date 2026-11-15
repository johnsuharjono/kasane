import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { client } from "./config.mjs";
faker.seed(20261116);
faker.setDefaultRefDate("2026-11-01T00:00:00Z");
const db = client("analytics");
async function insert(table, columns, rows) {
  for (let offset = 0; offset < rows.length; offset += 250) {
    const batch = rows.slice(offset, offset + 250);
    await db.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${batch.map((r, i) => `(${r.map((_, j) => `$${i * columns.length + j + 1}`).join(",")})`).join(",")}`,
      batch.flat(),
    );
  }
  console.log(`${table}: ${rows.length} rows`);
}
const date = () => faker.date.between({ from: "2025-01-01", to: "2026-10-31" });
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(20261116)");
  await db.query(
    await readFile(new URL("./analytics-schema.sql", import.meta.url), "utf8"),
  );
  await insert(
    "workspace.organizations",
    ["id", "name", "plan", "created_at"],
    Array.from({ length: 120 }, (_, i) => [
      i + 1,
      faker.company.name(),
      faker.helpers.arrayElement(["starter", "team", "enterprise"]),
      date(),
    ]),
  );
  const members = Array.from({ length: 900 }, (_, i) => [
    i + 1,
    (i % 120) + 1,
    faker.person.fullName(),
    `member.${i + 1}@example.test`,
    i < 120 ? "owner" : faker.helpers.arrayElement(["admin", "member"]),
  ]);
  await insert(
    "workspace.members",
    ["id", "organization_id", "name", "email", "role"],
    members,
  );
  const projects = Array.from({ length: 450 }, (_, i) => [
    i + 1,
    (i % 120) + 1,
    `${faker.hacker.noun()}-${i + 1}`,
    faker.helpers.arrayElement(["active", "archived"]),
    JSON.stringify({
      runtime: faker.helpers.arrayElement(["node", "rust", "python"]),
      autoDeploy: i % 3 !== 0,
    }),
  ]);
  await insert(
    "workspace.projects",
    ["id", "organization_id", "name", "status", "settings"],
    projects,
  );
  await insert(
    "workspace.deployments",
    [
      "id",
      "project_id",
      "actor_id",
      "status",
      "region",
      "duration_ms",
      "started_at",
    ],
    Array.from({ length: 5000 }, (_, i) => {
      const p = faker.helpers.arrayElement(projects);
      return [
        i + 1,
        p[0],
        i % 11
          ? faker.helpers.arrayElement(members.filter((m) => m[1] === p[1]))[0]
          : null,
        faker.helpers.arrayElement([
          "ready",
          "ready",
          "ready",
          "failed",
          "cancelled",
        ]),
        faker.helpers.arrayElement(["sin-1", "iad-1", "fra-1"]),
        i % 9 ? faker.number.int({ min: 300, max: 180000 }) : null,
        date(),
      ];
    }),
  );
  await insert(
    "billing.invoices",
    ["id", "organization_id", "amount", "status", "due_date"],
    Array.from({ length: 240 }, (_, i) => [
      faker.string.uuid(),
      (i % 120) + 1,
      faker.commerce.price({ min: 20, max: 15000 }),
      faker.helpers.arrayElement(["paid", "open", "void"]),
      date().toISOString().slice(0, 10),
    ]),
  );
  await db.query("COMMIT");
  await db.query("ANALYZE");
  const {
    rows: [counts],
  } = await db.query(
    `SELECT (SELECT count(*)::int FROM workspace.organizations) AS organizations,(SELECT count(*)::int FROM workspace.members) AS members,(SELECT count(*)::int FROM workspace.projects) AS projects,(SELECT count(*)::int FROM workspace.deployments) AS deployments,(SELECT count(*)::int FROM billing.invoices) AS invoices`,
  );
  assert.deepEqual(counts, {
    organizations: 120,
    members: 900,
    projects: 450,
    deployments: 5000,
    invoices: 240,
  });
  const {
    rows: [foreignKeys],
  } = await db.query(
    `SELECT count(*)::int AS count FROM pg_constraint WHERE contype='f' AND connamespace IN ('workspace'::regnamespace,'billing'::regnamespace)`,
  );
  assert.equal(foreignKeys.count, 5);
  console.log("Verified second fixture:", counts, "with 5 foreign keys.");
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
