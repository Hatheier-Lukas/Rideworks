
import { Resend } from "resend";

const MAIL_TO = "hatheierlukas@gmail.com";
const MAIL_FROM =
  process.env.MAIL_FROM || "RIDEWORKS <onboarding@resend.dev>";

function clean(value, max = 150) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function euro(value) {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Methode nicht erlaubt." });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY fehlt.");
    return res.status(500).json({ error: "E-Mail-Dienst nicht eingerichtet." });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const body = req.body || {};

    if (clean(body.website, 50)) {
      return res.status(200).json({ ok: true });
    }

    const customer = body.customer || {};

    const c = {
      name: clean(customer.name, 100),
      email: clean(customer.email, 150),
      phone: clean(customer.phone, 40),
      street: clean(customer.street, 150),
      zip: clean(customer.zip, 12),
      city: clean(customer.city, 80),
      country: clean(customer.country, 60),
      note: clean(customer.note, 1000)
    };

    if (!c.name || !c.street || !c.zip || !c.city) {
      return res.status(400).json({ error: "Lieferadresse unvollständig." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
      return res.status(400).json({ error: "Ungültige E-Mail-Adresse." });
    }

    const items = Array.isArray(body.items)
      ? body.items.slice(0, 50).map((item) => ({
          name: clean(item?.name),
          variant: clean(item?.variant),
          qty: Math.floor(Number(item?.qty)),
          price: Number(item?.price)
        }))
      : [];

    if (
      !items.length ||
      items.some(item =>
        !item.name ||
        !Number.isInteger(item.qty) ||
        item.qty < 1 ||
        item.qty > 99 ||
        !Number.isFinite(item.price) ||
        item.price < 0 ||
        item.price > 100000
      )
    ) {
      return res.status(400).json({ error: "Warenkorb ungültig." });
    }

    const total = items.reduce(
      (sum, item) => sum + item.qty * item.price,
      0
    );

    const moped = clean(body.moped, 80);

    const productRows = items.map(item => `
      <tr>
        <td>${escapeHtml(item.qty + " × " + item.name +
          (item.variant ? " (" + item.variant + ")" : ""))}</td>
        <td>${euro(item.price * item.qty)}</td>
      </tr>
    `).join("");

    const html = `
      <h2>Neue RIDEWORKS-Bestellung</h2>
      <table cellpadding="8" border="1" style="border-collapse:collapse">
        <tr><th>Produkt</th><th>Gesamtpreis</th></tr>
        ${productRows}
        <tr><td><strong>Gesamtsumme</strong></td>
        <td><strong>${euro(total)}</strong></td></tr>
      </table>

      ${moped ? `<p><strong>Moped:</strong> ${escapeHtml(moped)}</p>` : ""}

      <h3>Kundendaten</h3>
      <p>
        ${escapeHtml(c.name)}<br>
        ${escapeHtml(c.email)}<br>
        ${escapeHtml(c.phone)}
      </p>

      <h3>Lieferadresse</h3>
      <p>
        ${escapeHtml(c.street)}<br>
        ${escapeHtml(c.zip)} ${escapeHtml(c.city)}<br>
        ${escapeHtml(c.country)}
      </p>

      ${c.note ? `<p><strong>Anmerkung:</strong> ${escapeHtml(c.note)}</p>` : ""}
    `;

    const text = [
      "Neue RIDEWORKS-Bestellung",
      "",
      ...items.map(item =>
        `${item.qty} x ${item.name} ${item.variant} - ${euro(item.qty * item.price)}`
      ),
      "",
      `Gesamtsumme: ${euro(total)}`,
      "",
      `Name: ${c.name}`,
      `E-Mail: ${c.email}`,
      `Telefon: ${c.phone}`,
      `Adresse: ${c.street}, ${c.zip} ${c.city}, ${c.country}`,
      `Moped: ${moped}`,
      `Anmerkung: ${c.note}`
    ].join("\n");

    const { data, error } = await resend.emails.send({
      from: MAIL_FROM,
      to: [MAIL_TO],
      replyTo: c.email,
      subject: `RIDEWORKS-Bestellung von ${c.name}`,
      html,
      text
    });

    if (error) {
      console.error("Resend-Fehler:", error);
      return res.status(502).json({
        error: "E-Mail konnte nicht versendet werden."
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Bestellung erfolgreich versendet.",
      id: data?.id
    });

  } catch (error) {
    console.error("Bestellfehler:", error);
    return res.status(500).json({
      error: "Interner Fehler beim Bestellversand."
    });
  }
}
