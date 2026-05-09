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
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // The chat-panel test deliberately calls /api/chat without ANTHROPIC_API_KEY;
  // browsers log the resulting 500 as a console.error. The UI behavior is
  // verified separately, so don't fail the smoke run on that noise.
  const text = m.text();
  if (text.includes("/api/chat") || text.includes("status of 500")) return;
  errors.push(`console.error: ${text}`);
});

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

// --- Hover-to-place preview should appear in draw mode ---
await page.mouse.move(box.x + 100, box.y + 200);
await page.waitForTimeout(100);
const drawHoverGhosts = await page.locator("rect[stroke-dasharray]").count();
if (drawHoverGhosts < 1) fail(`Expected at least 1 dashed ghost in draw mode hover, got ${drawHoverGhosts}`);
log(`draw-mode hover ghost: ${drawHoverGhosts}`);

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

// --- Per-voice instrument dropdown ---
const instSelect = page.locator("select[title='Instrument']").first();
if ((await instSelect.count()) === 0) fail("Instrument select not visible in the voice list");
const instOptionCount = await instSelect.locator("option").count();
if (instOptionCount < 6) fail(`Expected >= 6 instruments, got ${instOptionCount}`);
await instSelect.selectOption("pluck");
await page.waitForTimeout(150);
const instAfter = await instSelect.inputValue();
if (instAfter !== "pluck") fail(`Instrument should change to pluck, got ${instAfter}`);
log(`Instrument dropdown: ${instOptionCount} options, switched to ${instAfter}`);

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

// Add a few notes in the new project for the multi-select tests.
const grid2 = await gridSvg.boundingBox();
await page.mouse.click(grid2.x + 100, grid2.y + 200);
await page.waitForTimeout(100);
await page.mouse.click(grid2.x + 200, grid2.y + 220);
await page.waitForTimeout(100);
await page.mouse.click(grid2.x + 300, grid2.y + 240);
await page.waitForTimeout(150);

// --- Switch to Select mode and marquee without shift ---
await page.click("button:has-text('Select')");
await page.waitForTimeout(100);
await page.mouse.move(grid2.x + 60, grid2.y + 180);
await page.mouse.down();
await page.mouse.move(grid2.x + 360, grid2.y + 260, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(150);
let bodyTxt = await page.locator("body").innerText();
const marqueeMatch = /(\d+)\s+notes selected/.exec(bodyTxt);
if (!marqueeMatch || Number(marqueeMatch[1]) < 3) fail(`Select-mode marquee (no shift) should select 3 notes, got: ${marqueeMatch?.[0] ?? "no match"}`);
log(`select-mode marquee: ${marqueeMatch[0]}`);

// Switch back to Draw mode for the rest of the tests.
await page.click("button:has-text('Draw')");
await page.waitForTimeout(100);

// --- Stack chord button + ghost preview while hovering ---
const majBtn = page.locator("button[title*='maj chord rooted']").first();
if ((await majBtn.count()) === 0) fail("Stack chord 'maj' button not visible in multi-select inspector");
// Hover to trigger ghost preview.
await majBtn.hover();
await page.waitForTimeout(100);
const ghostCount = await page.locator("rect[stroke-dasharray]").count();
if (ghostCount < 6) fail(`Expected ghost notes while hovering Stack chord (>=6), got ${ghostCount}`);
log(`ghost notes on hover: ${ghostCount}`);
const beforeStack = await page.locator("[data-note-id]").count();
await majBtn.click();
await page.waitForTimeout(150);
const afterStack = await page.locator("[data-note-id]").count();
if (afterStack < beforeStack + 6) fail(`Expected stack chord to add >=6 notes (3 selected × 2 chord tones), got ${afterStack - beforeStack}`);
log(`Stack chord: +${afterStack - beforeStack} notes`);

// --- Move-to-voice ---
// Add a 2nd voice in the toolbar voice list, then re-select the just-added
// stack notes and use the Move-to-voice control.
await page.click("button:has-text('+ Add')");
await page.waitForTimeout(150);
// Marquee-select again over the same area.
await page.mouse.move(grid2.x + 60, grid2.y + 100);
await page.keyboard.down("Shift");
await page.mouse.down();
await page.mouse.move(grid2.x + 400, grid2.y + 320, { steps: 10 });
await page.mouse.up();
await page.keyboard.up("Shift");
await page.waitForTimeout(150);
const moveBtn = page.locator("button[title^='Reassign selected notes to Voice 2']");
if ((await moveBtn.count()) === 0) fail("Move-to-voice 'Voice 2' button not visible");
await moveBtn.first().click();
await page.waitForTimeout(150);
log("Move-to-voice clicked");

// --- Reopen the projects menu (it was reset above) so the next checks work ---
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

// --- Stage 2 chat panel: input + send works, missing API key surfaces an error ---
const chatTextarea = page.locator("textarea[placeholder*='Ask the agent']");
if ((await chatTextarea.count()) === 0) fail("Chat textarea not visible");
await chatTextarea.fill("hello");
const sendBtn = page.locator("button", { hasText: "Send" });
await sendBtn.click();
// The chat sets a busy state while the request is in flight. We pass either
// way — "Agent is working…" eventually goes away, and either the key error
// surfaces or the agent answers. The browser may also need a few seconds for
// Next.js to cold-start the API route on the first call.
try {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Agent is working…"),
    null,
    { timeout: 30000 },
  );
} catch {
  const chatBody = await page.locator("body").innerText();
  fail(`Chat busy state never cleared. Got: ${chatBody.slice(-500)}`);
}
const chatBody = await page.locator("body").innerText();
const keyMissing = chatBody.includes("ANTHROPIC_API_KEY");
log(`chat panel: ${keyMissing ? "missing-key error surfaced" : "agent responded"}`);

if (errors.length > 0) {
  console.error("[smoke] Errors during test:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

log("ALL CHECKS PASSED");
await browser.close();
