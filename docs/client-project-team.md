# Client project Team tab

The fourth product-review fix moves project sharing into Team, inside each
project. Account Settings keeps its separate account-wide purpose.

## Behaviour

- Team sits after Stages in the client tab bar so it is visible on narrow screens.
- Observer sharing moves out of Overview; contractor invitations and assignment
  status move out of Stages. Those pages retain their progress and financial work.
- The primary client sees their role, contractor invitations/status, and observer
  sharing. Primary contractors using this project view get their existing client
  and observer invitation panels. These are the same permission-checked components
  used before the move, including confirmation, delivery fallback and retry.
- Leaving Team after submitting an invitation finishes the requested email
  delivery. Its result cannot update a different project or an unmounted panel.
- Other members see their project role and an explanation of their access,
  without invitation controls. Invitation lists retain their existing database
  visibility rules. Roles are read from project membership, not account metadata
  or project creation.
- Accepted contractors are labelled explicitly when primary. Their status stays
  visible after acceptance while the initial invitation form remains hidden.
- `/projects/<id>?tab=team` opens Team directly. Tab selection follows the URL,
  including browser navigation, and switching tabs preserves other parameters.
- The setup guide points to Team only while the initial contractor invitation is
  available, then to the invitation panel when Team is open. Permission changes
  refresh the cue without watching animated styles/classes.
- Navigation, role explanations and guide copy are translated in English/French.

## Deployment and verification

This step adds no migration. It requires the earlier
`20261112000200_project_team_permissions.sql` migration, documented in
[project-team-permissions.md](project-team-permissions.md).

UI regressions cover tab links, moving the invitation panels, invited primary
clients, observer restrictions, accepted assignments, loading/retry and setup
guidance after permission changes. The existing invitation, client-access and
stage approval tests remain in the targeted verification set. Run
`pnpm typecheck` and `pnpm build` before deployment.

Local verification passed: 252 targeted tests, typecheck, production build and
`git diff --check`. The tests include delivery after leaving Team and protection
against displaying the result on another project.

No production deployment or migration has been run for this step.
