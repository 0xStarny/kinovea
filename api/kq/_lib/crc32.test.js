const assert = require('assert');
const { crc32 } = require('./crc32');

// NOTE: KineQuick's crc32 is a variant (custom init/final convention), NOT standard
// IEEE CRC32 — so it does not match the usual 0x414FA339 known-answer. Real correctness
// is proven by kqAuth.test.js authenticating against the live backend (a wrong crc32
// yields wrong session signatures and a 401, not a 200 with real config data).
// These checks lock structural invariants + a regression baseline from the live-verified port.

// Deterministic + unsigned
const a = crc32('abc', 0);
assert.strictEqual(a, crc32('abc', 0));
assert.strictEqual(a >>> 0, a);
assert.ok(a >= 0 && a <= 0xFFFFFFFF);

// init=undefined vs init=0 are different code paths and must both stay unsigned ints
const u = crc32('hello world');
const z = crc32('hello world', 0);
assert.ok(Number.isInteger(u) && u >= 0 && u <= 0xFFFFFFFF);
assert.ok(Number.isInteger(z) && z >= 0 && z <= 0xFFFFFFFF);

// Regression baseline (value produced by the port that authenticates live)
assert.strictEqual(crc32('The quick brown fox jumps over the lazy dog'), 902591244);

console.log('crc32 OK');
