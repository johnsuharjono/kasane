import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

test("cancel prevents SQL from being dispatched while a new session opens", async ({
  page,
}) => {
  const bridge = await installDatabaseBridge(page);
  const connectionId = randomUUID(),
    id = randomUUID();
  bridge.connections.push({
    id: connectionId,
    name: "Fixture",
    database: "kasane_dev",
    host: "127.0.0.1",
    port: 55432,
    username: "kasane",
    tls: false,
  });
  bridge.sqlDocuments.set(id, {
    version: 1,
    id,
    connectionId,
    title: "Cancellation test",
    source: "SELECT 27 AS cancel_test;",
  });
  try {
    await page.goto("/");
    await expect(page.getByTitle("Open commerce.orders")).toBeVisible();
    await page
      .getByRole("complementary")
      .getByRole("button", {
        name: "Cancellation test",
        exact: true,
      })
      .click();
    await page.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const gate = new Promise((resolve) => {
        window.releaseDocumentSession = resolve;
      });
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === "open_session") await gate;
        return invoke(command, args);
      };
    });
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => window.releaseDocumentSession());
    await expect(
      page.getByText("Query cancelled", { exact: true }),
    ).toBeVisible();
    expect(
      bridge.events.filter((event) => event.command === "execute_sql"),
    ).toEqual([]);
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(
      page.getByRole("gridcell").getByText("27", { exact: true }),
    ).toBeVisible();
  } finally {
    await bridge.close();
  }
});
