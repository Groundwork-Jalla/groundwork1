# Task: map contractor form enums to display labels before syncing to GoHighLevel

## Problem

Contractor applications submitted on the website are synced into GoHighLevel (GHL)
as contacts with custom fields. The sync passes raw form `value` strings straight
through instead of the human-readable `label`, so every field a person reads
renders as a machine token.

Confirmed by inspecting a synced contact in GHL on 10 Sep 2026:

| GHL custom field      | Stored value                          | Should read              |
|-----------------------|---------------------------------------|--------------------------|
| `role`                | `other`                               | the contractor's trade   |
| `years_experience`    | `y10`                                 | `10+ years`              |
| `concurrent_projects` | `two_three`                           | `2-3`                    |
| `regions`             | `Kribi,buea.limbe, l'ouest, ebolowa`  | `Kribi, Buea, Limbe, Ouest, Ebolowa` |

This surfaced while building a WhatsApp message template that merges
`{{contact.role}}` into the message body. The template would send
"Trade applied for: other" to a real contractor. The same fields are merged into
emails and documents elsewhere, so the blast radius is wider than one template.

## Scope

**In scope:** the transformation at the sync boundary — the point where an
application record is converted into a GHL contact payload.

**Explicitly NOT in scope:**

- Do not change the enum `value` strings in the form, the DB schema, or the
  application record. They are correct as stored keys and are used for
  filtering and matching. Only the outbound representation is wrong.
- Do not edit the WhatsApp template in GHL. It is already correct and is
  pending Meta review.

## Where to look

Names below are from conversation context and may be slightly off — locate the
real symbols first rather than trusting these verbatim.

- `_contractor-sync.ts`, function `buildContractorPayload` — builds the GHL
  contact payload. This is where the mapping belongs.
- The contractor application form component — declares the select options.
  Each option should already have both a `value` and a `label`.

## Required change

### 1. Single source of truth for options

The form's option arrays must be the only place labels are defined. Do **not**
hand-write a parallel lookup map inside the sync file — two lists will drift the
first time a trade is added.

If the option arrays are currently declared inline in the form component, lift
them into a shared module (e.g. `constants/contractor-options.ts`) and import
them from both the form and the sync.

### 2. Map value to label in the payload builder

```ts
import {
  ROLE_OPTIONS,
  EXPERIENCE_OPTIONS,
  PROJECT_OPTIONS,
  REGION_OPTIONS,
} from '@/constants/contractor-options'

type Option = { value: string; label: string }

const label = (opts: Option[], v?: string | null): string =>
  opts.find(o => o.value === v)?.label ?? ''

// inside buildContractorPayload
role: application.role === 'other'
  ? (application.role_other?.trim() || 'Other')
  : label(ROLE_OPTIONS, application.role),

years_experience: label(EXPERIENCE_OPTIONS, application.years_experience),
concurrent_projects: label(PROJECT_OPTIONS, application.concurrent_projects),
regions: (application.regions ?? [])
  .map(r => label(REGION_OPTIONS, r))
  .filter(Boolean)
  .join(', '),
```

### 3. Handle `other`

`role === 'other'` must fall back to the `role_other` free-text field. If that is
empty, emit `Other` rather than an empty string — an empty merge field fails at
send time in GHL, which has no fallback value mechanism for template variables.

### 4. Regions join

The observed value mixes a comma, a period, mixed case and inconsistent spacing
in one string. Investigate whether this is a bad join on a multi-select or
whether the option `value` strings themselves are inconsistent. Mapping to
labels and joining with `', '` should resolve it; verify against the actual
stored shape (array vs pre-joined string) before assuming.

### 5. Form-side validation

`role_other` is not currently enforced when `role === 'other'`. Make it required
in that case, client and server side.

## Backfill

Roughly 650 existing contacts in GHL carry the raw values. After the mapping
ships, backfill them. Prefer re-running the sync over the existing application
records if that path exists and is idempotent; otherwise export from GHL,
transform, re-import.

Do not backfill until the new mapping is verified on a fresh submission.

## Acceptance criteria

- [ ] A new contractor application appears in GHL with human-readable values in
      `role`, `years_experience`, `concurrent_projects` and `regions`.
- [ ] An application with `role = other` shows the contractor's typed trade, not
      the string `other`, and never an empty field.
- [ ] Labels are defined in exactly one module, imported by both form and sync.
- [ ] Enum values in the DB and application records are unchanged.
- [ ] Existing 650 contacts backfilled.
