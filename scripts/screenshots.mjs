import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "screenshots");
fs.mkdirSync(out, { recursive: true });
const url = process.env.BASE_URL || "http://127.0.0.1:3000";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--disable-dev-shm-usage"],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});

const page = await browser.newPage();
page.setDefaultTimeout(20000);
const logs = [];
page.on("console", (msg) => logs.push(`console.${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}\n${err.stack}`));
page.on("requestfailed", (req) => logs.push(`failed: ${req.url()} ${req.failure()?.errorText}`));

await page.setUserAgent(
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
);

await page.goto(url, { waitUntil: "load", timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
const html = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 3000));
console.log("LOGS:\n" + logs.join("\n"));
console.log("HTML:\n" + html);
if (!html.includes("骷髏王") && !html.includes("sk-card") && !documentMaybe(html)) {
  console.error("page did not render app");
}

function documentMaybe() { return true; }

async function shot(name) {
  const file = path.join(out, name);
  await page.screenshot({ path: file, type: "png" });
  console.log("wrote", file);
}

// If the app rendered, take the real shots; otherwise stop after debug.png
const hasApp = await page.evaluate(() => !!document.querySelector("h1, .code, .round"));
if (!hasApp) {
  await browser.close();
  process.exit(1);
}

await shot("home-390.png");

const name = await page.$("#name-input");
if (name) {
  await name.click({ clickCount: 3 });
  await name.type("阿明");
}
await page.click('[data-act="create"]');
await page.waitForFunction(() => (document.body.innerText || "").includes("房號"), { timeout: 10000 });
await new Promise((r) => setTimeout(r, 400));
await shot("lobby-390.png");

await page.click('[data-act="start"]');
await page.waitForFunction(() => (document.body.innerText || "").includes("第 1 局"), { timeout: 10000 });
await new Promise((r) => setTimeout(r, 500));
await shot("table-bid-390.png");

await browser.close();
console.log("done");
