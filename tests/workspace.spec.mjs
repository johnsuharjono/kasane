import { test, expect } from "@playwright/test";
import pg from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const connectionString =
  "postgresql://kasane:kasane_dev_only@127.0.0.1:55432/kasane_dev";
const catalogSQL = (await readFile("src-tauri/src/db.rs", "utf8")).match(
  /pub const CATALOG: &str = "([^"]+)";/,
)[1];
// This test adapter exercises React against real PostgreSQL, but replaces Tauri IPC/Keychain/files.
// Native Rust execution is tested separately with cargo test -- --ignored.
test("connect → browse → query → notebook save/reopen, wide grid and editor", async ({
  page,
  browserName,
}) => {
  const sessions = new Map(),
    notebooks = new Map();
  let connections = [];
  let copiedText = "";
  const types = { getTypeParser: () => (v) => v };
  const admin = new pg.Client({ connectionString, types });
  await admin.connect();
  const typeNames = new Map(
    (await admin.query("SELECT oid::text,typname FROM pg_type")).rows.map(
      (r) => [Number(r.oid), r.typname],
    ),
  );
  const queries = [];
  const sqlFiles = new Map();
  const sqlDocuments = new Map();
  let dialogSaves = 0;
  const sqlPath = "/tmp/kasane-workspace-test.sql";
  const relationStructure = await readFile(
    "src-tauri/src/relation_structure.sql",
    "utf8",
  );
  await page.exposeFunction("kasaneTestInvoke", async (command, args = {}) => {
    if (command === "plugin:window|set_theme") return;
    if (command === "list_sql_documents") return [...sqlDocuments.values()];
    if (command === "save_sql_document") {
      sqlDocuments.set(args.document.id, structuredClone(args.document));
      return;
    }
    if (command === "plugin:dialog|save") dialogSaves++;
    if (command === "execute_sql") queries.push(args.sql);
    if (command === "plugin:clipboard-manager|write_text") {
      copiedText = args.text;
      return;
    }
    if (command === "plugin:dialog|save" || command === "plugin:dialog|open")
      return sqlPath;
    if (command === "write_sql_file") {
      sqlFiles.set(args.path, args.source);
      return;
    }
    if (command === "read_sql_file") return sqlFiles.get(args.path);
    if (command === "list_connections") return connections;
    if (command === "list_notebooks") return [...notebooks.values()];
    if (command === "save_connection") {
      connections = connections
        .filter((c) => c.id !== args.connection.id)
        .concat(args.connection);
      return;
    }
    if (command === "save_notebook") {
      notebooks.set(args.notebook.id, structuredClone(args.notebook));
      return;
    }
    if (command === "open_session") {
      const db = new pg.Client({ connectionString, types });
      await db.connect();
      sessions.set(args.sessionId, db);
      return;
    }
    if (command === "close_session") {
      await sessions.get(args.sessionId)?.end();
      sessions.delete(args.sessionId);
      return;
    }
    if (command === "get_relation_structure") {
      const result = await sessions
        .get(args.sessionId)
        .query(relationStructure, [args.schema, args.relation]);
      return JSON.parse(result.rows[0].structure);
    }
    if (command === "get_catalog" || command === "execute_sql") {
      const t = performance.now();
      const r = await sessions.get(args.sessionId).query({
        text: command === "get_catalog" ? catalogSQL : args.sql,
        rowMode: "array",
      });
      let bytes = 0;
      const rows = [];
      for (const row of r.rows) {
        const size = row.reduce(
          (n, v) => n + (v === null ? 0 : Buffer.byteLength(v)),
          0,
        );
        if (rows.length >= 1000 || bytes + size > 8 * 1024 * 1024) break;
        rows.push(row);
        bytes += size;
      }
      return {
        columns: r.fields.map((f) => ({
          name: f.name,
          dataType: typeNames.get(f.dataTypeID),
          oid: f.dataTypeID,
        })),
        rows,
        durationMs: performance.now() - t,
        returnedRows: String(r.rows.length),
        affectedRows: String(r.rowCount ?? 0),
        truncated: rows.length < r.rows.length,
        bytes,
      };
    }
    throw new Error(`Unexpected command ${command}`);
  });
  await page.addInitScript(() => {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: (command, args) => window.kasaneTestInvoke(command, args),
    };
  });
  async function replaceEditor(locator, text) {
    await locator.click();
    await locator.press("Meta+a");
    await page.keyboard.insertText(text);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Add a connection", exact: true })
      .click();
    const saveButton = page.getByRole("button", {
      name: "Save connection",
      exact: true,
    });
    await page.evaluate(() =>
      document.documentElement.style.setProperty(
        "--primary",
        "rgb(22, 72, 92)",
      ),
    );
    await expect(saveButton).toHaveCSS("background-color", "rgb(22, 72, 92)");
    await page.evaluate(() =>
      document.documentElement.style.removeProperty("--primary"),
    );
    await page.getByLabel("Password", { exact: true }).fill("kasane_dev_only");
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch connection" }),
    ).toContainText("Connected");
    const countBeforeOpen = queries.length;
    await page.getByTitle("Open commerce.customers").click();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.locator(".cm-content")).toHaveCount(0);
    await expect.poll(() => queries.length).toBe(countBeforeOpen + 2);
    await page.getByTitle("Open commerce.customers").click();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "customers", exact: true }),
    ).toHaveCount(1);
    await expect.poll(() => queries.length).toBe(countBeforeOpen + 2);
    await expect(
      page.getByRole("combobox", { name: "Document connection" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^id/ }).click();
    await expect(page.getByRole("columnheader").first()).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(page.getByRole("gridcell").first()).toHaveText("1");
    await page.getByRole("button", { name: /^id/ }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1000");
    await expect(
      page.getByRole("combobox", { name: "Filter column" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Filter rows", exact: true })
      .click();
    await page.getByRole("combobox", { name: "Filter column" }).click();
    await page.getByRole("option", { name: "email", exact: true }).click();
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "equals", exact: true }).click();
    await page.getByLabel("Filter value").fill("customer.99@example.test");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("99");
    await expect(page.locator(".result-status")).toContainText("1 returned");
    await page
      .getByLabel("Filter value")
      .fill("x'); DROP TABLE commerce.customers; --");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".empty-result")).toContainText(
      "No rows returned",
    );
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page.getByRole("gridcell").first()).toHaveText("1000");
    await expect(page.locator(".page-range")).toContainText("of 1,000 rows");
    const beforeStructure = queries.length;
    await page.getByTitle("Open commerce.customers").click({ button: "right" });
    await page.getByRole("menuitem", { name: "View Structure" }).click();
    await expect(page.getByRole("region", { name: "Columns" })).toContainText(
      "Nullable",
    );
    await expect(
      page.getByRole("region", { name: "Constraints" }),
    ).toContainText("PRIMARY KEY (id)");
    await expect(page.getByRole("region", { name: "Indexes" })).toContainText(
      "customers_email_lower_idx",
    );
    expect(queries.length).toBe(beforeStructure);
    await page.getByRole("tab", { name: "Data", exact: true }).click();
    await expect(page.getByRole("grid")).toBeVisible();
    expect(queries.length).toBe(beforeStructure);
    await expect(
      page.getByRole("tab", { name: "SQL", exact: true }),
    ).toHaveCount(0);
    await page.getByTitle("Open commerce.customers").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Open SQL", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText(
      '"commerce"."customers"',
    );
    expect(queries.length).toBe(beforeStructure);
    await page.getByRole("button", { name: "Run query", exact: false }).click();
    await expect(page.getByRole("grid")).toBeVisible();
    const splitter = page.getByRole("separator", {
      name: "Resize SQL editor and results",
    });
    const initialHeight = (
      await page.locator(".query-editor-pane").boundingBox()
    ).height;
    const splitBox = await splitter.boundingBox();
    await page.mouse.move(splitBox.x + splitBox.width / 2, splitBox.y + 2);
    await page.mouse.down();
    await page.mouse.move(splitBox.x + splitBox.width / 2, splitBox.y + 62);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await page.locator(".query-editor-pane").boundingBox()).height,
      )
      .toBeGreaterThan(initialHeight + 40);
    await splitter.focus();
    await splitter.press("ArrowUp");
    const sidebarHandle = page.getByRole("separator", {
      name: "Resize sidebar",
    });
    const oldWidth = (await page.getByRole("complementary").boundingBox())
      .width;
    const sb = await sidebarHandle.boundingBox();
    await page.mouse.move(sb.x + 2, sb.y + 100);
    await page.mouse.down();
    await page.mouse.move(sb.x + 42, sb.y + 100);
    await page.mouse.up();
    await expect
      .poll(
        async () => (await page.getByRole("complementary").boundingBox()).width,
      )
      .toBeGreaterThan(oldWidth + 25);
    const editor = page.locator(".cm-content");
    await replaceEditor(editor, "SELECT * FROM commerce.cus");
    await editor.press("Control+Space");
    await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
      "customers",
    );
    await editor.press("Escape");
    await replaceEditor(
      editor,
      "SELECT large_integer, exact_decimal, optional_text, empty_text FROM lab.type_samples WHERE id=1",
    );
    await editor.press("Meta+Enter");
    await expect(
      page.getByRole("gridcell").filter({ hasText: "9223372036854775807" }),
    ).toBeVisible();
    const grid = page.getByRole("grid");
    await grid.focus();
    await grid.press("ArrowRight");
    await grid.press("Enter");
    await expect(page.locator(".cell-inspector pre")).toContainText(
      "123456789012345678901234567890.123456789012345678901234567890",
    );
    await page.getByRole("button", { name: "Close inspector" }).click();
    await grid.focus();
    await grid.press("Meta+c");
    await expect
      .poll(() => copiedText)
      .toBe("123456789012345678901234567890.123456789012345678901234567890");
    await replaceEditor(editor, "SELECT * FROM lab.wide_results LIMIT 5000");
    await editor.press("Meta+Enter");
    await expect(page.locator(".warning")).toContainText("Limited");
    const metrics = await grid.evaluate(async (el) => {
      for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
      let maxCells = 0;
      const frames = [];
      let previous = performance.now();
      const start = previous;
      for (let i = 0; i < 100; i++) {
        el.scrollTop = (i * 149) % (el.scrollHeight - el.clientHeight);
        el.scrollLeft = (i * 211) % (el.scrollWidth - el.clientWidth);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
        maxCells = Math.max(
          maxCells,
          el.querySelectorAll("[role=gridcell]").length,
        );
      }
      frames.sort((a, b) => a - b);
      return {
        elapsedMs: performance.now() - start,
        p95FrameMs: frames[Math.floor(frames.length * 0.95)],
        maxCells,
        totalDomNodes: document.querySelectorAll("*").length,
        viewport: { width: el.clientWidth, height: el.clientHeight },
      };
    });
    expect(metrics.maxCells).toBeLessThan(1000);
    await grid.evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    await grid.focus();
    await grid.press("Control+End");
    await expect(
      page.locator("[role=gridcell][aria-selected=true]"),
    ).toBeVisible();
    const bounds = await grid.boundingBox();
    let resized = false;
    for (const header of await page.locator(".column-header").all()) {
      const box = await header.boundingBox();
      if (
        box &&
        box.x > bounds.x + 48 &&
        box.x + box.width < bounds.x + bounds.width - 80
      ) {
        const handle = await header.getByRole("separator").boundingBox();
        await page.mouse.move(handle.x + 3, handle.y + 10);
        await page.mouse.down();
        await page.mouse.move(handle.x + 43, handle.y + 10);
        await page.mouse.up();
        await expect
          .poll(async () => (await header.boundingBox()).width)
          .toBeCloseTo(box.width + 40, 0);
        resized = true;
        break;
      }
    }
    expect(resized).toBe(true);
    await replaceEditor(
      editor,
      "-- wide schema stress\n".repeat(1000) +
        "SELECT * FROM commerce.orders LIMIT 100;",
    );
    await editor.press("Meta+End");
    await expect(editor).toContainText("SELECT *");
    await page.getByLabel("SQL document title").fill("Customer analysis");
    await page.keyboard.press("Meta+s");
    await expect
      .poll(() => [...sqlDocuments.values()][0]?.source)
      .toContain("-- wide schema stress");
    expect(dialogSaves).toBe(0);
    const storedDocument = [...sqlDocuments.values()][0];
    expect(Object.keys(storedDocument).sort()).toEqual([
      "connectionId",
      "id",
      "source",
      "title",
      "version",
    ]);
    expect(JSON.stringify(storedDocument)).not.toContain("kasane_dev_only");
    await page.getByRole("button", { name: "Export SQL", exact: true }).click();
    await expect
      .poll(() => sqlFiles.get(sqlPath))
      .toContain("-- wide schema stress");
    await page
      .getByRole("button", { name: "Close Customer analysis", exact: true })
      .click();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "Customer analysis", exact: true }),
    ).toHaveCount(0);
    const queriesBeforeFile = queries.length;
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Customer analysis", exact: true })
      .click();
    await expect(page.getByLabel("SQL document title")).toHaveValue(
      "Customer analysis",
    );
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Customer analysis", exact: true })
      .click();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "Customer analysis", exact: true }),
    ).toHaveCount(1);
    expect(queries.length).toBe(queriesBeforeFile);
    await page.keyboard.press("Meta+,");
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator(".cm-editor")).toHaveCSS(
      "background-color",
      "rgb(27, 30, 40)",
    );
    await page.getByRole("radio", { name: "System", exact: true }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await page.keyboard.press("Escape");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "customers", exact: true })
      .click();
    await expect(page.getByRole("grid")).toHaveCSS(
      "background-color",
      "rgb(27, 30, 40)",
    );
    await mkdir("test-results", { recursive: true });
    await page.screenshot({
      path: `test-results/${browserName}-dark-grid.png`,
    });
    // A restored active table tab loads a fresh page on reload.
    await page
      .getByRole("button", { name: "Close customers", exact: true })
      .click();
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Customer analysis", exact: true })
      .click();
    await expect(page.getByLabel("SQL document title")).toHaveValue(
      "Customer analysis",
    );
    await expect(page.getByRole("grid")).toHaveCount(0);
    expect(queries.length).toBe(queriesBeforeFile);
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("kasane-menu", { detail: "settings" }),
      ),
    );
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Light", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "New document", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /^Notebook/ }).click();
    await page.getByLabel("Notebook title").fill("Revenue exploration");
    const sql = page.locator(".notebook-cell .cm-content");
    await replaceEditor(sql, "CREATE TEMP TABLE notebook_probe (message text)");
    await page.getByRole("button", { name: "Run cell", exact: true }).click();
    await expect(
      page.getByText("Statement completed", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "SQL cell", exact: true }).click();
    await replaceEditor(
      page.locator(".notebook-cell .cm-content").last(),
      "INSERT INTO notebook_probe VALUES ('persistent session') RETURNING message",
    );
    await page
      .getByRole("button", { name: "Run cell", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("gridcell").filter({ hasText: "persistent session" }),
    ).toBeVisible();
    await replaceEditor(
      page.locator(".notebook-cell .cm-content").first(),
      "SELECT 1",
    );
    await expect(
      page.getByText("Outdated results", { exact: false }),
    ).toHaveCount(1);
    await replaceEditor(
      page.locator(".notebook-cell .cm-content").first(),
      "SELECT does_not_exist",
    );
    const beforeFailure = queries.length;
    await page.getByRole("button", { name: "Run all", exact: true }).click();
    await expect(page.locator(".query-error")).toContainText("does_not_exist");
    expect(queries.slice(beforeFailure)).toEqual(["SELECT does_not_exist"]);
    await replaceEditor(
      page.locator(".notebook-cell .cm-content").first(),
      "SELECT 1",
    );
    const beforeRun = queries.length;
    await page.getByRole("button", { name: "Run all", exact: true }).click();
    await expect(page.locator(".cell-complete")).toHaveCount(2);
    expect(queries.slice(beforeRun)).toEqual([
      "SELECT 1",
      "INSERT INTO notebook_probe VALUES ('persistent session') RETURNING message",
    ]);
    await page
      .getByRole("button", { name: "Save", exact: false })
      .filter({ hasText: "Save" })
      .click();
    await expect(page.locator(".notebook-heading p")).toContainText(
      "Saved locally",
    );
    const saved = [...notebooks.values()][0];
    expect(saved.cells).toHaveLength(3);
    expect(JSON.stringify(saved)).not.toContain("executions");
    expect(JSON.stringify(saved)).not.toContain("kasane_dev_only");
    await page
      .getByRole("button", { name: "Close Revenue exploration", exact: true })
      .click();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "Revenue exploration", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Revenue exploration", exact: true })
      .click();
    await expect(page.getByLabel("Notebook title")).toHaveValue(
      "Revenue exploration",
    );
    await expect(page.locator(".notebook-cell .cm-content")).toHaveCount(2);
    await expect(page.getByRole("grid")).toHaveCount(0);
    await page.getByRole("button", { name: "Move cell 3 up" }).click();
    await page.getByRole("button", { name: "Delete cell 3" }).click();
    await expect(page.locator(".notebook-cell")).toHaveCount(2);
    await mkdir("test-results", { recursive: true });
    await writeFile(
      `test-results/${browserName}-metrics.json`,
      JSON.stringify(metrics, null, 2),
    );
    await page.screenshot({ path: `test-results/${browserName}-notebook.png` });
    await page.setViewportSize({ width: 960, height: 700 });
    await expect(
      page.getByRole("button", { name: "Run all", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    console.log(browserName, JSON.stringify(metrics));
    expect(errors).toEqual([]);
  } finally {
    for (const db of sessions.values()) await db.end();
    await admin.end();
  }
});
