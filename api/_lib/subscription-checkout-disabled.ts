export function subscriptionCheckoutDisabled(req: any, res: any) {
  res.setHeader('Allow', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.status(410).json({ error: 'Subscriptions are currently unavailable.' });
}
