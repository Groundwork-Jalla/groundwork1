import { readSpreadsheetPreview } from './spreadsheet-preview';

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try { self.postMessage({ ok: true, preview: readSpreadsheetPreview(event.data.buffer) }); }
  catch { self.postMessage({ ok: false }); }
};
