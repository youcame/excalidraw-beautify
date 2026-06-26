import { expect, test } from "@playwright/test";

const GRID = 20;

interface SceneEl {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeWidth: number;
  isDeleted: boolean;
}

const waitForApi = async (page: import("@playwright/test").Page) => {
  await page.waitForFunction(
    () =>
      !!(window as unknown as Record<string, any>).__EXCALIDRAW_API__
        ?.getSceneElements,
    { timeout: 20_000 },
  );
};

const readScene = async (
  page: import("@playwright/test").Page,
): Promise<SceneEl[]> =>
  page.evaluate(() => {
    const api = (window as unknown as Record<string, any>).__EXCALIDRAW_API__;
    return (api?.getSceneElements?.() ?? []).map((e: any) => ({
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      angle: e.angle,
      strokeWidth: e.strokeWidth,
      isDeleted: e.isDeleted,
    }));
  });

test("every load shows the messy seed diagram, the 美化 button and the bubble", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApi(page);

  const boxes = (await readScene(page)).filter(
    (e) => !e.isDeleted && e.type === "rectangle",
  );
  expect(boxes.length).toBeGreaterThanOrEqual(8);
  // genuinely messy: more than one stroke width, and at least one tilted box
  expect(new Set(boxes.map((b) => b.strokeWidth)).size).toBeGreaterThan(1);
  expect(boxes.some((b) => Math.abs(b.angle) > 0.01)).toBe(true);

  await expect(page.getByTestId("beautify-button")).toBeVisible();
  await expect(page.locator(".beautify__bubble")).toBeVisible();
});

test("clicking 美化 straightens, unifies and grid-aligns the scene", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApi(page);

  const button = page.getByTestId("beautify-button");
  await expect(button).toBeVisible();
  await button.click();

  await expect(page.locator(".beautify__bubble")).toHaveCount(0);
  await expect(button).toHaveAttribute("data-status", /done|idle/, {
    timeout: 15_000,
  });

  const boxes = (await readScene(page)).filter(
    (e) => !e.isDeleted && e.type === "rectangle",
  );
  expect(boxes.length).toBeGreaterThanOrEqual(8);

  // consistency: single stroke width, no rotation
  expect(new Set(boxes.map((b) => b.strokeWidth))).toEqual(new Set([2]));
  for (const b of boxes) {
    expect(Math.abs(b.angle)).toBeLessThan(1e-6);
    expect(Math.round(b.x) % GRID).toBe(0);
    expect(Math.round(b.y) % GRID).toBe(0);
  }

  // most boxes share one center column (the main pipeline axis)
  const centers = boxes.map((b) => Math.round(b.x + b.width / 2));
  const counts = new Map<number, number>();
  for (const c of centers) {
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(5);
});
