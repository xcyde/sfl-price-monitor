import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrices } from './formatPrices.ts';

test('formatPrices: empty list returns placeholder message', () => {
  const result = formatPrices([]);
  assert.deepEqual(result, ['No prices available yet.']);
});

test('formatPrices: items are sorted alphabetically by name', () => {
  const prices = [
    { itemName: 'Zucchini', price: 10, fetchedAt: new Date() },
    { itemName: 'Apple', price: 5, fetchedAt: new Date() },
    { itemName: 'Banana', price: 3, fetchedAt: new Date() },
  ];
  const [msg] = formatPrices(prices);
  const content = msg.replace('<pre>', '').replace('</pre>', '');
  const lines = content.split('\n');
  assert.equal(lines[0], 'Apple: 5');
  assert.equal(lines[1], 'Banana: 3');
  assert.equal(lines[2], 'Zucchini: 10');
});

test('formatPrices: wraps output in <pre> tags', () => {
  const prices = [{ itemName: 'Apple', price: 5, fetchedAt: new Date() }];
  const [msg] = formatPrices(prices);
  assert.ok(msg.startsWith('<pre>'));
  assert.ok(msg.endsWith('</pre>'));
});

test('formatPrices: escapes HTML special characters in item names', () => {
  const prices = [{ itemName: 'A&B <Item>', price: 1, fetchedAt: new Date() }];
  const [msg] = formatPrices(prices);
  assert.ok(msg.includes('A&amp;B &lt;Item&gt;'));
  assert.ok(!msg.includes('<Item>'));
});

test('formatPrices: splits into multiple messages when content exceeds 4096 chars', () => {
  const prices = Array.from({ length: 300 }, (_, i) => ({
    itemName: `Item${String(i).padStart(3, '0')}WithLongishName`,
    price: 999.99,
    fetchedAt: new Date(),
  }));
  const messages = formatPrices(prices);
  assert.ok(messages.length > 1, `expected multiple messages, got ${messages.length}`);
  for (const msg of messages) {
    assert.ok(msg.length <= 4096, `message length ${msg.length} exceeds 4096`);
  }
});

test('formatPrices: single item produces exactly one message', () => {
  const prices = [{ itemName: 'Apple', price: 1.5, fetchedAt: new Date() }];
  const messages = formatPrices(prices);
  assert.equal(messages.length, 1);
});
