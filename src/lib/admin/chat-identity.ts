// =========================================================
// Who a message is from, as a reader should see it — pure.
//
// 127 stops `send_message` writing an email address as somebody's name. This is the other
// half, and it is not redundant: `project_messages.sender_name` has several writers, and
// two of them are outside that function's reach — the GoHighLevel inbound mirror (077)
// takes whatever the contact is called at the provider, and the email delivery path falls
// back to the From address. Rows written before 127 ran also still exist.
//
// So nothing renders a name without passing through here, and an address never reaches a
// reader whichever path wrote it.
// =========================================================

/**
 * Does this look like an email address rather than a name?
 *
 * Deliberately narrow: an `@` with something either side of it. A name is not an address
 * because it contains a dot, and a loose test here would replace real names — which is a
 * worse bug than the one being fixed, because it is silent and it hides who spoke.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

/**
 * The name to show for a message.
 *
 * ── Why an address must never render ────────────────────────────────────────────────
 * A staff address in a thread the client can read, screenshot and forward is a direct
 * invitation to continue the conversation off Groundwork, which the product exists not to
 * do. In the other direction it is a client's own address shown to a contractor. Since 126
 * the same line is also carried to WhatsApp, so it leaves the platform twice.
 *
 * `fallback` is what the person IS — their role, or the desk. Never blank: an unnamed
 * bubble is the ambiguity the label was added to remove.
 */
export function displaySenderName(
  stored: string | null | undefined,
  fallback: string,
): string {
  const name = (stored ?? '').trim();
  if (!name || looksLikeEmail(name)) return fallback;
  return name;
}
