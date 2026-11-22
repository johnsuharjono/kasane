import { test, expect } from "@playwright/test";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";
const connectionId = "11111111-1111-4111-8111-111111111111";
const documentId = "33333333-3333-4333-8333-333333333333";
async function setup(page, source) {
  const bridge = await installDatabaseBridge(page);
  bridge.connections.push({
    id: connectionId,
    name: "Review",
    host: "127.0.0.1",
    port: 55432,
    database: "kasane_dev",
    username: "kasane",
    tls: false,
  });
  bridge.sqlDocuments.set(documentId, {
    version: 1,
    id: documentId,
    title: "Review query",
    connectionId,
    source,
  });
  await page.goto("/");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Review query", exact: true })
    .click();
  return bridge;
}
test("JSON previews and inspection preserve large integers and decimals", async ({
  page,
}) => {
  const bridge = await setup(
    page,
    `SELECT '{"n":9223372036854775807,"decimal":12345678901234567890.12345678901234567890}'::jsonb AS payload;`,
  );
  try {
    await page.locator(".cm-content").press("Meta+Enter");
    await expect(page.getByRole("gridcell").first()).toContainText(
      "9223372036854775807",
    );
    await page.getByRole("button", { name: "Inspect selected row" }).click();
    await expect(page.locator(".inspector-selected pre")).toContainText(
      "9223372036854775807",
    );
    await expect(page.locator(".inspector-selected pre")).toContainText(
      "12345678901234567890.12345678901234567890",
    );
  } finally {
    await bridge.close();
  }
});
test("failed document deletion preserves the open draft", async ({ page }) => {
  const bridge = await setup(page, "SELECT 1;");
  try {
    await page.locator(".cm-content").click();
    await page.locator(".cm-content").press("Meta+a");
    await page.keyboard.insertText("SELECT 'unsaved work';");
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args) =>
        command === "delete_sql_document"
          ? Promise.reject({ message: "Permission denied" })
          : original(command, args);
    });
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Review query", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      page.getByText("Permission denied", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "Review query", exact: true }),
    ).toHaveCount(1);
    const persisted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kasane.workspaces")),
    );
    expect(
      persisted.state.tabs.find((t) => t.id === documentId).cells[0].source,
    ).toBe("SELECT 'unsaved work';");
    await expect(page.locator(".cm-content")).toContainText("unsaved work");
    expect(bridge.sqlDocuments.get(documentId).source).toBe("SELECT 1;");
  } finally {
    await bridge.close();
  }
});

test("CSV export writes the displayed rows with PostgreSQL CSV escaping", async ({
  page,
}) => {
  const bridge = await setup(
    page,
    `SELECT i AS "row,id", '重ね,"quoted"' || chr(10) || 'next line' AS payload,
            NULL::text AS missing, ''::text AS empty
     FROM generate_series(1, 1002) AS i;`,
  );
  try {
    await page.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === "plugin:dialog|save") {
          window.csvDialog = args.options;
          return "/tmp/results.csv";
        }
        if (command === "write_csv_file") {
          window.csvExport = args;
          return;
        }
        return invoke(command, args);
      };
    });
    await page.locator(".cm-content").press("Meta+Enter");
    await expect(page.locator(".result-status")).toContainText(
      "1,000 of 1,002 returned",
    );
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.csvExport?.path))
      .toBe("/tmp/results.csv");
    const { title, source } = await page.evaluate(() => ({
      title: window.csvDialog.title,
      source: window.csvExport.source,
    }));
    expect(title).toBe("Export 1,000 displayed rows (limited result)");
    expect(
      source.startsWith(
        '"row,id",payload,missing,empty\r\n1,"重ね,""quoted""\nnext line",,""\r\n',
      ),
    ).toBe(true);
    expect(source.split("\r\n")).toHaveLength(1002);
    expect(source).toContain('\r\n1000,"重ね,');
    expect(source).not.toContain("\r\n1001,");
  } finally {
    await bridge.close();
  }
});
