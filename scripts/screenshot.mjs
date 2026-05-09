import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForFunction(() => !document.body.innerText.includes("Loading…"));

// Add a small melody so the screenshot has content.
const svgs = page.locator("svg");
let gridSvg = null;
let maxArea = 0;
for (let i = 0; i < (await svgs.count()); i++) {
  const box = await svgs.nth(i).boundingBox();
  if (!box) continue;
  const a = box.width * box.height;
  if (a > maxArea) { maxArea = a; gridSvg = svgs.nth(i); }
}
const box = await gridSvg.boundingBox();
const xs = [80, 160, 220, 300, 360, 440, 500, 580];
const ys = [240, 220, 200, 180, 200, 220, 200, 180];
for (let i = 0; i < xs.length; i++) await page.mouse.click(box.x + xs[i], box.y + ys[i]);
await page.waitForTimeout(200);

await page.screenshot({ path: "/tmp/piano-roll.png", fullPage: false });
console.log("wrote /tmp/piano-roll.png");
await browser.close();
