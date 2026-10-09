import RoleSignup from '@/components/auth/RoleSignup';

/**
 * /contractor-signup — the one front door for an approved contractor.
 *
 * Reached from the acceptance email, which carries the claim token issued when an admin
 * accepted the application (100). See components/auth/RoleSignup.tsx for why the token is
 * required and why the claim is finished by /auth/callback rather than here.
 */
export default function ContractorSignup() {
  return <RoleSignup role="contractor" />;
}
