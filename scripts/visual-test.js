import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(__dirname, '../screenshots');

async function run() {
  const browser = await chromium.launch({ headless: true });

  // Light mode - iPhone viewport
  const lightPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await lightPage.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await lightPage.waitForTimeout(2000);
  await lightPage.screenshot({ path: `${screenshotDir}/01-new-snippet-light.png`, fullPage: false });
  console.log('Screenshot: 01-new-snippet-light.png');

  // Dark mode
  await lightPage.click('button:has(svg.lucide-moon)');
  await lightPage.waitForTimeout(500);
  await lightPage.screenshot({ path: `${screenshotDir}/02-new-snippet-dark.png`, fullPage: false });
  console.log('Screenshot: 02-new-snippet-dark.png');

  // Type some code into editor
  const editor = lightPage.locator('textarea');
  await editor.click();
  await editor.fill('<html>\n<body>\n<h1 style="color:blue">Hello World</h1>\n<p>Testing Snippets.io</p>\n</body>\n</html>');
  await lightPage.waitForTimeout(2000);
  await lightPage.screenshot({ path: `${screenshotDir}/03-with-code-dark.png`, fullPage: false });
  console.log('Screenshot: 03-with-code-dark.png');

  // Switch to light mode for code view
  await lightPage.click('button:has(svg.lucide-sun)');
  await lightPage.waitForTimeout(500);
  await lightPage.screenshot({ path: `${screenshotDir}/04-with-code-light.png`, fullPage: false });
  console.log('Screenshot: 04-with-code-light.png');

  // Navigate to Library tab
  const libraryBtn = lightPage.locator('button:has-text("Library")');
  await libraryBtn.click();
  await lightPage.waitForTimeout(1000);
  await lightPage.screenshot({ path: `${screenshotDir}/05-library-light.png`, fullPage: false });
  console.log('Screenshot: 05-library-light.png');

  // Settings tab (API key)
  const settingsBtn = lightPage.locator('button:has-text("Settings")');
  await settingsBtn.click();
  await lightPage.waitForTimeout(500);
  await lightPage.screenshot({ path: `${screenshotDir}/06-api-key-modal.png`, fullPage: false });
  console.log('Screenshot: 06-api-key-modal.png');

  // Desktop viewport
  const desktopPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktopPage.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await desktopPage.waitForTimeout(2000);
  await desktopPage.screenshot({ path: `${screenshotDir}/07-desktop-light.png`, fullPage: false });
  console.log('Screenshot: 07-desktop-light.png');

  await browser.close();
  console.log('\nAll screenshots saved to screenshots/ directory');
}

run().catch(e => { console.error(e); process.exit(1); });
