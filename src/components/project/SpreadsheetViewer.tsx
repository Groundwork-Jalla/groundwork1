import { useEffect, useId, useState } from 'react';
import { useT } from '@/lib/i18n';
import { MAX_FILE_BYTES } from '@/lib/documents/accepted-files';
import type { SpreadsheetPreview } from '@/lib/documents/spreadsheet-preview';

const PARSE_TIMEOUT = 12_000;
function column(index: number): string {
  let value = index + 1, label = '';
  while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return label;
}

/** Bounded download as well as bounded rendering; parsing stays off the UI thread. */
async function download(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('download_failed');
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('file_size');
    return buffer;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FILE_BYTES) throw new Error('file_size');
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes.buffer;
}

export function SpreadsheetViewer({ url }: { url: string }) {
  const t = useT(); const id = useId();
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  const [state, setState] = useState<{ url: string; status: 'loading' | 'ready' | 'error'; preview?: SpreadsheetPreview }>({ url, status: 'loading' });
  useEffect(() => {
    let active = true, worker: Worker | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(); worker?.terminate();
      if (active) setState({ url, status: 'error' });
    }, PARSE_TIMEOUT);
    setState({ url, status: 'loading' }); setSelected(0);
    void download(url, controller.signal).then(buffer => {
      if (!active || controller.signal.aborted) return;
      worker = new Worker(new URL('../../lib/documents/spreadsheet.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ ok: boolean; preview?: SpreadsheetPreview }>) => {
        clearTimeout(timer); worker?.terminate();
        if (active) setState(event.data.ok && event.data.preview?.sheets.length
          ? { url, status: 'ready', preview: event.data.preview } : { url, status: 'error' });
      };
      worker.onerror = () => { clearTimeout(timer); worker?.terminate(); if (active) setState({ url, status: 'error' }); };
      worker.postMessage({ buffer }, [buffer]);
    }).catch(() => { clearTimeout(timer); if (active) setState({ url, status: 'error' }); });
    return () => { active = false; clearTimeout(timer); controller.abort(); worker?.terminate(); };
  }, [url, attempt]);
  const status = state.url === url ? state.status : 'loading';
  const sheet = status === 'ready' ? state.preview?.sheets[selected] : null;
  if (status === 'loading') return <p role="status" className="p-6 text-sm text-brand-mid-grey">{t('common.loading')}</p>;
  if (status === 'error') return <div role="alert" className="p-6 text-center">
    <p className="text-sm text-brand-mid-grey">{t('project.review.spreadsheetFailed')}</p>
    <button type="button" className="mt-3 text-sm font-semibold text-brand-green underline" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button>
  </div>;
  return <div className="flex h-full min-h-0 w-full flex-col">
    <div role="tablist" aria-label={t('project.review.sheets')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-brand-border-grey p-2">
      {state.preview?.sheets.map((tab, index) => <button key={index} type="button" role="tab" id={`${id}-${index}`} aria-selected={selected === index}
        aria-controls={`${id}-grid`} onClick={() => setSelected(index)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${selected === index ? 'bg-brand-green text-white' : 'text-brand-mid-grey'}`}>{tab.name}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-grid`} aria-labelledby={`${id}-${selected}`} className="min-h-0 flex-1 overflow-auto bg-white dark:bg-[#1e1e1e]">
      {!sheet?.rows.length ? <p className="p-6 text-sm text-brand-mid-grey">{t('project.review.emptySheet')}</p>
        : <table className="border-collapse text-left text-xs text-brand-near-black dark:text-white">
          <thead className="sticky top-0 bg-brand-off-white dark:bg-[#252525]"><tr><th className="border border-brand-border-grey px-3 py-2">#</th>
            {Array.from({ length: sheet.columns }, (_, index) => <th key={index} scope="col" className="min-w-28 border border-brand-border-grey px-3 py-2 font-mono">{column(index)}</th>)}
          </tr></thead>
          <tbody>{sheet.rows.map((row, index) => <tr key={index}>
            <th scope="row" className="sticky left-0 border border-brand-border-grey bg-brand-off-white px-3 py-2 font-mono text-brand-mid-grey dark:bg-[#252525]">{index + 1}</th>
            {Array.from({ length: sheet.columns }, (_, col) => <td key={col} className="max-w-96 whitespace-pre-wrap break-words border border-brand-border-grey px-3 py-2 font-mono">{row[col] ?? ''}</td>)}
          </tr>)}</tbody>
        </table>}
    </div>
    <footer className="shrink-0 border-t border-brand-border-grey p-3 text-xs text-brand-mid-grey">
      {state.preview?.truncated && <p>{t('project.review.spreadsheetTruncated')}</p>}
      <p>{t('project.review.savedValues')}</p>
    </footer>
  </div>;
}
