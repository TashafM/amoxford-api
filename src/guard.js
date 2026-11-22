// Validation + simple rate limit for the public enquiry form (/send-query).

// Letters in any script (so Hindi names work), spaces, dot, apostrophe, hyphen.
const NAME_RE = /^\p{L}[\p{L}\p{M} .'-]*$/u;
// Markup, template and SQL injection probes. Real parents never type these.
const PROBE_RE = /<\s*\/?\s*[a-z!?]|\$\{|<%|%>|\bon\w+\s*=|javascript:|;\s*--|\b(drop|truncate)\s+table\b|\bunion\s+select\b/i;

// Returns { data } with cleaned values, or { error } with a message for the user.
function validateEnquiry(body = {}) {
  const { name, phone_number, message } = body;
  if (![name, phone_number, message].every((v) => typeof v === "string")) {
    return { error: "All fields are required." };
  }

  const cleanName = name.trim().replace(/\s+/g, " ");
  const cleanMessage = message.trim();
  // Accept +91 / 91 / 0 prefixes and spaces/dashes, store plain 10 digits.
  const digits = phone_number.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");

  if (cleanName.length < 2 || cleanName.length > 60 || !NAME_RE.test(cleanName)) {
    return { error: "Please enter a valid name (letters only)." };
  }
  // Indian mobile: 10 digits starting 6-9, not one repeated digit (9999999999).
  if (!/^[6-9]\d{9}$/.test(digits) || /^(\d)\1{9}$/.test(digits)) {
    return { error: "Please enter a valid 10-digit mobile number." };
  }
  if (cleanMessage.length < 5 || cleanMessage.length > 5000) {
    return { error: "Message must be between 5 and 5000 characters." };
  }
  if (PROBE_RE.test(cleanName) || PROBE_RE.test(cleanMessage)) {
    return { error: "Your message contains characters that are not allowed." };
  }
  return { data: { name: cleanName, phone_number: digits, message: cleanMessage } };
}

// ponytail: in-memory per-IP limit, fine for one pm2 process. Use Redis if the API ever runs on several.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map(); // ip -> [timestamps]

function isRateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10000) {
    for (const [k, v] of hits) if (now - v[v.length - 1] >= WINDOW_MS) hits.delete(k);
  }
  return recent.length > MAX_PER_WINDOW;
}

module.exports = { validateEnquiry, isRateLimited };

// Self-check: node utils/enquiryGuard.js
if (require.main === module) {
  const assert = require("assert");
  const ok = (b) => assert.ok(validateEnquiry(b).data, JSON.stringify(b));
  const bad = (b) => assert.ok(validateEnquiry(b).error, JSON.stringify(b));
  const base = { name: "Ravi Kumar", phone_number: "9876543210", message: "Admission enquiry for class 5" };

  ok(base);
  ok({ ...base, name: "राहुल शर्मा" });
  ok({ ...base, name: "D'Souza Anne-Marie" });
  ok({ ...base, phone_number: "+91 98765-43210" });
  assert.strictEqual(validateEnquiry({ ...base, phone_number: "+919876543210" }).data.phone_number, "9876543210");
  ok({ ...base, message: "Fees for 2 kids? Is 50% discount < 10 days possible; thanks" });

  bad({ ...base, name: 'test"><img src=x onerror=alert(1)>' });
  bad({ ...base, name: "<script>alert(1)</script>" });
  bad({ ...base, message: "<script>alert(1)</script>" });
  bad({ ...base, message: "${7*7}" });
  bad({ ...base, message: "<%= 7*7 %>" });
  bad({ ...base, message: "'; DROP TABLE users;--" });
  bad({ ...base, phone_number: "1234567890" });
  bad({ ...base, phone_number: "9999999999" });
  bad({ ...base, phone_number: "99999" });
  bad({ ...base, name: { $gt: "" } });
  bad({ ...base, message: "hi" });
  bad({});

  for (let i = 0; i < 5; i++) assert.ok(!isRateLimited("1.1.1.1", 1000 + i));
  assert.ok(isRateLimited("1.1.1.1", 2000));
  assert.ok(!isRateLimited("2.2.2.2", 2000));
  assert.ok(!isRateLimited("1.1.1.1", 2000 + WINDOW_MS + 10));
  console.log("enquiryGuard ok");
}
