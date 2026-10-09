import RoleSignup from '@/components/auth/RoleSignup';

/**
 * /verifier-signup — the one front door for an invited verifier.
 *
 * Reached from the invitation email an admin sends after the engineer has been
 * interviewed (105). A verifier's decision releases a stage payment, so there is no open
 * version of this page — see components/auth/RoleSignup.tsx.
 */
export default function VerifierSignup() {
  return <RoleSignup role="verifier" />;
}
