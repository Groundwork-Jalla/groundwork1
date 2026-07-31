Groundwork — Claude Code Prompts (Per Sidebar Feature)
One prompt per client-sidebar item, plus the subpages you can drill into from each. Paste any single block into Claude Code as a fresh task; each is self-contained and assumes the shared design system from the master system prompt (HSL 217 91% 60% primary blue, greyscale surfaces, Inter body + serif display, glass-card style, shadcn/ui + Tailwind, React Router, TanStack Query, Supabase client at @/integrations/supabase/client, ClientLayout wrapper).

Design tokens to reference in every page:

Wrap page body in <ClientLayout> → <div className="space-y-6">.
Page header: h1.text-2xl.font-bold.tracking-tight + muted subtitle.
Cards: glass-card p-5/6 (bg with subtle blur, border, rounded-xl, hover:shadow-primary/10).
Empty state pattern: centered icon in a rounded muted circle, headline, one-line description, primary CTA.
Loading: shadcn Skeleton blocks matching final layout.
Currency: formatUSDAmount (subscription/pricing) or formatLocalCurrency (project costs, XAF Cameroon default).
Status pills via <StatusBadge status={...} />.
1) Dashboard — /
Build a page at src/pages/Index.tsx wrapped in ClientLayout, titled "Dashboard" with subtitle "Overview of your building protection".

Data: useQuery ["dashboard-projects", user.id] from supabase table "projects" selecting *, budget_breakdown(*), stages(id,name,status,order_index), payments(amount_total,amount_paid,amount_remaining,status), ordered by created_at desc.

Derived stats:
- totalProjects, activeProjects (status='active')
- totalBudget = sum(budget_estimated)
- totalPaid, totalOutstanding from flattened payments
- completedStages / totalStages across all projects
- firstProject = projects[0] for the charts

Layout top-to-bottom:
1. Header row: h1 "Dashboard" + serif-display class, right-side primary Button "New Project" -> /projects/new with Plus icon and shadow-primary/20.
2. ProfileCompletion card (component <ProfileCompletion />) — only render if profile <100% complete.
3. FunnelStateCard (<FunnelStateCard />) — dynamic guidance based on lifecycle state (new_signup, first_project, verifying, completed, dormant, reactivated).
4. Stats grid (grid-cols-2 md:grid-cols-4, glass-card p-5):
   - Total Projects (Building2 icon)
   - Active (TrendingUp)
   - Budget (DollarSign, formatUSDAmount)
   - Paid vs Outstanding (CreditCard) with a thin inline bar.
5. Two-column grid (lg:grid-cols-3): 
   - Left col-span-2: ProgressVelocity chart (line/area of completed stages over time) titled "Progress velocity — {firstProject.name}".
   - Right col-span-1: BudgetDonut (material/labor/engineering/permits split from budget_breakdown), WeatherWidget (city from firstProject.location), TrustBadge (shows tier: Self Verify grey / Jalla Verify blue / Jalla Protection gold).
6. Recent Projects list: max 5 cards, each row shows name, StatusBadge, stage progress bar (completedStages/totalStages), and Clock icon with "Updated {relative}". Click -> /projects/{id}.

States:
- Loading: 3-card Skeleton grid + skeleton chart.
- Empty (0 projects): centered Building2 in muted circle, "Start your first protected build", CTA "Create Project".

Use Tailwind semantic tokens only (bg-background, text-foreground, border-border, text-muted-foreground). No hardcoded colors.
2) My Projects — /projects
Build src/pages/MyProjects.tsx in ClientLayout.

Header: h1 "My Projects" + muted subtitle "View and manage all your construction projects". Right-side Button "+ New Project" -> /projects/new.

Fetch supabase.from('projects').select('*, stages(id,name,status,order_index)').order('created_at', desc) via TanStack Query key ['projects', user.id].

Card grid md:grid-cols-2 gap-4 of glass-card p-5:
- Top row: project name (font-semibold text-lg truncate), StatusBadge (active/paused/completed).
- Location + start date row: muted text with icon.
- Stage progress bar: computed completedStages/totalStages with pct% label. Bar uses bg-primary with muted track.
- Footer row: budget (formatLocalCurrency using project.currency, default XAF), Clock icon "Updated {relative time}".
- Whole card cursor-pointer, hover:shadow-xl hover:shadow-primary/10, onClick navigate to /projects/{id}.
- Include a subtle top-right tier ribbon if project.tier != 'self_serve'.

Loading: 3 Skeleton cards (h-28).
Empty state: centered icon, "No projects yet", "Create your first project to start tracking construction stages", CTA "Create Project".

Include the Logo component at top-left of the empty state illustration.
2a) Project Detail — /projects/:id (opens when you click a project)
Build src/pages/ProjectDetail.tsx in ClientLayout — the deepest page in the app.

Data (parallel queries):
- projects: select *, budget_breakdown(*), country_settings(*), payments(*), stage_certificates(*)
- stages: select *, project_substages(*) where project_id=:id, order by order_index
- team: project_team_members join profiles (roles: professional/construction/verification)
- contractors: project_contractors join profiles + project_contractor_invites (pending)
- documents: project_documents where project_id=:id
- timeline: project_timeline_events (activity feed)

Sticky top header (glass, backdrop-blur):
- Back link to /projects.
- Project name (serif-display h1), location, StatusBadge, tier badge.
- Right: Actions dropdown (Edit, Pause, Archive), Share link.
- Under header a horizontal Tabs bar: Overview | Stages | Payments | Documents | Team | Timeline | Certificates.

TAB: Overview
- 3-column stats: Budget (estimated vs spent progress bar), Timeline (start-end, days elapsed / total), Stage progress ({completed}/{total}).
- BudgetDonut card (material/labor/engineering/permits/contingency from budget_breakdown).
- AssignedProfessionalCard (only Jalla Verify/Protection): shows assigned jala_professional avatar + contact, or "Awaiting assignment" if null.
- Weather + site conditions widget (WeatherWidget using project.location).

TAB: Stages
- Vertical list of 10 stages from CONSTRUCTION_STAGES with lock/unlock icons.
- Each stage card expandable accordion:
  - Header: stage number circle, name, StatusBadge (locked/in_progress/pending_review/completed/rejected), % complete.
  - Body when open:
    - SubstageList: checklist of project_substages with status pills, rejection_note banner (destructive) if rejected_at set.
    - Update composer: textarea + photo upload (stage_media, stage_updates tables). Post button.
    - Documents dropzone (bound to stage_id).
    - Action buttons based on tier:
        Self Verify: "Mark as complete" (calls edge fn approve-stage, self path).
        Jalla Verify / Protection owner: "Submit for verification" (queues review).
        Jala professional or admin (reviewing): "Approve" + "Reject specific substages" -> RejectStageDialog (multi-select substages + note).
    - When approved on Jalla Verify tier: show download link to stage_certificate PDF + QR verification badge.

TAB: Payments
- Milestone list from payments table: milestone name, amount_total (local currency), paid/remaining bars, due date, status pill.
- "Record payment" button opens dialog (amount, method, note, receipt upload).
- Total footer: subtotal, processing fee (10% self_serve / 3% hybrid / negotiated full_service in USD conversion note), grand total.

TAB: Documents
- Uploader dropzone -> supabase storage bucket 'project-documents' path {project.id}/{filename}.
- Grid of file cards (icon by mime, name, size, uploaded_by, date). Row actions: preview, download, delete (owner only).
- Category filter: plan | permit | invoice | certificate | other.

TAB: Team
- AssignedProfessionalCard (Jalla tiers only).
- ContractorTeamCard: list of accepted contractors + pending invites. "Invite contractor" button opens dialog (email + role); enforces 1-contractor cap on Self Verify (disable + tooltip when already 1).
- Construction/verification teams (Jalla Protection): grouped lists from project_team_members.

TAB: Timeline
- Reverse-chronological feed from project_timeline_events (stage completed, doc uploaded, payment recorded, contractor accepted, etc.) with icon per type and relative time.

TAB: Certificates
- Grid of stage_certificates: stage name, issued date, PDF download, QR image, "Copy public verify link" (/verify/{token}).

All destructive actions confirm via AlertDialog. All mutations use TanStack Query + toast (sonner) and invalidate the relevant keys. Handle loading and empty per-tab.
3) Resources — /tools/resources
Build src/pages/tools/ResourceLibrary.tsx in ClientLayout.

Header: h1 "Resource Library" + subtitle "Guides, checklists, directories and templates for each construction stage".

Filter bar (sticky, glass-card p-4, flex flex-wrap gap-3):
- Search Input with Search icon: filters title + summary case-insensitive.
- Category Select: all | guide | checklist | directory | template.
- Stage Select: all + CONSTRUCTION_STAGES (1..10) by stage_number.

Fetch: supabase.from('resources').select('*').eq('published', true).order('stage_number', asc, nullsFirst:false). Cache key ['resources'].

Filter client-side by search, category, stage.

Grid md:grid-cols-2 lg:grid-cols-3 of shadcn Card:
- CardHeader: Category badge (greyscale CATEGORY_COLORS map: guide=muted, checklist=inverted, directory=outline, template=dashed) + Stage tag "Stage {n}: {stage name}" if stage_number set.
- CardTitle: resource.title (line-clamp-2).
- CardDescription: resource.summary (line-clamp-3).
- CardContent footer: read_time_minutes with BookOpen icon, ArrowRight on hover.
- Whole card wrapped in Link to /tools/resources/{slug}.

Loading: 6 Skeleton cards.
Empty (filtered zero): centered muted BookOpen, "No resources match your filters", "Clear filters" ghost button.

Do not use color hues in badges — greyscale only.
3a) Resource Detail — /tools/resources/:slug
Build src/pages/tools/ResourceDetail.tsx in ClientLayout.

Fetch single resource by slug: supabase.from('resources').select('*').eq('slug', slug).eq('published', true).single().

Header block:
- Back link "← Back to resources" -> /tools/resources.
- Category badge (same greyscale map as library) + Stage badge.
- H1 resource.title (serif-display).
- Muted subtitle: resource.summary.
- Meta row: BookOpen icon + read_time_minutes, updated_at date.
- If resource.file_url present: primary Button "Download PDF" with Download icon (opens in new tab).

Main content Card:
- Render resource.body as light Markdown:
  - `# ` -> h2, `## ` -> h3, `### ` -> h4.
  - `- ` bullet lines flushed as <ul.list-disc>.
  - Inline **bold**, *italic*, `code`.
  - Blank line splits paragraphs.
- Prose width max-w-3xl mx-auto, text-muted-foreground for body, foreground for headings.

Side rail (lg:grid-cols-3, content col-span-2, rail col-span-1):
- "Related resources" card: 3 other resources with same stage_number or category.
- If category='template' or 'checklist' and file_url set: "Download" reminder card with FileText icon.

States: Skeleton article on load, 404 card + link back if not found.
4) Contractors — /contractors
Build src/pages/ContractorDirectory.tsx in ClientLayout.

Header: h1 "Verified Contractors" + subtitle "Browse Jalla-vetted contractors in your region".

Fetch from view contractors_public (email/phone hidden by RLS) — supabase.from('contractors_public').select('*').eq('active', true).

Filter bar:
- Search Input (name, trade, city).
- Trade Select (mason, carpenter, electrician, plumber, roofer, tiler, painter, general).
- City Select (dynamic distinct from data).
- Verified toggle (default on).

Grid md:grid-cols-2 lg:grid-cols-3 of glass-card p-5:
- Avatar (first letter fallback), name, verified checkmark if verified=true.
- Trade chips (badge muted).
- City + years_experience row.
- Rating stars (avg_rating, 1-decimal) with ({review_count}).
- Short bio line-clamp-2.
- "View profile" ghost button -> /contractors/{id}.
- Do NOT show email or phone here (protected fields).

Empty: HardHat icon, "No contractors match your filters".
Loading: 6 Skeleton cards.
4a) Contractor Profile — /contractors/:id
Build src/pages/ContractorProfile.tsx in ClientLayout.

Fetch contractors_public row by id. If viewer has an active project where this contractor is accepted (project_contractors), also fetch the private contractors row for contact info (RLS-gated).

Layout:
- Back link to /contractors.
- Hero card: large avatar, name, verified badge, trade chips, city, joined date, star rating.
- Two-column below:
  Left (col-span-2):
    - About (bio prose).
    - Portfolio grid (contractor_portfolio_items: photo, project name, year, description).
    - Reviews list (contractor_reviews joined with client profile initial): stars, headline, body, date.
  Right (col-span-1):
    - "Contact" card:
        - If viewer has a shared project: show phone + email + Message button.
        - Else: locked state "Invite this contractor to your project to unlock contact details" + button "Invite to project" (opens project picker dialog -> calls invite-contractor edge function).
    - Trades summary card.
    - Verification card: shows verification checks passed (id, license, insurance).

Handle loading skeletons and 404 fallback.
5) Community — external https://www.skool.com/...
The Community sidebar item is not a page inside the app — it opens the Groundwork School community on skool.com in a new tab.

In src/components/ClientLayout.tsx the nav array marks this item with external:true. Render it as an <a> with target="_blank" rel="noopener noreferrer", not a react-router Link.

The nav item uses the Users lucide icon and label "Community". On hover show a small "↗" external indicator. No route registration needed.

If in the future we bring community in-house, the replacement page would live at src/pages/Community.tsx with a feed of skool posts pulled via their API — but that is out of scope today.
6) Payments — /payments
Build src/pages/PaymentsHistory.tsx in ClientLayout.

Header: h1 "Payments" + subtitle "All payment milestones across your projects".

Fetch: supabase.from('payments').select('*, projects(id,name,currency,tier)').order('due_date', asc). Group by projects.name.

Top strip: 3 stat cards
- Total paid (sum amount_paid across all projects, formatLocalCurrency of primary project currency or split by currency).
- Outstanding (sum amount_remaining).
- Next due (nearest future due_date + project name).

Grouped table sections per project (glass-card):
- Section header: project name link -> /projects/{id}, currency chip, tier badge.
- Rows: milestone (stage or custom), amount_total, amount_paid, amount_remaining (bar), due_date, StatusBadge (pending/partial/paid/overdue).
- Row action: "Record payment" opens a shared dialog reused from ProjectDetail.
- If tier=hybrid show a footer note "3% Jalla verification fee applied on release".
- If tier=self_serve show "10% processing fee".

Empty: CreditCard icon, "No payment milestones yet — create a project to start tracking".
Loading: 2 Skeleton table sections.

Export button top-right: downloads a CSV of all rows (client-side, no backend call).
7) Notifications — /notifications
Build src/pages/Notifications.tsx in ClientLayout.

Header: h1 "Notifications" + subtitle, and a right-side "Mark all as read" ghost button (calls supabase update notifications set read_at=now() where user_id=self and read_at is null).

Fetch: supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', desc).limit(100). Realtime subscribe on the notifications table for this user.

Filter tabs: All | Unread | Projects | Payments | System.

List (glass-card divide-y):
Each row:
- Left: icon by type (Building2 for project, CreditCard for payment, Shield for verification, FileText for document, Users for team, Bell for system).
- Middle: bold title, muted body (1-line clamp), relative time.
- Right: unread dot (bg-primary), row action dropdown (Mark read/unread, Open, Dismiss).
- Click row -> navigate to notification.link_url when present.

States:
- Loading: 6 Skeleton rows.
- Empty: Bell icon, "You're all caught up".
- Pagination: "Load older" button when count === 100.
8) Help — /help
Build src/pages/Help.tsx in ClientLayout.

Header: h1 "Help & Support" + subtitle "Answers, tutorials, and a direct line to our team".

Sections:
1. Quick actions grid (md:grid-cols-3, glass-card p-5):
   - Video walkthroughs (Play icon) -> external link.
   - Book onboarding call (Calendar icon) -> Cal.com link.
   - Contact support (Mail icon) -> opens Contact dialog (name/email prefilled, subject, message; posts to support_tickets table).
2. FAQ accordion (shadcn Accordion). Categories: Getting started, Projects & stages, Payments & fees, Verification & certificates, Account & security. Question list is a local constant array of ~15 Q&As including tier explanations (Self Verify 10%, Jalla Verify $199 + 3%, Jalla Protection custom).
3. Docs & resources card: links to /tools/resources filtered by category=guide.
4. System status card: shows a green/amber/red dot from supabase.rpc('system_status') — falls back to green with "All systems operational".
5. Contact form (bottom card): name, email (prefill from profile), category select, message textarea, "Send" primary button; on success show toast + reset.

Include SEO <title> "Help — Groundwork" via react-helmet-async.
9) Settings — /settings
Build src/pages/ClientSettings.tsx in ClientLayout as a tabbed page.

Tabs: Profile | Account | Notifications | Subscription | Danger zone.

Fetch profile via supabase.from('profiles').select('*').eq('id', user.id).single() and subscription via supabase.from('user_subscriptions') + pricing_plans join.

TAB: Profile
- Avatar upload (storage bucket 'avatars/{user.id}/avatar.png').
- Fields: full_name, phone, city, country (Select from country_settings), preferred_currency (readonly derived).
- Bio textarea.
- Save button -> update profiles; invalidate profile query; toast success.

TAB: Account
- Email (readonly from auth.user.email).
- "Change password" -> opens dialog: new + confirm, calls supabase.auth.updateUser.
- Connected providers: Google (show connected status).
- Language + timezone selects.

TAB: Notifications
- Toggle rows for: Project updates, Verification alerts, Payment reminders, Contractor invites, Marketing emails.
- Persist to profiles.notification_prefs JSON.

TAB: Subscription
- SubscriptionCard reused: shows current plan (Self Verify / Jalla Verify / Jalla Protection) with fee (10% / 3% / negotiated), price ($0 / $199/mo / Custom), included features from src/lib/tierFeatures.ts.
- Actions:
  - On Self Verify: "Upgrade to Jalla Verify" primary button -> checkout (Paddle/Stripe when enabled) or "Contact us" toast if not yet enabled.
  - On Jalla Verify: "Manage billing" -> customer portal link; "Downgrade" ghost -> confirm dialog.
  - On Jalla Protection: "Contact success manager" mailto.
- Billing history table: invoices from user_invoices (date, amount, status, download PDF).

TAB: Danger zone
- Export my data (calls edge fn export-user-data -> zip URL).
- Delete account (double-confirm dialog, calls edge fn delete-user).

Every mutation uses TanStack Query, sonner toasts, and invalidates on success. Handle unsaved-changes dirty state with a warning on tab switch.
Notes for Claude Code when running any of these
Never hardcode hex colors. Use Tailwind semantic classes (bg-card, text-foreground, border-border, bg-primary text-primary-foreground, text-muted-foreground, bg-destructive).
Every table read that lists rows uses TanStack Query. Every mutation invalidates the matching keys.
Guard all pages with <ProtectedRoute> in App.tsx (already wired).
SEO: set <title> and <meta name="description"> per page via react-helmet-async.
Skeletons must mirror the final layout, not just placeholder blobs.
Empty states always give a primary next action.
Currency: subscription pricing is USD; project financials use project.currency (default XAF Cameroon).
Tier gating logic lives in src/lib/tierFeatures.ts — read tier from the current project or user subscription and branch UI/actions accordingly.