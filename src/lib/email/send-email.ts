export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('[email] send failed:', body);
    }
    return res.ok;
  } catch (err) {
    console.error('[email] send error:', err);
    return false;
  }
}
