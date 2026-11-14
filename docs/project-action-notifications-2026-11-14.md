# Project action notifications and Back navigation

The sender-side role selector now also offers Family member as observer access.
Login/signup copy reads the invitation's role from the server; an invitee does not
choose their own project privileges. Signup/login/confirmation retain the original
project, including new users, existing accounts and blocked browser storage.

Meaningful project events notify accepted clients, primary/additional contractors,
observers and assigned active verifiers, normally excluding the actor. Events
include evidence/review/rework, receipt submission/decisions, price proposals/
decisions, payment plans, progression with a balance, membership, documents and
verification. Existing invitees receive an acceptance target before project access;
the accepting account receives a direct project-ready target. Creating a shared
link is not mislabeled as sending an email. Pending/revoked memberships and private
staff notes are excluded from the participant feed.

Notification clicks resolve current project membership, including account-role
corrections, and retain the project/stage/receipt/proposal/document/conversation/
message target. Work-review notices focus work rather than a payment card. The
UI waits for the requested stage/tab and asynchronous content before scrolling and
focusing the target. Clicking does not execute an approval or receipt decision.

The shared bell/list feed is account-scoped, refreshes inserts and read updates,
recovers missed realtime changes on focus/visible polling, counts all unread
records and permits loading older bell items. Fetch/read failures are explicit;
a read-status failure does not prevent opening the action. Late responses cannot
replace another account's feed or override a later notification click.

Back is now one role-aware document-navigation component across the client,
contractor, admin and verifier project views, their loading/error states and BOQ
screens. It has visible mobile text and a 44-pixel minimum tap area. Nested BOQ
returns retain their workspace/project tab. The Management enquiry page resolves
actual project membership for its return link. This strengthens the reported
navigation path; the original live click/Back failure is not claimed as reproduced.

## Release

Apply only unapplied prerequisites, then:

1. `20261114000400_project_invitation_role_selection.sql`
2. `20261114000500_project_action_notifications.sql`
3. Deploy the matching application.

Back navigation needs no separate database migration. Migration 005 adds the
notification event identity/audience and event triggers, repairs the public
notification RPC's sender/member boundary and publishes the notification table
for realtime where needed. It does not change prices, receipt amounts or project
work states, send emails or enable WhatsApp. Existing notification history remains.

Database regression fixtures exercise replay, real receipt/price/approval RPCs,
accepted/pending/revoked participants, observer destinations, exact entity IDs,
read isolation, duplicate prevention, private notes and forged sender/project
metadata. UI/unit checks cover invitation roles, family access, current-role
destinations, account/race isolation, unread counts and all four Back destinations.

Production release and the comprehensive controlled-account review remain
separate from these local checks. See
[the full meeting audit](meeting-implementation-audit-2026-11-14.md) and
[the workflow behavior reference](project-workflow-behaviour-2026-11-14.md).

Final local verification: 225 focused tests passed in 14 files, TypeScript checking
and the production build passed, and the isolated PostgreSQL payment/notification
regressions passed. The receipt checks also cover authorizing work from an already
confirmed receipt while a different receipt stays pending. The comprehensive live
acceptance requested by the user has not been run as part of these local checks.
