# WhatsApp English Template Troubleshooting (Internal Engineering Reference)

> **Audience:** Engineering & Meta Business Manager admins only — kept separate from the team operations guide (`docs/whatsapp-templates-guide.pdf`).

---

## 1. Why English Templates Get Declined or Flagged `MISSING_OR_CHANGED`

1. **Exact String Matching (`MISSING_OR_CHANGED`)**:
   - Groundwork's **Check connection** compares Meta's `APPROVED` template character-for-character against the corresponding row in `public.lifecycle_sequence_steps` (template name, language code `'en'` — never `'en_US'`, exact `BODY.text`, `FOOTER.text = 'Reply STOP to stop reminders.'`, and `BUTTONS` URL + label).
   - **Current remaining item (`groundwork_cl09` / `en`)**: 85 of 86 templates are `APPROVED`; `groundwork_cl09` (`en`) shows `MISSING_OR_CHANGED` because the copy saved in `lifecycle_sequence_steps` (`code = 'CL09'`) does not yet match the version submitted in Meta.
2. **Promotional / Social-Proof Claims Inside `UTILITY` Templates**:
   - Meta rejects or reclassifies `UTILITY` templates that pitch benefits or referrals (e.g., `groundwork_cs12` P.S. claiming higher referrals).
3. **Grammar & Dangling Variables**:
   - Missing articles or subject-verb mismatches (`"what your client see"` → `"what your client sees"`, `"view project"` → `"view the project"`).
   - Variables at the very start or end of a body are automatically guarded by `channelBody()` in `shared/whatsapp.ts`.
4. **Category Reclassification (`UTILITY` → `MARKETING`)**:
   - Templates reclassified to `MARKETING` still deliver normally once approved. All language siblings of a template name must share one Meta category.

---

## 2. Recommended Compliant English Rewrites

### `groundwork_cl09` (`en`) — Match Approved French Sibling (Zero Variables, Clean Utility)
```text
Hello,

We have received your request for help finding a contractor. The Groundwork team will review your project needs and follow up with you on the next steps.
```

### `groundwork_cs12` (`en`) — Remove Promotional P.S. + Fix Grammar
```text
Hi {{1}},

Your project is not connected to a Homeowner yet. If you need help sending the invitation or getting them set up on Groundwork, reply to this message and our team will assist.
```

### `groundwork_cs09` (`en`) — Fix Grammar + Keep Transactional Tone
```text
Hi {{1}},

{{2}} has been created in Groundwork.

Your next step is to invite the Homeowner. Once connected, they can view the project details, milestones, documents, and updates you share. You control what is shared.
```

### `groundwork_iv01` (`en`) — Fix Missing Article
```text
Hi {{1}},

{{2}} has invited you to join {{3}} on Groundwork by Jalla.

Accept the invitation to view the project details, documents, milestones, and updates shared with you. If you already have an account, sign in. If you are new, create your account to view the project.
```

---

## 3. Step-by-Step SOP: Fixing a Declined / Mismatched Template

1. Open **Meta Business Suite → WhatsApp Manager → Account tools → Message templates** (WABA ID `1087160260359893`) and check status + exact language code (`en`, not `en_US`).
2. Update the matching step in **Groundwork Admin → Sequences** (`/admin/sequences`) **FIRST** so Groundwork's stored wording matches Meta byte-for-byte.
3. Submit/update the exact wording in Meta (footer `Reply STOP to stop reminders.`, URL button `https://www.tryjalla.com/{{1}}`).
4. Once Meta shows **APPROVED**, open **Groundwork Admin → Inbox → WhatsApp → Connection settings** and click **Check connection** to refresh status to `APPROVED`.
