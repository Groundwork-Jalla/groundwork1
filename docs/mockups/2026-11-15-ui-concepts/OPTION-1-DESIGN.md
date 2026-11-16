# Option 1 — Calm & clear

Selected by the user on 15 November 2026 for the next design iteration. This is a reviewable design brief, not an application implementation or a change to payment rules.

**Current approval:** after an intermediate implementation of 02, the user returned to **01 — Calm & clear for the client dashboard** and specified a quiet overview. The white sidebar and layout below now govern the home. **03 — Stages/payment** and **06 — Confirmations** remain in place; other client screens and Admin still require design review. See [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Visual direction

Keep the familiar white sidebar, Groundwork wordmark and forest-green actions. Use a warm off-white canvas, white content surfaces, fine warm-grey rules and generous spacing. Prefer one clear next action over competing cards. Client screens should feel welcoming; Admin screens should remain compact enough for daily work.

Retain the existing Plus Jakarta Sans headings, Inter body text and tabular IBM Plex Mono figures. Use the repository palette: green #1f4d36, ink #0a0a0a, canvas #f7f7f5 and rule #e4e3df. Corners around 12–14px and restrained shadows are sufficient. States need text plus an icon/dot, with readable contrast; color alone cannot carry meaning.

Scope any future shared-shell styling to client and Admin variants. Do not globally restyle the contractor workspace, which the user considers satisfactory.

## Client home

The selected [home preview](01-client-home-calm.png) establishes the hierarchy: greeting, current project, next action, concise financial summary and project shortcuts. Use actual owned and joined projects; a contractor-created build shared with a client is a valid first project. Do not ask that client to create a duplicate or show an incomplete creation checklist.

Keep the dashboard as an overview. Show one project summary, one real next action, three financial figures and a few project shortcuts. Detailed stages, transaction history, documents and conversations belong in their existing project views. Collapse other projects until requested and avoid duplicate create actions. The newer six-item client menu and bell/history access take precedence over the navigation illustrated in the older board.

Use only the project's authorized uploaded imagery. If no appropriate image exists, show a neutral architectural fallback. Generated preview photographs must not become production project images or construction evidence.

The action panel must come from real project permissions and state. It can direct a primary client to review an update, review proposed prices, add an eligible receipt or read a contractor decision. When no client action is due, explain the other participant's next step rather than inventing an urgent task. Observers must retain their existing permissions and must not gain client approval/payment controls.

The [mobile states](05-client-mobile-states.png) show a genuine empty account and distinguish the two creation origins. Empty state guidance must not appear while projects are loading or a query has failed. An invited client with an existing project should see that project, not the empty-account screen.

## Stages, approvals and money

Use the [stage/payment preview](03-client-stages-payments.png) and [confirmation preview](06-client-confirmations.png) as composition guidance. Retain all ten stages and actual substage evidence. Shortened lists in the images are not permission to hide stages. Historical completion does not reset a stage's budget or receipts; zero-cost stages and approved revisions retain their existing rules.

Work approval, submitted proof, confirmed money and authorization to progress remain distinct. For contractor-created projects, evidence review precedes payment for that reviewed stage. For client-created projects, the existing funding-first flow remains. Do not infer eligibility from project origin alone: the actual stage and backend permission state still govern.

Keep construction evidence above the payment form. Clients review contractor uploads; they never upload construction evidence. Show receipt controls only when eligible, with clearly named Choose file, Take photo and Upload payment receipt actions. Preserve full payment, two installments, multiple receipts, corrections/replacement, exact currency/amount validation and error recovery.

A pending receipt is not confirmed money. In mobile state D, a submitted 3,000,000 XAF receipt leaves confirmed received at 0 and outstanding at 6,000,000 XAF until the contractor confirms it. Partial confirmations reduce the balance; they do not themselves authorize the next stage. Preserve the separate contractor progression decision and outstanding amount.

Use existing shared budget/money helpers and native precision for every real amount. Confirmed BOQ totals remain fee-free. The example numbers must never be hard-coded into the app. If conversion is shown, preserve its saved-versus-receipt rate context, source and date.

Confirmation dialogs should name the project/stage, the amount where relevant and the consequence. In the example price proposal, 60,000,000 becomes 63,000,000 XAF; the stage changes from 6,000,000 to 9,000,000 XAF and its previously confirmed 3,000,000 stays recorded, leaving 6,000,000 due. Clients approve a contractor proposal; they do not directly edit it in this dialog.

The work-approval dialog must describe the contractor's separate responsibility to confirm payment. It must not claim payment has already been received when it has not. Preview text is not a substitute for the actual state-specific product copy.

## Admin

Use [overview](04-admin-overview.png) and [communications](07-admin-communications.png) as the Admin direction. Collapse long navigation groups without deleting existing destinations. Retain current project workspaces, people/roles, reporting, acquisition, finance, support and system tools.

Put attention items and staff follow-up before secondary visualizations. Every metric and queue must use its existing real data source and open the corresponding dataset. An unavailable source shows an unavailable state, not a zero. Do not ship preview statistics or invented growth trends.

In Communications, keep conversations beside the person's current unfinished action, owner, next contact time and history. Separate logging human contact from completing the user's action. Preserve reminders pausing/resuming, email and WhatsApp channel handling, tracking, journeys, sequences and delivery logs. The proposed layout must not merge distinct provider reply APIs or enable sending.

Provider setup remains available without long credential forms dominating the inbox. Current DNS/Meta dependencies remain honest setup states. The illustrated email conversation is not proof of live receiving. Secret settings remain write-only.

Admin stays an oversight and communication surface. Client approvals, contractor evidence and receipt/progression decisions remain in their participant workflows.

## Navigation, accessibility and implementation order

Retain current routes, project tabs, query parameters, notification destinations, invitation continuation and Back behavior. The simplified tabs in the mockups illustrate hierarchy; existing capabilities still need destinations in the final UI.

Responsive layouts must work at narrow phone widths, with text labels, visible focus, adequate touch targets, keyboard-accessible dialogs, correctly associated fields and clear loading/error/disabled states. Feedback must identify what succeeded, what is waiting and who acts next.

When implementation begins, use small reviewable passes: client home and shared client navigation, client project stages/payment presentation, Admin overview/navigation, then Admin communications. Exercise existing role, navigation, stage, payment, pricing and communication regressions as relevant. Do not change business rules as part of the visual pass.

## Assets and review status

The original numbered PNGs are design-review artifacts. The later three-area implementation and its controlled browser screenshots are recorded separately in [IMPLEMENTATION.md](IMPLEMENTATION.md). Provider settings and the Admin UI are outside that implementation.

Generated using the built-in image tool with the selected home and Admin images as style references. See [OPTION-1-PROMPTS.md](OPTION-1-PROMPTS.md) for the full prompts and the targeted numeric-label correction.

