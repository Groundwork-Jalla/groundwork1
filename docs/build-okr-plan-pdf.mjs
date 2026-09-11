import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const SP = process.env.SP;
const html = readFileSync(`${SP}/okr-plan.html`, 'utf8');

// The publish tool wraps authored content in a document skeleton; for the PDF we supply
// our own, with the same charset and viewport so the page renders identically.
const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
${html}
</body></html>`;

const b = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});
const p = await b.newPage();
const errs = [];
p.on('console', m => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

// Light, always. The document has a dark theme for screen; a PDF is read on white and
// printed on white, so the dark palette would be wrong on both counts.
await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await p.setContent(page, { waitUntil: 'networkidle0' });
// Google Fonts must actually arrive, or the PDF silently ships in the fallback stack.
await p.evaluateHandle('document.fonts.ready');

const usedFonts = await p.evaluate(() =>
  [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));

await p.pdf({
  path: `${SP}/Groundwork-OKR-90-Day-Plan.pdf`,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#82878B;padding:0 13mm;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;'
    + 'justify-content:space-between;">'
    + '<span>Groundwork · ninety-day plan · Favour · 11 September 2026</span>'
    // One element, or space-between scatters the page number, the slash and the total
    // into three separate columns.
    + '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>'
    + '</div>',
  margin: { top: '14mm', right: '13mm', bottom: '16mm', left: '13mm' },
});

console.log('fonts loaded:', [...new Set(usedFonts)].join(', ') || '(none — check the CSP/network)');
console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
