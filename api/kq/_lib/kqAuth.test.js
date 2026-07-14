// Live-backend verification: proves the server-side handshake authenticates and
// can call a signed WebAgenda function for real. Read-only (GetConfig).
const assert = require('assert');
const { signedPost } = require('./kqAuth');

(async () => {
  const cfg = await signedPost('WebAgenda/GetConfig');
  assert.strictEqual(cfg.status, 200);
  assert.ok(Array.isArray(cfg.body.locations) && cfg.body.locations.length >= 2, 'expected locations');
  assert.ok(cfg.body.locations.some(l => l.Name === 'Kinovea Lasne'), 'expected Kinovea Lasne');
  assert.ok(Array.isArray(cfg.body.therapists) && cfg.body.therapists.length >= 1, 'expected therapists');
  console.log('kqAuth OK — locations:', cfg.body.locations.length, '| therapists:', cfg.body.therapists.length);
})().catch(e => { console.error('kqAuth FAIL:', e.message); process.exit(1); });
