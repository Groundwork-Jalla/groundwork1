# Project invitation links and observer identity

The review notes describe product observations. The user's direct clarification
sets the link behavior: **the first signed-in person to accept the link claims
it**. Acceptance also requires a confirmed account email, as with the existing
invitation flow. Creating a link does not sign anybody in.

## Review status

| Item | Status |
| --- | --- |
| Contractor stage-price edits, reflected across views | Already implemented as contractor proposals and client approval; see [stage pricing](stage-pricing-account-review.md) |
| Changes to the project total | Still require client approval, per the user's earlier decision; the original BOQ and amendment history remain recorded |
| Observer labels | Fixed in the chat participant roster, WhatsApp role vocabulary, project people summaries and pending invitation labels |
| Shareable project links as the primary invitation option | Implemented for the initial primary client, initial primary contractor and additional observers |
| Email invitations | Retained as a separate option; existing email invitations remain bound to the recipient address |
| Receipt currency and partial-payment behavior | Retained; confirmed receipts reduce balances and the contractor decides whether to proceed or request a top-up |
| Production receipt reading | Still needs deployment/configuration verification and actual receipt testing; see [receipt diagnostics](receipt-verification-errors.md) |
| Custom substage creation/editing | Remains queued for the future rollout previously requested |
| Follow-up testing meeting | Ruth's scheduling action; no meeting or external communication was created by this change |

## Sharing and accepting a link

In the project's Team section, use **Create project link**, check the displayed
role, then **Copy link**. The link can be shared through the inviter's chosen
channel. **Invite by email instead** opens the existing email form. Link creation
does not send an email or report that one was sent.

Links expire seven days after creation. The invitation card shows the expiry,
offers a manual-copy fallback if clipboard access fails, and provides **Refresh
invitation status**. Existing pending links remain available after reopening the
panel. A pending link can be removed using the invitation's existing Remove
control. Creating again while the same role's link is pending returns that link;
after acceptance, expiry or revocation a new invitation gets a different token.

The public preview identifies the project, inviter and intended role. It contains
no budget or receipt data and never consumes the link. The invitee can sign in or
create an account, including confirmation on another device. Only acceptance
claims the link. Once claimed, the server records the account and its verified
email on the actual project membership. The next account cannot claim it.

Same-account acceptance retries are idempotent, including a response lost after a
successful write. The onboarding continuation is cleared only after that session
can read the project through RLS. Permanently unavailable links are removed from
stored continuation so they cannot keep interrupting unrelated sign-ins. A
temporary connection/access error or an email-invitation account mismatch remains
retryable. Error messages and role explanations are available in English and
French.

## Roles and concurrency

Both primary project roles may invite observers. Only the primary client may
create the initial contractor link. The primary contractor of a contractor-created
project may create the initial client link. A link reserves its pending primary
role, including against the email invitation path. Established primary roles still
require Groundwork staff to change them. Existing participants cannot claim a
link to upgrade their own role.

An observer link grants the existing observer membership and read/conversation
permissions. It does not grant construction-evidence upload, receipt upload, work
approval, price editing or invitation rights. A global contractor who joins as an
observer is labelled Observer on that project.

Creation, acceptance, expiry cleanup and revocation use the existing project-row
lock. Competing acceptances are serialized before checking and writing the claim.
Expired primary links release their reservation, while accepted memberships remain
valid after the invitation's expiry. Revoking an accepted observer removes access;
accepted primary participants retain the existing staff-managed role rules.

The participant roster now includes accepted primary clients and observers,
excludes revoked invitations, and returns one role per account. A contractor who
created a project is labelled Contractor rather than Client. The primary client
label takes precedence over a legacy secondary contractor assignment. The roster
is available to actual project participants, staff and the service role.

## Release and verification

Apply preceding migrations in order, including
`20261113000100_stage_price_amendments.sql` for the previously implemented price
editor, then apply
[`20261113000200_project_invitation_links.sql`](../supabase/migrations/20261113000200_project_invitation_links.sql)
before releasing the updated application. This migration is transactional and
replay-safe. It does not change project budgets, stages, receipts or fees.

`node scripts/test-project-team.mjs` runs the actual migration twice against a
temporary PostgreSQL instance with real authenticated RLS. It covers email/link
coexistence, server-chosen identity, verified accounts, observer permissions,
primary-role reservations, expiry, cancellation, revocation, idempotent recovery,
immediate project visibility and independent-session two-account claim races for
all three invitation roles. UI/authentication tests cover primary link placement,
email separation, copy feedback/fallback, stale results and continuation handling.

Live acceptance should use separate client, contractor and observer accounts:
share one link with two signed-in accounts and verify that only its first
claimant joins; test a new signup; verify the same saved project total on both
primary views; approve a price amendment and confirm both views refresh; upload
real and unrelated receipt files after the Production reader is configured.
No production migration, deployment or live receipt-reading call was made by this
change.
