// Checks payment tracking without touching Gmail. Run from boc-server against the
// local database (any state - everything it creates is rolled back):
//   node test-helpers/payments-check.mjs
//
// Stage 1 parses the receipts in test-helpers/receipts/ - real Brown Marketplace
// notifications with every personal detail replaced by the seeded test users - and
// asserts the extracted facts. Stage 2 runs queries.applyPayment inside a transaction
// against trips created for the purpose and asserts the matching policy.
import "dotenv/config";
import assert from "assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseReceipt } from "../payments/receipt.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "receipts");
const read = (name) => fs.readFile(path.join(DIR, `receipt-${name}.eml`));

// STAGE 1 - parsing
const expected = {
  //Sept 2026 template: "Stock Number" inline, no promo
  single: { orderNumber: "943032", tripClass: "C", unitPrice: 15, quantity: 1, cartTotal: 15, email: "test@du.de", altEmail: "test@du.de" },
  //Older template, financial-aid promo brings Total to $0.00 - unit price must still be read
  promo: { orderNumber: "927935", tripClass: "A", unitPrice: 5, quantity: 1, cartTotal: 5, email: "test2@du.de", altEmail: "test2@du.de" },
  //Two-item cart (F + J); this is the F notification, and the cart total is F + J
  cart: { orderNumber: "926389", tripClass: "F", unitPrice: 30, quantity: 1, cartTotal: 80, email: "test@du.de", altEmail: "test@du.de" },
  //Lowercase "trip" product with no form fields
  nofields: { orderNumber: "921440", tripClass: "H", unitPrice: 40, quantity: 1, cartTotal: 40, email: "test2@du.de", altEmail: null },
};
for (const [name, want] of Object.entries(expected)) {
  assert.deepEqual(parseReceipt(await read(name)), want, `receipt-${name}.eml`);
}
const genuine = (await read("single")).toString("latin1");
assert.throws(() => parseReceipt(genuine.replace("dkim=pass header.i=@touchnet.com", "dkim=fail header.i=@touchnet.com")), /DKIM/);
assert.throws(() => parseReceipt(genuine.replace(/^Authentication-Results: mx\.google\.com;.*(\r?\n[ \t].*)*/m, "")), /DKIM/);
assert.throws(() => parseReceipt(genuine.replace("Class C Trip Ordered", "Membership Ordered")), /subject/);
console.log("STAGE 1 ok - all receipts parse, forgeries rejected");

// STAGE 2 - matching. Imports the models here so Stage 1 works without a database.
const { default: sequelize } = await import("../sequelize.mjs");
const { default: models } = await import("../models.mjs");
const { default: queries } = await import("../queries.mjs");
const { User, Trip, TripSignUp } = models;
await sequelize.sync(); //queries.mjs kicks this off in the background; wait for it

const t = await sequelize.transaction();
const opt = { transaction: t };
try {
  const buyer = await User.create({ firstName: "Pay", lastName: "Check", email: "pay_check@brown.edu", role: "Participant" }, opt);
  const trip = (name, plannedDate, fields) =>
    Trip.create({ tripName: name, plannedDate, category: "Hiking", status: "Pre-Trip", maxSize: 5, ...fields }, opt);
  const later = await trip("PayCheck C later", "2027-03-20", { class: "C" });
  const sooner = await trip("PayCheck C sooner", "2027-03-10", { class: "C" });
  const custom = await trip("PayCheck override", "2027-03-15", { priceOverride: 12.5 });
  const twoItem = await trip("PayCheck two-item", "2027-03-25", { priceOverride: 85 }); //bought as G + J in one cart
  const classF = await trip("PayCheck F", "2027-03-30", { class: "F" });
  const waitlisted = await trip("PayCheck C waitlisted", "2027-03-01", { class: "C" });
  const signup = (tripId, fields) =>
    TripSignUp.create({ userId: buyer.id, tripId, tripRole: "Participant", confirmed: true, ...fields }, opt);
  await signup(later.id, { status: "Selected" });
  await signup(sooner.id, { status: "Attended" });
  await signup(custom.id, { status: "Selected" });
  await signup(twoItem.id, { status: "Selected" });
  await signup(classF.id, { status: "Selected" });
  await signup(waitlisted.id, { status: "Waitlisted" }); //Sooner than all, but not owed yet

  const receipt = (fields) => ({ email: "pay_check@brown.edu", altEmail: null, unitPrice: 15, quantity: 1, cartTotal: 15, ...fields });
  const names = (marked) => marked.map((s) => s.Trip.tripName);

  assert.deepEqual(names(await queries.applyPayment(receipt({ email: "stranger@brown.edu" }), opt)), [], "unknown buyer");
  assert.deepEqual(names(await queries.applyPayment(receipt({ unitPrice: 50, cartTotal: 50 }), opt)), [], "no trip at that price");
  assert.deepEqual(names(await queries.applyPayment(receipt(), opt)), ["PayCheck C sooner"], "oldest eligible at $15");
  assert.deepEqual(names(await queries.applyPayment(receipt(), opt)), ["PayCheck C later"], "next oldest, sooner now paid");
  assert.deepEqual(names(await queries.applyPayment(receipt(), opt)), [], "nothing left at $15 (waitlisted ignored)");
  assert.deepEqual(
    names(await queries.applyPayment(receipt({ email: "nobody@example.com", altEmail: "PAY_CHECK@brown.edu", unitPrice: 12.5 }), opt)),
    ["PayCheck override"], "price override, buyer found via the form-field email (case-insensitively)");
  const twoItemCart = receipt({ unitPrice: 50, quantity: 1, cartTotal: 85 }); //the J notification of a G + J cart
  assert.deepEqual(names(await queries.applyPayment(twoItemCart, opt)), ["PayCheck two-item"], "multi-item cart matches at the cart total");
  assert.deepEqual(names(await queries.applyPayment(twoItemCart, opt)), [], "the other product's notification is a no-op");
  assert.deepEqual(names(await queries.applyPayment(receipt({ unitPrice: 30, cartTotal: 80 }), opt)), ["PayCheck F"], "no trip at the cart total, so the unit price");
  const paid = await TripSignUp.count({ where: { userId: buyer.id, paid: true }, ...opt });
  assert.equal(paid, 5);
  console.log("STAGE 2 ok - matching policy holds");
} catch (err) {
  console.error("FAIL:", err.message);
  process.exitCode = 1;
} finally {
  await t.rollback();
  await sequelize.close();
}
