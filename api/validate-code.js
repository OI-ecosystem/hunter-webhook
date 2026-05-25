// api/validate-code.js
// Validates Hunter Intelligence access codes against Upstash Redis
// Called by dashboard.html on login

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false, error: 'No code provided' });

  const cleanCode = code.trim().toUpperCase();

  // Validate format: HUNT-XXXX-XXXX
  const codePattern = /^HUNT-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  if (!codePattern.test(cleanCode)) {
    return res.status(200).json({
      valid: false,
      error: 'Invalid code format. Check your email for your access code.',
    });
  }

  // Demo codes — always work (for testing)
  const DEMO_CODES = {
    'HUNT-DEMO-0001': { tier: 'Standard', protocols: 10, expires: '2026-12-31' },
    'HUNT-S001-2026': { tier: 'Standard', protocols: 10, expires: '2026-12-31' },
    'HUNT-S002-2026': { tier: 'Standard', protocols: 10, expires: '2026-12-31' },
    'HUNT-P001-2026': { tier: 'Pro',      protocols: 20, expires: '2026-12-31' },
    'HUNT-P002-2026': { tier: 'Pro',      protocols: 20, expires: '2026-12-31' },
  };

  if (DEMO_CODES[cleanCode]) {
    const demo = DEMO_CODES[cleanCode];
    const expires = new Date(demo.expires);
    const daysLeft = Math.ceil((expires - new Date()) / (1000 * 60 * 60 * 24));
    return res.status(200).json({
      valid: true,
      tier: demo.tier,
      protocols: demo.protocols,
      expires: demo.expires,
      daysLeft,
      demo: true,
    });
  }

  // Look up in Upstash Redis
  try {
    const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(cleanCode)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      console.error('Redis lookup failed:', response.status);
      return res.status(200).json({
        valid: false,
        error: 'Unable to validate code. Please try again.',
      });
    }

    const data = await response.json();

    // Key not found
    if (data.result === null || data.result === undefined) {
      return res.status(200).json({
        valid: false,
        error: 'Access code not found. Check your email or contact support.',
      });
    }

    // Parse stored code data
    let codeData;
    try {
      codeData = typeof data.result === 'string'
        ? JSON.parse(data.result)
        : data.result;
    } catch (e) {
      console.error('Failed to parse code data:', e);
      return res.status(200).json({
        valid: false,
        error: 'Code data error. Please contact support.',
      });
    }

    // Check expiry
    const expires = new Date(codeData.expires);
    const now = new Date();
    if (expires < now) {
      return res.status(200).json({
        valid: false,
        error: 'This access code has expired. Please renew your subscription.',
      });
    }

    const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));

    return res.status(200).json({
      valid: true,
      tier: codeData.tier,
      protocols: codeData.protocols || (codeData.tier === 'Pro' ? 20 : 10),
      expires: expires.toISOString().split('T')[0],
      daysLeft,
    });

  } catch (err) {
    console.error('Validation error:', err);
    return res.status(200).json({
      valid: false,
      error: 'Validation service temporarily unavailable. Please try again.',
    });
  }
}
