// Print the standalone guide with installed Chrome. No downloads or external page requests.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, 'Groundwork-Project-and-Payment-Flow-Guide-2026-11-14.html');
const output = resolve(here, 'Groundwork-Project-and-Payment-Flow-Guide-2026-11-14.pdf');
const profile = mkdtempSync(resolve(tmpdir(), 'groundwork-flow-pdf-'));
const browser = spawn('/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-extensions', '--disable-sync', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let buffer = '', lastId = 0, stderr = '';
const pending = new Map();
const pipeError = error => {
  for (const wait of pending.values()) { clearTimeout(wait.timer); wait.reject(new Error(`Chrome connection failed: ${error.message}. ${stderr}`)); }
  pending.clear();
};
browser.on('error', pipeError);
browser.stdio[3].on('error', pipeError);
browser.stdio[4].on('error', pipeError);
browser.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw), wait = pending.get(message.id);
    if (!wait) continue;
    pending.delete(message.id); clearTimeout(wait.timer);
    message.error ? wait.reject(new Error(message.error.message)) : wait.resolve(message.result);
  }
});
browser.on('exit', code => {
  for (const wait of pending.values()) { clearTimeout(wait.timer); wait.reject(new Error(`Chrome exited (${code}): ${stderr}`)); }
  pending.clear();
});
function call(method, params = {}, sessionId) {
  const id = ++lastId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
try {
  await call('Browser.getVersion');
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params = {}) => call(method, params, sessionId);
  await page('Page.enable');
  await page('Network.enable');
  await page('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  await page('Emulation.setEmulatedMedia', { media: 'print' });
  const { frameTree } = await page('Page.getFrameTree');
  await page('Page.setDocumentContent', { frameId: frameTree.frame.id, html: readFileSync(source, 'utf8') });
  await page('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
  const { result } = await page('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('.page')].map((node, index) => ({page:index+1, title:node.querySelector('h1').innerText, height:node.clientHeight, used:node.scrollHeight, width:node.clientWidth, usedWidth:node.scrollWidth})))`, returnByValue: true });
  const layout = JSON.parse(result.value);
  const overflow = layout.filter(row => row.used > row.height + 2 || row.usedWidth > row.width + 2);
  writeFileSync(resolve(tmpdir(), 'groundwork-flow-guide-layout.json'), JSON.stringify(layout, null, 2));
  if (overflow.length) throw new Error('Page overflow: ' + JSON.stringify(overflow));
  const printed = await page('Page.printToPDF', {
    printBackground: true, displayHeaderFooter: true, preferCSSPageSize: true,
    generateTaggedPDF: true, generateDocumentOutline: true,
    paperWidth: 210 / 25.4, paperHeight: 297 / 25.4,
    marginTop: 15 / 25.4, marginRight: 16 / 25.4, marginBottom: 18 / 25.4, marginLeft: 16 / 25.4,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-family:Arial,sans-serif;font-size:8px;color:#65786c;display:flex;justify-content:space-between;width:100%;padding:0 16mm"><span>Groundwork by Jalla · Project &amp; payment flow · 14 November 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  writeFileSync(output, Buffer.from(printed.data, 'base64'));
  console.log(JSON.stringify({ output, pages: layout.length, pageOverflow: overflow.length }));
  await call('Browser.close');
} finally {
  browser.kill();
  await new Promise(resolve => setTimeout(resolve, 300));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
