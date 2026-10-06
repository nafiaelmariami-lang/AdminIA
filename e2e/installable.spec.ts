import { expect, test } from "@playwright/test";

test("application installable : manifeste, icônes, métadonnées", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { name: string; short_name: string; start_url: string; display: string; icons: { src: string; sizes: string; purpose?: string }[] };
  expect(manifest).toMatchObject({ short_name: "AdminIA", start_url: "/app", display: "standalone" });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  for (const sel of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]', 'meta[name="theme-color"]']) {
    await expect(page.locator(sel).first()).toBeAttached();
  }
  expect((await request.get((await page.locator('link[rel="apple-touch-icon"]').first().getAttribute("href"))!)).ok()).toBe(true);
  // Aucun service worker : rien de personnel n'est mis en cache sur l'appareil.
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0)).toBe(0);
});
