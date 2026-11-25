import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { normalizeCheckout } from "../lib/commerce.js";
import { getPool } from "../lib/database.js";
import { loadCatalog } from "../lib/catalog.js";

const MAIL_TO = "shop.rideworks@gmail.com";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function euro(cents) {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR"
  }).format(cents / 100);
}

function respond(res, status, payload) {
  return res.status(status).json(payload);
}

function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const requestHost = req.headers["x-forwarded-host"] || req.headers.host;
    return Boolean(requestHost && originHost === requestHost);
  } catch {
    return false;
  }
}

function formatEmail(order, orderId, bankDetails) {
  const rows = order.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.qty + " × " + item.name + " (" + item.variant + ")")}</td>
      <td>${euro(item.unitPriceCents * item.qty)}</td>
    </tr>
  `).join("");
  const paymentText = order.paymentMethod === "bank_transfer"
    ? `Bitte überweise den Gesamtbetrag mit der Zahlungsreferenz ${orderId} an ${bankDetails.name}, IBAN ${bankDetails.iban}${bankDetails.bic ? `, BIC ${bankDetails.bic}` : ""}.`
    : "Barzahlung bei Abholung.";
  const addressText = `${order.address.name}\n${order.address.street}\n${order.address.zip} ${order.address.city}\n${order.address.country}`;
  const html = `
    <h2>RIDEWORKS-Bestellung ${escapeHtml(orderId)}</h2>
    <table cellpadding="8" border="1" style="border-collapse:collapse">
      <tr><th>Produkt</th><th>Betrag</th></tr>
      ${rows}
      <tr><td>Warenwert</td><td>${euro(order.subtotalCents)}</td></tr>
      <tr><td>Versand</td><td>${euro(order.shippingCents)}</td></tr>
      <tr><td><strong>Gesamtbetrag</strong></td><td><strong>${euro(order.totalCents)}</strong></td></tr>
    </table>
    <p>${escapeHtml(paymentText)}</p>
    <h3>Lieferadresse</h3>
    <p>${escapeHtml(addressText).replace(/\n/g, "<br>")}</p>
    ${order.address.note ? `<p>Anmerkung: ${escapeHtml(order.address.note)}</p>` : ""}
  `;
  const text = [
    `RIDEWORKS-Bestellung ${orderId}`,
    "",
    ...order.items.map((item) =>
      `${item.qty} x ${item.name} (${item.variant}) - ${euro(item.unitPriceCents * item.qty)}`
    ),
    "",
    `Warenwert: ${euro(order.subtotalCents)}`,
    `Versand: ${euro(order.shippingCents)}`,
    `Gesamtbetrag: ${euro(order.totalCents)}`,
    "",
    paymentText,
    "",
    "Lieferadresse:",
    addressText,
    order.address.note ? `Anmerkung: ${order.address.note}` : ""
  ].filter(Boolean).join("\n");
  return { html, text };
}

async function findExisting(pool, key) {
  const result = await pool.query(
    "SELECT id, status, email_status FROM orders WHERE idempotency_key = $1",
    [key]
  );
  return result.rows[0] || null;
}

function respondExisting(res, order) {
  if (order.email_status === "failed") {
    return respond(res, 502, {
      error: `Bestellung ${order.id} ist gespeichert, aber die Bestätigung konnte nicht versendet werden. Bitte kontaktiere ${MAIL_TO}.`,
      orderId: order.id
    });
  }
  if (order.email_status === "pending") {
    return respond(res, 202, {
      ok: true,
      orderId: order.id,
      status: order.status,
      emailStatus: order.email_status,
      message: `Bestellung ${order.id} ist gespeichert. Die Bestätigung steht noch aus; kontaktiere bei Rückfragen ${MAIL_TO}.`
    });
  }
  return respond(res, 200, {
    ok: true,
    orderId: order.id,
    status: order.status,
    emailStatus: order.email_status,
    message: "Diese Bestellung wurde bereits angenommen."
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { error: "Methode nicht erlaubt." });
  }
  if (!validOrigin(req)) return respond(res, 403, { error: "Ungültige Anfragequelle." });

  const body = typeof req.body === "string" ? (() => {
    try { return JSON.parse(req.body); } catch { return null; }
  })() : req.body;
  if (!body || Buffer.byteLength(JSON.stringify(body), "utf8") > 20000) {
    return respond(res, 400, { error: "Ungültige Bestelldaten." });
  }
  if (typeof body.website === "string" && body.website.trim()) {
    return respond(res, 202, { ok: true });
  }

  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return respond(res, 400, { error: "Bitte wiederhole den Checkout, die Bestellkennung fehlt." });
  }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return respond(res, 503, { error: "Bestellungen sind nicht verfügbar: E-Mail-Dienst (RESEND_API_KEY und MAIL_FROM) nicht eingerichtet." });
  }

  let order;
  try {
    const catalog = await loadCatalog();
    order = normalizeCheckout(body, catalog);
  } catch (error) {
    return respond(res, error.statusCode || 400, { error: error.message });
  }

  let pool;
  let client;
  let orderId;
  try {
    pool = getPool();
    const previous = await findExisting(pool, idempotencyKey);
    if (previous) return respondExisting(res, previous);

    client = await pool.connect();
    await client.query("BEGIN");
    orderId = `RW-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    await client.query(
      `INSERT INTO orders
       (id, idempotency_key, customer_name, customer_email, customer_phone, address,
        country_code, delivery_method, payment_method, subtotal_cents, shipping_cents, total_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        orderId, idempotencyKey, order.address.name, order.address.email,
        order.address.phone, JSON.stringify(order.address), order.countryCode,
        order.deliveryMethod, order.paymentMethod, order.subtotalCents,
        order.shippingCents, order.totalCents
      ]
    );

    for (const item of [...order.items].sort((a, b) => a.sku.localeCompare(b.sku))) {
      await client.query(
        "INSERT INTO inventory (sku, stock) VALUES ($1, 0) ON CONFLICT (sku) DO NOTHING",
        [item.sku]
      );
      const stockResult = await client.query(
        "SELECT stock FROM inventory WHERE sku = $1 FOR UPDATE",
        [item.sku]
      );
      if (!stockResult.rows[0] || stockResult.rows[0].stock < item.qty) {
        const error = new Error(`Produkt ${item.name} (${item.variant}) ist nicht auf Lager.`);
        error.statusCode = 409;
        throw error;
      }
      await client.query(
        "UPDATE inventory SET stock = stock - $1, updated_at = now() WHERE sku = $2 AND stock >= $1",
        [item.qty, item.sku]
      );
      await client.query(
        `INSERT INTO order_items
         (order_id, product_id, sku, product_name, variant_name, quantity, unit_price_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orderId, item.productId, item.sku, item.name, item.variant, item.qty, item.unitPriceCents]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
    }
    if (error.code === "23505" && pool) {
      try {
        const existing = await findExisting(pool, idempotencyKey);
        if (existing) return respondExisting(res, existing);
      } catch {
        return respond(res, 503, { error: "Bestellung konnte nicht überprüft werden. Bitte versuche es erneut." });
      }
    }
    if (error.statusCode) return respond(res, error.statusCode, { error: error.message });
    if (!pool && error.statusCode === 503) return respond(res, 503, { error: error.message });
    console.error("Bestellung konnte nicht gespeichert werden:", error.code || "database_error");
    return respond(res, 503, { error: "Bestellung konnte nicht gespeichert werden. Bitte versuche es später erneut." });
  } finally {
    client?.release();
  }

  const bankDetails = {
    name: process.env.BANK_ACCOUNT_NAME || "",
    iban: process.env.BANK_IBAN || "",
    bic: process.env.BANK_BIC || ""
  };
  const message = formatEmail(order, orderId, bankDetails);
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const [customerResult, shopResult] = await Promise.all([
      resend.emails.send({
        from: process.env.MAIL_FROM,
        to: [order.address.email],
        replyTo: MAIL_TO,
        subject: `Bestellbestätigung ${orderId} – RIDEWORKS`,
        html: message.html,
        text: message.text
      }),
      resend.emails.send({
        from: process.env.MAIL_FROM,
        to: [MAIL_TO],
        replyTo: order.address.email,
        subject: `Neue Bestellung ${orderId} von ${order.address.name}`,
        html: message.html,
        text: message.text
      })
    ]);
    if (customerResult.error || shopResult.error) throw new Error("email_provider_error");
    await pool.query("UPDATE orders SET email_status = 'sent' WHERE id = $1", [orderId]);
    return respond(res, 201, {
      ok: true,
      orderId,
      status: "payment_pending",
      emailStatus: "sent",
      totalCents: order.totalCents,
      message: "Bestellung gespeichert und Bestätigung versendet."
    });
  } catch {
    try {
      await pool.query("UPDATE orders SET email_status = 'failed' WHERE id = $1", [orderId]);
    } catch {
      console.error("E-Mail-Status konnte nicht in der Datenbank aktualisiert werden.");
    }
    console.error("Bestellung gespeichert, E-Mail-Versand fehlgeschlagen.");
    return respond(res, 502, {
      error: `Bestellung ${orderId} wurde gespeichert, aber die Bestätigung konnte nicht versendet werden. Bitte kontaktiere ${MAIL_TO}.`,
      orderId
    });
  }
}
