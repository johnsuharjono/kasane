import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

test("staged table edits survive paging and only Apply sends changes", async ({
  page,
}) => {
  const bridge = await installDatabaseBridge(page);
  bridge.connections.push({
    id: randomUUID(),
    name: "Development",
    database: "kasane_dev",
    host: "127.0.0.1",
    port: 55432,
    username: "kasane",
    tls: false,
  });
  try {
    await page.goto("/");
    await page.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.tableWrites = [];
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === "apply_table_updates") {
          window.tableWrites.push(args);
          if (window.tableWrites.length === 1)
            return Promise.reject({
              message: "The row changed in PostgreSQL.",
            });
          return Promise.resolve();
        }
        return invoke(command, args);
      };
    });
    await page.getByTitle("Open commerce.customers").click();
    await expect(
      page.getByRole("button", { name: "Edit table", exact: true }),
    ).toHaveCount(0);
    const firstEmail = page.getByRole("gridcell", {
      name: "customer.1@example.test",
      exact: true,
    });
    await expect(firstEmail).toHaveAttribute("aria-readonly", "false");
    await expect(page.getByRole("gridcell").first()).toHaveAttribute(
      "aria-readonly",
      "true",
    );

    await page.getByRole("gridcell").first().dblclick();
    await page.getByRole("grid").press("Enter");
    const inspector = page.getByRole("complementary", {
      name: "Row inspector",
    });
    await expect(inspector).toHaveCount(0);
    await page.getByRole("button", { name: "Inspect selected row" }).click();
    await expect(inspector).toBeVisible();
    await inspector.getByRole("button", { name: "Close inspector" }).click();

    await page.getByRole("button", { name: "Choose columns" }).click();
    await page
      .getByRole("menuitemcheckbox", { name: "id", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("gridcell").first()).toHaveText(
      "customer.1@example.test",
    );
    await firstEmail.dblclick();
    const editor = page.getByRole("textbox", { name: "Cell value" });
    await editor.fill("cancelled@example.test");
    await editor.press("Escape");
    await expect(firstEmail).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Changes (1)", exact: true }),
    ).toHaveCount(0);
    await firstEmail.dblclick();
    const stage = async (value) => {
      await editor.fill(value);
      await editor.press("Enter");
    };
    await stage("new@example.test");
    const pane = page.getByRole("complementary", { name: "Table changes" });
    await expect(pane).toHaveCount(0);
    await expect(
      page.getByRole("gridcell", { name: "new@example.test", exact: true }),
    ).toHaveAttribute("data-staged", "true");
    await page
      .getByRole("button", { name: "Changes (1)", exact: true })
      .click();
    await expect(pane.getByText("id = 1", { exact: true })).toBeVisible();
    await expect(pane.getByText("new@example.test")).toBeVisible();
    await expect(
      page.getByRole("gridcell", { name: "new@example.test", exact: true }),
    ).toHaveAttribute("data-staged", "true");
    await pane.getByRole("tab", { name: "SQL", exact: true }).click();
    const sql = pane.getByLabel("SQL preview");
    await expect(sql).toContainText('UPDATE "commerce"."customers"');
    await expect(sql).toContainText('WHERE "id" = $2');
    await expect(sql).toContainText("new@example.test");
    expect(await page.evaluate(() => window.tableWrites)).toHaveLength(0);

    const nextPage = page.getByRole("button", { name: "Next page" });
    await nextPage.click();
    await expect(page.getByRole("gridcell").first()).toHaveText(
      "customer.51@example.test",
    );
    await expect(pane).toBeVisible();
    const email = page.getByRole("gridcell", {
      name: "customer.51@example.test",
      exact: true,
    });
    await email.click();
    await page.getByRole("grid").press("Enter");
    await stage("page-two@example.test");
    await expect(
      page.getByRole("button", { name: "Changes (2)", exact: true }),
    ).toBeVisible();
    await pane.getByRole("tab", { name: "Diff", exact: true }).click();
    await pane
      .getByRole("button", { name: "Undo change to email" })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "Changes (1)", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText(
      "new@example.test",
    );

    const apply = pane.getByRole("button", { name: "Apply changes" });
    await apply.click();
    await expect(pane.getByRole("alert")).toContainText("The row changed");
    await expect(pane.getByText("new@example.test")).toBeVisible();
    await apply.click();
    await expect(
      page.getByText("Changes applied to 1 row.", { exact: true }),
    ).toBeVisible();
    await expect(pane).toHaveCount(0);
    const requests = await page.evaluate(() => window.tableWrites);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0].rows).toMatchObject([
      {
        key: ["1"],
        cells: [{ column: "email", value: "new@example.test" }],
      },
    ]);
    expect(requests[0].rows[0].cells[0]).not.toHaveProperty("before");
    await expect(firstEmail).toBeVisible();
    await firstEmail.click();
    const grid = page.getByRole("grid");
    await grid.press("End");
    const jsonColumn = page
      .getByRole("columnheader")
      .filter({ hasText: /metadata/ });
    await expect
      .poll(async () => (await jsonColumn.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(300);
    expect((await jsonColumn.boundingBox()).width).toBeLessThanOrEqual(540);
    await grid.press("Enter");
    const json = page.getByRole("dialog", { name: "Edit metadata" });
    const jsonInput = json.getByRole("textbox", { name: "Cell value" });
    await expect(jsonInput).toHaveAttribute("rows", "8");
    await expect(json).not.toHaveAttribute("aria-modal", "true");
    await jsonInput.fill('{"exact": 9223372036854775807}');
    await json.getByRole("button", { name: "Stage change" }).click();
    await page
      .getByRole("button", { name: "Changes (1)", exact: true })
      .click();
    await expect(
      pane.getByText('{"exact": 9223372036854775807}', { exact: true }),
    ).toBeVisible();
    await pane.getByRole("button", { name: "Discard all" }).click();

    await firstEmail.dblclick();
    await editor.fill("discarded@example.test");
    await page.getByRole("button", { name: "Open full cell editor" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit email" });
    await expect(
      dialog.getByRole("textbox", { name: "Cell value" }),
    ).toHaveValue("discarded@example.test");
    await dialog.getByRole("button", { name: "Stage change" }).click();
    await expect(
      page.getByRole("button", { name: "Changes (1)", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Meta+w");
    const warning = page.getByRole("dialog", { name: "Discard table edits?" });
    await expect(warning).toBeVisible();
    await warning.getByRole("button", { name: "Discard and close" }).click();
    await expect(page.getByRole("grid")).toHaveCount(0);
    expect(await page.evaluate(() => window.tableWrites)).toHaveLength(2);
  } finally {
    await bridge.close();
  }
});
