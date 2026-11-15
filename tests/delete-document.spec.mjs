import { test, expect } from "@playwright/test";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

const connectionId = "11111111-1111-4111-8111-111111111111";
const documentId = "33333333-3333-4333-8333-333333333333";

test("delete a saved SQL document from the sidebar, closing its tab", async ({
  page,
}) => {
  const bridge = await installDatabaseBridge(page);
  bridge.connections.push({
    id: connectionId,
    name: "Local playground",
    host: "127.0.0.1",
    port: 55432,
    database: "kasane_dev",
    username: "kasane",
    tls: false,
  });
  bridge.sqlDocuments.set(documentId, {
    version: 1,
    id: documentId,
    title: "Scratch query",
    connectionId,
    source: "SELECT 1;",
  });
  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  const entry = sidebar.getByRole("button", {
    name: "Scratch query",
    exact: true,
  });
  await entry.click();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Scratch query", exact: true }),
  ).toBeVisible();

  // Cancelling keeps the document.
  await entry.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expect(page.getByRole("dialog")).toContainText("closes its tab");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(bridge.sqlDocuments.has(documentId)).toBe(true);

  await entry.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => bridge.sqlDocuments.has(documentId)).toBe(false);
  await expect(entry).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Scratch query", exact: true }),
  ).toHaveCount(0);
  await bridge.close();
});
