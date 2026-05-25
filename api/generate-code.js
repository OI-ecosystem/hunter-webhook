// api/generate-code.js
// Called by Stripe webhook when payment succeeds
// Generates a unique access code, stores in Upstash Redis, emails via Resend

import crypto from 'crypto';

const DASHBOARD_URL = 'https://hunter-webhook.vercel.app/dashboard.html';

function generateCode(tier) {
  const prefix = tier === 'Pro' ? 'P' : 'S';
  const part1 = prefix + Math.random().toString(36).substring(2, 5).toUpperCase();
  const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `HUNT-${part1}-${part2}`;
}

async function storeCode(code, data) {
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      value: JSON.stringify(data),
      ex: 60 * 60 * 24 * 31, // 31 days in seconds
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Redis store failed: ${err}`);
  }
  return response.json();
}

async function sendEmail(email, code, tier, expires) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Hunter Intelligence <hello@hunterintelligence.io>',
      to: email,
      subject: `Your Hunter Intelligence ${tier} access is ready`,
      html: emailTemplate(code, tier, expires),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Email send failed: ${err}`);
  }
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const { email, tier, stripeSessionId, stripeCustomerId, renewal } = req.body;

  if (!email || !tier) {
    return res.status(400).json({ error: 'Missing email or tier' });
  }

  // Generate unique code
  const code = generateCode(tier);
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + 30);

  const codeData = {
    email,
    tier,
    protocols: tier === 'Pro' ? 20 : 10,
    expires: expires.toISOString(),
    created: now.toISOString(),
    stripeSessionId: stripeSessionId || null,
    stripeCustomerId: stripeCustomerId || null,
    renewal: renewal || false,
  };

  try {
    // Store in Upstash Redis (auto-expires after 31 days)
    await storeCode(code, codeData);
    console.log(`Code stored in Redis: ${code}`);
  } catch (err) {
    console.error('Redis error:', err);
    return res.status(500).json({ error: 'Failed to store access code' });
  }

  try {
    // Send email via Resend
    await sendEmail(email, code, tier, expires);
    console.log(`Email sent to ${email}`);
  } catch (err) {
    console.error('Email error:', err);
    // Don't fail the whole request if email fails — code is stored
    // Could add retry logic here later
  }

  return res.status(200).json({
    success: true,
    code,
    tier,
    expires: expires.toISOString().split('T')[0],
    email,
    dashboard_url: DASHBOARD_URL,
  });
}

function emailTemplate(code, tier, expires) {
  const expiryStr = expires.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  const price = tier === 'Pro' ? '£149' : '£49';
  const protocolCount = tier === 'Pro' ? 'all 20' : 'the top 10';
  const proFeatures = tier === 'Pro'
    ? 'snapshot probability scores, TVL correlation matrix, whale tracker, priority protocol alerts, and'
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0efea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:0 20px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <h1 style="font-size:20px;font-weight:600;color:#1a1a18;margin:0 0 4px;">
        Hunter <span style="color:#1D9E75;">Intelligence</span>
      </h1>
      <p style="font-size:13px;color:#9a9994;margin:0;">Airdrop farming intelligence</p>
    </div>

    <!-- Main card -->
    <div style="background:#ffffff;border-radius:12px;padding:32px;margin-bottom:16px;border:0.5px solid rgba(0,0,0,0.1);">
      <p style="font-size:15px;color:#1a1a18;margin:0 0 8px;">
        Your <strong>${tier}</strong> subscription is active.
      </p>
      <p style="font-size:13px;color:#5f5e5a;margin:0 0 24px;">
        Enter your access code below at the dashboard to get started.
      </p>

      <!-- Code block -->
      <div style="background:#E1F5EE;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
        <p style="font-size:11px;color:#085041;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.1em;font-weight:500;">
          Your access code
        </p>
        <p style="font-size:26px;font-weight:600;font-family:monospace;color:#1a1a18;letter-spacing:0.12em;margin:0 0 8px;">
          ${code}
        </p>
        <p style="font-size:12px;color:#085041;margin:0;">
          Valid until ${expiryStr}
        </p>
      </div>

      <!-- CTA button -->
      <a href="${DASHBOARD_URL}"
         style="display:block;background:#1D9E75;color:#ffffff;text-align:center;
                padding:14px 20px;border-radius:8px;text-decoration:none;
                font-size:15px;font-weight:500;margin-bottom:24px;">
        Open your dashboard →
      </a>

      <!-- What you get -->
      <div style="border-top:0.5px solid rgba(0,0,0,0.1);padding-top:20px;">
        <p style="font-size:12px;font-weight:500;color:#1a1a18;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.06em;">
          ${tier} includes
        </p>
        <p style="font-size:13px;color:#5f5e5a;line-height:1.7;margin:0;">
          Ranked intelligence on ${protocolCount} airdrop protocols · AI weekly briefing ·
          ROI calculator · ${proFeatures} weekly Telegram delivery
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:0 20px 40px;">
      <p style="font-size:12px;color:#9a9994;line-height:1.7;margin:0;">
        ${price}/month · cancel anytime<br>
        Questions? Reply to this email or message @HunterIntelBot on Telegram
      </p>
    </div>

  </div>
</body>
</html>
  `;
}
