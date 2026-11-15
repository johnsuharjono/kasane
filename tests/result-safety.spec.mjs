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
