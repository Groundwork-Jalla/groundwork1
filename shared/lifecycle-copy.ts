// Pure lifecycle copy and timing shared by the worker and Admin previews.

export interface Person {
  email: string;
  fullName?: string | null;
  phone?: string | null;
  lang?: string | null;
}

export interface Step {
  position: number;
  delay_hours: number;
  channel: 'email' | 'whatsapp';
  code?: string;
  subject_en: string; subject_fr: string;
  body_en: string; body_fr: string;
  cta_key?: string; cta_label_en?: string; cta_label_fr?: string;
}

/** What a message can say about the project and the other party. Stored on the enrolment. */
export interface Context {
  project_id?: string;
  project_name?: string;
  client_name?: string;
  contractor_name?: string;
  invite_path?: string;
  entry_source?: string;
  recipient_role?: string;
  anonymous_invitation?: boolean;
}

export function pickLang(lang: string | null | undefined): 'en' | 'fr' {
  return String(lang ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const firstOf = (name: string | null | undefined) => {
  const n = (name ?? '').trim();
  return n && !n.includes('@') ? n.split(/\s+/)[0] : '';
};

/**
 * {{first_name}}, {{name}}, {{email}} and, from the enrolment context, {{project_name}},
 * {{client_name}}, {{contractor_name}}, {{client_first_name}}, {{contractor_first_name}}.
 * Missing names use the copy's language; unknown tags are blanked, never printed.
 */
export function render(text: string, p: Person, ctx: Context = {}, lang: 'en' | 'fr' = 'en'): string {
  const name = (p.fullName ?? '').trim();
  const vars: Record<string, string> = {
    first_name: firstOf(name) || (lang === 'fr' ? 'à vous' : 'there'),
    name,
    email: p.email,
    project_name: ctx.project_name ?? (lang === 'fr' ? 'votre projet' : 'your project'),
    client_name: ctx.client_name ?? (ctx.anonymous_invitation ? (lang === 'fr' ? 'votre client' : 'your client') : ''),
    contractor_name: ctx.contractor_name ?? (ctx.anonymous_invitation ? (lang === 'fr' ? 'votre entrepreneur' : 'your contractor') : ''),
    client_first_name: firstOf(ctx.client_name) || (lang === 'fr' ? 'votre client' : 'there'),
    contractor_first_name: firstOf(ctx.contractor_name) || (lang === 'fr' ? 'votre entrepreneur' : 'there'),
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

export function copyFor(step: Step, lang: string | null | undefined, p: Person, ctx: Context = {}) {
  const french = pickLang(lang) === 'fr';
  const field = (english: string, translated: string | undefined) => {
    const useFrench = french && !!translated?.trim();
    return render(useFrench ? translated! : english, p, ctx, useFrench ? 'fr' : 'en');
  };
  return {
    subject: field(step.subject_en, step.subject_fr),
    body: field(step.body_en, step.body_fr),
    cta: field(step.cta_label_en ?? '', step.cta_label_fr),
  };
}

/** Where the button on a step takes the reader. Always the exact unfinished screen. */
export function ctaPath(key: string | undefined, ctx: Context): string | null {
  const pid = ctx.project_id;
  const contractor = ctx.recipient_role === 'contractor';
  switch (key) {
    case 'onboarding': return '/work/onboarding';
    case 'create_project': return '/projects/new';
    case 'invite_client': return pid ? `/work/projects/${pid}?tab=people` : '/work/projects';
    case 'connect_contractor': return pid ? `/projects/${pid}?tab=team` : '/dashboard';
    case 'open_project':
      return pid ? (contractor ? `/work/projects/${pid}` : `/projects/${pid}`) : (contractor ? '/work' : '/dashboard');
    case 'invitation': return ctx.invite_path || (contractor ? '/work' : '/dashboard');
    case 'manage_invitation': return pid ? (contractor ? `/work/projects/${pid}?tab=people` : `/projects/${pid}?tab=team`) : (contractor ? '/work/projects' : '/projects');
    default: return null;
  }
}

/** Delays are stored between messages; the schedule is measured from stage entry. */
export function stepTimeline<T extends Pick<Step, 'position' | 'delay_hours'>>(steps: readonly T[]) {
  let elapsed = 0;
  return [...steps].sort((a, b) => a.position - b.position).map(step => {
    elapsed += step.delay_hours;
    return { step, hoursFromEntry: elapsed };
  });
}
