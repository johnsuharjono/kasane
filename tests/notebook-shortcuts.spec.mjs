import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

test("notebook command mode, insertion, cell types, run and floating completion", async ({
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cells = page.locator(".notebook-cell");
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "New notebook", exact: true })
      .click();
    await expect(cells).toHaveCount(2);
    await cells.first().hover();
    await page
      .getByRole("button", { name: "Delete cell 1", exact: true })
      .click();
    await expect(cells).toHaveCount(1);
    let editor = cells.first().locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("SELECT 1 AS original;");
    await page.keyboard.press("Escape");
    await expect(cells.first()).toBeFocused();
    await page.keyboard.press("a");
    await expect(cells).toHaveCount(2);
    await expect(cells.first()).toBeFocused();
    await expect(cells.nth(1).locator(".cm-content")).toContainText("original");
    await page.keyboard.press("b");
    await expect(cells).toHaveCount(3);
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press("m");
    await expect(cells.nth(1)).toHaveClass(/markdown/);
    await expect(
      page.locator(".notebook-selection, .notebook-key-hint"),
    ).toHaveCount(0);
    await expect(cells.nth(1)).toHaveAttribute("data-mode", "command");
    expect(
      await cells
        .nth(1)
        .evaluate((el) => getComputedStyle(el, "::before").content),
    ).toBe('""');
    await page.keyboard.press("Enter");
    await expect(cells.nth(1).locator("textarea")).toBeFocused();
    await expect(cells.nth(1)).toHaveAttribute("data-mode", "edit");
    await page.keyboard.insertText("a b m y");
    await expect(cells).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cells.nth(2)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+Enter");
    await expect(cells.nth(2).getByRole("gridcell").first()).toHaveText("1");
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(3).locator(".cm-content")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Shift+Enter");
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("y");
    await expect(cells.nth(1)).toHaveClass(/sql/);

    // Completion must escape the bounded editor/cell and remain clickable.
    await page.keyboard.press("Enter");
    editor = cells.nth(1).locator(".cm-content");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(
      Array(24).fill("-- line").join("\n") + "\nSEL",
    );
    await page.keyboard.press("Control+Space");
    const tooltip = page.locator(".cm-tooltip-autocomplete");
    await expect(tooltip).toBeVisible();
    expect(
      await tooltip.evaluate((el) => el.closest(".notebook-cell") === null),
    ).toBe(true);
    await expect
      .poll(() =>
        tooltip.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + Math.min(12, r.height / 2),
          );
          return r.top >= 0 && r.bottom <= innerHeight && el.contains(hit);
        }),
      )
      .toBe(true);
    const sourceBeforeEscape = await editor.innerText();
    await page.keyboard.press("Escape");
    // Do not wait for a render between Escape and the command key.
    await page.keyboard.press("b");
    await expect(tooltip).toHaveCount(0);
    await expect(cells).toHaveCount(5);
    await expect(cells.nth(2)).toBeFocused();
    await expect.poll(() => editor.innerText()).toBe(sourceBeforeEscape);
    await page.keyboard.type("qwt");
    await expect.poll(() => editor.innerText()).toBe(sourceBeforeEscape);
    await expect(cells.nth(2)).toBeFocused();
    await expect(cells.nth(2).locator(".cm-placeholder")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(cells.nth(2).locator(".cm-content")).toBeFocused();
    await page.keyboard.type("SELECT 2;");
    await expect(cells.nth(2).locator(".cm-content")).toHaveText("SELECT 2;");
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});

test("Jupyter commands work from cell prompts and outputs, preserve other results, and expose shortcut help", async ({
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cells = page.locator(".notebook-cell");
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "New notebook", exact: true })
      .click();
    await expect(cells).toHaveCount(2);
    const originalId = await cells.last().getAttribute("data-cell-id");
    const original = page.locator(`[data-cell-id="${originalId}"]`);
    const editor = original.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("SELECT 7 AS preserved;");
    await page.keyboard.press("Control+Enter");
    await expect(original.getByRole("gridcell").first()).toHaveText("7");
    await expect(original).toBeFocused();
    await expect(original.locator(".cell-main .execution-view")).toHaveCount(0);
    await expect(
      original.locator(".notebook-output .execution-view"),
    ).toHaveCount(1);

    await cells.first().locator(".cell-position").click();
    await page.keyboard.press("a");
    await expect(cells).toHaveCount(3);
    await expect(cells.first()).toBeFocused();
    await page.keyboard.press("Shift+b");
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press("d");
    await expect(cells).toHaveCount(4);
    await page.keyboard.press("d");
    await expect(cells).toHaveCount(3);
    await page.keyboard.press("z");
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(1)).toBeFocused();
    await expect(original.locator(".outdated-banner")).toHaveCount(0);

    // Editing and removing a different Markdown cell must preserve this output.
    const markdown = page.locator(".notebook-cell.markdown").first();
    await markdown.locator(".cell-position").click();
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("Changed explanation");
    await page.keyboard.press("Escape");
    await expect(original.locator(".outdated-banner")).toHaveCount(0);
    await expect(
      markdown.getByRole("button", { name: /Delete cell/ }),
    ).toBeVisible();
    await markdown.getByRole("button", { name: /Delete cell/ }).click();
    await expect(cells).toHaveCount(3);
    await expect(original.getByRole("gridcell").first()).toHaveText("7");
    await expect(original.locator(".outdated-banner")).toHaveCount(0);

    // Commands also work after interacting with the output, not only on a section.
    await original.getByRole("gridcell").first().click();
    await page.keyboard.press("a");
    await expect(cells).toHaveCount(4);
    await expect(cells.nth(2)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("SELECT 8;");
    await page.keyboard.press("Control+Enter");
    await expect(cells.nth(2).getByRole("gridcell").first()).toHaveText("8");
    await expect(original.locator(".outdated-banner")).toHaveCount(0);
    await original.getByRole("button", { name: /Move cell .* up/ }).click();
    await expect(original.locator(".outdated-banner")).toHaveCount(0);
    await original.locator(".cell-position").click();
    await page.keyboard.press("d");
    await page.keyboard.press("d");
    await expect(original).toHaveCount(0);
    await page.keyboard.press("z");
    await expect(original.getByRole("gridcell").first()).toHaveText("7");
    await expect(original.locator(".outdated-banner")).toHaveCount(0);

    await page.keyboard.press("h");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help).toContainText("A and B do not require Shift");
    await expect(help).toContainText("Undo cell deletion");
    // Escape can reach the notebook before the dialog takes focus.
    await original.dispatchEvent("keydown", { key: "Escape" });
    await expect(help).toHaveCount(0);
    await page
      .getByRole("button", { name: "Keyboard shortcuts", exact: true })
      .click();
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    const countBeforeAlt = await cells.count();
    const originalIndex = await original.evaluate((el) =>
      [...el.parentElement.children].indexOf(el),
    );
    await original.locator(".cm-content").click();
    await page.keyboard.press("Alt+Enter");
    await expect(cells).toHaveCount(countBeforeAlt + 1);
    await expect(
      cells.nth(originalIndex + 1).locator(".cm-content"),
    ).toBeFocused();
    await expect(original.getByRole("gridcell").first()).toHaveText("7");
    expect(errors).toEqual([]);
  } finally {
    await bridge.close();
  }
});
