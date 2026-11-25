import { test, expect } from "@playwright/test";
import { installDatabaseBridge } from "./helpers/database-bridge.mjs";

test("closing a dirty query requires an explicit save or discard", async ({
  page,
}) => {
  const bridge = await installDatabaseBridge(page);
  await page.goto("/");
  const strip = page.getByRole("navigation", { name: "Open documents" });
  const sidebar = page.getByRole("complementary");
  const query = strip.getByRole("button", { name: "Query 1", exact: true });
  const prompt = page.getByRole("dialog", {
    name: "Save changes to “Query 1”?",
  });

  await page.keyboard.press("Meta+t");
  await expect(query).toBeVisible();
  await page.keyboard.press("Meta+w");
  await expect(prompt).toBeVisible();
  expect(bridge.sqlDocuments.size).toBe(0);
  await prompt.getByRole("button", { name: "Keep editing" }).click();
  await expect(query).toBeVisible();

  await strip.getByRole("button", { name: "Close Query 1" }).click();
  await prompt.getByRole("button", { name: "Discard and close" }).click();
  await expect(query).toHaveCount(0);
  await page.reload();
  await expect(query).toHaveCount(0);
  expect(bridge.sqlDocuments.size).toBe(0);

  await page.keyboard.press("Meta+t");
  await strip.getByRole("button", { name: "Close Query 1" }).click();
  await prompt.getByRole("button", { name: "Save and close" }).click();
  await expect(query).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: "Query 1", exact: true }),
  ).toBeVisible();
  expect([...bridge.sqlDocuments.values()].map(({ title }) => title)).toEqual([
    "Query 1",
  ]);

  await expect(
    page.getByRole("button", { name: "Import SQL", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: /Import SQL/ }),
  ).toBeVisible();
});

test("dragging past the right edge scrolls to the last tab without resizing the strip", async ({
  page,
}) => {
  await installDatabaseBridge(page);
  await page.goto("/");
  const strip = page.getByRole("navigation", { name: "Open documents" });
  for (let i = 0; i < 14; i++) await page.keyboard.press("Meta+t");
  const cards = strip.locator("[data-tab-id]");
  await expect(cards).toHaveCount(14);
  const menu = page.getByRole("button", { name: "Show open tabs" });
  await menu.click();
  await page.getByRole("menuitem", { name: "Query 1", exact: true }).click();
  await expect(cards.first()).toHaveClass(/active/);
  const source = await strip
    .getByRole("button", { name: "Query 1", exact: true })
    .boundingBox();
  const bounds = await strip.boundingBox();
  const menuBounds = await menu.boundingBox();
  const scrollWidth = await strip.evaluate((el) => el.scrollWidth);

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width + 35,
    source.y + source.height / 2,
    { steps: 18 },
  );
  await expect(page.locator(".tab-drag-preview")).toBeVisible();
  await expect
    .poll(() =>
      strip.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft),
    )
    .toBeLessThanOrEqual(1);
  expect(await strip.evaluate((el) => el.scrollWidth)).toBe(scrollWidth);
  expect(await menu.boundingBox()).toEqual(menuBounds);
  await page.mouse.up();
  await expect(cards.last().locator("button").first()).toHaveText("Query 1");
  await expect(cards.last()).toHaveClass(/active/);
});
