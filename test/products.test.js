import test from "node:test";
import assert from "node:assert/strict";
import { validateProduct } from "../api/products.js";

const product = {
  id: "spec-test",
  name: "Test product",
  variants: [{
    sku: "SPEC-TEST-1",
    name: "Standard",
    price: 12.5,
    compareAtPrice: null,
    stock: 0,
    lowStock: 3
  }]
};

test("validates and cleans editable technical product details", () => {
  const result = validateProduct({
    ...product,
    subcategory: "  Elektronik ",
    compatibility: "  Derbi D50B0, Minarelli AM6  ",
    variants: [{ ...product.variants[0], image: "https://images.example.com/product.jpg", sku: "SPEC-TEST-NEW", previousSku: "SPEC-TEST-1" }],
    technicalDetails: {
      productType: "  LED-Relais\n",
      weight: "35 g",
      extra: [{ label: "Anschluss", value: "  2-polig\t" }]
    }
  });
  assert.equal(result.technicalDetails.productType, "LED-Relais");
  assert.equal(result.technicalDetails.weight, "35 g");
  assert.deepEqual(result.technicalDetails.extra, [{ label: "Anschluss", value: "2-polig" }]);
  assert.equal(result.variants[0].previousSku, "SPEC-TEST-1");
  assert.equal(result.subcategory, "Elektronik");
  assert.equal(result.compatibility, "Derbi D50B0, Minarelli AM6");
  assert.equal(result.variants[0].image, "https://images.example.com/product.jpg");
});

test("rejects invalid or oversized editable technical details", () => {
  assert.throws(() => validateProduct({
    ...product,
    technicalDetails: { voltage: { value: "12 V" } }
  }), /Text/);
  assert.throws(() => validateProduct({
    ...product,
    technicalDetails: { extra: [{ label: "", value: "Value" }] }
  }), /Merkmal und Wert/);
  assert.throws(() => validateProduct({
    ...product,
    technicalDetails: { extra: Array.from({ length: 31 }, (_, index) => ({ label: `Label ${index}`, value: "Value" })) }
  }), /höchstens 30/);
  assert.throws(() => validateProduct({
    ...product,
    variants: [{ ...product.variants[0], image: "http://images.example.com/product.jpg" }]
  }), /Produktbild/);
});
