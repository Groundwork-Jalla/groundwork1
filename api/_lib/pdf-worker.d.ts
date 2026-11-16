// pdf.js ships no types for its worker build. Only this one export is needed, and it is
// handed straight back to pdf.js (see payment-receipt-reader.ts), never called here.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
