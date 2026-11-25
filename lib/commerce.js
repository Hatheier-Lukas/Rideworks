export const SHIPPING_CENTS = Object.freeze({ AT: 490, DE: 790 });
export const FREE_SHIPPING_THRESHOLD_CENTS = 7500;

export function normalizeCheckout(body, catalog, env = process.env) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Ungültige Bestelldaten.");
  }
  const customer = body.customer;
  const required = ["name", "email", "street", "zip", "city", "country"];
  if (!customer || required.some((key) => typeof customer[key] !== "string" || !customer[key].trim())) {
    throw new Error("Bitte gib eine vollständige Lieferadresse und E-Mail-Adresse an.");
  }

  const clean = (value, max) => value.trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
  const address = {
    name: clean(customer.name, 100),
    email: clean(customer.email, 254).toLowerCase(),
    phone: clean(typeof customer.phone === "string" ? customer.phone : "", 40),
    street: clean(customer.street, 150),
    zip: clean(customer.zip, 12),
    city: clean(customer.city, 80),
    country: clean(customer.country, 40),
    note: clean(typeof customer.note === "string" ? customer.note : "", 1000)
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
    throw new Error("Ungültige E-Mail-Adresse.");
  }

  const country = address.country.toLocaleLowerCase("de-AT");
  const countryCode = ["österreich", "osterreich", "austria", "at"].includes(country)
    ? "AT"
    : ["deutschland", "germany", "de"].includes(country) ? "DE" : null;
  if (!countryCode) throw new Error("Derzeit ist Versand nur nach Österreich und Deutschland verfügbar.");

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    throw new Error("Warenkorb ungültig.");
  }
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const requestedItems = body.items.map((requested) => {
    const product = products.get(requested?.productId);
    const variant = product?.variants.find((entry) => entry.sku === requested?.sku);
    const qty = requested?.qty;
    if (!product?.active || !variant || !Number.isFinite(variant.price) || variant.price <= 0 ||
        !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new Error("Warenkorb enthält ein ungültiges oder nicht verfügbares Produkt.");
    }
    return {
      productId: product.id,
      sku: variant.sku,
      name: product.name,
      variant: variant.name,
      qty,
      unitPriceCents: Math.round(variant.price * 100)
    };
  });
  const bySku = new Map();
  for (const item of requestedItems) {
    const existing = bySku.get(item.sku);
    if (existing) {
      existing.qty += item.qty;
      if (existing.qty > 99) throw new Error("Die Menge einer Produktvariante darf 99 nicht überschreiten.");
    } else {
      bySku.set(item.sku, item);
    }
  }
  const items = [...bySku.values()];

  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0);
  const deliveryMethod = body.deliveryMethod;
  if (!["shipping", "pickup"].includes(deliveryMethod)) {
    throw new Error("Bitte wähle Versand oder Abholung.");
  }
  const paymentMethod = body.paymentMethod;
  if (!["bank_transfer", "cash_pickup"].includes(paymentMethod)) {
    throw new Error("Diese Zahlart ist nicht verfügbar.");
  }
  if (paymentMethod === "cash_pickup" && deliveryMethod !== "pickup") {
    throw new Error("Barzahlung ist nur bei Abholung möglich.");
  }
  if (paymentMethod === "bank_transfer" && (!env.BANK_ACCOUNT_NAME || !env.BANK_IBAN)) {
    const error = new Error("Vorkasse ist derzeit nicht eingerichtet. Bitte kontaktiere den Shop.");
    error.statusCode = 503;
    throw error;
  }

  const shippingCents = deliveryMethod === "pickup" || subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : SHIPPING_CENTS[countryCode];
  return {
    address,
    countryCode,
    deliveryMethod,
    paymentMethod,
    items,
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents
  };
}
