# Groundwork communication and payment use cases

Prepared for review after the 15 November Product Session and updated for Philip’s 16 November contractor-connection correction. Date: 16 November 2026, Malaysia time. This describes the expected product behavior and a controlled test plan. It does not claim that every real email or WhatsApp message has been delivered.

## 1. What this framework does

Groundwork decides the person's next unfinished action, schedules the appropriate message, records delivery and replies, and gives the team a follow-up queue. Admin controls the framework. Resend transports email; Meta transports WhatsApp. This is separate from the on-screen walkthrough.

There are four primary activation journeys and sixteen sequence branches. The independent journeys lead a user toward their own project; the invited journeys lead them into the existing project. An observer or family member does not count as the primary client accepting a project.

The saved sequences determine the schedule. The established reminder points include the immediate acknowledgement and Day 1, Day 3 and Day 7. The meeting's shorthand “0/3/7” does not explicitly cancel the previously agreed Day-1 reminder. Admin's Journeys preview shows the actual timing for each branch. Reminders are measured from entry into the current unfinished step, rather than restarting from signup for every subsequent action.

Completing the requested action stops that action's reminders. A new milestone can begin a new sequence. Clicking an email, receiving an email, opening a project or logging a staff call does not by itself complete an unfinished onboarding, project or invitation action.

## 2. Current release and live-test status

- The contractor-before-payment update is a local implementation pending its two new migrations and matching application deployment. Apply `20261116000000_contractor_before_payment.sql`, then `20261116000100_project_contractor_matching.sql`. This update does not enable email or WhatsApp delivery.
- Activation email delivery was still paused at the 16 November read-only review. There were no configured controlled email recipients and no default follow-up owner. This explains why an account can receive its Supabase confirmation email without receiving a Groundwork welcome email during testing.
- The background worker was running successfully. Role-change email delivery is independent of the activation pause; its queue existed and contained one provider-accepted send with no recorded queue error. Provider acceptance still requires an inbox check.
- The sampled recent receipts had their submission notifications, including receipts on stages now marked complete. That sample does not establish the order of the historical actions in the recording. The regression suite separately exercises a receipt submitted after an explicit progression override.
- The direct Meta connection is a separate channel. Its templates and actual inbound/outbound proof must be checked independently of email. Do not treat a verified callback challenge as proof of a received customer message.
- Old exact seed placeholder rows remain visible for administrative review. Their underlying email copy needs review before enabling the corresponding email journeys. The WhatsApp exporter excludes those exact seed drafts.

## 3. Contractor signs up independently

**CS-1 — Account created, email not confirmed.** Supabase supplies the account confirmation step. The person completes confirmation and signs into the same account. An activation welcome is a different message; receiving confirmation alone is not proof that the activation worker delivered its message.

**CS-2 — Account confirmed, contractor onboarding unfinished.** The next action is contractor onboarding. Messages take the user to the unfinished setup. Creating a second account is unnecessary. When onboarding completes, its reminders stop.

**CS-3 — Onboarding complete, no project created.** The next action is Create a project. The contractor receives the project-creation acknowledgement/reminders for that branch when delivery and the sequence are enabled. These messages stop when an owned project is actually created.

**CS-4 — Contractor has no current project.** Choosing the no-project option pauses project-creation nudges. It is distinct from choosing to create a project. The person retains their account and can create a project later. Their pause must not be recorded as successful project creation.

**CS-5 — Contractor already owns or has joined a project.** Required contractor setup still applies. The completion screen offers Access your project(s), rather than requiring another first project. An accepted project assignment counts; an unclaimed or revoked invitation does not.

**CS-6 — Project created, client not invited.** The next action is to invite the client from that project's People section. The acknowledgement uses that project's name and destination. Its figures are the same project records that the client will later see.

**CS-7 — Shareable client link created, not claimed.** The first claimant joins with the role chosen by the inviter. The link has no expiration, remains single-use, and can be revoked. An anonymous link has no known recipient inbox: creating it does not send or record a delivery to an invented client. The known inviter can receive pending-invitation reminders.

**CS-8 — Named client invited, not joined.** The invitation directs the client into signup or login and back to the existing project. Pending reminders concern this invitation. The contractor can refresh the actual invitation status. The existing pending link is reused where appropriate; refreshing does not create another invitation.

**CS-9 — Primary client joins.** The pending invitation sequence ends and the connected-project acknowledgement applies. Joining is enough for the agreed primary-client connection target; an additional approval, receipt or chat message is not required to count that connection. An observer joining is insufficient.

**CS-10 — Contractor starts a certified-partner application.** Partner application progress and decisions are a separate workflow from creating a project and inviting a client. Record and test the application acknowledgement/status independently. A started application alone does not prove that a project is connected or that contractor onboarding is complete.

## 4. Client signs up independently

**CL-1 — Account created, no project.** After account confirmation, the next action is Create a project. An enabled welcome/reminder links to project creation. No contractor evidence or payment is requested before there is a project and an eligible stage.

**CL-2 — Project started but not saved.** A partly filled wizard is not a successfully created project. The client can return to the saved draft where supported. Project-created messaging and connection tracking must wait for the committed project record.

**CL-3 — Project created, existing contractor available.** Dashboard, project overview and Stages offer “Invite your contractor” and “Let Jalla help you find a contractor.” The invitation button opens that exact project’s Team panel with Contractor selected. The client generates its link or supplies the contractor’s email. Payment plans and receipt uploads stay unavailable until an identified primary contractor accepts the project.

**CL-4 — Project created, client requests help finding a contractor.** The request is saved as a project-linked ticket in Admin Support, alerts the admin team, stops that project’s generic connection reminders and queues the enabled support acknowledgement through the existing delivery controls. Repeated clicks reuse the open request, including while staff are working on it. The client sees that the request was received; a failed save offers retry and never claims success. Staff review and contact the client. Asking for help does not appoint a contractor or unlock payments.

**CL-5 — Contractor invited, acceptance outstanding.** The project displays the pending invitation with a link to view or share it. Payment plans and receipt uploads remain unavailable. A named email invitation and an anonymous shareable link have different delivery evidence. Accepting the primary assignment, rather than merely creating or sending its link, satisfies the connection gate.

**CL-6 — Contractor joins.** The connected-project acknowledgement applies. An accepted, identified primary contractor on this project makes its payment workflow available. The next action refreshes from the saved membership. The existing project origin still determines whether funding or evidence comes first. A secondary contractor or a contractor connected to another project does not satisfy this gate. Both views use the same budget, approved prices, stages and receipt history.

**CL-7 — Client owns several projects.** Project-specific messages retain the relevant project name and destination. Connecting one project must not silently complete another project's unfinished invitation.

## 5. Client invites a contractor

**CI-1 — New contractor account.** The invitation first identifies the existing project. Signup retains the intended contractor role and invitation continuation. Required contractor onboarding follows, then the user returns to the invited project. They are not asked to create a duplicate project to gain access.

**CI-2 — Existing contractor, onboarding complete.** After verified login, the contractor claims the invitation and opens the correct work view of that project. Their acceptance ends pending reminders.

**CI-3 — Existing contractor, onboarding unfinished.** Required setup is completed before work access. The intended project destination survives the setup flow. Already completed panels and existing projects are retained.

**CI-4 — Existing account has the wrong account role.** Account-role correction is an admin action. An invitation or an account label cannot silently grant admin, verifier or primary-project authority. Correct the account through Admin where required, then continue the existing invitation.

**CI-5 — Additional contractor invited.** The initial primary contractor retains pricing and payment-confirmation responsibilities. Another contractor can receive the explicitly assigned collaboration/evidence permissions without replacing the primary contractor.

**CI-6 — Link already claimed or revoked.** A different person cannot reuse a single-use claim. Show the invitation result and the route to request an appropriate invitation. An already accepted member uses their existing project access.

## 6. Contractor invites a client, observer or family member

**IV-1 — New primary client.** Signup and account confirmation lead back to the invited project. The accepted primary client can review contractor evidence, approve price proposals and upload payment receipts. They cannot upload construction evidence.

**IV-2 — Existing primary client account.** Login and acceptance open the same project immediately. Its budget is not recalculated into a second client-specific figure.

**IV-3 — Observer or family member.** The link gives observer access to the shared project, costs, documents and conversation. It does not grant stage approval, price approval, receipt upload or contractor receipt confirmation. Changing the account's global role later does not automatically change this project membership.

**IV-4 — User returns to an invitation after signing in elsewhere.** The verified account and invitation continuation determine the destination. A project link is not an authentication session. Its lack of expiration does not remove normal sign-in and email-confirmation requirements.

## 7. Reminders, replies and the human team

**COM-1 — User remains inactive.** The sequence sends only when the relevant journey and global delivery switch are enabled and the user is eligible. The worker checks the actual unfinished action before delivery. An overdue worker run does not make a completed action incomplete again.

**COM-2 — User finishes between reminders.** The actual milestone cancels or supersedes the old action's reminders. The next email must reflect the newly relevant action. A newer primary-role invitation takes priority over generic instructions to create another project.

**COM-3 — User replies for help.** Replies to managed email use the configured thread-specific receiving address. An authenticated reply appears in Admin's inbox and pauses the relevant automation for human review. Unverified content remains labelled for review rather than being silently trusted.

**COM-4 — Staff replies.** The team opens the saved conversation, reviews the correct recipient and sends a reply through the configured channel. The send log records provider acceptance and later delivery events separately. A staff reply must not mark project creation or invitation acceptance complete.

**COM-5 — Day-7 human follow-up.** Eligible stalled users enter Needs attention. Admin assigns a staff owner, records attempts and schedules the next contact. The configured default cadence is separate from the reminder schedule. Logging a call keeps an unfinished action open; completing the required action resolves the activation task. Support or delivery issues still require their own review.

**COM-6 — No-project opt-out or unsubscribe.** The scoped no-project pause differs from stopping all activation reminders. Essential account/security notices are separate. Resuming does not replay every older reminder in a burst.

**COM-7 — Provider failure, retry or uncertain delivery.** Preserve the saved recipient, message content and idempotency identity. A retry must not create a duplicate email or mark delivery successful without evidence. An uncertain old attempt is held for review where required.

**COM-8 — English and French.** Message copy and action labels follow the saved recipient preference. Language is not inferred from the person who invited them. Missing translations and fallback wording need review. Dates and sources are retained rather than invented.

**COM-9 — Admin tracking.** Use Journeys for the intended path, Sequences for copy and enablement, Send log for attempts and delivery, Inbox for replies, Needs attention for staff tasks, and Tracking and recovery for milestone measures. An email open, a staff contact and a connected project are different facts.

**COM-10 — Channel independence.** Email and WhatsApp have separate settings and delivery proof. WhatsApp requires a connected consenting phone; STOP suspends that channel. A callback challenge, approved template or provider API response is not proof that a recipient read a message. GHL activation overlap still needs an operational retirement check before wider delivery.

## 8. Account-role changes

**ROLE-1 — Admin corrects client to contractor.** The canonical account role changes, a bell notice and transactional email are queued, and active sessions update to the current dashboard. The email uses neutral wording and links to required contractor onboarding or the existing workspace.

**ROLE-2 — Corrected contractor already owns a project.** Unambiguous owned projects receive the approved origin/access repair while preserving budgets, stages, evidence, receipts and completed work. Onboarding ends with Access your project(s).

**ROLE-3 — Another contractor already owns the primary assignment.** Preserve that assignment and flag the project for admin review. The corrected global account role is not permission to replace the existing contractor or upload evidence as an observer.

**ROLE-4 — Contractor, client, verifier or admin correction.** Each role gets its appropriate dashboard destination. Repeating an unchanged repair does not duplicate assignments or role-notification emails. Role-email provider acceptance and actual inbox delivery are separate test results.

## 9. Project payment behavior

**PAY-1 — Contractor-created project.** The contractor uploads work evidence. The primary client reviews and approves it. The client then uploads receipts for that reviewed stage. The primary contractor confirms money received and separately decides whether work can proceed. This cycle applies to later stages too.

**PAY-2 — Client-created project.** First connect the primary contractor: invite an existing contractor or request Jalla’s help. Until the contractor accepts, show the connection options instead of payment requests, plans or receipt upload controls. After acceptance, the first eligible paid stage starts with funding. The client proposes full payment or a custom installment plan and supplies receipts; the contractor reviews the plan and received money before work is authorized. Evidence, client approval and the next funding/progression decision follow. Normal zero-cost stages keep their zero value and follow their work rules. Server checks also refuse receipt reading/submission and plan creation before connection; direct API calls cannot bypass the screen.

**PAY-3 — Confirmed BOQ.** The confirmed total is the pricing basis without Groundwork charges being added. Mid-build completed stages retain their allocated values and historical completion state. Approved later price revisions can change every stage, including originally zero-cost stages, and can change the project total after client approval. Receipt and prior-price history remain recorded.

**PAY-4 — Full payment with multiple proofs.** Full payment is a plan for the stage, not a restriction to one receipt file. Each receipt retains its own exact amount and currency. Several vendor receipts can contribute to the same stage payment.

**PAY-5 — Two custom installments.** The client enters either the first amount or a percentage. For a 60,000 XAF stage, 30% gives 18,000 XAF first and 42,000 XAF second; 70% gives 42,000 XAF and 18,000 XAF. The second amount is the exact remainder. The primary contractor reviews and accepts the proposed plan before it authorizes work. Saving a plan does not confirm receipt of money.

**PAY-6 — Multiple vendor receipts in one installment.** Associate each file with installment 1 or 2 and enter that file's own amount and currency. Do not enter the sum of several files as the amount of one receipt. Several receipts are allowed in either installment; two installments does not mean a two-file limit.

**PAY-7 — Receipt amount or document mismatch.** A non-receipt image, unreadable proof, unfinished transfer, currency mismatch and amount mismatch have distinct outcomes. The entered amount must match that receipt. It is not required to equal half the stage budget. A provider outage is a different issue and must not be reported as an invalid receipt.

**PAY-8 — Money received, work decision deferred.** Record the receipt as received once. The contractor can return to decide about work later. A second decision does not count the same money twice. Pending or flagged proofs do not become confirmed receipts merely because another receipt was accepted.

**PAY-9 — Additional payment or flagged proof.** Show the contractor's requested amount/note and the outstanding balance. Automatic progression does not follow an unresolved receipt or missing authorization. Correcting/replacing a receipt preserves the original history. Confirmed money remains recorded.

**PAY-10 — Explicit progression with an outstanding balance.** After the required client work approval, the primary contractor can review the balance and explicitly authorize progression under the existing eligibility rules. The next stage can open, while the old balance remains payable. This is not full payment, a debt waiver or automatic confirmation of pending receipts. The recording demonstrates this explicit exception; its earlier speculative explanation about unanimous receipt statuses is not the controlling rule.

**PAY-11 — Another receipt arrives for the previous stage.** The client returns to that stage and adds its payment proof. The contractor gets a notification targeting that exact older stage and receipt, even if construction has progressed. Confirmation reduces that stage's outstanding balance without reopening its work or skipping another stage.

**PAY-12 — Currency and conversion details.** USD, NGN and XAF are distinct currencies; “Zaf” in the notes refers to the previously clarified XAF. Each receipt keeps its original money and saved conversion. Project-budget conversion and receipt conversion are different facts. Display the amount and action prominently, with source/date/rate detail available to expand. Later market quotes must not rewrite previously recorded receipt amounts.

**PAY-13 — Open a receipt.** The receipt viewer opens authorized document content. A new tab is a viewing behavior, not evidence that copying or downloading is technically prevented. A real Download action and a View action should not be described as interchangeable.

**PAY-14 — Notifications and permissions.** Receipt review opens the applicable receipt; work approval opens its stage/update; price approval opens its proposal; invitation notifications open acceptance or the joined project as appropriate. Account role and project membership both matter. Observer notifications provide context without granting an action they cannot perform.

**PAY-15 — Primary contractor removed after payment activity.** New payment plans and receipts become unavailable until a primary contractor is connected again. Previously uploaded receipts and recorded amounts remain visible as history. Removing a contractor does not erase payments, change the BOQ total or zero completed stages. Observers can read their permitted project content without receiving invitation, contractor-request or payment controls.

**PAY-16 — A receipt is for more than the stage costs.** Once the contractor confirms the money as received, the amount above the stage's price is carried to the stages that still need it. An earlier stage that was allowed to proceed with a balance is settled first; what is left reduces the next stage, then the one after. A pending or flagged receipt carries nothing. Each stage shows what was carried in, what it passed on, and any credit no stage has needed yet. Example: a 6,000,000 XAF receipt on a 5,239,300 XAF stage settles that stage and reduces the next stage by 760,700 XAF. Requires migration `20261117000000_overpayment_carry_and_closeout.sql`.

**PAY-17 — A stage is covered, wholly or partly, by carried money.** Carried money lowers the balance; it does not start work. The primary contractor reviews the carried amount and accepts it for that stage, which is the same decision as accepting a receipt. The client is notified. If the carried amount does not cover the whole stage, the rest stays payable, and moving past the stage with a balance still needs the contractor's separate, explicit authorization.

**PAY-18 — Closing a project.** When the last stage is approved and nothing is owed, the project completes as before. When any stage still has a recorded balance, or a receipt is waiting for the contractor, the last stage completes but the project stays open. The Close-out panel lists the stages and amounts still owed. The client can still add receipts to those stages. Once everything is settled, the client, the primary contractor or an administrator closes the project with the Close project action. The database refuses the action while a balance or an undecided receipt remains.

## 10. Controlled test plan for the team

Prepare distinct client and contractor accounts for the following cohorts. Keep actual login credentials in the team's existing private handover process rather than this review document.

- Client account that confirms signup and takes no other action.
- Client account that creates a project but does not invite a contractor.
- Client account that requests help connecting a contractor.
- New invited contractor and existing invited contractor; include unfinished and completed onboarding.
- Contractor account that confirms signup but leaves onboarding unfinished.
- Contractor that finishes onboarding but has no project; test both Create project and the no-project pause.
- Contractor that creates a project but does not invite a client.
- New invited primary client, existing primary client, and a separate observer/family member.
- Contractor that starts a partner application, independently of their project state.
- Corrected contractor with an existing owned project, and a conflicting existing primary assignment requiring review.

For each account record the start time, journey, current unfinished action, expected message code/language, actual provider status, inbox arrival, reply result, project destination and stop condition. Avoid changing account or project facts midway through an inactivity cohort unless that is the case being tested.

Run the immediate checks first. Continue the real cohorts at the actual Day-1, Day-3 and Day-7 deadlines shown in Journeys. Automated local tests may use a controlled clock; they do not establish real provider delivery at a future deadline. Do not shift production signup times or replay real customer mail to simulate waiting.

For payments first create a client project without a contractor, test both connection options and confirm no payment prompt is available while an invitation or help request is pending. Accept the primary contractor and verify payment becomes available on that project alone. Also test both project origins; an unequal 30/70 plan; several receipts in each installment; a rejected non-receipt image; a corrected proof; a received-but-deferred decision; a separate progression override; and a later receipt against the completed old stage. Compare both dashboards before and after each action, including after primary-contractor removal.

Before enabling the cohort: review copy (including old placeholders), configure only the chosen controlled recipients, assign a staff owner, review the reply cadence, check sending/reply domains and signed callbacks, and confirm GHL activation overlap is retired. Enable only the intended email journeys. An empty controlled-recipient list is not a sending pause.

## 11. Review ownership and remaining acceptance

- Favour: release the invitation continuity/refresh and percentage-input fixes with the matching client pages; supply this use-case document; demonstrate the exact late-receipt notification regression.
- Ruth: review the concise receipt wording and send the agreed final copy; confirm the team can follow the scenarios without developer explanation.
- Admin/team: choose the controlled email cohort and default follow-up owner, enable the selected journeys when ready, and conduct actual delivery/reply/human-contact checks.
- Team: confirm test-account access through the existing private handover, agree the review time explicitly, and record the real Day-1/3/7 results.
- WhatsApp setup: complete real consent/START, signed inbound, approved-template and controlled outbound/delivery checks before wider sending. These remain separate from the email test.

No message, meeting invitation, account-role change, production financial mutation or sending enablement was performed to prepare this document.
