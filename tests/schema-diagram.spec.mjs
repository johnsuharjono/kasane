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
        id bigint PRIMARY KEY REFERENCES ${schema}.notes(id),
        parent_id bigint REFERENCES ${schema}.notes(id),
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
      .getByRole("button", { name: `Open diagram for ${schema}` })
      .click();

    const diagram = page.getByRole("region", { name: "Schema diagram" });
    const notes = diagram.getByRole("article", { name: `${schema}.notes` });
    await expect(diagram.getByRole("article")).toHaveCount(3);
    await expect(notes.getByText("body", { exact: true })).toHaveCount(0);
    await expect(notes.getByText("PK/FK", { exact: true })).toHaveAttribute(
      "title",
      "Primary and foreign key",
    );
    await expect(notes.getByRole("button")).toHaveCount(0);
    await expect(
      diagram.locator(".react-flow__background-pattern.dots"),
    ).toHaveCount(1);
    await expect(diagram.locator(".react-flow__edge")).toHaveCount(4);
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

    const notesNode = diagram
      .locator(".react-flow__node")
      .filter({ has: page.getByRole("article", { name: `${schema}.notes` }) });
    const edge = diagram
      .locator(
        `[aria-label*="notes.line references commerce.order_items.line_number"]`,
      )
      .locator(".react-flow__edge-path");
    const originalRoute = await edge.getAttribute("d");
    const before = await notesNode.evaluate((node) => node.style.transform);
    const header = await notes.locator("header").boundingBox();
    await page.mouse.move(
      header.x + header.width / 2,
      header.y + header.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      header.x + header.width / 2 + 65,
      header.y + header.height / 2 + 65,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(edge).not.toHaveAttribute("d", originalRoute);
    await expect
      .poll(() => notesNode.evaluate((node) => node.style.transform))
      .not.toBe(before);
    const moved = await notesNode.evaluate((node) => node.style.transform);

    await diagram.getByRole("button", { name: "All columns" }).click();
    await expect(notes.getByText("body", { exact: true })).toBeVisible();
    await expect
      .poll(() => notesNode.evaluate((node) => node.style.transform))
      .toBe(moved);
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

    await diagram.getByRole("button", { name: "All columns" }).click();
    await expect(notes.getByText("body", { exact: true })).toHaveCount(0);
    await diagram.getByRole("button", { name: "Refresh diagram" }).click();
    await expect(notes).toBeVisible();
    await expect
      .poll(() => notesNode.evaluate((node) => node.style.transform))
      .toBe(before);
    await expect(edge).toHaveAttribute("d", originalRoute);

    await page.getByTitle(`Open ${schema}.notes`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Show in Diagram" }).click();
    await expect(diagram.getByRole("article")).toHaveCount(2);
    await expect(
      diagram.getByRole("article", { name: `${schema}.tags` }),
    ).toHaveCount(0);
    await diagram.getByRole("button", { name: "Refresh diagram" }).click();
    await expect(notes).toBeVisible();
    const strip = page.getByRole("navigation", { name: "Open documents" });
    const fullTab = strip.getByRole("button", {
      name: `${schema} · Diagram`,
      exact: true,
    });
    const focusedTab = strip.getByRole("button", {
      name: "notes · Diagram",
      exact: true,
    });
    const tabTitles = strip.locator("[data-tab-id] > button:first-child");
    // Exercise the pointer sensor in both engines without native HTML drag events.
    const dragTabTo = async (from, to) => {
      const source = await from.boundingBox();
      const target = await to.boundingBox();
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 12 },
      );
      await expect(strip.locator("[data-dragging]")).toHaveCount(1);
      await expect(
        strip.locator("[data-tab-id]:not([data-dragging])"),
      ).toHaveAttribute("style", /translateX\((?!0px)/);
      await page.mouse.up();
    };

    await dragTabTo(focusedTab, fullTab);
    await expect(tabTitles).toHaveText([
      "notes · Diagram",
      `${schema} · Diagram`,
    ]);
    await expect(diagram.getByRole("article")).toHaveCount(2);
    await expect(strip.locator("[data-dragging]")).toHaveCount(0);
    await dragTabTo(fullTab, focusedTab);
    await expect(diagram.getByRole("article")).toHaveCount(2);
    await expect(tabTitles).toHaveText([
      `${schema} · Diagram`,
      "notes · Diagram",
    ]);

    await fullTab.click();
    await expect(diagram.getByRole("article")).toHaveCount(3);
    await expect
      .poll(() => notesNode.evaluate((node) => node.style.transform))
      .toBe(before);

    await focusedTab.press("Alt+ArrowLeft");
    await page.reload();
    await expect(tabTitles).toHaveText([
      "notes · Diagram",
      `${schema} · Diagram`,
    ]);
    await expect
      .poll(() => notesNode.evaluate((node) => node.style.transform))
      .toBe(before);
  } finally {
    await bridge.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
