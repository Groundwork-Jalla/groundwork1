# Product review completion tracker

Scope: the 11 November working-session notes and transcript, plus the BOQ,
membership and cross-view financial requirements in this conversation. Meeting
notes are requirements evidence; they do not authorize sending meeting invites,
emailing participants, or deploying production changes.

Already implemented and retained:

- [x] Confirmed BOQ totals, native precision and saved FX; fee-free BOQ allocation
  across stages, preserving historical values and zero-weight stages.
- [x] Receipt-based actual payout totals, separate from planned stage amounts.
- [x] Sequential stage approval, next-stage receipt prompt and contractor acknowledgment.
- [x] Primary-client/contractor invitations, secondary observer restrictions,
  verified acceptance, role controls and recipient language.
- [x] Project Team tab with sharing moved out of Overview/Stages.

Remaining implementation and verification:

- [ ] Confirm building type can be corrected before project creation without changing a confirmed BOQ total.
- [ ] Match client fonts, green actions and progress colours to the contractor design.
- [ ] Remove site-preview/latest-project content from the project overview.
- [ ] Show USD equivalents alongside project-currency financial values.
- [ ] Use Approved/Approve updates for client sign-off; reserve Verified for independent verification.
- [ ] Replace idle flashing evidence cues with an explanation that contractor updates will appear there.
- [ ] Merge stage breakdown and payment timeline; distinguish scheduled values from actual receipts.
- [ ] Use consistent project timeline colours and preserve expected completion dates.
- [ ] Simplify dashboard: green hero/actions, keep other projects, remove cost allocation and Upload updates.
- [ ] Give filtered project lists accurate empty states, especially On hold.
- [ ] Hide the dashboard 2FA setup action while retaining account security settings.
- [ ] Hide unavailable video/resource categories.
- [ ] Preview Excel documents in the project, with bounded processing and readable sheets.
- [ ] Make actual documents openable and show only uploaded media/formally issued certificates.
- [ ] Restrict BQ editing to assigned contractors/admins while preserving client access to uploaded BOQ documents.
- [ ] Rename take-off actions to Edit bill of quantities and sharing to Share this project.
- [ ] Run meaningful client/contractor, BOQ, permission and document regressions; reconcile stale tests with agreed behaviour.
- [ ] Typecheck/build and document deployment prerequisites and any manual acceptance steps.

Production migrations and live account acceptance tests remain separate release
steps until actually executed. No external messages or production changes are
part of this local implementation.
