// Server-side KineQuick (synAuth) authentication + signed requests.
//
// Reproduces the exact handshake the KineQuick web widget performs client-side,
// but keeps all credentials server-side. The webuser password stays inside this
// module and is never logged or returned. Proven working against the live backend
// (WebAgenda/GetConfig + GetAvailabilities) during reconnaissance.
//
// Public API:
//   signedPost(functionName, bodyObject?) -> { status, body }
//   getConfig() -> parsed WebAgenda/GetConfig body
//
const CryptoJS = require('crypto-js');
const { crc32 } = require('./crc32');

const PLANNER_HTML = 'https://www.q-top.be/online-planner-v2/FR/?root=kq43414';
const AUTHDATA_URL = 'https://www.q-top.be/online-planner-v2/php/request.handler.php?function=getAuthData&root=kq43414';
const MAX_SESSION_MS = 300000;   // KineQuick maxSessLifeTime
const REFRESH_MS = 250000;       // re-handshake before expiry, with margin

const sha256 = (s) => CryptoJS.SHA256(s).toString(CryptoJS.enc.Hex);
const pad8 = (h) => { while (h.length < 8) h = '0' + h; return h; };

// Module-scope session cache (survives warm serverless invocations)
let session = null;      // { url, root, user, passwordHashHexa, sessionIdHexa8, sessionPrivateKey, ts }
let lastTick = 0;

async function getText(url, opts) { return (await fetch(url, opts)).text(); }
async function getJson(url) {
  const t = await getText(url);
  try { return JSON.parse(t); } catch { return t; }
}

// Fetch the AES key ("deck") from the served planner HTML (static per deployment).
async function fetchDeck() {
  const html = await getText(PLANNER_HTML);
  const m = html.match(/id=['"]deck['"][^>]*value=['"]([^'"]+)['"]/);
  if (!m) throw new Error('deck key not found in planner HTML');
  return decodeURIComponent(m[1]);
}

// Fetch + decode getAuthData, decrypt the webuser password with the deck key.
async function getAuthData() {
  const b64 = await getText(AUTHDATA_URL);
  const jsonStr = CryptoJS.enc.Base64.parse(b64).toString(CryptoJS.enc.Utf8);
  const resp = JSON.parse(JSON.parse(jsonStr));
  const res = JSON.parse(resp['result']);
  if (res.statusCode !== 200) throw new Error('getAuthData statusCode ' + res.statusCode);
  const data = JSON.parse(res['data']); // { username, password(enc), url, root }

  const deck = await fetchDeck();
  const decrypted = CryptoJS.AES.decrypt(data.password.toString(), deck, { iv: data.root })
    .toString(CryptoJS.enc.Utf8);
  if (!decrypted) throw new Error('password decryption produced empty string');
  return { username: data.username, url: data.url, root: data.root, decrypted };
}

// Local "YYYY-MM-DD HH:MM:SS" with month via getMonth() (0-based), matching synAuth callback e.
function nowDateTimeStr() {
  const e = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${e.getFullYear()}-${p(e.getMonth())}-${p(e.getDate())} ${p(e.getHours())}:${p(e.getMinutes())}:${p(e.getSeconds())}`;
}

async function login() {
  const { username, url, root, decrypted } = await getAuthData();
  const passwordHashHexa = sha256('salt' + decrypted);

  // 1) TimeStamp (sequence step)
  await getText(`${url}/${root}/TimeStamp`);

  // 2) server nonce
  const nonceResp = await getJson(`${url}/${root}/auth?UserName=${encodeURIComponent(username)}`);
  const serverNonce = nonceResp.result;

  // 3) password proof + client nonce -> session
  const clientNonce = sha256(nowDateTimeStr());
  const proof = sha256(root + serverNonce + clientNonce + username + passwordHashHexa);
  const sessResp = await getJson(
    `${url}/${root}/auth?UserName=${encodeURIComponent(username)}&Password=${proof}&ClientNonce=${clientNonce}`
  );
  const result = sessResp.result;
  if (!result || result.indexOf('+') === -1) throw new Error('login failed: bad session response');

  const sessionId = parseInt(result.slice(0, result.indexOf('+')), 10);
  session = {
    url, root, user: username, passwordHashHexa,
    sessionIdHexa8: pad8(sessionId.toString(16)),
    sessionPrivateKey: crc32(passwordHashHexa, crc32(result, 0)),
    ts: Date.now()
  };
  return session;
}

async function ensureSession() {
  if (!session || Date.now() - session.ts > REFRESH_MS) await login();
  return session;
}

function sessionSign(urlPath) {
  let c = Date.now();
  if (lastTick === c) c += 1;
  lastTick = c;
  let d = pad8(c.toString(16));
  if (d.length > 8) d = d.slice(d.length - 8);
  const sig = pad8(crc32(urlPath, crc32(d, session.sessionPrivateKey)).toString(16));
  const sep = urlPath.indexOf('?') === -1 ? '?session_signature=' : '&session_signature=';
  return urlPath + sep + session.sessionIdHexa8 + d + sig;
}

// Signed POST to a WebAgenda function. bodyObject (if given) is wrapped exactly like
// the widget: JSON.stringify([ JSON.stringify(bodyObject) ]).
async function signedPost(functionName, bodyObject) {
  await ensureSession();
  const target = `${session.url}/${session.root}/${functionName}`;
  const signed = sessionSign(target);
  const body = bodyObject === undefined ? undefined : JSON.stringify([JSON.stringify(bodyObject)]);
  const r = await fetch(signed, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

async function getConfig() {
  const r = await signedPost('WebAgenda/GetConfig');
  if (r.status !== 200 || typeof r.body !== 'object') throw new Error('GetConfig failed: ' + r.status);
  return r.body;
}

module.exports = { signedPost, getConfig };
