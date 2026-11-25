import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

test("restored table tabs load one fresh page when opened", async ({
  page,
}) => {
  let resumeCatalog;
  const bridge = await installDatabaseBridge(page, {
    afterCatalog: async () => {
      if (resumeCatalog) await resumeCatalog.promise;
    },
  });
  bridge.connections.push({
    id: randomUUID(),
    name: "Development",
    database: "kasane_dev",
    host: "127.0.0.1",
    port: 55432,
    username: "kasane",
    tls: false,
  });
  const queries = () =>
    bridge.events.filter((event) => event.command === "execute_sql");
  const grid = page.getByRole("grid");
  const tabs = page.getByRole("navigation", { name: "Open documents" });
  try {
    await page.goto("/");
    await page.getByTitle("Open commerce.customers").click();
    await expect(page.locator(".page-range")).toHaveText("1–50 of 1,000 rows");
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(grid.getByRole("gridcell").first()).toHaveText("51");
    await page.getByTitle("Open commerce.orders").click();
    await expect(page.locator(".page-range")).toHaveText("1–50 of 8,000 rows");

    const before = queries().length;
    resumeCatalog = Promise.withResolvers();
    await page.reload();
    await expect(page.getByText("Loading rows…")).toBeVisible();
    await expect(page.locator(".page-range")).toBeEmpty();
    expect(queries()).toHaveLength(before);
    resumeCatalog.resolve();
    await expect(grid).toBeVisible();
    expect(
      queries()
        .slice(before)
        .map((event) => event.sql),
    ).toEqual([expect.stringContaining('FROM "commerce"."orders"')]);

    await tabs.getByRole("button", { name: "customers", exact: true }).click();
    await expect(grid.getByRole("gridcell").first()).toHaveText("51");
    expect(
      queries()
        .slice(before + 1)
        .map((event) => event.sql),
    ).toEqual([expect.stringContaining('FROM "commerce"."customers"')]);
    await tabs.getByRole("button", { name: "orders", exact: true }).click();
    await expect(grid).toBeVisible();
    expect(queries()).toHaveLength(before + 2);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("checkbox", { name: /Load table data on open/ })
      .click();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByText("Table ready.", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Switch connection" }),
    ).toContainText("Connected");
    await expect(page.locator(".page-range")).toBeEmpty();
    expect(queries()).toHaveLength(before + 2);
  } finally {
    resumeCatalog?.resolve();
    await bridge.close();
  }
});

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
    const paging = page
      .locator(".table-toolbar")
      .getByRole("group", { name: "Table pagination" });
    const pageNumber = paging.getByRole("textbox", { name: "Page number" });
    await expect(
      paging
        .getByRole("combobox", { name: "Rows per page" })
        .locator('[data-slot="select-value"]'),
    ).toHaveText("50");
    await expect(paging.locator(".page-total")).toHaveText("1,000");
    await expect(page.locator(".page-range")).toHaveText("1–50 of 1,000 rows");
    await option("Rows per page", "500");
    await expect(page.locator(".page-range")).toHaveText("1–500 of 1,000 rows");
    expect(queries().some((e) => /count\(\*\)/i.test(e.sql))).toBe(true);
    await expect(
      page.getByRole("button", { name: /^(Recount|Count rows)$/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("501");
    await expect(page.locator(".page-range")).toHaveText(
      "501–1,000 of 1,000 rows",
    );
    await expect(
      page.getByRole("button", { name: "Next page", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".page-range")).toHaveText(
      "501–1,000 of 1,000 rows",
    );
    await expect(pageNumber).toHaveValue("2");
    await expect(paging.locator(".page-count")).toHaveText("of 2");
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1");
    await option("Rows per page", "25");
    await expect(paging.locator(".page-range")).toHaveText(
      "1–25 of 1,000 rows",
    );
    await pageNumber.fill("3");
    await pageNumber.press("Enter");
    await expect(page.getByRole("gridcell").first()).toHaveText("51");
    await expect(pageNumber).toHaveValue("3");
    await expect(paging.locator(".page-count")).toHaveText("of 40");
    await option("Rows per page", "500");
    await expect(paging.locator(".page-range")).toHaveText(
      "1–500 of 1,000 rows",
    );
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("501");
    await page.getByRole("button", { name: /^id/ }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1");
    await expect(pageNumber).toHaveValue("1");
    await expect(paging.locator(".page-count")).toHaveText("of 2");
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
    await expect(page.locator(".page-range")).toHaveText("1–1 of 1 rows");

    await page
      .getByRole("button", { name: "Clear filter", exact: true })
      .click();
    await expect(page.locator(".page-range")).toHaveText("1–500 of 1,000 rows");
    const countsBefore = queries().filter((e) =>
      /count\(\*\)/i.test(e.sql),
    ).length;
    await page
      .getByRole("button", { name: "Refresh table data", exact: true })
      .click();
    await expect
      .poll(() => queries().filter((e) => /count\(\*\)/i.test(e.sql)).length)
      .toBe(countsBefore + 1);
    await expect(page.locator(".page-range")).toHaveText("1–500 of 1,000 rows");

    const action = await page
      .getByRole("button", { name: "New document", exact: true })
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
    await expect(page.locator(".page-range")).toHaveText("1–50 of 8,000 rows");
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
    await page.locator(".notebook-cell .cm-content").click();
    await page.keyboard.type("SELECT current_database();");
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

test("paging proceeds while the same filtered count is pending", async ({
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
      const gate = new Promise((resolve) => {
        window.releaseTableCount = resolve;
      });
      const rowsGate = new Promise((resolve) => {
        window.releaseTableRows = resolve;
      });
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const result = await invoke(command, args);
        if (command === "execute_sql" && args.sql.startsWith("SELECT count(*)"))
          await gate;
        if (command === "execute_sql" && args.sql.startsWith("SELECT *"))
          await rowsGate;
        return result;
      };
    });
    await page.getByTitle("Open commerce.customers").click();
    const refresh = page.locator(".table-toolbar").getByRole("button", {
      name: "Refresh table data",
      exact: true,
    });
    await expect(refresh).toBeVisible();
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    await expect(refresh).toBeDisabled();
    await expect(refresh.locator("svg")).toHaveClass(/animate-spin/);
    await page.evaluate(() => window.releaseTableRows());
    await expect(refresh).toHaveAttribute("aria-busy", "false");
    await expect(refresh).toBeEnabled();
    const cancelCount = page.getByRole("button", {
      name: "Cancel count",
      exact: true,
    });
    await expect(cancelCount).toBeVisible();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("51");
    await cancelCount.click();
    await page.evaluate(() => window.releaseTableCount());
    await expect(page.locator(".page-range")).toHaveText("51–100");
    const queries = bridge.events.filter(
      (event) => event.command === "execute_sql",
    );
    const counts = queries.filter((event) =>
      event.sql.startsWith("SELECT count(*)"),
    );
    expect(counts).toHaveLength(1);
    expect(counts[0].sessionId).not.toBe(queries[0].sessionId);
    await expect
      .poll(() => bridge.sessions.has(counts[0].sessionId))
      .toBe(false);
  } finally {
    await bridge.close();
  }
});

test("table row selection copies only selected rows and works with query popovers", async ({
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
  const pick = async (label, option, index = 0) => {
    await page
      .getByRole("combobox", { name: label, exact: true })
      .nth(index)
      .click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  try {
    await page.goto("/");
    await page.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === "plugin:clipboard-manager|write_text") {
          window.copiedRows = args.text;
          return Promise.resolve();
        }
        return invoke(command, args);
      };
    });
    await page.getByTitle("Open commerce.customers").click();
    const all = page.getByRole("checkbox", {
      name: "Select all rows on this page",
    });
    const copy = page.getByRole("button", { name: "Copy selected rows" });
    await page
      .getByRole("checkbox", { name: "Select row 3", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Select row 1", exact: true })
      .click();
    await expect(all).toHaveAttribute("aria-checked", "mixed");
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

    await copy.click();
    await page.getByRole("menuitem", { name: "Copy as JSON" }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(window.copiedRows ?? "[]").map(({ id }) => id),
        ),
      )
      .toEqual(["1", "3"]);
    await copy.click();
    await page.getByRole("menuitem", { name: "Copy as CSV" }).click();
    await expect
      .poll(() => page.evaluate(() => window.copiedRows))
      .toMatch(
        /^id,email,.*\r\n1,customer\.1@example\.test,.*\r\n3,customer\.3@example\.test,/,
      );

    await all.click();
    await expect(page.getByText("50 selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(all).toHaveAttribute("aria-checked", "false");
    await expect(copy).toHaveCount(0);

    const filter = page.getByRole("button", {
      name: "Filter rows",
      exact: true,
    });
    await filter.click();
    await pick("Filter column", "email");
    await page.getByLabel("Filter value").fill("customer.");
    await page.getByRole("button", { name: "Add filter" }).click();
    await pick("Filter column", "id", 1);
    await pick("Filter operator", "equals", 1);
    await page.getByLabel("Filter value").nth(1).fill("99");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".page-range")).toHaveText("1–1 of 1 rows");
    await expect(page.getByRole("gridcell").first()).toHaveText("99");

    await filter.click();
    await page.getByLabel("Filter value").nth(1).fill("42");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await filter.click();
    await expect(page.getByLabel("Filter value").nth(1)).toHaveValue("99");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Clear filter" }).click();

    await page.getByRole("button", { name: "Sort rows", exact: true }).click();
    await pick("Sort column", "id");
    await pick("Sort direction", "Descending");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1000");
  } finally {
    await bridge.close();
  }
});
