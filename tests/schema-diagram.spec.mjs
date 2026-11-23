import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

test("explore schema and table diagrams with composite and cross-schema keys", async ({
  page,
}) => {
  const bridge = await installDatabaseBridge(page);
  const admin = new pg.Client({
    connectionString:
      "postgresql://kasane:kasane_dev_only@127.0.0.1:55432/kasane_dev",
  });
  const schema = `diagram_${randomUUID().replaceAll("-", "")}`;
  await admin.connect();
  try {
    await admin.query(`
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.notes (
        id bigint PRIMARY KEY, parent_id bigint REFERENCES ${schema}.notes(id),
        line integer, order_id bigint, body text,
        CONSTRAINT item_fk FOREIGN KEY (line, order_id)
          REFERENCES commerce.order_items(line_number, order_id)
      );
      CREATE TABLE ${schema}.tags (label text);
    `);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Add a connection", exact: true })
      .click();
    await page.getByLabel("Password", { exact: true }).fill("kasane_dev_only");
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Schema actions for ${schema}` })
      .click();
    await page.getByRole("menuitem", { name: "Open Diagram" }).click();

    const diagram = page.getByRole("region", { name: "Schema diagram" });
    const notes = diagram.getByRole("article", { name: `${schema}.notes` });
    await expect(diagram.getByRole("article")).toHaveCount(3);
    await expect(notes.getByText("body", { exact: true })).toHaveCount(0);
    await expect(diagram.locator(".react-flow__edge")).toHaveCount(3);
    for (const description of [
      "notes.line references commerce.order_items.line_number",
      "notes.order_id references commerce.order_items.order_id",
      `notes.parent_id references ${schema}.notes.id`,
    ]) {
      await expect(
        diagram
          .locator(".react-flow__edge")
          .filter({ has: page.locator("path.react-flow__edge-path[d^='M']") })
          .and(diagram.locator(`[aria-label*="${description}"]`)),
      ).toHaveCount(1);
    }

    await diagram.getByRole("button", { name: "All columns" }).click();
    await expect(notes.getByText("body", { exact: true })).toBeVisible();
    const search = diagram.getByRole("searchbox", {
      name: "Find table in diagram",
    });
    await search.fill("order_items");
    await search.press("Enter");
    await expect(diagram.locator(".react-flow__node.selected")).toHaveAttribute(
      "aria-label",
      "commerce.order_items",
    );
    await diagram.getByRole("button", { name: "Fit diagram" }).click();

    await page.getByTitle(`Open ${schema}.notes`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Show in Diagram" }).click();
    await expect(diagram.getByRole("article")).toHaveCount(2);
    await expect(
      diagram.getByRole("article", { name: `${schema}.tags` }),
    ).toHaveCount(0);
    await diagram.getByRole("button", { name: "Refresh diagram" }).click();
    await expect(notes).toBeVisible();
    await diagram
      .getByRole("button", { name: "View structure for commerce.order_items" })
      .click();
    await expect(page.getByRole("tab", { name: "Structure" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByText("PRIMARY KEY (order_id, line_number)", { exact: true }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "notes · Diagram", exact: true })
      .click();
    await expect(diagram.getByRole("article")).toHaveCount(2);
    await diagram
      .getByRole("button", { name: `Open data for ${schema}.notes` })
      .click();
    await expect(page.getByRole("tab", { name: "Data" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  } finally {
    await bridge.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
