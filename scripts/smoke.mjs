// Headless smoke test for the piano-roll app.
// Run with: node scripts/smoke.mjs (requires `next dev` running on port 3000).

import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:3000";
const HEADLESS = process.env.HEADFUL !== "1";

function log(msg) { console.log(`[smoke] ${msg}`); }
function fail(msg) { console.error(`[smoke] FAIL: ${msg}`); process.exit(1); }

const browser = await chromium.launch({ headless: HEADLESS });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });

await page.goto(URL, { waitUntil: "networkidle" });
log("page loaded");

// Wait for the app to render past the loading state.
await page.waitForFunction(() => !document.body.innerText.includes("Loading…"), null, { timeout: 8000 });

// Toolbar present.
const toolbarText = await page.locator("body").innerText();
if (!toolbarText.includes("Tempo")) fail("Toolbar didn't render");
if (!toolbarText.includes("Voices")) fail("Voice list didn't render");
log("toolbar + voice list present");

// Find the piano roll grid SVG (the larger one, in the scroll area).
const svgs = page.locator("svg");
const svgCount = await svgs.count();
log(`found ${svgCount} svgs`);

// The grid SVG has the data-note-id rects after we add notes.
// Grab the bounding box of the rightmost (widest) svg = grid.
let gridSvg = null;
let maxArea = 0;
for (let i = 0; i < svgCount; i++) {
  const box = await svgs.nth(i).boundingBox();
  if (!box) continue;
  const area = box.width * box.height;
  if (area > maxArea) { maxArea = area; gridSvg = svgs.nth(i); }
}
if (!gridSvg) fail("no grid svg");
const box = await gridSvg.boundingBox();
log(`grid svg ${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)},${Math.round(box.y)})`);

// Click in the grid to add a note.
await page.mouse.click(box.x + 100, box.y + 200);
await page.waitForTimeout(150);

const noteCountAfterClick = await page.locator("[data-note-id]").count();
if (noteCountAfterClick !== 1) fail(`expected 1 note after click, got ${noteCountAfterClick}`);
log(`after click: ${noteCountAfterClick} note`);

// Add another note further to the right.
await page.mouse.click(box.x + 250, box.y + 240);
await page.waitForTimeout(150);
let n = await page.locator("[data-note-id]").count();
if (n !== 2) fail(`expected 2 notes, got ${n}`);
log(`after 2nd click: ${n} notes`);

// Backspace deletes the last selected note.
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
n = await page.locator("[data-note-id]").count();
if (n !== 1) fail(`expected 1 note after Backspace, got ${n}`);
log(`after Backspace: ${n} note`);

// Click the existing note to select, then verify chord cycler shows up.
const remaining = page.locator("[data-note-id]").first();
const rbox = await remaining.boundingBox();
await page.mouse.click(rbox.x + 4, rbox.y + 4);
await page.waitForTimeout(150);
const inspectorText = await page.locator("body").innerText();
if (!inspectorText.includes("Chord cycler")) fail(`Chord cycler not visible after selecting one note. Body text: ${inspectorText.slice(0, 500)}`);
log("chord cycler visible");

// Cycle chord forward and commit (Enter).
await page.keyboard.press("]");
await page.waitForTimeout(50);
await page.keyboard.press("]");
await page.waitForTimeout(50);
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
n = await page.locator("[data-note-id]").count();
if (n < 3) fail(`expected at least 3 notes after Enter (chord commit), got ${n}`);
log(`after chord commit: ${n} notes`);

// Test play/stop.
await page.keyboard.press("Space");
await page.waitForTimeout(50);
const playingText1 = await page.locator("button").filter({ hasText: /Stop|Play/ }).first().innerText();
log(`transport label after Space: ${playingText1}`);
await page.keyboard.press("Space");
await page.waitForTimeout(100);

// Verify IndexedDB has a project saved.
const idbHas = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === "piano-roll");
});
if (!idbHas) fail("IndexedDB 'piano-roll' database not created");
log("IndexedDB project saved");

// Visible Delete button when notes are selected.
const deleteBtn = page.locator("button", { hasText: /^Delete/ });
if ((await deleteBtn.count()) === 0) fail("Delete button not visible while notes are selected");
const beforeDel = await page.locator("[data-note-id]").count();
await deleteBtn.first().click();
await page.waitForTimeout(150);
const afterDel = await page.locator("[data-note-id]").count();
if (afterDel >= beforeDel) fail(`Delete button didn't remove notes (${beforeDel} → ${afterDel})`);
log(`Delete button: ${beforeDel} → ${afterDel}`);

// Projects menu: open it, create a new project, verify the grid resets.
await page.click("button:has-text('Projects')");
await page.waitForTimeout(100);
await page.click("button:has-text('New project')");
await page.waitForTimeout(300);
const notesAfterNew = await page.locator("[data-note-id]").count();
if (notesAfterNew !== 0) fail(`Expected empty grid after New project, got ${notesAfterNew} notes`);
log("New project: grid is empty");

// Add a note in the new project, then open menu and verify it lists 2 projects.
const grid2 = await gridSvg.boundingBox();
await page.mouse.click(grid2.x + 100, grid2.y + 200);
await page.waitForTimeout(150);
await page.click("button:has-text('Projects')");
await page.waitForTimeout(150);
// Items are rows with timestamps; count by the right-side delete buttons.
const projectRows = await page.locator("[role='menu'] button[title='Delete project']").count();
if (projectRows < 2) fail(`Expected at least 2 projects in menu, got ${projectRows}`);
log(`Projects menu lists ${projectRows} projects`);

// Delete the *non-current* project (the older one). Confirm dialog comes from window.confirm.
page.once("dialog", (d) => d.accept());
const rows = page.locator("[role='menu'] > div > div");
const rowCount = await rows.count();
// Find a row whose label doesn't include "current".
let targetIdx = -1;
for (let i = 0; i < rowCount; i++) {
  const txt = await rows.nth(i).innerText();
  if (!txt.includes("current")) { targetIdx = i; break; }
}
if (targetIdx === -1) fail("Couldn't find a non-current project row to delete");
await rows.nth(targetIdx).locator("button[title='Delete project']").click();
await page.waitForTimeout(200);
// Menu stays open after delete; check count directly.
const projectRowsAfter = await page.locator("[role='menu'] button[title='Delete project']").count();
if (projectRowsAfter !== projectRows - 1) fail(`Expected ${projectRows - 1} projects after delete, got ${projectRowsAfter}`);
log(`After delete: ${projectRowsAfter} projects`);

if (errors.length > 0) {
  console.error("[smoke] Errors during test:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

log("ALL CHECKS PASSED");
await browser.close();
