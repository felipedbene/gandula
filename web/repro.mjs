import { chromium } from "@playwright/test";

const URL = "http://localhost:5173/";
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const start = page.getByRole("button", { name: /Iniciar carreira/i });
if (await start.count()) { await start.first().click(); await page.waitForTimeout(1200); }

await page.getByRole("button", { name: /Avançar rodada/i }).first().click();
await page.waitForTimeout(800);

// Snapshot: projection text + all progress bar values + the user's pitch row shape.
async function snap() {
  return await page.evaluate(() => {
    const poss = [...document.querySelectorAll("*")].find((e) =>
      /Posse projetada/.test(e.textContent || "") && e.children.length <= 3,
    );
    const possText = [...document.querySelectorAll("*")]
      .map((e) => e.textContent || "").find((t) => /%\s*×\s*\d+%/.test(t) && t.length < 20) || "";
    const bars = [...document.querySelectorAll('[role="progressbar"]')].map((b) =>
      b.getAttribute("aria-valuenow") || b.querySelector("[style*='width']")?.getAttribute("style") || "?",
    );
    // User pitch = the interactive one (has a bench rail sibling). Approximate by
    // taking visible dot rows: group visible dots by their rounded y center.
    const dots = [...document.querySelectorAll("[data-dot-id]")].filter((d) => {
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const rows = {};
    for (const d of dots) {
      const y = Math.round(d.getBoundingClientRect().y / 20) * 20;
      rows[y] = (rows[y] || 0) + 1;
    }
    const rowShape = Object.keys(rows).sort((a, b) => a - b).map((y) => rows[y]);
    return { possText, bars: bars.slice(0, 4), rowShape, visibleDots: dots.length };
  });
}

const base = await snap();
log("BASE        :", JSON.stringify(base));

async function change(label, value) {
  const before = await snap();
  await page.getByLabel(label).selectOption(value);
  await page.waitForTimeout(350);
  const after = await snap();
  const moved =
    JSON.stringify(before.bars) !== JSON.stringify(after.bars) ||
    before.possText !== after.possText ||
    JSON.stringify(before.rowShape) !== JSON.stringify(after.rowShape);
  log(`${label}=${value}: board moved? ${moved}  bars ${JSON.stringify(before.bars)}→${JSON.stringify(after.bars)}  shape ${JSON.stringify(before.rowShape)}→${JSON.stringify(after.rowShape)}`);
}

await change(/Postura/i, "VeryAttacking");   // mentality
await change(/Ritmo/i, "Fast");              // tempo  (asymmetric → should move userBar)
await change(/Marcação/i, "High");           // pressing (disrupts opp midfield → should move possession)
await change(/Amplitude/i, "Wide");          // width  (shot quality)
await change(/Formação/i, "F352");           // formation (should restructure pitch if formation-aware)

log("page errors:", errors.length ? errors : "none");
await browser.close();
