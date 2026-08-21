import { chromium } from "playwright";

const baseUrl = process.env.MYFINANCE_APP_URL || "https://wahyudp76.github.io/myfinance/";
const email = process.env.PARITY_TEST_EMAIL;
const password = process.env.PARITY_TEST_PASSWORD;

if (!email || !password) {
  console.log("Headless legacy parity: SKIPPED (test credentials not configured)");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const transactionResponses = [];

try {
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!url.includes("/rest/v1/transactions")) return;
      if (response.request().method() !== "GET") return;
      if (response.status() !== 200) return;
      const body = await response.json();
      if (Array.isArray(body)) transactionResponses.push(body);
    } catch {
      // Ignore non-JSON/aborted responses; final assertion handles absence.
    }
  });

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  await page.waitForTimeout(5000);

  const rows = transactionResponses.flat();
  if (!rows.length) {
    throw new Error("Production transaction read was not observed. Legacy path may not have bootstrapped, or the API transport changed.");
  }

  process.stdout.write(JSON.stringify(rows));
} finally {
  await browser.close();
}
