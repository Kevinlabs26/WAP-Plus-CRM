import test from "node:test";
import assert from "node:assert/strict";
import { donationQrUrl } from "../src/lib/donation.ts";

test("donation QR URL encodes the selected donation page", () => {
  const url = donationQrUrl("https://example.com/donate?a=1&b=2");
  assert.match(url, /^https:\/\/api\.qrserver\.com\/v1\/create-qr-code\//);
  assert.match(url, /data=https%3A%2F%2Fexample\.com%2Fdonate%3Fa%3D1%26b%3D2/);
});
