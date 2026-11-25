import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeCheckout } from "../lib/commerce.js";

const catalog = {
  products: [{
    id: "part",
    name: "Part",
    active: true,
    variants: [{ sku: "PART-1", name: "One", price: 25 }]
  }]
};
const base = {
  customer: {
    name: "Buyer",
    email: "buyer@example.com",
    street: "Street 1",
    zip: "1010",
    city: "Vienna",
    country: "Österreich"
  },
  items: [{ productId: "part", sku: "PART-1", qty: 1 }],
  paymentMethod: "cash_pickup",
  deliveryMethod: "pickup"
};

test("calculates shipping from catalog prices and the configured destination", () => {
  const austria = normalizeCheckout({
    ...base,
    paymentMethod: "bank_transfer",
    deliveryMethod: "shipping"
  }, catalog, { BANK_ACCOUNT_NAME: "Shop", BANK_IBAN: "configured" });
  assert.equal(austria.shippingCents, 490);
  assert.equal(austria.totalCents, 2990);

  const order = normalizeCheckout({
    ...base,
    paymentMethod: "bank_transfer",
    deliveryMethod: "shipping",
    items: [{ productId: "part", sku: "PART-1", qty: 2 }],
    customer: { ...base.customer, country: "Deutschland" }
  }, catalog, { BANK_ACCOUNT_NAME: "Shop", BANK_IBAN: "configured" });
  assert.equal(order.subtotalCents, 5000);
  assert.equal(order.shippingCents, 790);
  assert.equal(order.totalCents, 5790);

  const free = normalizeCheckout({
    ...base,
    paymentMethod: "bank_transfer",
    deliveryMethod: "shipping",
    items: [{ productId: "part", sku: "PART-1", qty: 3 }]
  }, catalog, { BANK_ACCOUNT_NAME: "Shop", BANK_IBAN: "configured" });
  assert.equal(free.shippingCents, 0);
  assert.equal(free.totalCents, 7500);
});

test("ignores client prices and rejects invalid SKU, quantity, and payment", () => {
  const order = normalizeCheckout({
    ...base,
    items: [{ productId: "part", sku: "PART-1", qty: 1, price: 0.01 }]
  }, catalog);
  assert.equal(order.totalCents, 2500);
  for (const items of [
    [{ productId: "part", sku: "unknown", qty: 1 }],
    [{ productId: "part", sku: "PART-1", qty: 0 }],
    [{ productId: "part", sku: "PART-1", qty: 100 }]
  ]) {
    assert.throws(() => normalizeCheckout({ ...base, items }, catalog));
  }
  assert.throws(() => normalizeCheckout({ ...base, paymentMethod: "paypal" }, catalog));
  assert.throws(() => normalizeCheckout({
    ...base,
    deliveryMethod: "shipping",
    paymentMethod: "cash_pickup"
  }, catalog));
  assert.throws(() => normalizeCheckout({
    ...base,
    items: [{ productId: "part", sku: "PART-1", qty: "1" }]
  }, catalog));
  assert.throws(() => normalizeCheckout({
    ...base,
    items: [
      { productId: "part", sku: "PART-1", qty: 99 },
      { productId: "part", sku: "PART-1", qty: 1 }
    ]
  }, catalog));
});

test("refuses bank transfer when the owner has not configured payment details", () => {
  assert.throws(
    () => normalizeCheckout({ ...base, paymentMethod: "bank_transfer" }, catalog, {}),
    { statusCode: 503 }
  );
});

test("keeps all existing seed products and their variants in the server catalog", async () => {
  const data = JSON.parse(await readFile(new URL("../products.json", import.meta.url), "utf8"));
  assert.deepEqual(data.products.map((product) => product.id), ["relais", "spiegel", "halter", "bezug"]);
  assert.deepEqual(data.products.find((product) => product.id === "halter").variants.map((variant) => variant.price), [49.9, 44.9, 29.9]);
  const skus = data.products.flatMap((product) => product.variants.map((variant) => variant.sku));
  assert.equal(new Set(skus).size, skus.length);
  assert.equal(data.products.length, 15);
  const additions = data.products.slice(4);
  assert.equal(additions.length, 11);
  assert.deepEqual(additions[0].variants.map((variant) => variant.name), ["Rotes Display", "Blaues Display"]);
  assert.ok(additions.every((product) =>
    product.active === false && product.variants.every((variant) => variant.price === null)
  ));
  assert.throws(() => normalizeCheckout({
    ...base,
    items: [{ productId: "thermometer", sku: "RW-THERMOMETER-RED", qty: 1 }]
  }, data));
});
