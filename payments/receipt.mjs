//Parses one TouchNet "product ordered" notification from the Brown Marketplace into the
//facts the payment watcher matches on. Pure: no network, no database, no logging.
//
//What the club actually receives (every receipt from March to September 2026 was checked):
//  - One email per PRODUCT ordered, not per order. A cart with two trip classes produces
//    two emails sharing an order number, each listing the whole cart; a product without
//    notifications enabled (Class G, as of 2026-09) produces none. So every email is
//    treated as exactly one payment - the item named in its subject. The cart total is
//    also returned because trips priced above any single item are paid as two items
//    in one cart (see queries.applyPayment).
//  - The amount charged is NOT the price. 89 of 131 orders carried a financial-aid promo
//    code, mostly bringing "Total:" to $0.00. The item row's Unit Price identifies the trip.
//  - The body is a single quoted-printable text/html part. "Order:" and "Contact Email:"
//    (the checkout address) are always present; some products add a form "Email Address:"
//    field, kept as a fallback. Two item-table layouts exist ("Item Stock Number Quantity
//    Unit Price Detail Total" until Sept 2026, "Item Quantity Unit Price Total" since).
//
//Throws on anything it doesn't recognise. A throw means the template changed (or the
//message isn't a receipt), never that the student didn't pay - the watcher leaves such
//messages unprocessed so a parser fix picks them up.

//Gmail's own verdict on the message. Anyone can put TouchNet's address in From:, so the
//DKIM result Gmail stamps on arrival is what makes a receipt trustworthy.
const AUTHENTIC = /^mx\.google\.com;[\s\S]*\bdkim=pass\b[\s\S]*header\.i=@touchnet\.com/;
const SENDER = "campuspayments@touchnet.com";
const SUBJECT = /Outing Club-Class ([A-Z]) trip Ordered/i;
const ITEM_TABLE = /Unit Price(?: Detail)? Total (.*?) Subtotal:/;
const ITEM_ROW = /Outing Club-Class ([A-Z]) trip\b.*?\b(\d+) \$([\d.]+) \$[\d.]+/gi;
const EMAIL = /\S+@\S+/;

//RFC 5322 header block -> { name: [values] }, names lowercased, folded lines unfolded
function parseHeaders(block) {
  const headers = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).toLowerCase();
    (headers[name] ??= []).push(line.slice(idx + 1).trim());
  }
  return headers;
}

function decodeBody(body, encoding) {
  if (encoding === "quoted-printable") {
    //Soft breaks vanish; =XX escapes are bytes, so reassemble as UTF-8 via latin1
    const bytes = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
  if (encoding === "base64") return Buffer.from(body, "base64").toString("utf8");
  return body;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&(\w+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\s+/g, " ");
}

//Takes the raw RFC 822 source as a Buffer or string. Returns
//  { orderNumber, tripClass, unitPrice, quantity, cartTotal, email, altEmail }
//with emails lowercased, altEmail null when the product has no form field, and cartTotal
//the sum of unit price x quantity over every item in the cart.
export function parseReceipt(source) {
  //latin1 keeps one char per byte so quoted-printable escapes decode correctly
  const raw = Buffer.isBuffer(source) ? source.toString("latin1") : source;
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) throw new Error("no header/body separator");
  const headers = parseHeaders(raw.slice(0, split));
  const header = (name) => headers[name]?.[0] ?? "";

  if (!header("from").includes(SENDER)) throw new Error(`not from ${SENDER}`);
  if (!(headers["authentication-results"] ?? []).some((v) => AUTHENTIC.test(v))) {
    throw new Error("no passing DKIM verdict from Gmail for touchnet.com");
  }
  const subject = header("subject").match(SUBJECT);
  if (!subject) throw new Error(`unrecognised subject "${header("subject")}"`);
  if (!/^text\/html/i.test(header("content-type"))) {
    throw new Error(`unexpected Content-Type "${header("content-type")}"`);
  }

  const encoding = header("content-transfer-encoding").toLowerCase();
  const text = htmlToText(decodeBody(raw.slice(split).trimStart(), encoding));
  const field = (label) => text.match(new RegExp(`${label}:\\s*(\\S+)`))?.[1];

  const emailField = (label) => (EMAIL.test(field(label) ?? "") ? field(label).toLowerCase() : null);

  const orderNumber = field("Order");
  if (!/^\d+$/.test(orderNumber ?? "")) throw new Error("no order number");
  const email = emailField("Contact Email");
  if (!email) throw new Error("no contact email");

  const table = text.match(ITEM_TABLE)?.[1];
  if (!table) throw new Error("no item table");
  const tripClass = subject[1].toUpperCase();
  const rows = [...table.matchAll(ITEM_ROW)];
  const row = rows.find((r) => r[1].toUpperCase() === tripClass);
  if (!row) throw new Error(`no item row for class ${tripClass}`);

  return {
    orderNumber,
    tripClass,
    unitPrice: Number(row[3]),
    quantity: Number(row[2]),
    cartTotal: rows.reduce((sum, r) => sum + Number(r[3]) * Number(r[2]), 0),
    email,
    altEmail: emailField("Email Address"),
  };
}
