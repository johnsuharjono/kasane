import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

test("table pages, filtered counts, preferences and content-sized notebook results", async ({
  page,
  browserName,
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const queries = () =>
    bridge.events.filter((e) => e.command === "execute_sql");
  async function option(label, value) {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: value, exact: true }).click();
  }
  try {
    await page.goto("/");
    await page.getByTitle("Open commerce.customers").click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1");
    await expect(page.locator(".page-range")).toHaveText("1–500");
    expect(queries().some((e) => /count\(\*\)/i.test(e.sql))).toBe(false);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("501");
    await expect(page.locator(".page-range")).toHaveText("501–1,000");
    await expect(
      page.getByRole("button", { name: "Next page", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Count rows", exact: true }).click();
    await expect(page.locator(".page-range")).toHaveText(
      "501–1,000 of 1,000 rows",
    );
    await expect(page.locator(".page-number")).toHaveText("Page 2 of 2");
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1");
    await expect(
      page.getByRole("combobox", { name: "Rows per page", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("501");
    await page.getByRole("button", { name: /^id/ }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1");
    await expect(page.locator(".page-number")).toHaveText("Page 1 of 2");
    await page.getByRole("button", { name: /^id/ }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1000");
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("500");
    await page
      .getByRole("button", { name: "Filter rows", exact: true })
      .click();
    await option("Filter column", "email");
    await option("Filter operator", "equals");
    await page.getByLabel("Filter value").fill("customer.99@example.test");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("99");
    await expect(
      page.getByRole("button", { name: "Count rows", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Count rows", exact: true }).click();
    await expect(page.locator(".page-range")).toHaveText("1–1 of 1 rows");

    const action = await page
      .getByRole("button", { name: "Import SQL", exact: true })
      .boundingBox();
    const bar = await page
      .getByRole("navigation", { name: "Open documents", exact: true })
      .boundingBox();
    expect(
      Math.abs(action.y + action.height / 2 - (bar.y + bar.height / 2)),
    ).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await option("Editor font size", "16 px");
    await page.getByRole("checkbox", { name: /Wrap long lines/ }).click();
    await page
      .getByRole("checkbox", { name: /Load table data on open/ })
      .click();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await page.keyboard.press("Escape");
    const before = queries().length;
    await page.getByTitle("Open commerce.orders").click();
    await expect(page.getByText("Table ready.", { exact: true })).toBeVisible();
    expect(queries()).toHaveLength(before);
    await page
      .getByRole("button", { name: "Refresh table data", exact: true })
      .click();
    await expect(page.locator(".page-range")).toHaveText("1–500");
    await expect(page.getByRole("grid")).toHaveCSS(
      "background-color",
      "rgb(27, 30, 40)",
    );
    await mkdir("artifacts/refinements", { recursive: true });
    if (browserName === "webkit")
      await page.screenshot({
        path: "artifacts/refinements/dark-table.png",
        animations: "disabled",
      });
    await page
      .getByRole("button", { name: "New notebook", exact: true })
      .click();
    await page.getByRole("button", { name: "Run cell", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("kasane_dev");
    await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "16px");
    await expect(page.locator(".cm-lineWrapping")).toBeVisible();
    const small = await page
      .locator(".notebook-cell .grid-and-inspector")
      .boundingBox();
    expect(small.height).toBeLessThan(150);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("radio", { name: "Light", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    if (browserName === "webkit")
      await page.screenshot({
        path: "artifacts/refinements/settings.png",
        animations: "disabled",
      });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("grid")).toHaveCSS(
      "background-color",
      "rgb(251, 252, 254)",
    );
    if (browserName === "webkit")
      await page.screenshot({
        path: "artifacts/refinements/light-notebook.png",
        animations: "disabled",
      });
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Editor font size", exact: true }),
    ).toContainText("16 px");
    await expect(
      page.getByRole("checkbox", { name: /Wrap long lines/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /Load table data on open/ }),
    ).not.toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});
