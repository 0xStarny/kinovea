# Kinovea Booking App (powered by KineQuick) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a branded single-page booking UI for the Kinovea clinics that writes real appointments into the same KineQuick backend the clinic already uses, via a server-side proxy.

**Architecture:** A Vercel serverless proxy (`api/kq/*`) reproduces KineQuick's `synAuth` handshake server-side and exposes 4 same-origin JSON endpoints. A vanilla HTML/CSS/JS front (`rdv/`) consumes only those endpoints, presenting an all-on-one-page filter UX in the Kinovea visual identity. A zero-dep Node dev server allows local browser verification without the Vercel CLI.

**Tech Stack:** Node 18+ serverless functions (Vercel), `crypto-js@3.1.2` (byte-compatible with the site's own CryptoJS for AES/SHA-256), a hand-ported CRC32 (exact table from the site), vanilla front-end, deployed on the existing Vercel static project.

**Reconnaissance status:** The auth handshake, signed `GetConfig`, and signed `GetAvailabilities` are already PROVEN working against the live backend during brainstorming (see spec `docs/superpowers/specs/2026-07-14-kinequick-booking-app-design.md`). The proxy code below is a cleanup of that verified proof-of-concept, not a guess.

---

## Verified reference data (from live `WebAgenda/GetConfig`, root kq43414)

**Auth chain (all server-side):**
1. `GET https://www.q-top.be/online-planner-v2/php/request.handler.php?function=getAuthData&root=kq43414`
   → base64 → `CryptoJS.enc.Base64.parse(...).toString(Utf8)` → `JSON.parse(JSON.parse(x))` → `.result` → `JSON.parse` → `{statusCode, data}` → `JSON.parse(data)` = `{username:"webuser", password:<AES>, url:"https://aws1.kqc.be", root:"kq43414"}`.
2. `deck` AES key is a hidden field in the served planner HTML: `GET https://www.q-top.be/online-planner-v2/FR/?root=kq43414`, extract `id='deck' value='...'`. Decrypt: `CryptoJS.AES.decrypt(password, deck, {iv: root}).toString(Utf8)`.
3. `passwordHashHexa = SHA256("salt" + decryptedPassword)`.
4. `GET {url}/{root}/TimeStamp` (sequence step).
5. `GET {url}/{root}/auth?UserName=webuser` → `{result: serverNonce}`.
6. `clientNonce = SHA256("YYYY-MM-DD HH:MM:SS")` (local, month is `getMonth()` 0-based, zero-padded).
7. `GET {url}/{root}/auth?UserName=webuser&Password=SHA256(root+serverNonce+clientNonce+user+passwordHashHexa)&ClientNonce=clientNonce` → `{result: "<sessionId>+..."}`.
8. `sessionIdHexa8 = pad8(hex(sessionId))`; `sessionPrivateKey = crc32(passwordHashHexa, crc32(fullResult, 0))`.

**SessionSign(urlPath):** `tick = pad8-or-last8(hex(Date.now()))`; `sig = pad8(hex(crc32(urlPath, crc32(tick, sessionPrivateKey))))`; append `?session_signature=` (or `&` if `?` present) `+ sessionIdHexa8 + tick + sig`. All signed calls are `POST`; body (when present) is `JSON.stringify([ JSON.stringify(payloadObject) ])`.

**Config shapes:**
- `locations[]`: `{Id, Name, Address, OpeningTime, ClosingTime, specialties:[{ID, appointmentTypes:[{ID, Therapists:[therapistId...]}]}]}`
- `specialties[]`: `{Id, Description:{FR,NL,EN}}`
- `appointmentTypes[]`: `{Id, Duration, Description:{FR,NL,EN}}`
- `therapists[]`: `{Id, Name}`
- `webAgendaOptions`: `{MinBookingHours:3, MaxBookingDays:100, MaxTentativePerDay:10, MaxTentReqPerSession:10, ShowOnlyAvailableSlots:1, HideEmptyColumns:1, AppointmentReasonMandatory:"arNotMandatory", ...}`

**Locations (Id: Name):** 1 Kinovea Lasne · 23 Kinovea Rhode-Saint-Genèse · 24 Domiciles Lasne-Genappe · 25 Domiciles Waterloo-Braine l'Alleud · 26 Domiciles La Hulpe-Rixensart-Genval · 27 Domiciles Ottignies-LLN-Céroux-Mousty · 29 Domiciles Wavre-Chaumont-Gistoux-Grez Doiceau · 30 Domiciles Rhode-Beersel-Uccle · 33 Domiciles Forest-Saint-Gilles-Ixelles · 35 Domiciles Linkebeek-Beersel-Wauthier-Braine-Braine-l'Alleud-Rhode.
→ **Cabinets = {1, 23}; À domicile = all others.**

**GetAvailabilities** — request payload object: `{DateFrom:"dd/mm/yyyy", DateTo:"dd/mm/yyyy", OptionalLocationID:<int|"">, OptionalAppointmentTypeID:<int|"">, OptionalSpecialtyID:<int|"">}` (7-day window, Monday→Sunday). Response: `{availabilities:[{therapists:[{TherapistID, days:[{Date:"dd/mm/yyyy", dateDelphi:ISO, hasAnyOnlineReservableBlock, times:[{Start:"HH:MM", End:"HH:MM"}]}]}]}], availabilitiesDetail:{DateFrom, DateTo, OptionalFirstAvailableDate}}`.

**AddAppointment** — payload object (verified in `functions.js:5601` `getFormAppData`):
```json
{
  "patientDetails": {"Language":"FR","Title":"","FirstName":"","FamilyName":"","BirthDate":"","StreetNbr":"","ZIP":"","City":"","EMail":"","Telephone":""},
  "patientID": 0,
  "patientBirthdate": "",
  "appointmentRemark": "",
  "therapistID": 0,
  "specialtyID": 0,
  "appointmentTypedID": 0,
  "appointmentStart": "dd/mm/yyyy hh:mm",
  "locationID": 0
}
```
Existing patient → `patientID` from `GetExistingPatient`, `patientDetails` may be minimal. New patient → `patientID:0` + full `patientDetails`. Success status: `201` (created); `401/403/409` = slot already booked.

---

## File structure

```
kinovea/
├── package.json                 # NEW — declares crypto-js dep for the functions
├── vercel.json                  # MODIFY — keep subdomain routing; functions auto-detected
├── api/
│   └── kq/
│       ├── _lib/
│       │   ├── crc32.js         # NEW — exact CRC32 table + crc32()
│       │   └── kqAuth.js        # NEW — getAuthData, login, sessionSign, signedPost, module cache
│       ├── config.js            # NEW — GET → GetConfig (server-cached)
│       ├── availabilities.js    # NEW — POST {locationId,specialtyId,typeId,weekStart} → GetAvailabilities
│       ├── patient-lookup.js    # NEW — POST {niss} → GetExistingPatient
│       └── book.js              # NEW — POST {appointments[]} → AddAppointment (one by one)
├── rdv/
│   ├── index.html               # NEW — page skeleton + charte + "powered by KineQuick"
│   ├── rdv.css                  # NEW — Kinovea visual identity
│   └── rdv.js                   # NEW — data layer + state + rendering
├── dev-server.js                # NEW — zero-dep local server: static + /api/kq/* (LOCAL ONLY)
└── docs/superpowers/...         # specs + this plan
```

**Responsibility split:** `_lib/` = crypto + auth (never touches HTTP req/res shaping). Each `api/kq/*.js` = one endpoint: parse request → call `signedPost` → shape JSON response. `rdv.js` = only talks to `/api/kq/*`, never to KineQuick directly. Keep `rdv.js` sectioned (api / state / render-filters / render-calendar / render-form) — if it exceeds ~600 lines, split render modules out.

---

## Task 1: Project scaffolding + dev server

**Files:** Create `kinovea/package.json`, `kinovea/dev-server.js`; verify `kinovea/vercel.json`.

- [ ] **Step 1: Create `package.json`**
```json
{
  "name": "kinovea-site",
  "version": "1.0.0",
  "private": true,
  "scripts": { "dev": "node dev-server.js" },
  "dependencies": { "crypto-js": "3.1.2" }
}
```

- [ ] **Step 2: Install deps**
Run: `cd kinovea && npm install`
Expected: `node_modules/crypto-js` present, no errors.

- [ ] **Step 3: Create `dev-server.js`** — zero-dep static + API router matching Vercel's `(req,res)` handler contract, so the same `api/kq/*.js` files run locally and on Vercel.
```js
// Local dev only. Serves ./ as static and routes /api/kq/* to the handler modules.
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 3210;
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json' };

function collectBody(req){ return new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));}); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/kq/')) {
    const name = url.pathname.replace('/api/kq/','').replace(/\/$/,'');
    const file = path.join(__dirname, 'api', 'kq', name + '.js');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('no handler'); }
    delete require.cache[require.resolve(file)];
    const handler = require(file);
    req.query = Object.fromEntries(url.searchParams);
    req.body = {};
    if (req.method === 'POST') { const raw = await collectBody(req); try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; } }
    const shim = {
      _s:200,_h:{}, status(c){this._s=c;return this;},
      setHeader(k,v){this._h[k]=v;},
      json(o){res.writeHead(this._s,{'Content-Type':'application/json',...this._h});res.end(JSON.stringify(o));},
      end(t){res.writeHead(this._s,this._h);res.end(t||'');}
    };
    try { await handler(req, shim); } catch(e){ res.writeHead(500); res.end('handler error: '+e.message); }
    return;
  }
  // static
  let p = url.pathname === '/' ? '/rdv/index.html' : url.pathname;
  if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(__dirname, p);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
server.listen(PORT, () => console.log(`dev server on http://localhost:${PORT}`));
```

- [ ] **Step 4: Confirm `vercel.json` unaffected** — read it; ensure it does not `routes`-override `/api`. Vercel auto-serves `api/**.js` as functions. If existing config uses legacy `routes`, add a passthrough for `/api/(.*)`. Document any change inline.

- [ ] **Step 5: Commit**
```bash
cd kinovea && git add package.json dev-server.js && git commit -m "chore: add serverless deps + zero-dep local dev server"
```

---

## Task 2: CRC32 module (exact port)

**Files:** Create `kinovea/api/kq/_lib/crc32.js`; Verify: `kinovea/api/kq/_lib/crc32.test.js` (node, run directly).

- [ ] **Step 1: Write verification first** — `crc32.test.js`
```js
const { crc32 } = require('./crc32');
// crc32 of "" with init 0 must equal the site's behavior: crc32("",0) -> 0
const assert = require('assert');
assert.strictEqual(typeof crc32('abc', 0), 'number');
assert.strictEqual(crc32('abc', 0) >>> 0, crc32('abc', 0)); // unsigned
// Known cross-check: standard CRC32 of "The quick brown fox jumps over the lazy dog" = 0x414FA339
assert.strictEqual(crc32('The quick brown fox jumps over the lazy dog') >>> 0, 0x414FA339);
console.log('crc32 OK');
```

- [ ] **Step 2: Run — expect fail** (`Cannot find module './crc32'`)
Run: `cd kinovea && node api/kq/_lib/crc32.test.js`

- [ ] **Step 3: Implement `crc32.js`** — table pasted from the site's `synAuth.js` `Crc32Tab` (256 entries). Signature identical to source: `crc32(str, init)` where `init===undefined` starts `0xFFFFFFFF`, else `init ^ 0xFFFFFFFF`.
```js
const T = [0,1996959894,3993919788,/* …full 256-entry table from synAuth.js… */];
function add(b, ch){ return (T[255 & (b ^ ch)] ^ ((b >> 8) & 0xFFFFFF)) >>> 0; }
function crc32(str, init){
  let c = init === undefined ? 0xFFFFFFFF : (init ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < str.length; i++) c = add(c, str.charCodeAt(i));
  return (c ^ 0xFFFFFFFF) >>> 0;
}
module.exports = { crc32 };
```
> Copy the full table verbatim from `scratchpad/synAuth.js` (regex `Crc32Tab=function\(\)\{var a=new Array\(([^)]+)\)`). Do not retype by hand.

- [ ] **Step 4: Run — expect `crc32 OK`**
Run: `cd kinovea && node api/kq/_lib/crc32.test.js`

- [ ] **Step 5: Commit**
```bash
cd kinovea && git add api/kq/_lib/crc32.js api/kq/_lib/crc32.test.js && git commit -m "feat: exact CRC32 port for KineQuick session signing"
```

---

## Task 3: Auth library (`kqAuth.js`)

**Files:** Create `kinovea/api/kq/_lib/kqAuth.js`; Verify: `kinovea/api/kq/_lib/kqAuth.test.js`.

This is a cleanup of the proven `scratchpad/poc-auth.js`. Differences from PoC: fetch the `deck` key live from the planner HTML (do not read a local file); cache `{auth, ts}` at module scope; re-handshake when `Date.now() - ts > 250000` (< the 300 000 ms `maxSessLifeTime`, leaving margin).

- [ ] **Step 1: Write verification first** — `kqAuth.test.js` (hits live backend, read-only)
```js
const { signedPost } = require('./kqAuth');
(async () => {
  const cfg = await signedPost('WebAgenda/GetConfig');
  const assert = require('assert');
  assert.strictEqual(cfg.status, 200);
  assert.ok(Array.isArray(cfg.body.locations) && cfg.body.locations.length >= 2);
  assert.ok(cfg.body.locations.some(l => l.Name === 'Kinovea Lasne'));
  console.log('kqAuth OK — locations:', cfg.body.locations.length);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
```

- [ ] **Step 2: Run — expect fail** (module missing)
Run: `cd kinovea && node api/kq/_lib/kqAuth.test.js`

- [ ] **Step 3: Implement `kqAuth.js`** — port from `scratchpad/poc-auth.js`, replacing the file-based deck read with a live fetch and adding the module-scope session cache. Exposes `signedPost(functionName, bodyObject?)` and `getConfig()`. `signedPost` ensures a valid session first (`ensureSession()`), builds `body = bodyObject === undefined ? undefined : JSON.stringify([ JSON.stringify(bodyObject) ])`, POSTs the signed URL, returns `{status, body}` (body JSON-parsed, or raw text on non-JSON). Full reference implementation lives in `scratchpad/poc-auth.js` + the deck-fetch below:
```js
async function fetchDeck() {
  const html = await (await fetch('https://www.q-top.be/online-planner-v2/FR/?root=kq43414')).text();
  const m = html.match(/id='deck'[^>]*value='([^']+)'/);
  if (!m) throw new Error('deck key not found');
  return decodeURIComponent(m[1]);
}
```
> Keep credentials server-side only. Never log the decrypted password or `sessionPrivateKey`.

- [ ] **Step 4: Run — expect `kqAuth OK — locations: 10`**
Run: `cd kinovea && node api/kq/_lib/kqAuth.test.js`

- [ ] **Step 5: Commit**
```bash
cd kinovea && git add api/kq/_lib/kqAuth.js api/kq/_lib/kqAuth.test.js && git commit -m "feat: server-side KineQuick auth handshake + signed POST"
```

---

## Task 4: `config.js` endpoint

**Files:** Create `kinovea/api/kq/config.js`.

- [ ] **Step 1: Implement** — server-cached (module-scope, 5 min TTL) passthrough that reshapes config for the front (strip `options` noise, precompute `isCabinet` per location):
```js
const { getConfig } = require('./_lib/kqAuth');
let cache = null, cacheTs = 0;
const CABINET_IDS = new Set([1, 23]);
module.exports = async (req, res) => {
  try {
    if (!cache || Date.now() - cacheTs > 300000) { cache = await getConfig(); cacheTs = Date.now(); }
    const c = cache;
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.status(200).json({
      locations: c.locations.map(l => ({
        id: l.Id, name: l.Name, address: l.Address,
        opening: l.OpeningTime, closing: l.ClosingTime,
        isCabinet: CABINET_IDS.has(l.Id),
        specialties: l.specialties.map(s => ({ id: s.ID, types: s.appointmentTypes.map(t => ({ id: t.ID, therapists: t.Therapists })) }))
      })),
      specialties: c.specialties.map(s => ({ id: s.Id, name: s.Description.FR })),
      appointmentTypes: c.appointmentTypes.map(t => ({ id: t.Id, name: t.Description.FR, duration: t.Duration })),
      therapists: c.therapists.map(t => ({ id: t.Id, name: t.Name })),
      rules: c.webAgendaOptions
    });
  } catch (e) { res.status(502).json({ error: 'config_unavailable' }); }
};
```

- [ ] **Step 2: Verify via dev server**
Run: `cd kinovea && node dev-server.js &` then `curl -s http://localhost:3210/api/kq/config | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('locations',j.locations.length,'cabinets',j.locations.filter(l=>l.isCabinet).map(l=>l.name));})"`
Expected: `locations 10 cabinets [ 'Kinovea Lasne', 'Kinovea Rhode-Saint-Genèse' ]`

- [ ] **Step 3: Commit**
```bash
cd kinovea && git add api/kq/config.js && git commit -m "feat: /api/kq/config endpoint (reshaped, cached)"
```

---

## Task 5: `availabilities.js` endpoint

**Files:** Create `kinovea/api/kq/availabilities.js`.

- [ ] **Step 1: Implement** — accepts `{locationId, specialtyId?, typeId?, weekStart?}` (`weekStart` = ISO date; default = upcoming Monday). Computes Monday→Sunday `dd/mm/yyyy`, calls `WebAgenda/GetAvailabilities`, flattens to a front-friendly shape: per day → per slot `{start, end, therapistId}`.
```js
const { signedPost } = require('./_lib/kqAuth');
const pad = n => (n < 10 ? '0' + n : '' + n);
const ddmmyyyy = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
function mondayOf(d){ const x = new Date(d); const wd = (x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-wd); return x; }
module.exports = async (req, res) => {
  try {
    const { locationId, specialtyId = '', typeId = '', weekStart } = req.body || {};
    if (!locationId) return res.status(400).json({ error: 'locationId required' });
    const start = weekStart ? mondayOf(new Date(weekStart)) : mondayOf(new Date(Date.now()+864e5));
    const end = new Date(start); end.setDate(end.getDate()+6);
    const r = await signedPost('WebAgenda/GetAvailabilities', {
      DateFrom: ddmmyyyy(start), DateTo: ddmmyyyy(end),
      OptionalLocationID: locationId, OptionalAppointmentTypeID: typeId, OptionalSpecialtyID: specialtyId
    });
    if (r.status !== 200 || typeof r.body !== 'object') return res.status(502).json({ error: 'availabilities_unavailable' });
    const byDate = {};
    (r.body.availabilities || []).forEach(a => (a.therapists || []).forEach(t =>
      (t.days || []).forEach(day => (day.times || []).forEach(slot => {
        (byDate[day.Date] ||= []).push({ start: slot.Start, end: slot.End, therapistId: t.TherapistID });
      }))));
    Object.values(byDate).forEach(arr => arr.sort((a,b)=>a.start.localeCompare(b.start)));
    res.status(200).json({
      weekStart: ddmmyyyy(start), weekEnd: ddmmyyyy(end),
      firstAvailable: r.body.availabilitiesDetail?.OptionalFirstAvailableDate || '',
      days: byDate
    });
  } catch (e) { res.status(502).json({ error: 'availabilities_error' }); }
};
```

- [ ] **Step 2: Verify via dev server** (Kinovea Lasne = id 1)
Run: `curl -s -X POST http://localhost:3210/api/kq/availabilities -H 'Content-Type: application/json' -d '{"locationId":1}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('week',j.weekStart,'->',j.weekEnd,'days with slots:',Object.keys(j.days).length);})"`
Expected: a week range and ≥0 days with slots (non-error shape). If current week is empty, pass `{"locationId":1,"weekStart":"<a near-future Monday>"}`.

- [ ] **Step 3: Commit**
```bash
cd kinovea && git add api/kq/availabilities.js && git commit -m "feat: /api/kq/availabilities endpoint (flattened week model)"
```

---

## Task 6: `patient-lookup.js` endpoint

**Files:** Create `kinovea/api/kq/patient-lookup.js`.

- [ ] **Step 1: Implement** — `{niss}` → `WebAgenda/GetExistingPatient` (payload `{Id: niss}`). Returns `{found:false}` or `{found:true, patient:{id, firstName, familyName, ...}}`. Map only fields the front needs; never echo raw internal patient object wholesale.
```js
const { signedPost } = require('./_lib/kqAuth');
module.exports = async (req, res) => {
  try {
    const niss = (req.body?.niss || '').toString().replace(/\D/g,'');
    if (!niss) return res.status(400).json({ error: 'niss required' });
    const r = await signedPost('WebAgenda/GetExistingPatient', { Id: niss });
    if (r.status !== 200 || !r.body || r.body === false || r.body.Id === 0) return res.status(200).json({ found: false });
    const p = r.body;
    res.status(200).json({ found: true, patient: {
      id: p.Id, firstName: p.FirstName||'', familyName: p.FamilyName||'',
      zip: p.ZIP||'', city: p.City||'', street: p.StreetNbr||'', email: p.EMail||'', phone: p.Telephone||''
    }});
  } catch (e) { res.status(200).json({ found: false }); }
};
```
> Confirm the exact `GetExistingPatient` response field names against `scratchpad/functions.js` (`getPatIdWithNissNr`, line ~435) during implementation; adjust the mapping if they differ.

- [ ] **Step 2: Verify** — with a bogus NISS, expect `{found:false}`; with a real one (from the clinic, if available) expect `{found:true}`.
Run: `curl -s -X POST http://localhost:3210/api/kq/patient-lookup -H 'Content-Type: application/json' -d '{"niss":"00000000000"}'`
Expected: `{"found":false}`

- [ ] **Step 3: Commit**
```bash
cd kinovea && git add api/kq/patient-lookup.js && git commit -m "feat: /api/kq/patient-lookup endpoint (NISS)"
```

---

## Task 7: `book.js` endpoint (writes real appointments)

**Files:** Create `kinovea/api/kq/book.js`.

- [ ] **Step 1: Implement** — accepts `{patient:{...}, appointments:[{locationId, specialtyId, typeId, therapistId, start}]}` where `start` = `"dd/mm/yyyy hh:mm"`. Enforces `appointments.length <= 10` (rule `MaxTentReqPerSession`). Sends each via `WebAgenda/AddAppointment` sequentially (matches original widget), collects per-item status.
```js
const { signedPost } = require('./_lib/kqAuth');
module.exports = async (req, res) => {
  try {
    const { patient = {}, appointments = [] } = req.body || {};
    if (!Array.isArray(appointments) || !appointments.length) return res.status(400).json({ error: 'no appointments' });
    if (appointments.length > 10) return res.status(400).json({ error: 'too many appointments' });
    const details = {
      Language: 'FR', Title: patient.title || '',
      FirstName: patient.firstName || '', FamilyName: patient.familyName || '',
      BirthDate: '', StreetNbr: patient.street || '', ZIP: patient.zip || '',
      City: patient.city || '', EMail: patient.email || '', Telephone: patient.phone || ''
    };
    const results = [];
    for (const a of appointments) {
      const payload = {
        patientDetails: details,
        patientID: patient.id ? parseInt(patient.id, 10) : 0,
        patientBirthdate: patient.birthdate || '',
        appointmentRemark: a.remark || '',
        therapistID: parseInt(a.therapistId, 10),
        specialtyID: parseInt(a.specialtyId, 10),
        appointmentTypedID: parseInt(a.typeId, 10),
        appointmentStart: a.start,
        locationID: parseInt(a.locationId, 10)
      };
      const r = await signedPost('WebAgenda/AddAppointment', payload);
      results.push({ start: a.start, status: r.status, ok: r.status === 201 || r.status === 200 });
    }
    const allOk = results.every(r => r.ok);
    res.status(allOk ? 201 : 207).json({ ok: allOk, results });
  } catch (e) { res.status(502).json({ error: 'book_error' }); }
};
```
> Status semantics from source: `201` created; `401/403/409` slot already taken; map those to a user-facing "slot no longer available" on the front.

- [ ] **Step 2: DO NOT auto-test with a real write yet.** Verify only that validation rejects bad input (no live booking in this step):
Run: `curl -s -X POST http://localhost:3210/api/kq/book -H 'Content-Type: application/json' -d '{"appointments":[]}'`
Expected: `{"error":"no appointments"}`

- [ ] **Step 3: Commit**
```bash
cd kinovea && git add api/kq/book.js && git commit -m "feat: /api/kq/book endpoint (real AddAppointment)"
```

---

## Task 8: Front skeleton + charte (`rdv/index.html`, `rdv/rdv.css`)

**Files:** Create `kinovea/rdv/index.html`, `kinovea/rdv/rdv.css`.

Reuse the exact design tokens from `kinovea/lasne/index.html` `:root` (paper/ink/teal/gold, Fraunces + Inter + IBM Plex Mono, radius, shadow). The page has: header (Kinovea logo + title "Prise de rendez-vous"), a filter bar, a results/calendar region, a slide-in booking panel, and a footer with a **"Powered by KineQuick"** badge linking to the original widget (`https://www.q-top.be/online-planner-v2/FR/?root=kq43414`) as the escape hatch for cancellations.

- [ ] **Step 1: Create `index.html`** — semantic skeleton with these anchor elements (ids consumed by `rdv.js`): `#mode-toggle` (Cabinet/Domicile), `#location-picker`, `#specialty-filter`, `#therapist-filter`, `#week-nav`, `#calendar`, `#selection-summary`, `#booking-panel`, `#patient-form`, `#confirmation`. Include `<link rel="stylesheet" href="rdv.css">` and `<script src="rdv.js" defer></script>`. Fonts + charte inline `<style>` or in `rdv.css`. Footer: `Powered by <a href="https://www.q-top.be/online-planner-v2/FR/?root=kq43414">KineQuick</a>`.

- [ ] **Step 2: Create `rdv.css`** — port `:root` tokens from `lasne/index.html`; style header, filter chips (pill buttons like the charte), calendar grid (7-column week, slots as tappable pills), sticky selection summary, slide-in panel, form fields, confirmation state. Mobile-first; the filter bar wraps, the calendar becomes horizontally scrollable on narrow screens (no page-level horizontal scroll).

- [ ] **Step 3: Verify in browser** — `preview_start {name:"kinovea-rdv"}` (add to `.claude/launch.json`: `npm run dev`, port 3210). Screenshot the empty shell; confirm charte (teal/gold/paper, Fraunces headings), footer badge present, no console errors, no horizontal overflow at 375px.

- [ ] **Step 4: Commit**
```bash
cd kinovea && git add rdv/index.html rdv/rdv.css .claude/launch.json && git commit -m "feat: booking page skeleton in Kinovea identity"
```

---

## Task 9: Front data layer + filter UX (`rdv/rdv.js`)

**Files:** Create `kinovea/rdv/rdv.js`.

- [ ] **Step 1: API + state module** — `api.config()`, `api.availabilities(params)`, `api.patientLookup(niss)`, `api.book(payload)` (all `fetch('/api/kq/*')`). Global `state = {config, mode:'cabinet', locationId:null, specialtyId:null, typeId:null, therapistId:null, weekStart:null, selection:[]}`. On load: `api.config()` → populate. Handle config failure with the fallback message + phone/link.

- [ ] **Step 2: Render filters** — `#mode-toggle` switches cabinet/domicile → `#location-picker` shows the matching locations (`isCabinet` split). Choosing a location derives available specialties (from `location.specialties`), which derive appointment types and therapists (cascade using the nested config). Specialty + therapist are optional chip filters. Every filter change → re-fetch availabilities. Keep the whole thing on one page (no wizard steps) per the spec.

- [ ] **Step 3: Verify in browser** — select "Au cabinet" → Kinovea Lasne; confirm specialty chips populate from real config; toggle "À domicile" → region list appears. Screenshot. No console errors.

- [ ] **Step 4: Commit**
```bash
cd kinovea && git add rdv/rdv.js && git commit -m "feat: booking data layer + single-page filter UX"
```

---

## Task 10: Week calendar + slot selection

**Files:** Modify `kinovea/rdv/rdv.js`, `kinovea/rdv/rdv.css`.

- [ ] **Step 1: Render calendar** — from `api.availabilities`, draw a 7-day week grid; each day lists its `{start,end,therapistId}` slots as tappable pills (show therapist name from config when no therapist filter is active). Week nav (`‹ ›`) shifts `weekStart` and re-fetches. "Premier RDV disponible" button jumps to `firstAvailable`. Respect `MinBookingHours`/`MaxBookingDays` when bounding navigation.

- [ ] **Step 2: Slot selection** — tapping a slot adds `{locationId, specialtyId, typeId, therapistId, start:"dd/mm/yyyy hh:mm"}` to `state.selection` and reflects it in the sticky `#selection-summary`. Enforce `MaxTentativePerDay`/`MaxTentReqPerSession` client-side (mirror server guard). Allow removing a selected slot.

- [ ] **Step 3: Verify in browser** — pick a real available slot at Kinovea Lasne; confirm it appears in the summary; navigate weeks; screenshot the populated calendar.

- [ ] **Step 4: Commit**
```bash
cd kinovea && git add rdv/rdv.js rdv/rdv.css && git commit -m "feat: week calendar with real slots + selection"
```

---

## Task 11: Patient form + confirmation

**Files:** Modify `kinovea/rdv/rdv.js`, `kinovea/rdv/rdv.css`.

- [ ] **Step 1: Patient step** — after ≥1 slot selected, "Continuer" opens `#booking-panel`. NISS field with a "Rechercher" button → `api.patientLookup` → autofill on `found`. Otherwise a new-patient form: first name, family name, email, phone, street/nr, ZIP, city (mandatory set matching the original widget; validate email + required fields client-side). Respect `AppointmentReasonMandatory` for the remark field.

- [ ] **Step 2: Submit + confirmation** — "Confirmer" → `api.book({patient, appointments: state.selection})`. On `ok`, show `#confirmation` (summary of booked slots, clinic contact, "powered by KineQuick"). On partial/failure (`207`/`409`), show which slots failed and re-fetch availabilities for those days. Disable the submit button while in flight; never double-submit.

- [ ] **Step 3: Verify (form only, no real write)** in browser — fill the form, confirm validation blocks empty/invalid input, confirm the lookup autofill path with a bogus NISS shows the new-patient form. Screenshot. **Do not click final confirm yet.**

- [ ] **Step 4: Commit**
```bash
cd kinovea && git add rdv/rdv.js rdv/rdv.css && git commit -m "feat: patient form, NISS lookup, confirmation screen"
```

---

## Task 12: End-to-end real booking test (the acceptance gate)

**Files:** none (verification only).

- [ ] **Step 1: Pre-flight** — confirm with the clinic owner (Bastien) a safe test slot and that a junk test booking is OK (it will land in the real agenda and should be deleted afterward). Prefer the owner's own therapist (Larbalestrier Amory, id 1) at Kinovea Lasne, far-future slot, remark "TEST — à supprimer".

- [ ] **Step 2: Book through the real UI** — via the browser preview, complete the full flow and click Confirm. Capture the confirmation screen (screenshot) and the `book` response (`read_network_requests`) showing `status: 201`.

- [ ] **Step 3: Verify server-side truth** — open the original KineQuick widget / clinic back-office and confirm the appointment appears in the agenda at the booked slot. This is the definitive proof the data really landed (screenshot).

- [ ] **Step 4: Clean up** — delete the test appointment (via back-office or the original widget's cancel flow) so the real agenda is left clean.

- [ ] **Step 5: Commit a short RESULTS note**
```bash
cd kinovea && git add docs/superpowers/plans/2026-07-14-kinequick-booking-app.md && git commit -m "docs: record verified end-to-end real booking"
```

---

## Notes / guardrails
- **Never** log or return the decrypted `webuser` password or `sessionPrivateKey`. They stay inside `kqAuth.js`.
- `book.js` is a write endpoint open to the origin; for the POC this matches the original widget's exposure. If this outlives the pitch, add a light rate-limit / same-origin check (out of scope now, noted in spec).
- Everything reads from the live config at runtime — no location/specialty/therapist IDs are hard-coded in the front beyond the cabinet-vs-domicile split (`{1,23}`), which is documented in `config.js`.
- Keep `rdv.js` sectioned; split render modules if it grows past ~600 lines.
