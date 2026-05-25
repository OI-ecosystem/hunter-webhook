// api/stripe-webhook.js
// Listens for Stripe payment events and triggers code generation

import Stripe from 'stripe';

// Price ID to tier mapping — update these if prices change
const PRICE_TIERS = {
  'price_1Tax6tCPEYT0QuWDzka6GrVn': 'Standard', // £49/month
  'price_1TaxC5CPEYT0QuWDTG955MgO': 'Pro',       // £149/month
};

// Also support lookup keys as fallback
const LOOKUP_TIERS = {
  'hunter_standard_monthly': 'Standard',
  'hunter_pro_monthly': 'Pro',
};

export const config = {
  api: { bodyParser: false }, // Required for Stripe signature verification
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getTierFromSession(session) {
  // Try line items price ID first
  const priceId = session?.line_items?.data?.[0]?.price?.id;
  if (priceId && PRICE_TIERS[priceId]) return PRICE_TIERS[priceId];

  // Try metadata (set on payment link)
  if (session?.metadata?.tier) return session.metadata.tier;

  // Try amount as last resort
  const amount = session?.amount_total;
  if (amount >= 14900) return 'Pro';
  if (amount >= 4900)  return 'Standard';

  return 'Standard'; // safe default
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log('Stripe event received:', event.type);

  // Handle checkout completion (new subscriber)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;

    if (!email) {
      console.error('No email in session:', session.id);
      return res.status(200).json({ received: true }); // acknowledge but log
    }

    const tier = getTierFromSession(session);
    console.log(`New subscriber: ${email} — ${tier}`);

    try {
      const baseUrl = `https://${process.env.VERCEL_URL}`;
      const response = await fetch(`${baseUrl}/api/generate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          tier,
          stripeSessionId: session.id,
          stripeCustomerId: session.customer,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('Code generation failed:', err);
        return res.status(500).json({ error: 'Code generation failed' });
      }

      const result = await response.json();
      console.log(`Code generated for ${email}: ${result.code}`);
    } catch (err) {
      console.error('Error calling generate-code:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  // Handle subscription renewal
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    // Only process renewals (not first payment — that's handled above)
    if (invoice.billing_reason === 'subscription_cycle') {
      const email = invoice.customer_email;
      const priceId = invoice.lines?.data?.[0]?.price?.id;
      const tier = PRICE_TIERS[priceId] || 'Standard';

      console.log(`Renewal for ${email} — ${tier}`);

      try {
        const baseUrl = `https://${process.env.VERCEL_URL}`;
        await fetch(`${baseUrl}/api/generate-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            tier,
            stripeCustomerId: invoice.customer,
            renewal: true,
          }),
        });
      } catch (err) {
        console.error('Renewal code generation failed:', err);
      }
    }
  }

  // Handle cancellation — invalidate existing codes
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    console.log('Subscription cancelled for customer:', customerId);
    // Codes expire naturally after 30 days — no action needed
    // Future: could look up and delete codes by customerId
  }

  return res.status(200).json({ received: true });
}
