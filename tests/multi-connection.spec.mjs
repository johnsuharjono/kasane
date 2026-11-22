import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";
test("switch database browsers without retargeting saved SQL or notebooks", async ({
  page,
  browserName,
}) => {
  test.skip(
    !process.env.KASANE_MULTI_TEST,
    "Requires make db-multi-up db-seed-analytics",
  );
  const bridge = await installDatabaseBridge(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const executions = () =>
    bridge.events.filter((e) => e.command === "execute_sql");
  async function edit(locator, source) {
    await locator.click();
    await locator.press("Meta+a");
    await page.keyboard.insertText(source);
  }
  async function capture(name) {
    if (browserName !== "webkit") return;
    await mkdir("artifacts/multiple-connections", { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `artifacts/multiple-connections/${name}.png`,
      animations: "disabled",
      caret: "hide",
    });
  }
  async function newDocument(kind) {
    await page
      .getByRole("button", { name: "New document", exact: true })
      .click();
    await page
      .getByRole("menuitem", {
        name: kind === "notebook" ? /^Notebook/ : /^SQL document/,
      })
      .click();
  }
  async function selectAndConnect(name) {
    await page.getByRole("button", { name: "Switch connection" }).click();
    await page
      .getByRole("menuitem", { name: `Switch to ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch connection" }),
    ).toContainText(`${name}`);
    await expect(
      page.getByRole("button", { name: "Switch connection" }),
    ).toContainText("Connected");
  }
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Add a connection", exact: true })
      .click();
    await page.getByLabel("Password", { exact: true }).fill("kasane_dev_only");
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch connection" }),
    ).toContainText("Connected");
    await page.getByRole("button", { name: "Switch connection" }).click();
    await page
      .getByRole("menuitem", { name: "New connection…", exact: true })
      .click();
    await page
      .getByLabel("Connection name", { exact: true })
      .fill("Analytics sandbox");
    await page.getByLabel("Port", { exact: true }).fill("55433");
    await page.getByLabel("Database", { exact: true }).fill("kasane_analytics");
    await page.getByLabel("Password", { exact: true }).fill("kasane_dev_only");
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    const commerce = bridge.connections.find(
        (c) => c.database === "kasane_dev",
      ),
      analytics = bridge.connections.find(
        (c) => c.database === "kasane_analytics",
      );
    expect(commerce.id).not.toBe(analytics.id);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await page.keyboard.press("Escape");
    await selectAndConnect("Local playground", "kasane_dev");
    const browserA = bridge.events.findLast(
      (e) => e.command === "open_session" && e.connectionId === commerce.id,
    ).sessionId;
    await page.getByTitle("Open commerce.orders").click();
    await expect(page.getByRole("grid")).toBeVisible();
    await newDocument("sql");
    await page.getByLabel("SQL document title").fill("Commerce summary");
    const sourceA =
      "SELECT current_database() AS database, count(*) AS customers FROM commerce.customers;";
    await edit(page.locator(".cm-content"), sourceA);
    await page.locator(".cm-content").press("Meta+Enter");
    await expect(
      page.getByRole("gridcell").filter({ hasText: "kasane_dev" }),
    ).toBeVisible();
    await page.keyboard.press("Meta+s");
    await expect
      .poll(() =>
        [...bridge.sqlDocuments.values()].some(
          (d) => d.title === "Commerce summary",
        ),
      )
      .toBe(true);
    await newDocument("notebook");
    await page.getByLabel("Notebook title").fill("Commerce notes");
    await page.locator(".notebook-cell .cm-content").click();
    await page.keyboard.type("SELECT current_database();");
    await page.getByRole("button", { name: "Run cell", exact: true }).click();
    await expect(
      page.getByRole("gridcell").filter({ hasText: "kasane_dev" }),
    ).toBeVisible();
    await page.keyboard.press("Meta+s");
    await expect.poll(() => bridge.notebooks.size).toBe(1);
    const aSessions = [...bridge.sessions.entries()]
      .filter(([, s]) => s.connectionId === commerce.id)
      .map(([id]) => id);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "orders", exact: true })
      .click();
    await page.getByRole("button", { name: "Dismiss notice" }).click();
    await capture("01-commerce-connection");
    await selectAndConnect("Analytics sandbox", "kasane_analytics");
    expect(bridge.sessions.has(browserA)).toBe(false);
    for (const id of aSessions.filter((id) => id !== browserA))
      expect(bridge.sessions.has(id)).toBe(true);
    await expect(page.getByTitle("Open commerce.orders")).toHaveCount(0);
    await page.getByTitle("Open workspace.deployments").click();
    await expect(page.getByRole("grid")).toBeVisible();
    await newDocument("sql");
    await page.getByLabel("SQL document title").fill("Analytics summary");
    const sourceB =
      "SELECT current_database() AS database, count(*) AS deployments FROM workspace.deployments;";
    await edit(page.locator(".cm-content"), sourceB);
    await page.locator(".cm-content").press("Meta+Enter");
    await expect(
      page.getByRole("gridcell").filter({ hasText: "kasane_analytics" }),
    ).toBeVisible();
    await page.keyboard.press("Meta+s");
    await expect.poll(() => bridge.sqlDocuments.size).toBe(2);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "deployments", exact: true })
      .click();
    await page.getByRole("button", { name: "Dismiss notice" }).click();
    await capture("02-analytics-connection");
    await expect(
      page.getByRole("button", { name: "Close orders", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("complementary")
        .getByRole("button", { name: "Commerce summary", exact: true }),
    ).toHaveCount(0);
    const beforeSwitch = executions().length;
    await selectAndConnect("Local playground");
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "orders", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("grid")).toBeVisible();
    expect(executions().length).toBe(beforeSwitch);
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Commerce summary", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Document connection" }),
    ).toHaveCount(0);
    await page.locator(".cm-content").press("Meta+Enter");
    await expect(
      page.getByRole("gridcell").filter({ hasText: "kasane_dev" }),
    ).toBeVisible();
    expect(executions().at(-1).connectionId).toBe(commerce.id);
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Commerce notes", exact: true })
      .click();
    await page.getByRole("button", { name: "Run cell", exact: true }).click();
    await expect(
      page.getByRole("gridcell").filter({ hasText: "kasane_dev" }),
    ).toBeVisible();
    expect(executions().at(-1).connectionId).toBe(commerce.id);
    await selectAndConnect("Local playground", "kasane_dev");
    await expect(page.getByTitle("Open commerce.orders")).toBeVisible();
    expect(
      [...bridge.sqlDocuments.values()].find(
        (d) => d.title === "Commerce summary",
      ).connectionId,
    ).toBe(commerce.id);
    expect(
      [...bridge.sqlDocuments.values()].find(
        (d) => d.title === "Analytics summary",
      ).connectionId,
    ).toBe(analytics.id);
    expect([...bridge.notebooks.values()][0].connectionId).toBe(commerce.id);
    await page
      .getByRole("button", { name: "Close Commerce summary", exact: true })
      .click();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "Commerce summary", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close Commerce notes", exact: true })
      .click();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "Commerce notes", exact: true }),
    ).toHaveCount(0);
    const before = executions().length;
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Commerce summary", exact: true })
      .click();
    await expect(page.locator(".cm-content")).toContainText(sourceA);
    await expect(page.getByRole("grid")).toHaveCount(0);
    expect(executions().length).toBe(before);
    await capture("03-returned-saved-sql");
    await page.reload();
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Commerce notes", exact: true })
      .click();
    await expect(page.getByLabel("Notebook title")).toHaveValue(
      "Commerce notes",
    );
    await expect(
      page.getByRole("combobox", { name: "Document connection" }),
    ).toHaveCount(0);
    expect(executions().length).toBe(before);
    await expect(
      page
        .getByRole("complementary")
        .getByRole("button", { name: "Analytics summary", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Switch connection" }),
    ).toContainText("Local playground");
    const persisted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kasane.workspaces")),
    );
    expect(
      persisted.state.tabs.every((t) => !t.executions && !t.sessionId),
    ).toBe(true);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "orders", exact: true })
      .click();
    await expect(
      page.getByText("Table restored.", { exact: true }),
    ).toBeVisible();
    expect(executions().length).toBe(before);
    await selectAndConnect("Analytics sandbox");
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "deployments", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("grid")).toHaveCount(0);
    expect(executions().length).toBe(before);
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test("late explorer responses cannot replace another workspace", async ({
  page,
}) => {
  test.skip(!process.env.KASANE_MULTI_TEST, "Requires both database fixtures");
  const commerceId = randomUUID(),
    analyticsId = randomUUID();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const bridge = await installDatabaseBridge(page, {
    afterCatalog: (id) => (id === commerceId ? gate : undefined),
  });
  const base = { host: "127.0.0.1", username: "kasane", tls: false };
  bridge.connections.push(
    {
      ...base,
      id: commerceId,
      name: "Commerce",
      port: 55432,
      database: "kasane_dev",
    },
    {
      ...base,
      id: analyticsId,
      name: "Analytics",
      port: 55433,
      database: "kasane_analytics",
    },
  );
  try {
    await page.goto("/");
    await expect
      .poll(() =>
        bridge.events.some(
          (e) => e.command === "get_catalog" && e.connectionId === commerceId,
        ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Switch connection" }).click();
    await page
      .getByRole("menuitem", { name: "Switch to Analytics", exact: true })
      .click();
    await expect(page.getByTitle("Open workspace.deployments")).toBeVisible();
    release();
    const oldSession = bridge.events.find(
      (e) => e.command === "open_session" && e.connectionId === commerceId,
    ).sessionId;
    await expect.poll(() => bridge.sessions.has(oldSession)).toBe(false);
    await expect(page.getByTitle("Open commerce.orders")).toHaveCount(0);
    await expect(page.getByTitle("Open workspace.deployments")).toBeVisible();
    expect(bridge.events.filter((e) => e.command === "execute_sql")).toEqual(
      [],
    );
    await page.getByTitle("Open workspace.deployments").click();
    await expect(page.getByRole("grid")).toBeVisible();
    await page.getByRole("button", { name: "Switch connection" }).click();
    await page
      .getByRole("menuitem", { name: "Disconnect", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch connection" }),
    ).toContainText("Disconnected");
    await expect(
      page.getByRole("button", { name: "Reconnect session", exact: true }),
    ).toBeVisible();
    await expect.poll(() => bridge.sessions.size).toBe(0);
    const before = bridge.events.filter(
      (e) => e.command === "execute_sql",
    ).length;
    await page.getByRole("button", { name: "Switch connection" }).click();
    await page.getByRole("menuitem", { name: "Connect", exact: true }).click();
    await expect(page.getByTitle("Open workspace.deployments")).toBeVisible();
    expect(
      bridge.events.filter((e) => e.command === "execute_sql"),
    ).toHaveLength(before);
  } finally {
    release();
    await bridge.close();
  }
});
