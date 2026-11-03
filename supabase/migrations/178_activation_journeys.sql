-- =========================================================
-- 178 — The Communication Flow v1.0 journeys, with tracking
--
-- Turns the five placeholder sequences from 177 into the four journeys in the
-- "Groundwork User Activation Communication Flow" (contractor self-signup, contractor
-- invited, client self-signup, client invited), with the approved English wording.
--
-- One sequence per STAGE. A stage's exit event is the next stage's trigger, so a person
-- walks CS01-04 -> CS05-08 -> CS09-12 -> CS13-15 automatically, and a stage exit cancels
-- the pending reminders of the stage before. Delays are from the previous message, so
-- Day 1 / Day 3 / Day 7 = 24h / +48h / +96h from entering the stage.
--
-- Tracked per person: every email sent (lifecycle_sends.step_code), the last email, the
-- action still awaited, and a Day-7 follow-up task with a reason, priority, owner and
-- due date. All of it is shown in /admin/sequences > Needs attention.
--
-- Not seeded because another sequence already sends the same words to the same person:
-- CI10/CI11 (= CL11/CL12), IV06/IV07 (= CS14/CS15), IV08 (= CS16).
--
-- Everything is seeded DISABLED. French wording is empty (the app falls back to English)
-- until it is written in the admin.
--
-- Run in: Supabase Dashboard > SQL Editor (after 177)
-- =========================================================

BEGIN;

ALTER TABLE public.lifecycle_sequences
  ADD COLUMN IF NOT EXISTS journey TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recipient TEXT NOT NULL DEFAULT 'self' CHECK (recipient IN ('self','inviter')),
  ADD COLUMN IF NOT EXISTS match JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS awaiting_action TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS skip_if_active_in TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.lifecycle_sequence_steps
  ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cta_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cta_label_en TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cta_label_fr TEXT NOT NULL DEFAULT '';

-- One enrolment per person per sequence PER PROJECT (ref), so a second build starts its own clock.
ALTER TABLE public.lifecycle_enrollments
  ADD COLUMN IF NOT EXISTS ref TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS subject_email TEXT,
  ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_step_code TEXT,
  ADD COLUMN IF NOT EXISTS emails_sent INT NOT NULL DEFAULT 0;
ALTER TABLE public.lifecycle_enrollments
  DROP CONSTRAINT IF EXISTS lifecycle_enrollments_sequence_key_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_enrollments_per_ref
  ON public.lifecycle_enrollments (sequence_key, email, ref);

ALTER TABLE public.lifecycle_sends
  ADD COLUMN IF NOT EXISTS step_code TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT;
CREATE INDEX IF NOT EXISTS lifecycle_sends_by_email ON public.lifecycle_sends (email, sent_at DESC);

ALTER TABLE public.followup_queue
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal')),
  ADD COLUMN IF NOT EXISTS owner TEXT,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}';

-- The 177 placeholders, if nobody switched them on.
DELETE FROM public.lifecycle_sequences
 WHERE key IN ('contractor_welcome','client_welcome','invitation_pending','contractor_invitation_pending','no_project_selected')
   AND enabled = false;

INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cs_signup$t$,$t$Contractor — complete onboarding$t$,$t$CS01, CS02, CS03, CS04$t$,$t$Contractor self-signup$t$,$t$user_signup$t$,ARRAY['contractor_onboarding_completed']::text[],$t$contractor$t$,$t$self$t$,$t${"entry_source": "independent_signup"}$t$::jsonb,$t$Complete contractor onboarding$t$,7,ARRAY['ci_invited','ci_onboarding']::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_signup$t$,1,0,'email',$t$CS01$t$,$t$Welcome to Groundwork by Jalla$t$,$t$Hi {{first_name}},

Welcome to Groundwork by Jalla. Groundwork helps you organize projects, milestones, documents, progress updates, and client communication in one place.

Your next step is to complete your contractor onboarding so we can finish setting up your account.$t$,$t$onboarding$t$,$t$Complete contractor onboarding$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_signup$t$,2,24,'email',$t$CS02$t$,$t$Complete your Groundwork contractor onboarding$t$,$t$Hi {{first_name}},

You created your Groundwork account, but your contractor onboarding is not complete yet. Finish the remaining details to begin using Groundwork for your projects.$t$,$t$onboarding$t$,$t$Continue onboarding$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_signup$t$,3,48,'email',$t$CS03$t$,$t$Finish setting up your contractor account$t$,$t$Hi {{first_name}},

Completing your contractor onboarding gives you access to create projects, organize project information, and collaborate with clients through Groundwork.

Return to your onboarding and complete the remaining steps.$t$,$t$onboarding$t$,$t$Finish onboarding$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_signup$t$,4,96,'email',$t$CS04$t$,$t$Do you need help completing your Groundwork account?$t$,$t$Hi {{first_name}},

Your contractor onboarding is still incomplete. If something is preventing you from finishing, reply to this email and tell us where you are stuck.

You can also return to Groundwork and complete the remaining steps now.$t$,$t$onboarding$t$,$t$Complete onboarding$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cs_onboarded$t$,$t$Contractor — create first project$t$,$t$CS05, CS06, CS07, CS08$t$,$t$Contractor self-signup$t$,$t$contractor_onboarding_completed$t$,ARRAY['project_created','no_active_project_selected']::text[],$t$contractor$t$,$t$self$t$,$t${"entry_source": "independent_signup"}$t$::jsonb,$t$Create the first project$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_onboarded$t$,1,0,'email',$t$CS05$t$,$t$Your contractor onboarding is complete$t$,$t$Hi {{first_name}},

Your contractor onboarding is complete. You now have standard contractor access to Groundwork and can use it to organize project information, milestones, documents, updates, and client communication.

Create your first project to begin.$t$,$t$create_project$t$,$t$Create your first project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_onboarded$t$,2,24,'email',$t$CS06$t$,$t$Create your first project on Groundwork$t$,$t$Hi {{first_name}},

Your contractor account is ready. Add your first active project so you can begin organizing the work inside Groundwork.

If you do not currently have a project to add, select that option in Groundwork and we will stop these reminders.$t$,$t$create_project$t$,$t$Create a project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_onboarded$t$,3,48,'email',$t$CS07$t$,$t$Bring your first project into Groundwork$t$,$t$Hi {{first_name}},

A Groundwork project gives you one place for milestones, documents, progress updates, and communication with your client.

Create your first project when you are ready to begin organizing it.$t$,$t$create_project$t$,$t$Create a project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_onboarded$t$,4,96,'email',$t$CS08$t$,$t$Need help adding your first project?$t$,$t$Hi {{first_name}},

You have not created a project yet. If you have an active project and need help setting it up, reply to this email and our team can assist. If you do not currently have a project, update your account so we can move you into the appropriate communication track.$t$,$t$create_project$t$,$t$Add a project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cs_project$t$,$t$Contractor — invite the client$t$,$t$CS09, CS10, CS11, CS12$t$,$t$Contractor self-signup$t$,$t$project_created$t$,ARRAY['client_invited']::text[],$t$contractor$t$,$t$self$t$,$t${}$t$::jsonb,$t$Invite the client to the project$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_project$t$,1,0,'email',$t$CS09$t$,$t$Your first Groundwork project has been created$t$,$t$Hi {{first_name}},

Congratulations on creating {{project_name}} in Groundwork.

The next step is to invite your client. Once connected, your client can view the project information, milestones, documents, and updates you share. You control what your client see.$t$,$t$invite_client$t$,$t$Invite your client$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_project$t$,2,24,'email',$t$CS10$t$,$t$Invite your client to {{project_name}}$t$,$t$Hi {{first_name}},

{{project_name}} is ready, but your client has not been invited yet. Connect them so they can follow the project through Groundwork.$t$,$t$invite_client$t$,$t$Invite client$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_project$t$,3,48,'email',$t$CS11$t$,$t$Give your client visibility into {{project_name}}$t$,$t$Hi {{first_name}},

Inviting your client creates a shared source of truth for project updates, documents, and milestones. It also reduces the need to distribute the same information across separate channels.$t$,$t$invite_client$t$,$t$Invite client$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_project$t$,4,96,'email',$t$CS12$t$,$t$Do you need help inviting your client?$t$,$t$Hi {{first_name}},

Your project is not connected to a client yet. If you need help sending the invitation or explaining Groundwork to your client, reply to this email.

P.S: Contractor using Groundwork to provide updates report higher client satisfaction and referrals$t$,$t$invite_client$t$,$t$Invite client$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cs_client_pending$t$,$t$Contractor — client invitation pending$t$,$t$CS13, CS14, CS15$t$,$t$Contractor self-signup$t$,$t$client_invited$t$,ARRAY['invitation_accepted']::text[],$t$contractor$t$,$t$inviter$t$,$t${"inviter_role": "contractor"}$t$::jsonb,$t$Client to accept the invitation$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_client_pending$t$,1,0,'email',$t$CS13$t$,$t$Your invitation to {{client_name}} has been sent$t$,$t$Hi {{first_name}},

Your invitation to {{client_name}} for {{project_name}} has been sent. We will let you know when the client accepts and joins the project.$t$,$t$open_project$t$,$t$View project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_client_pending$t$,2,72,'email',$t$CS14$t$,$t${{client_name}} has not joined {{project_name}} yet$t$,$t$Hi {{first_name}},

Your client invitation is still pending. You may want to follow up directly, resend the invitation, or confirm that the email address is correct.$t$,$t$open_project$t$,$t$Review invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_client_pending$t$,3,96,'email',$t$CS15$t$,$t$Your client invitation is still pending$t$,$t$Hi {{first_name}},

{{client_name}} has not joined {{project_name}} yet. Resend the invitation, update the contact information, or reply if you need help

onboarding the client.$t$,$t$open_project$t$,$t$Manage invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cs_connected$t$,$t$Contractor — client joined$t$,$t$CS16$t$,$t$Contractor self-signup$t$,$t$invitation_accepted$t$,'{}'::text[],$t$contractor$t$,$t$inviter$t$,$t${"inviter_role": "contractor"}$t$::jsonb,$t$$t$,NULL,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cs_connected$t$,1,0,'email',$t$CS16$t$,$t${{client_name}} has joined {{project_name}}$t$,$t$Hi {{first_name}},

{{client_name}} has joined {{project_name}}. Your project is now connected, and you can begin sharing updates, documents, milestones, and progress through Groundwork.$t$,$t$open_project$t$,$t$Open project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$ci_invited$t$,$t$Contractor — invitation not accepted$t$,$t$CI01, CI02, CI03, CI04$t$,$t$Contractor invited by a client$t$,$t$contractor_invited$t$,ARRAY['invitation_accepted']::text[],$t$contractor$t$,$t$self$t$,$t${}$t$::jsonb,$t$Accept the project invitation$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_invited$t$,1,0,'email',$t$CI01$t$,$t${{client_name}} invited you to {{project_name}} on Groundwork$t$,$t$Hi {{first_name}},

{{client_name}} has invited you to collaborate on {{project_name}} through Groundwork by Jalla.

Accept the invitation to view the project and collaborate with the client. If you already have a Groundwork account, sign in. If you are new, you will create an account before joining.$t$,$t$invitation$t$,$t$View and accept invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_invited$t$,2,24,'email',$t$CI02$t$,$t$Reminder: {{client_name}} invited you to {{project_name}}$t$,$t$Hi {{first_name}},

Your invitation to {{project_name}} is waiting. Accept it to join the project and collaborate with {{client_name}} in Groundwork.$t$,$t$invitation$t$,$t$Accept invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_invited$t$,3,48,'email',$t$CI03$t$,$t$Join {{project_name}} on Groundwork$t$,$t$Hi {{first_name}},

Groundwork gives you and {{client_name}} a shared place for project information, milestones, documents, and updates. Accept the invitation to join the existing project.$t$,$t$invitation$t$,$t$Join project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_invited$t$,4,96,'email',$t$CI04$t$,$t$Your invitation to {{project_name}} is still open$t$,$t$Hi {{first_name}},

This is the final reminder for your invitation to {{project_name}}. Accept it now or reply if you are having trouble accessing the project.$t$,$t$invitation$t$,$t$Accept invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$ci_onboarding$t$,$t$Contractor — finish onboarding to join$t$,$t$CI05, CI06, CI07, CI08$t$,$t$Contractor invited by a client$t$,$t$invitation_accepted$t$,ARRAY['contractor_onboarding_completed']::text[],$t$contractor$t$,$t$self$t$,$t${"entry_source": "contractor_invitation", "onboarding_status": "in_progress"}$t$::jsonb,$t$Complete contractor onboarding$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_onboarding$t$,1,0,'email',$t$CI05$t$,$t$Complete your contractor setup to join {{project_name}}$t$,$t$Hi {{first_name}},

You accepted {{client_name}}'s invitation to {{project_name}}. Because this is your first Groundwork project, complete your contractor onboarding before joining the project.

You do not need to create another project. The client's project is already waiting for you.$t$,$t$onboarding$t$,$t$Complete contractor onboarding$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_onboarding$t$,2,24,'email',$t$CI06$t$,$t$Finish setting up your account for {{project_name}}$t$,$t$Hi {{first_name}},

Your invitation has been accepted, but your contractor onboarding is incomplete. Finish the remaining steps to join {{project_name}}.$t$,$t$onboarding$t$,$t$Continue onboarding$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_onboarding$t$,3,48,'email',$t$CI07$t$,$t${{project_name}} is waiting for you$t$,$t$Hi {{first_name}},

Complete your contractor onboarding to access the project {{client_name}} shared with you. You will be taken directly to the existing project once setup is complete.$t$,$t$onboarding$t$,$t$Finish onboarding$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_onboarding$t$,4,96,'email',$t$CI08$t$,$t$Need help joining {{project_name}}?$t$,$t$Hi {{first_name}},

Your contractor setup is still incomplete. Reply if you need assistance, or complete the remaining steps to join {{project_name}}.$t$,$t$onboarding$t$,$t$Complete setup$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$ci_connected_existing$t$,$t$Contractor — joined (already onboarded)$t$,$t$CI09$t$,$t$Contractor invited by a client$t$,$t$invitation_accepted$t$,'{}'::text[],$t$contractor$t$,$t$self$t$,$t${"entry_source": "contractor_invitation", "onboarding_status": "completed"}$t$::jsonb,$t$$t$,NULL,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_connected_existing$t$,1,0,'email',$t$CI09$t$,$t$You have joined {{project_name}}$t$,$t$Hi {{first_name}},

You are now connected to {{project_name}} with {{client_name}}. Open the project to review its information and begin collaborating through Groundwork.$t$,$t$open_project$t$,$t$Open project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$ci_connected_new$t$,$t$Contractor — joined (after onboarding)$t$,$t$CI09$t$,$t$Contractor invited by a client$t$,$t$contractor_onboarding_completed$t$,'{}'::text[],$t$contractor$t$,$t$self$t$,$t${"entry_source": "contractor_invitation"}$t$::jsonb,$t$$t$,NULL,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$ci_connected_new$t$,1,0,'email',$t$CI09$t$,$t$You have joined {{project_name}}$t$,$t$Hi {{first_name}},

You are now connected to {{project_name}} with {{client_name}}. Open the project to review its information and begin collaborating through Groundwork.$t$,$t$open_project$t$,$t$Open project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cl_signup$t$,$t$Client — create first project$t$,$t$CL01, CL02, CL03, CL04$t$,$t$Client self-signup$t$,$t$user_signup$t$,ARRAY['project_created']::text[],$t$client$t$,$t$self$t$,$t${"entry_source": "independent_signup"}$t$::jsonb,$t$Create the first project$t$,7,ARRAY['iv_invited']::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_signup$t$,1,0,'email',$t$CL01$t$,$t$Welcome to Groundwork by Jalla$t$,$t$Hi {{first_name}},

Welcome to Groundwork by Jalla. Groundwork gives you one place to organize your construction project, follow milestones, receive updates, and collaborate with your contractor.

Create your first project to begin.$t$,$t$create_project$t$,$t$Create your first project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_signup$t$,2,24,'email',$t$CL02$t$,$t$Create your first Groundwork project$t$,$t$Hi {{first_name}},

Your Groundwork account is ready, but you have not created a project yet. Add your project so you can begin organizing the build and connecting the people involved.$t$,$t$create_project$t$,$t$Create project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_signup$t$,3,48,'email',$t$CL03$t$,$t$Bring your construction project into Groundwork$t$,$t$Hi {{first_name}},

Creating your project gives you a shared place for milestones, documents, progress updates, and communication with your contractor.$t$,$t$create_project$t$,$t$Create project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_signup$t$,4,96,'email',$t$CL04$t$,$t$Need help creating your project?$t$,$t$Hi {{first_name}},

You have not created a project yet. If you need help entering the project details, reply to this email and our team can assist.$t$,$t$create_project$t$,$t$Create project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cl_project$t$,$t$Client — connect a contractor$t$,$t$CL05, CL06, CL07, CL08$t$,$t$Client self-signup$t$,$t$project_created$t$,ARRAY['contractor_invited','contractor_support_requested']::text[],$t$client$t$,$t$self$t$,$t${}$t$::jsonb,$t$Invite a contractor or request support$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_project$t$,1,0,'email',$t$CL05$t$,$t$Your first Groundwork project has been created$t$,$t$Hi {{first_name}},

Congratulations on creating {{project_name}}.

Your next step is to connect the professional responsible for the work. Invite your existing contractor, or request help from Jalla if you do not have one yet.$t$,$t$connect_contractor$t$,$t$Connect a contractor$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_project$t$,2,24,'email',$t$CL06$t$,$t$Connect a contractor to {{project_name}}$t$,$t$Hi {{first_name}},

{{project_name}} is ready, but no contractor is connected yet. Invite your contractor or request help finding an appropriate professional.$t$,$t$connect_contractor$t$,$t$Connect a contractor$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_project$t$,3,48,'email',$t$CL07$t$,$t$Your project needs a contractor$t$,$t$Hi {{first_name}},

A connected contractor can share project information, documents, milestones, and progress updates with you through Groundwork. If you don’t have a contractor, reply to this email and Jalla will help you find one$t$,$t$connect_contractor$t$,$t$Connect a contractor$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_project$t$,4,96,'email',$t$CL08$t$,$t$Do you need help connecting a contractor?$t$,$t$Hi {{first_name}},

{{project_name}} is not connected to a contractor yet. Invite the professional you already work with, or request support from Jalla if you need assistance.$t$,$t$connect_contractor$t$,$t$Choose contractor option$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cl_support$t$,$t$Client — support request received$t$,$t$CL09$t$,$t$Client self-signup$t$,$t$contractor_support_requested$t$,ARRAY['support_request_resolved']::text[],$t$client$t$,$t$self$t$,$t${}$t$::jsonb,$t$Jalla to review the support request$t$,NULL,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_support$t$,1,0,'email',$t$CL09$t$,$t$We received your contractor support request$t$,$t$Hi {{first_name}},

We received your request for help connecting a contractor to {{project_name}}. A member of the Jalla team will review the project information and contact you about the next step.

This request does not guarantee an immediate match or appointment. Any professional engagement will remain subject to availability, fit, client choice, and applicable terms.$t$,$t$open_project$t$,$t$View project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cl_contractor_pending$t$,$t$Client — contractor invitation pending$t$,$t$CL10, CL11, CL12$t$,$t$Client self-signup$t$,$t$contractor_invited$t$,ARRAY['invitation_accepted']::text[],$t$client$t$,$t$inviter$t$,$t${"inviter_role": "client"}$t$::jsonb,$t$Contractor to accept the invitation$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_contractor_pending$t$,1,0,'email',$t$CL10$t$,$t$Your invitation to {{contractor_name}} has been sent$t$,$t$Hi {{first_name}},

Your invitation to {{contractor_name}} for {{project_name}} has been sent. We will let you know when the contractor accepts and joins the project.$t$,$t$open_project$t$,$t$View project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_contractor_pending$t$,2,72,'email',$t$CL11$t$,$t${{contractor_name}} has not joined {{project_name}} yet$t$,$t$Hi {{first_name}},

Your contractor invitation is still pending. You may follow up directly, resend the invitation, or confirm the email address.$t$,$t$open_project$t$,$t$Review invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_contractor_pending$t$,3,96,'email',$t$CL12$t$,$t$Your contractor invitation is still pending$t$,$t$Hi {{first_name}},

{{contractor_name}} has not joined {{project_name}}. Resend the invitation, update the contact information, or request help from Jalla.$t$,$t$open_project$t$,$t$Manage invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$cl_connected$t$,$t$Client — contractor joined$t$,$t$CL13$t$,$t$Client self-signup$t$,$t$invitation_accepted$t$,'{}'::text[],$t$client$t$,$t$inviter$t$,$t${"inviter_role": "client"}$t$::jsonb,$t$$t$,NULL,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$cl_connected$t$,1,0,'email',$t$CL13$t$,$t${{contractor_name}} has joined {{project_name}}$t$,$t$Hi {{first_name}},

{{contractor_name}} has joined {{project_name}}. Your project is now connected, and you can collaborate through Groundwork as information, milestones, documents, and updates are added.$t$,$t$open_project$t$,$t$Open project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$iv_invited$t$,$t$Client — invitation not accepted$t$,$t$IV01, IV02, IV03, IV04$t$,$t$Client invited by a contractor$t$,$t$client_invited$t$,ARRAY['invitation_accepted']::text[],$t$client$t$,$t$self$t$,$t${}$t$::jsonb,$t$Accept the project invitation$t$,7,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$iv_invited$t$,1,0,'email',$t$IV01$t$,$t${{contractor_name}} invited you to view {{project_name}}$t$,$t$Hi {{first_name}},

{{contractor_name}} has invited you to join {{project_name}} on Groundwork by Jalla.

Accept the invitation to view the existing project, including information, documents, milestones, and updates shared with you. If you already have an account, sign in. If you are new, create your account to view project.$t$,$t$invitation$t$,$t$Accept invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$iv_invited$t$,2,24,'email',$t$IV02$t$,$t$Reminder: join {{project_name}} on Groundwork$t$,$t$Hi {{first_name}},

Your invitation to {{project_name}} is waiting. Accept it to connect with {{contractor_name}} and view the project through Groundwork.$t$,$t$invitation$t$,$t$Accept invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$iv_invited$t$,3,48,'email',$t$IV03$t$,$t$Get visibility into {{project_name}}$t$,$t$Hi {{first_name}},

Groundwork gives you and {{contractor_name}} a shared place for project information, documents, milestones, and progress updates. Accept the invitation to join your project.$t$,$t$invitation$t$,$t$Join project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$iv_invited$t$,4,96,'email',$t$IV04$t$,$t$Your invitation to {{project_name}} is still open$t$,$t$Hi {{first_name}},

This is the final automated reminder for your invitation to {{project_name}}. Accept it now or reply if you need help accessing the project.$t$,$t$invitation$t$,$t$Accept invitation$t$) ON CONFLICT (sequence_key,position) DO NOTHING;
INSERT INTO public.lifecycle_sequences (key,name,description,journey,trigger_event,exit_events,audience,recipient,match,awaiting_action,followup_after_days,skip_if_active_in) VALUES ($t$iv_connected$t$,$t$Client — joined$t$,$t$IV05$t$,$t$Client invited by a contractor$t$,$t$invitation_accepted$t$,'{}'::text[],$t$client$t$,$t$self$t$,$t${"entry_source": "client_invitation"}$t$::jsonb,$t$$t$,NULL,'{}'::text[]) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.lifecycle_sequence_steps (sequence_key,position,delay_hours,channel,code,subject_en,body_en,cta_key,cta_label_en) VALUES ($t$iv_connected$t$,1,0,'email',$t$IV05$t$,$t$You have joined {{project_name}}$t$,$t$Hi {{first_name}},

You are now connected to {{project_name}} with {{contractor_name}}. Open the project to review the available information and follow updates through Groundwork.

You do not need to create another project. The project shared with you is already active in your account.$t$,$t$open_project$t$,$t$Open project$t$) ON CONFLICT (sequence_key,position) DO NOTHING;

COMMIT;
