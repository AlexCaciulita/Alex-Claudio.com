// Card payments through Stripe Checkout, for a couple's retainer and balance. The amount always comes
// from the dashboard's own payment schedule, never from the browser. A payment counts as paid only
// once Stripe says so: on the couple's return from Checkout (the session is looked up) or by webhook.
const crypto = require('node:crypto');

const API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_S = 5 * 60;

// Stripe takes form-encoded bodies with nested keys: line_items[0][price_data][currency]=usd.
function formEncode(value, prefix = '', out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) formEncode(inner, prefix ? `${prefix}[${key}]` : key, out);
  } else out.append(prefix, String(value));
  return out;
}

class PaymentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createPayments({ env = process.env, fetch: fetchImpl = fetch } = {}) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return { enabled: false };
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET || '';

  async function stripe(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(body && body.idempotency ? { 'Idempotency-Key': body.idempotency } : {})
        },
        body: body ? formEncode(body.form).toString() : undefined,
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new PaymentError(503, 'Card payments can’t be reached right now.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new PaymentError(res.status === 401 ? 503 : 502, (data.error && data.error.message) || 'Card payments aren’t working right now.');
    return data;
  }

  return {
    enabled: true,
    // test or live, from the key, so the dashboard can say which.
    mode: /^sk_live_|^rk_live_/.test(key) ? 'live' : 'test',

    createCheckout: ({ amountCents, name, description, email, successUrl, cancelUrl, metadata, idempotency }) => stripe('POST', '/checkout/sessions', {
      idempotency,
      form: {
        mode: 'payment',
        line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name, description } } } },
        customer_email: email || undefined,
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: metadata.payment_id,
        metadata,
        payment_intent_data: { metadata, description: `${name}${description ? ` · ${description}` : ''}` }
      }
    }),

    session: (id) => {
      if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(String(id || ''))) throw new PaymentError(400, 'Unknown payment.');
      return stripe('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
    },

    // The event, if the Stripe-Signature header proves Stripe sent this exact body recently; otherwise null.
    verifyWebhook(raw, header, now = Date.now()) {
      if (!webhookSecret || !Buffer.isBuffer(raw)) return null;
      const parts = Object.fromEntries(String(header || '').split(',').map((part) => part.split('=')).filter((pair) => pair.length === 2));
      const t = Number(parts.t);
      const signatures = String(header || '').split(',').filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
      if (!t || !signatures.length || Math.abs(now / 1000 - t) > WEBHOOK_TOLERANCE_S) return null;
      const expected = crypto.createHmac('sha256', webhookSecret).update(`${t}.`).update(raw).digest('hex');
      const ok = signatures.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
      if (!ok) return null;
      try { return JSON.parse(raw.toString('utf8')); } catch (error) { return null; }
    }
  };
}

module.exports = { createPayments, formEncode, PaymentError };
