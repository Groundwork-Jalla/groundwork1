# Contractor connection before client payments

Philip’s 16 November review corrects the assumption that a client already has a contractor when creating a project.

The client Dashboard, project Overview and Stages now offer **Invite your contractor** or **Let Jalla help you find a contractor** before payment. The invite opens that project’s Team panel with Contractor selected. A pending invitation shows its current state and can be reopened and shared. The Jalla option saves a real, project-linked Admin Support ticket, alerts admins and schedules the enabled support acknowledgement through the existing communication controls. Open requests are reused instead of duplicated.

Only an accepted primary contractor with an identified user on this project satisfies the connection gate. Once connected, client-origin work retains its funding-first cycle; contractor-origin work retains evidence → client approval → payment for the reviewed stage. Receipt decisions, partial balances, custom installments, stage prices and progression permissions retain their existing rules.

No-connection screens suppress payment forms. The server separately blocks receipt-reader reservations, new receipt records and new payment plans without a primary contractor. A stale screen or direct RPC cannot submit them. Existing receipt history and completed stage values are retained if a contractor is removed.

## Release

Apply after the existing November payment, invitation, support and communication migrations:

1. `supabase/migrations/20261116000000_contractor_before_payment.sql`
2. `supabase/migrations/20261116000100_project_contractor_matching.sql`
3. Deploy the matching application.

Both migrations can be rerun. They do not modify existing money, appoint contractors, change historical stages or enable communication delivery. Unknown/missing connection capabilities keep payment controls closed. Existing email/WhatsApp pauses and audience settings remain authoritative. The new brand green is still awaiting Philip’s exact colour code.

## Validation

Focused component/API tests exercise missing, pending, secondary and accepted-primary memberships, correct project invitation routing, durable help-request status, failures, duplicate clicks, project switching and read-only historical receipts after removal. Isolated local PostgreSQL regressions exercise actual payment RPC refusal and rollback, primary-contractor acceptance, project-scoped support requests, admin notifications, communication scheduling, permissions and migration replay. Existing funding-first and evidence-first paths remain covered.

The updated communication/payment use-case document and PDF include the connection step. Deployed acceptance testing still needs a controlled client project without a contractor, an invitation acceptance and an Admin Support follow-up.
