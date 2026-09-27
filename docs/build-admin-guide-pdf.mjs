import puppeteer from 'puppeteer-core';
import { readFileSync, readdirSync } from 'node:fs';

// Screenshots live in docs/admin-guide-shots/ and are inlined as data URIs: a PDF that
// points at localhost is a PDF full of broken images the moment it leaves this machine.
// The file name is the placeholder — 07-finance.jpg fills {{07-finance}}.
const SHOTS = `${process.env.PROJ ?? '.'}/docs/admin-guide-shots`;
const shots = Object.fromEntries(
  readdirSync(SHOTS).filter(f => f.endsWith('.jpg')).map(f => [
    f.replace(/\.jpg$/, ''),
    'data:image/jpeg;base64,' + readFileSync(`${SHOTS}/${f}`).toString('base64'),
  ]));

let html = readFileSync(`${process.env.PROJ ?? '.'}/docs/build-admin-guide-source.html`, 'utf8');
for (const [k, uri] of Object.entries(shots)) html = html.replaceAll(`{{${k}}}`, uri);
const missing = [...html.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1]);
if (missing.length) throw new Error(`no screenshot for: ${missing.join(', ')}`);

const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;

const b = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
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

const fonts = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
const imgs = await p.evaluate(() => [...document.images].map(i => ({ ok: i.complete && i.naturalWidth > 0, alt: i.alt.slice(0, 32) })));

await p.pdf({
  path: `${process.env.PROJ ?? '.'}/docs/Groundwork-Admin-Testing-Guide.pdf`,
  format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#82878B;padding:0 13mm;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;'
    + 'justify-content:space-between;">'
    + '<span>Groundwork by Jalla · Admin testing guide · 27 September 2026</span>'
    + '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: '13mm', right: '13mm', bottom: '15mm', left: '13mm' },
});

console.log('fonts:', [...new Set(fonts)].join(', ') || '(none)');
console.log('images:', imgs.filter(i => i.ok).length + '/' + imgs.length, 'loaded');
const broken = imgs.filter(i => !i.ok);
if (broken.length) console.log('BROKEN:', broken.map(i => i.alt));
console.log('console errors:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
