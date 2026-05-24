import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function generateAccessCode(tier) {
  const prefix = tier === 'pro' ? 'HUNT-P' : 'HUNT-S';
  const num = Math.floor(Math.random() * 9000) + 1000;
  const year = new Date().getFullYear();
  return `${prefix}${num}-${year}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed' || 
      event.type === 'customer.subscription.created') {
    
    const session = event.data.object;
    const customerEmail = session.customer_email || session.customer_details?.email;
    
    // Determine tier from amount
    const amount = session.amount_total;
    const tier = amount >= 7900 ? 'pro' : 'standard';
    const tierName = tier === 'pro' ? 'Pro' : 'Standard';
    const accessCode = generateAccessCode(tier);

    console.log(`New subscriber: ${customerEmail} — ${tierName} — ${accessCode}`);

    // Send access code email via Resend
    try {
      await resend.emails.send({
        from: 'Hunter Intelligence <onboarding@resend.dev>',
        to: customerEmail,
        subject: `Your Hunter Intelligence ${tierName} access code`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;background:#ffffff;">
            <div style="margin-bottom:32px;">
              <span style="font-size:18px;font-weight:600;color:#1a1a18;">Hunter<span style="color:#1D9E75;">.</span>Intelligence</span>
            </div>
            <h1 style="font-size:24px;font-weight:600;color:#1a1a18;margin-bottom:8px;">Welcome to Hunter Intelligence ${tierName}</h1>
            <p style="font-size:15px;color:#5f5e5a;line-height:1.6;margin-bottom:32px;">Your subscription is confirmed. Here is your access code:</p>
            
            <div style="background:#f0efea;border-radius:8px;padding:24px;text-align:center;margin-bottom:32px;">
              <div style="font-size:13px;color:#9a9994;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Your Access Code</div>
              <div style="font-size:28px;font-weight:700;color:#1a1a18;letter-spacing:0.04em;">${accessCode}</div>
            </div>

            <p style="font-size:14px;color:#5f5e5a;line-height:1.6;margin-bottom:24px;">To access your dashboard:</p>
            <ol style="font-size:14px;color:#5f5e5a;line-height:1.8;margin-bottom:32px;padding-left:20px;">
              <li>Visit your Hunter Intelligence dashboard</li>
              <li>Enter your access code when prompted</li>
              <li>Your ${tierName} tier will unlock immediately</li>
            </ol>

            <p style="font-size:13px;color:#9a9994;line-height:1.6;">Keep this code safe — you'll need it each time you access the dashboard. If you have any issues email <a href="mailto:shorgs67@icloud.com" style="color:#1D9E75;">shorgs67@icloud.com</a></p>
            
            <div style="border-top:0.5px solid rgba(0,0,0,0.1);margin-top:32px;padding-top:24px;">
              <p style="font-size:12px;color:#9a9994;">Hunter Intelligence — Intelligence only. No custody. No wallets. No keys.</p>
            </div>
          </div>
        `
      });
      console.log(`Access code email sent to ${customerEmail}`);
    } catch (emailErr) {
      console.error('Email send failed:', emailErr);
    }
  }

  res.status(200).json({ received: true });
}

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
