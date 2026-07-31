import type { Lang } from './types';

// =========================================================
// Externally-hosted forms (GoHighLevel / LeadConnector)
//
// IMPORTANT — why this file exists:
// The contractor application form is an <iframe> served from
// api.leadconnectorhq.com. That is a DIFFERENT ORIGIN from this app, so the
// browser's same-origin policy makes its contents completely unreachable from
// our JavaScript. We cannot read, rewrite, or translate a single word inside
// it — not with a library, not with a script, not at all.
//
// The only way to show a French application form is to build a French version
// INSIDE GoHighLevel and embed that one instead.
//
// ─── HOW TO FINISH THIS (≈15 min in the GHL dashboard) ───────────────────
//   1. GHL → Sites → Forms → open "Contractor Form"
//   2. "..." menu → Duplicate. Name it "Contractor Form — FR"
//   3. Translate every field label, placeholder, option, button, help text,
//      validation message, and the post-submit thank-you screen
//   4. Save, then Integrate/Embed and copy the new form ID out of the embed
//      URL (the segment after /widget/form/)
//   5. Paste it into GHL_CONTRACTOR_FORM.fr.id below and delete `fallback: true`
//
// Until step 5 is done, French visitors are shown the English form together
// with a visible notice telling them it is only available in English — which
// is honest, rather than silently pretending the toggle worked.
// =========================================================

export interface ExternalFormConfig {
  /** GHL form ID — the path segment after /widget/form/ */
  id: string;
  /** Pixel height GHL reports for this form. */
  height: number;
  /** True while this locale is still pointing at another language's form. */
  fallback?: boolean;
}

export const GHL_FORM_BASE = 'https://api.leadconnectorhq.com/widget/form';
export const GHL_EMBED_SCRIPT = 'https://link.msgsndr.com/js/form_embed.js';

export const GHL_CONTRACTOR_FORM: Record<Lang, ExternalFormConfig> = {
  en: {
    id: 'v5Ezo83OmYTlfxka9UAK',
    height: 1078,
  },
  fr: {
    // ⬇︎ REPLACE with the duplicated French form's ID, then remove `fallback`.
    id: 'v5Ezo83OmYTlfxka9UAK',
    height: 1078,
    fallback: true,
  },
};

/** Resolve the form config for a language, and whether it's a fallback. */
export function getContractorForm(lang: Lang): ExternalFormConfig {
  return GHL_CONTRACTOR_FORM[lang] ?? GHL_CONTRACTOR_FORM.en;
}

/**
 * Build the iframe src. GHL ignores unknown query params, so passing the
 * locale is harmless and gives their side something to key off if they ever
 * add native localisation.
 */
export function buildFormUrl(lang: Lang): string {
  const { id } = getContractorForm(lang);
  return `${GHL_FORM_BASE}/${id}?locale=${lang}`;
}
