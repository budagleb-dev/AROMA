const MENU = {
  esp:['Espresso',2.5], cap:['Cappuccino',3.8], lat:['Latte',4.2], fw:['Flat White',4], cb:['Cold Brew',4.5], hc:['Hot Chocolate',4.2],
  cr:['Butter Croissant',3.2], ch:['Cheesecake',5.5], ti:['Tiramisu',5.8], br:['Chocolate Brownie',4], cn:['Cinnamon Roll',3.9], lt:['Lemon Tart',4.8],
  at:['Avocado Toast',8.5], om:['Omelette',7.9], gb:['Granola Bowl',7], pc:['Pancakes',8], cm:['Croque Monsieur',8.9], oj:['Fresh Orange Juice',4.2]
};
const FEE = 2.5, FREE_FROM = 25, MIN_DELIVERY = 10;
const USD_RATE = 1.08;
const LOCALES = { en: 'en', ru: 'ru', nl: 'nl' };

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: 'STRIPE_SECRET_KEY is not set' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }

  const usd = b.currency === 'USD';
  const currency = usd ? 'usd' : 'eur';
  const rate = usd ? USD_RATE : 1;
  const cents = (eur) => Math.round(eur * rate * 100);

  const lines = [];
  let subEur = 0;
  for (const id of Object.keys(b.items || {})) {
    const item = MENU[id];
    const qty = parseInt(b.items[id], 10);
    if (!item || !(qty >= 1 && qty <= 50)) return json(400, { error: 'Bad item' });
    lines.push({ name: item[0], amount: cents(item[1]), qty });
    subEur += item[1] * qty;
  }
  if (!lines.length) return json(400, { error: 'Empty cart' });

  const delivery = b.mode === 'Delivery';
  if (delivery && subEur < MIN_DELIVERY) return json(400, { error: 'Below minimum order' });
  if (delivery && subEur < FREE_FROM) lines.push({ name: 'Delivery', amount: cents(FEE), qty: 1 });

  const origin = event.headers.origin || process.env.URL || 'http://localhost:8888';
  const p = new URLSearchParams();
  p.append('mode', 'payment');
  p.append('success_url', origin + '/?paid=1');
  p.append('cancel_url', origin + '/?canceled=1');
  p.append('locale', LOCALES[b.lang] || 'auto');
  lines.forEach((l, i) => {
    p.append(`line_items[${i}][quantity]`, String(l.qty));
    p.append(`line_items[${i}][price_data][currency]`, currency);
    p.append(`line_items[${i}][price_data][unit_amount]`, String(l.amount));
    p.append(`line_items[${i}][price_data][product_data][name]`, l.name);
  });
  const meta = { type: String(b.mode || ''), name: b.name, phone: b.phone, address: b.address, comment: b.comment, site_currency: b.currency };
  Object.keys(meta).forEach((k) => {
    const v = String(meta[k] || '').slice(0, 450);
    p.append(`metadata[${k}]`, v);
    p.append(`payment_intent_data[metadata][${k}]`, v);
  });

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: p
  });
  const data = await r.json();
  if (!r.ok) return json(502, { error: (data.error && data.error.message) || 'Stripe error' });
  return json(200, { url: data.url });
};
