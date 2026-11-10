// Build the 10 November daily report as a PDF.
//
// Same output contract as build-readiness-pdf.mjs — A4, light palette, backgrounds
// printed, a footer carrying the title and the page count. The one difference is the
// driver: puppeteer-core is not a dependency of this repository, so this reads the
// `patchright` build (a Playwright fork) that ships with the installed CodeGPT
// extension, and drives the system Chrome with it. Nothing is installed to run this.
//
//   node docs/build-daily-report-pdf.mjs
//
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, 'build-daily-report-source.html');
const OUT    = resolve(HERE, 'Groundwork-Daily-Report-2026-11-10.pdf');

// ── The driver ───────────────────────────────────────────────────────────────────────
// Named rather than searched for, so a failure says which path was missing instead of
// reporting "no browser" and leaving somebody to guess.
const CANDIDATES = [
  resolve(homedir(), '.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/node_modules/patchright/index.js'),
];
const driverPath = CANDIDATES.find(existsSync);
if (!driverPath) {
  console.error('No patchright build found. Looked in:\n  ' + CANDIDATES.join('\n  '));
  process.exit(1);
}
// patchright is CommonJS, and its named exports are not the Playwright surface — the
// browser types hang off the default export. Reading `.chromium` from the top level
// gives undefined and fails one line later with a message that does not say why.
const driver = await import(pathToFileURL(driverPath).href);
const chromium = driver.default?.chromium ?? driver.chromium;
if (!chromium) { console.error('patchright loaded but exposes no chromium'); process.exit(1); }

const CHROME = '/usr/bin/google-chrome';
if (!existsSync(CHROME)) { console.error(`No Chrome at ${CHROME}`); process.exit(1); }

// The authored file is a fragment: a title, the stylesheet, and the body. Supply the
// skeleton here, with the same charset and viewport, so it renders identically to the
// way it would if it were published.
const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
${readFileSync(SOURCE, 'utf8')}
</body></html>`;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

// Light, always. The stylesheet carries a dark theme for screen reading; a PDF is read
// on white and printed on white, so the dark palette would be wrong on both counts.
const context = await browser.newContext({ colorScheme: 'light' });
const p = await context.newPage();

const errs = [];
p.on('console', m => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

await p.setContent(page, { waitUntil: 'networkidle' });
// Google Fonts must actually arrive, or the PDF silently ships in the fallback stack
// and the type is wrong in a way nobody notices until it is printed.
await p.evaluate('document.fonts.ready');

const usedFonts = await p.evaluate(() =>
  [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));

await p.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#82878B;padding:0 13mm;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;'
    + 'justify-content:space-between;">'
    + '<span>Groundwork &middot; daily report &middot; 10 November 2026</span>'
    // One element, or space-between scatters the page number, the slash and the total
    // into three separate columns.
    + '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>'
    + '</div>',
  margin: { top: '14mm', right: '13mm', bottom: '16mm', left: '13mm' },
});

console.log('written:', OUT);
console.log('fonts loaded:', [...new Set(usedFonts)].join(', ') || '(none — check the network)');
console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
