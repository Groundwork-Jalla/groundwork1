# GoHighLevel custom fields — contractor applications

*Originally written 26 Aug 2026 · Updated 20 Nov 2026*

> **Ownership note (Nov 2026):** Groundwork now owns product activation communications (direct Resend Day-0 Welcome & Project Activation emails, `/admin/sequences` reminders, and Meta WhatsApp Cloud API). GoHighLevel remains the CRM for contractor applications, acquisition/sales pipelines, and optional contact mirroring. See [`docs/GHL-SETUP.md`](GHL-SETUP.md) and `api/_lib/communication-ownership.ts`.

Every contractor application pushed to GoHighLevel sends a structured payload defined in `api/ghl/_contractor-payload.ts`. **A custom field key that does not exist in GHL is silently dropped** — it looks identical to a blank answer on the contact.

---

## Fastest way to set up: Auto-create from Admin

You do **not** need to create these ~99 fields by hand anymore:

1. Open **`/admin/crm`** (uses `api/_handlers/crm-fields.ts`).
2. Click **Check / Create missing fields**.
3. Groundwork reads the exact live list from `contractorFieldKeys()` in `api/ghl/_contractor-payload.ts` and creates any missing Contact custom fields in GHL automatically.

---

## CRITICAL: Do NOT create native GHL fields as custom fields

An earlier August 2026 version of this doc mistakenly listed native contact fields in Tier 1. **Never create these 8 fields as custom fields** — `api/ghl/_contractor-payload.ts` (`NATIVE_CONTACT_FIELDS`) deliberately strips them from custom fields and sends them on top-level GHL Contact fields instead:

- `full_name`, `first_name`, `last_name`, `email`, `phone`, `country`, `city`, `source`

Creating duplicate custom fields named `phone`, `email`, or `city` in GHL breaks GHL SMS/WhatsApp workflows and contact deduplication.

---

## Custom field groups (`contractorFieldKeys()` — 99 custom fields)

Note: Enum values such as `role`, `operates_as`, `team_size`, `years_experience`, `project_types`, and screening answers are sent as **human-readable translated labels** (e.g., `"General Contractor"` / `"Entrepreneur général"`), not raw enum slugs.

### Tier 1 — Core application fields (13 fields)

| Key | Notes |
|---|---|
| `business_name` | Company / business name |
| `role` | Translated trade label (or `role_other` text when "other") |
| `role_other` | Free text when role is "other" |
| `years_experience` | Human-readable range |
| `operates_as` | Registered business or individual |
| `team_size` | Human-readable team size |
| `project_types` | Comma-separated human-readable types |
| `regions` | Free-text regions served |
| `concurrent_projects` | Capacity |
| `status` | Application status at push time |
| `application_url` | Deep link to `/admin/applications/:id` |
| `projects_summary` | Long text summary of past projects |
| `documents_summary` | Long text list of uploaded documents with links |

### Tier 2 — Screening & party fields (5 fields)

| Key | Notes |
|---|---|
| `accepts_milestones` | `Yes` / `No` |
| `accepts_verification` | `Yes` / `No` |
| `accepts_no_side_pay` | `Yes` / `No` |
| `agreed_to_terms` | `Yes` / `No` |
| `groundwork_party` | `'Contractor'` |

### Tier 3 — Expanded project & document rows (64 fields)

All of this is already summarized in `projects_summary` and `documents_summary`; individual keys exist for filtering/automation:

- `project_1_*` … `project_5_*` — `name`, `role`, `year`, `budget`, `location`, `ref_name`, `ref_email`, `ref_phone` (40 fields)
- `document_1_*` … `document_8_*` — `label`, `size`, `url` (24 fields)

### Tier 4 — Bookkeeping & credential track fields (17 fields)

- Metadata (8): `application_id`, `submitted_at`, `lang`, `tags_csv`, `upload_count`, `project_count`, `portfolio_url`, `video_url`, `why_join`, `differentiator`, `ready_for_early`
- Credential track (`CRED_KEYS`, **all lowercase** — GHL rejects camelCase keys):
  `cred_avgproject`, `cred_diaspora`, `cred_diasporaproperty`, `cred_legalservices`, `cred_paymentstructure`, `cred_services`, `cred_software`, `cred_tradeprojects`, `cred_workstyle`

> Different applicant tracks fill different subsets of `cred_*`; blank values on unrelated tracks are expected.

---

## Checking your work

1. Run **Check / Create missing fields** in `/admin/crm`.
2. Open any application at `/admin/applications/<id>` and click **Send to CRM again**.
3. Open the contact in GHL and verify the fields populated. Toggle **"Hide empty fields"** in GHL's contact detail pane to hide unrelated sub-account fields from other funnels.

**Match on the key, not the label.** Two GHL fields can share the display label `"Language"` while only the one with key `lang` receives Groundwork's value.
