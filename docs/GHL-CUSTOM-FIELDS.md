# GoHighLevel custom fields — contractor applications

Every field below is sent on every contractor application. **A field GHL does not have is
silently dropped** — no error, no warning, and on the contact it looks identical to a
question the applicant left blank. That is the single most misleading failure mode in this
integration, which is why this list exists.

Create them under **Settings → Custom Fields**, object **Contact**, with the exact key
spelling shown. Type is Text unless noted.

There are 104 in total. **Do not create all 104.** Tiers 1 and 2 are 24 fields and carry
almost everything you would actually open a contact to find out. Tier 3 is 64 fields whose
content is already readable in two summary fields you will have created in Tier 1.

---

## Tier 1 — create these first (20 fields)

Who the applicant is, whether they qualify, and where to read the rest.

| Key | Notes |
|---|---|
| `full_name` | |
| `first_name` | |
| `last_name` | |
| `business_name` | |
| `email` | |
| `phone` | |
| `country` | |
| `city` | |
| `role` | Their trade — e.g. `general_contractor` |
| `role_other` | Free text, only when role is "other" |
| `years_experience` | |
| `operates_as` | Registered business or individual |
| `team_size` | |
| `project_types` | Comma-separated |
| `regions` | |
| `concurrent_projects` | |
| `status` | Application status at the time of the push |
| `application_url` | **The deep link back to the full application. The most useful field here.** |
| `projects_summary` | Long text. Their whole project history in one field. |
| `documents_summary` | Long text. Every document, each with its link. |

## Tier 2 — the screening answers (4 fields)

The Section 6 standards. Worth having as their own fields because you will want to filter
and automate on them.

| Key | Notes |
|---|---|
| `accepts_milestones` | `Yes` / `No` |
| `accepts_verification` | `Yes` / `No` |
| `accepts_no_side_pay` | `Yes` / `No` |
| `agreed_to_terms` | `Yes` / `No` |

## Tier 3 — only if you need to filter on them (64 fields)

Everything here is *already legible* in `projects_summary` and `documents_summary`. Create
these only when you want GHL to filter, sort or trigger automation on an individual value —
a workflow that fires on `document_1_url` being present, say.

- `project_1_*` … `project_5_*` — `name`, `role`, `year`, `budget`, `location`,
  `ref_name`, `ref_email`, `ref_phone` (40 fields)
- `document_1_*` … `document_8_*` — `label`, `size`, `url` (24 fields)

## Tier 4 — bookkeeping (16 fields)

Useful for debugging, rarely for people.

`application_id`, `source`, `submitted_at`, `lang`, `tags_csv`, `upload_count`,
`project_count`, `portfolio_url`, `video_url`, `why_join`, `differentiator`,
`ready_for_early`, `cred_diaspora`, `cred_cnps`, `cred_taxId`, `cred_insurance`,
`cred_licence`

> The `cred_*` set changes with the applicant's credential track, so not every application
> fills every one. That is expected, not a fault.

---

## Checking your work

`/admin/applications/<id>` → **Send to CRM again**, then open the contact in GHL. Anything
you created appears; anything you did not is simply absent. Compare against this list rather
than against the contact, because an absent field and an empty one look the same.
