# 15 November Product Session — implementation review

Reviewed against the supplied recording transcript and the repository on 16 November 2026. The recording's observations are evidence to investigate; the summary is not a new permission to send messages, distribute credentials or change production account roles.

## Findings and changes

| Item | Finding | Result |
| --- | --- | --- |
| Link creation returns to an earlier screen | Realtime invitation INSERT cleared the sender's project permissions during a refresh. Parent components then unmounted the sharing panel. The API wrapper also discarded the returned token and required another read before showing a URL. | Keep the panel mounted for INSERT refreshes; UPDATE/DELETE still close prior grants immediately. Return and display the server-issued link while the list refreshes. Preserve the selected role during a temporary read. |
| Refresh invitation status | The handlers already called the real invitation and permission reads; it was not a placeholder in the reviewed code. It lacked a tracked pending state. | Add guarded refresh state and a loading label; refresh accepted/pending rows without generating another link. |
| Equal installment halves | Database and UI already accepted a custom first amount. There was no percentage input; the equal-halves fixture/default example could be mistaken for a requirement. | Add explicit Amount/Percentage selection. Compute the first amount and exact remainder with integer decimal arithmetic; keep the existing contractor approval and second confirmation. No financial schema change. |
| Receipt text is too dense | Saved conversion source, dates and both currency legs were shown for every receipt. | Put those unchanged details inside View conversion details. Amounts and review actions remain visible. The explicit progression-with-balance notice is emphasized. Final wording remains a team review item. |
| Receipt after progression has no notification | The current notification trigger emits on every receipt INSERT without excluding complete stages. Both recent sampled receipts had submission notices; that sample does not establish historical event order. | Add a real PostgreSQL regression for work approval, partial receipt, explicit override, next stage opening, late old-stage receipt, exact contractor notification and later money confirmation. It verifies the remaining balance and next stage are preserved. Do not add a duplicate notification sender without reproducing a missing database event. |
| Role-change email missing | Already implemented by the 15 November role-notification migration and transactional worker. The live queue exists and had one provider-accepted send with no recorded queue error. | Existing English/French role notice and onboarding/project destinations retain their tests. Actual inbox delivery still needs controlled confirmation. |
| Welcome email missing during call | Live activation delivery remains paused, with no controlled email cohort or default staff owner configured. Supabase account confirmation is separate. | Document the enabling/test steps; do not turn on wider delivery as a side effect of a code review. |
| Full communication-use-case document | Needed by the team to test scenarios consistently. | [Communication and payment use cases](communication-use-cases-2026-11-16.md) and the [nine-page PDF](communication-use-cases-2026-11-16.pdf), including independent/invited clients and contractors, no-project choices, partner applications, replies, staff follow-up, role corrections and payment edge cases. |

## Decisions preserved from the transcript and chat

- Contractors upload construction evidence; clients review it.
- Contractor-created projects use evidence, client approval and payment for that reviewed stage. Client-created projects start their eligible paid stage with funding.
- Full payment or two installments can each involve multiple receipts. A receipt is checked against its own entered amount and currency, not a forced half-stage value.
- Money confirmation, work authorization and progression authorization remain separate decisions.
- Flags and outstanding decisions do not automatically authorize progression. The recording's explicit contractor override is a separate reviewed action; it leaves pending receipts unconfirmed and the debt payable.
- BOQ totals and agreed prices remain common across views; previous money and work history are retained.
- Account-role changes do not replace another primary project contractor or turn observers into approval/payment actors.
- The notes' “Zaf” means XAF, as already clarified by the owner.
- The notes' “0/3/7” wording is not an explicit cancellation of the previously agreed Day-1 reminder. Review the actual saved Journeys preview before testing the cadence.

## Files and verification

The invitation changes are in `ProjectSharing`, `ShareProject`, `ContractorInvite`,
`ProjectInvitationLink`, `useProjectTeamAccess` and the link RPC wrapper. The
percentage change uses `installment-split.ts` and `StagePaymentPlanPanel`.
`ExchangeRateNote` retains the existing saved rates behind an expandable disclosure.

Focused tests cover role preservation during refresh, immediate display of returned
links, all three invitation roles, refresh acceptance, denied permissions, custom
percentage arithmetic, unchanged amount-mode plans and plan confirmations. Existing
conversion tests continue to check original amounts, source/date and both locales.
The payment database fixture tests the actual late-receipt case using an isolated
local PostgreSQL instance. No live receipt, invitation or email was submitted by
these tests.

Validation passed: **282 focused tests across thirteen files**, type checking and
the production build. After the last percentage-validation/preview adjustment,
the **28 installment calculation and screen tests** and the production build passed
again. The isolated payment database suite passed with the new late-receipt case.
The PDF was checked for readable layout and text coverage.

No new migration is required for these code changes. Commit/deploy the matching
application and run the controlled acceptance cases. Passing local tests and a
provider-accepted role email do not establish complete real-world delivery.

## Team follow-ups

Ruth's final receipt copy, the private test-account handover, the agreed review call
and actual cohort delivery/reply results remain operational follow-ups. No survey,
meeting scheduling or team message was sent from the attached notes.
