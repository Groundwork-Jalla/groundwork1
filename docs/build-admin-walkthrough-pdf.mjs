import puppeteer from 'puppeteer-core';
import { readFileSync, readdirSync } from 'node:fs';

// Screenshots live in docs/walkthrough-shots/ and are inlined as data URIs: a PDF that
// points at localhost is a PDF full of broken images the moment it leaves this machine,
// and keeping them in the repo is what makes this script runnable a year from now.
//
// To refresh them: run the app, sign in as an admin, and capture each screen at
// 1280x860 (deviceScaleFactor 2), then downscale to 1320px wide JPEG. The file name is
// the placeholder — 03-new-user.jpg fills {{03-new-user}}.
const SHOTS_DIR = `${process.env.PROJ ?? '.'}/docs/walkthrough-shots`;
const shots = Object.fromEntries(
  readdirSync(SHOTS_DIR)
    .filter(f => f.endsWith('.jpg'))
    .map(f => [f.replace(/\.jpg$/, ''),
               'data:image/jpeg;base64,' + readFileSync(`${SHOTS_DIR}/${f}`).toString('base64')]));

let html = readFileSync(process.env.PROJ + '/docs/build-admin-walkthrough-source.html', 'utf8');
for (const [key, uri] of Object.entries(shots)) {
  html = html.replaceAll(`{{${key}}}`, uri);
}
const missing = [...html.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1]);
if (missing.length) throw new Error(`no screenshot for: ${missing.join(', ')}`);

const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;

const b = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});
const p = await b.newPage();
const errs = [];
p.on('console', m => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

// Light, always: a PDF is read on white and printed on white.
await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await p.setContent(page, { waitUntil: 'networkidle0' });
await p.evaluateHandle('document.fonts.ready');

const usedFonts = await p.evaluate(() =>
  [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
const imgs = await p.evaluate(() =>
  [...document.images].map(i => ({ ok: i.complete && i.naturalWidth > 0, alt: i.alt.slice(0, 30) })));

await p.pdf({
  path: process.env.PROJ + '/docs/Groundwork-Admin-Client-Setup-Walkthrough.pdf',
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#82878B;padding:0 13mm;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;'
    + 'justify-content:space-between;">'
    + '<span>Groundwork by Jalla · Setting up a client · 22 September 2026</span>'
    + '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>'
    + '</div>',
  margin: { top: '14mm', right: '13mm', bottom: '16mm', left: '13mm' },
});

console.log('fonts:', [...new Set(usedFonts)].join(', ') || '(none — check the network)');
console.log('images:', imgs.filter(i => i.ok).length + '/' + imgs.length, 'loaded');
const broken = imgs.filter(i => !i.ok);
if (broken.length) console.log('BROKEN:', broken.map(i => i.alt));
console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
