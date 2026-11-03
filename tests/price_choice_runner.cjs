const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = { document: { getElementById: () => null } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/labs.js', 'utf8'), context);
const model = context.DongnePriceChoice;
const candidate = Object.freeze({ id: 'B', sale_krw: 123456789 });
const before = JSON.stringify(candidate);
for (let discount = 0; discount <= 30; discount++) {
  const quote = model.price(candidate.sale_krw, discount);
  assert.equal(quote.assumed, Math.round(candidate.sale_krw * (100 - discount) / 100));
  assert.equal(quote.difference + quote.assumed, candidate.sale_krw);
}
for (const invalid of [NaN, Infinity, 0, -1, '100', null, 1.5]) assert.equal(model.price(invalid, 10), null);
for (const invalid of [-1, 31, 2.5, NaN, '10']) assert.equal(model.price(100, invalid), null);
const state = model.create();
assert.equal(state.confirm('b', 100), false);
state.reset(candidate.id);
assert.equal(state.adjust(10), true);
assert.equal(state.decision, null); // slider alone never confirms
for (const choice of ['a', 'b', 'unsure']) {
  assert.equal(state.confirm(choice, candidate.sale_krw), true);
  assert.equal(state.decision.choice, choice);
  assert.equal(state.decision.discount, 10);
}
const snapshot = state.decision;
state.adjust(11);
assert.equal(state.decision, null);
assert.equal(snapshot.discount, 10);
assert.equal(state.adjust(31), false);
assert.equal(state.discount, 11);
state.reset('C'); // replacing comparison invalidates all previous prices/decisions
assert.equal(state.discount, 0);
assert.equal(state.decision, null);
state.confirm('a', 100);
state.reset(); // same reset used for lens:clear and lens:analysis
assert.equal(state.b, null);
assert.equal(state.decision, null);
assert.equal(state.discount, 0);
assert.equal(JSON.stringify(candidate), before);
console.log('price choice: discounts, rounding, immutability, confirmation and reset passed');
