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

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });

  // This harness deliberately does not submit financial mutations.
  // The login selectors must be adapted to the production UI if they change.
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await passwordInput.press("Enter");

  await page.waitForTimeout(2000);

  const result = await page.evaluate(async () => {
    if (typeof window.__MYFINANCE_PARITY_READ__ !== "function") {
      throw new Error("Production parity read bridge is not installed");
    }
    return window.__MYFINANCE_PARITY_READ__();
  });

  process.stdout.write(JSON.stringify(result));
} finally {
  await browser.close();
}
