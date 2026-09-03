import { handler as crmUser }     from './_handlers/user.js';
import { handler as crmProject }  from './_handlers/project.js';
import { handler as crmResync }   from './_handlers/resync-application.js';
import { handler as crmRetry }    from './_handlers/retry.js';
import { handler as crmInbound }  from './_handlers/inbound.js';
import { handler as profileGeo }  from './_handlers/profile-geo.js';
import { handler as crmStatus }   from './_handlers/crm-status.js';
import { handler as crmDiagnose } from './_handlers/crm-diagnose.js';
import { handler as crmFields } from './_handlers/crm-fields.js';
import { handler as crmAudit } from './_handlers/crm-audit.js';
import { handler as crmDelivery } from './_handlers/conversation-delivery.js';
import { handler as crmOauth } from './_handlers/crm-oauth.js';
import { handler as crmBackfill } from './_handlers/crm-backfill.js';
import { handler as crmEmailTest } from './_handlers/crm-email-test.js';

/**
 * One endpoint, several actions.
 *
 * ── Why this exists, so nobody "tidies" it back apart ────────────────────────────────
 * Vercel counts every file under `api/` as a separate serverless function, and the Hobby
 * plan allows **12**. Each of the actions below used to be its own file. Adding them took
 * the project from 10 functions to 17, and *every deployment failed* from that moment —
 * silently, as far as the app was concerned. Production simply froze on the last good
 * build for a day while fixes were merged, pushed, and never shipped. Two separate bugs
 * were chased for hours that were both already fixed in code.
 *
 * So: entry points are the scarce resource, not files. The handlers still live one per
 * file under `_handlers/`, which Vercel does not count because of the underscore. This
 * file is only a switchboard.
 *
 * **Before adding a new file under `api/`, count them.** `find api -name '*.ts' ! -name
 * '_*.ts'` must stay at 12 or below, or nothing deploys at all. Prefer a new action here.
 * The other way out is the Pro plan, which lifts the cap.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────────────
 * Deliberately none at this layer. Each action authenticates differently — a bearer
 * token, an admin check, a shared secret for GHL's inbound calls — and collapsing that
 * into one gate here would be how the weakest one becomes everyone's. The dispatcher
 * routes; the handlers decide.
 */

type Action =
  | 'crm-user' | 'crm-project' | 'crm-resync' | 'crm-retry' | 'crm-inbound'
  | 'crm-status' | 'crm-diagnose' | 'crm-fields' | 'crm-audit' | 'crm-email-test' | 'crm-delivery' | 'crm-oauth' | 'crm-backfill'
  | 'profile-geo';

const ROUTES: Record<Action, (req: any, res: any) => Promise<void>> = {
  'crm-user':    crmUser,
  'crm-project': crmProject,
  'crm-resync':  crmResync,
  'crm-retry':   crmRetry,
  'crm-inbound': crmInbound,
  'crm-status':  crmStatus,
  'crm-diagnose': crmDiagnose,
  'crm-fields': crmFields,
  'crm-audit': crmAudit,
  'crm-delivery': crmDelivery,
  'crm-oauth': crmOauth,
  'crm-backfill': crmBackfill,
  'crm-email-test': crmEmailTest,
  'profile-geo': profileGeo,
};

export default async function handler(req: any, res: any) {
  // Accepted from the query as well as the body: GHL's outbound webhook builder can set
  // a URL but not always a body field, and its calls have to reach `crm-inbound`.
  const fromQuery = typeof req.query?.action === 'string' ? req.query.action : undefined;
  const fromBody  = typeof req.body?.action === 'string' ? req.body.action : undefined;
  const action = (fromQuery ?? fromBody) as Action | undefined;

  if (!action || !(action in ROUTES)) {
    res.status(400).json({
      error: 'Unknown action',
      actions: Object.keys(ROUTES),
    });
    return;
  }

  return ROUTES[action](req, res);
}
