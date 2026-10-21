// To Do app server. Serves /api/* here; the web pages come from the assets folder (public/).
import { USERS, LISTS, SEED, DEFAULT_STORES, DEFAULT_FOOD_STORES } from './config.js';

const SESSION_DAYS = 90;
const COOKIE = 'todo_session';
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- small helpers ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const fail = (msg, status = 400) => json({ error: msg }, status);

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function pbkdf2(pin, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}

function cookieOf(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// ---------- database setup ----------
let schemaReady = null;

async function addColumns(env, table, cols) {
  const have = (await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map((r) => r.name);
  for (const [name, def] of cols) {
    if (!have.includes(name)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
  }
}

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare('CREATE TABLE IF NOT EXISTS lists (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, name TEXT, pos INTEGER)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS sections (id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER, name TEXT, pos INTEGER)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, section_id INTEGER, parent_id INTEGER, text TEXT, pos INTEGER)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS pins (user TEXT PRIMARY KEY, salt TEXT, hash TEXT)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS attempts (user TEXT PRIMARY KEY, n INTEGER, until INTEGER)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS chores (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, person TEXT, days TEXT DEFAULT \'\', deleted INTEGER DEFAULT 0)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS chore_done (chore_id INTEGER, day TEXT, by TEXT, PRIMARY KEY (chore_id, day))'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS recovery (user TEXT PRIMARY KEY, salt TEXT, hash TEXT)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS week_goals (week TEXT PRIMARY KEY, target INTEGER, reward TEXT, closed INTEGER DEFAULT 0)'),
      ]);
      // New columns go in this list, never into the CREATE TABLE above, so updates never break existing data.
      await addColumns(env, 'items', [
        ['done', 'INTEGER DEFAULT 0'],
        ['deleted', 'INTEGER DEFAULT 0'],
        ['store', "TEXT DEFAULT ''"],
        ['priority', "TEXT DEFAULT 'normal'"],
        ['due', "TEXT DEFAULT ''"],
        ['created_by', "TEXT DEFAULT 'doug'"],
        ['updated_at', 'INTEGER DEFAULT 0'],
        ['shop', "TEXT DEFAULT ''"],
        ['link', "TEXT DEFAULT ''"],
      ]);
      await addColumns(env, 'chores', [['created', "TEXT DEFAULT ''"]]);
      await seed(env);
      // 1.1.0: Roman's own list is now called "Roman's To do" (only if it still has the old name).
      await env.DB.prepare("UPDATE lists SET name = ? WHERE key = 'roman' AND name = 'Roman'").bind("Roman's To do").run();
      // 1.2.0: the shared wish list. New databases get it from the seed; older ones get it here, once.
      const wishDone = await env.DB.prepare("SELECT v FROM settings WHERE k = 'wish_ready'").first();
      if (!wishDone) {
        await env.DB.prepare("INSERT OR IGNORE INTO lists (key, name, pos) VALUES ('wish', ?, 4)").bind("Roman's Wish List").run();
        const wl = await env.DB.prepare("SELECT id FROM lists WHERE key = 'wish'").first();
        const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM sections WHERE list_id = ?').bind(wl.id).first();
        if (!have.n) {
          let sp = 0;
          for (const name of ['Birthday', 'Christmas', 'Anytime ideas']) await env.DB.prepare('INSERT INTO sections (list_id, name, pos) VALUES (?,?,?)').bind(wl.id, name, sp++).run();
        }
        await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('wish_ready', '1')").run();
      }
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function insertItem(env, sectionId, parentId, text, pos, by, done = 0) {
  const r = await env.DB.prepare('INSERT INTO items (section_id, parent_id, text, pos, done, created_by, updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind(sectionId, parentId, text, pos, done ? 1 : 0, by, Date.now())
    .run();
  return r.meta.last_row_id;
}

async function seed(env) {
  const seeded = await env.DB.prepare("SELECT v FROM settings WHERE k='seeded'").first();
  if (seeded) return;
  let lp = 0;
  for (const L of LISTS) {
    await env.DB.prepare('INSERT OR IGNORE INTO lists (key, name, pos) VALUES (?,?,?)').bind(L.key, L.name, lp++).run();
  }
  for (const L of LISTS) {
    const row = await env.DB.prepare('SELECT id FROM lists WHERE key=?').bind(L.key).first();
    let sp = 0;
    for (const S of SEED[L.key] || []) {
      const s = await env.DB.prepare('INSERT INTO sections (list_id, name, pos) VALUES (?,?,?)').bind(row.id, S.name, sp++).run();
      let ip = 0;
      for (const it of S.items) {
        const text = typeof it === 'string' ? it : it.text;
        const id = await insertItem(env, s.meta.last_row_id, null, text, ip++, 'doug');
        for (const [k, kid] of (it.kids || []).entries()) await insertItem(env, s.meta.last_row_id, id, kid, k, 'doug');
      }
    }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('seeded', '1')").run();
}

// ---------- sessions and PINs ----------
async function sessionKey(env) {
  let secret = env.SESSION_SECRET;
  if (!secret) {
    let r = await env.DB.prepare("SELECT v FROM settings WHERE k='session_secret'").first();
    if (!r) {
      await env.DB.prepare("INSERT OR IGNORE INTO settings (k, v) VALUES ('session_secret', ?)").bind(b64u(crypto.getRandomValues(new Uint8Array(32)))).run();
      r = await env.DB.prepare("SELECT v FROM settings WHERE k='session_secret'").first();
    }
    secret = r.v;
  }
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeToken(env, uid) {
  const payload = b64u(enc.encode(JSON.stringify({ u: uid, exp: Date.now() + SESSION_DAYS * 864e5 })));
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(payload));
  return `${payload}.${b64u(sig)}`;
}

async function userFromRequest(env, request) {
  const tok = cookieOf(request, COOKIE);
  const [p, s] = tok.split('.');
  if (!p || !s) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await sessionKey(env), fromB64u(s), enc.encode(p));
    if (!ok) return null;
    const d = JSON.parse(dec.decode(fromB64u(p)));
    if (!d || d.exp < Date.now()) return null;
    return USERS.find((u) => u.id === d.u) || null;
  } catch (e) {
    return null;
  }
}

async function checkPin(env, uid, pin) {
  if (!pin) return false;
  const row = await env.DB.prepare('SELECT salt, hash FROM pins WHERE user=?').bind(uid).first();
  if (row) return (await pbkdf2(pin, row.salt)) === row.hash;
  const start = env[`PIN_${uid.toUpperCase()}`];
  if (!start) return false;
  return (await sha(pin)) === (await sha(String(start)));
}

const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

async function login(env, request) {
  const body = await request.json().catch(() => ({}));
  const u = USERS.find((x) => x.id === body.user);
  if (!u) return fail('Pick who you are first.');
  const a = await env.DB.prepare('SELECT n, until FROM attempts WHERE user=?').bind(u.id).first();
  if (a && a.until > Date.now()) return fail('Too many tries. Wait a few minutes and try again.', 429);
  if (!(await checkPin(env, u.id, String(body.pin || '')))) {
    const n = (a ? a.n : 0) + 1;
    const locked = n >= 5;
    await env.DB.prepare('INSERT OR REPLACE INTO attempts (user, n, until) VALUES (?,?,?)').bind(u.id, locked ? 0 : n, locked ? Date.now() + 10 * 60000 : 0).run();
    return fail(locked ? 'Too many tries. Wait 10 minutes.' : 'That PIN is not right.', 401);
  }
  await env.DB.prepare('DELETE FROM attempts WHERE user=?').bind(u.id).run();
  return json({ user: pub(u) }, 200, { 'Set-Cookie': sessionCookie(await makeToken(env, u.id), SESSION_DAYS * 86400) });
}

async function changePin(env, user, request) {
  const b = await request.json().catch(() => ({}));
  // Someone already signed in can set a new PIN without the old one (the signed in session proves who they are).
  if (!b.forgot && !(await checkPin(env, user.id, String(b.old || '')))) return fail('Your current PIN is not right.', 401);
  const next = String(b.new || '');
  if (!/^\d{4,8}$/.test(next)) return fail('Use 4 to 8 digits for the new PIN.');
  const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('INSERT OR REPLACE INTO pins (user, salt, hash) VALUES (?,?,?)').bind(user.id, salt, await pbkdf2(next, salt)).run();
  return json({ ok: true });
}

// A recovery code: Dad makes one in Settings and saves it. On the sign in page it sets a new PIN if he forgets it.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function makeRecovery(env, user) {
  if (!isParent(user)) return fail('Only a parent can make a recovery code.', 403);
  const raw = [...crypto.getRandomValues(new Uint8Array(16))].map((n) => CODE_CHARS[n % 32]).join('');
  const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('INSERT OR REPLACE INTO recovery (user, salt, hash) VALUES (?,?,?)').bind(user.id, salt, await pbkdf2(raw, salt)).run();
  return json({ code: raw.match(/.{4}/g).join('-') });
}

async function recoverPin(env, request) {
  const b = await request.json().catch(() => ({}));
  const u = USERS.find((x) => x.id === b.user && x.role === 'parent');
  if (!u) return fail('Recovery codes are for Dad. Ask Dad to reset the PIN.');
  const key = 'rec:' + u.id;
  const a = await env.DB.prepare('SELECT n, until FROM attempts WHERE user=?').bind(key).first();
  if (a && a.until > Date.now()) return fail('Too many tries. Wait a few minutes and try again.', 429);
  const next = String(b.pin || '');
  if (!/^\d{4,8}$/.test(next)) return fail('Use 4 to 8 digits for the new PIN.');
  const row = await env.DB.prepare('SELECT salt, hash FROM recovery WHERE user=?').bind(u.id).first();
  const code = normCode(b.code);
  if (!row || code.length !== 16 || (await pbkdf2(code, row.salt)) !== row.hash) {
    const n = (a ? a.n : 0) + 1, locked = n >= 5;
    await env.DB.prepare('INSERT OR REPLACE INTO attempts (user, n, until) VALUES (?,?,?)').bind(key, locked ? 0 : n, locked ? Date.now() + 10 * 60000 : 0).run();
    return fail(locked ? 'Too many tries. Wait 10 minutes.' : 'That recovery code is not right.', 401);
  }
  const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('INSERT OR REPLACE INTO pins (user, salt, hash) VALUES (?,?,?)').bind(u.id, salt, await pbkdf2(next, salt)).run();
  await env.DB.prepare('DELETE FROM attempts WHERE user IN (?, ?)').bind(key, u.id).run();
  return json({ user: pub(u) }, 200, { 'Set-Cookie': sessionCookie(await makeToken(env, u.id), SESSION_DAYS * 86400) });
}

async function resetPin(env, user, request) {
  if (!isParent(user)) return fail('Only a parent can reset a PIN.', 403);
  const b = await request.json().catch(() => ({}));
  const who = USERS.find((u) => u.id === b.user && u.role === 'kid');
  if (!who) return fail('Pick whose PIN to reset.');
  const next = String(b.pin || '');
  if (!/^\d{4,8}$/.test(next)) return fail('Use 4 to 8 digits for the new PIN.');
  const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('INSERT OR REPLACE INTO pins (user, salt, hash) VALUES (?,?,?)').bind(who.id, salt, await pbkdf2(next, salt)).run();
  await env.DB.prepare('DELETE FROM attempts WHERE user=?').bind(who.id).run();
  return json({ ok: true });
}

const pub = (u) => ({ id: u.id, name: u.name, role: u.role });
const isParent = (u) => u.role === 'parent';
const canSee = (u, listKey) => !!LISTS.find((l) => l.key === listKey && l.members.includes(u.id));

// ---------- reading ----------
// kind is '' for the Other shopping list (hardware and so on) or 'food' for groceries.
async function getStores(env, kind = '') {
  const food = kind === 'food';
  const fallback = food ? DEFAULT_FOOD_STORES : DEFAULT_STORES;
  const r = await env.DB.prepare('SELECT v FROM settings WHERE k = ?').bind(food ? 'stores_food' : 'stores').first();
  try {
    return r ? JSON.parse(r.v) : fallback;
  } catch (e) {
    return fallback;
  }
}

async function buildState(env, user) {
  const visible = LISTS.filter((l) => l.members.includes(user.id)).map((l) => l.key);
  const lists = (await env.DB.prepare('SELECT id, key, name FROM lists ORDER BY pos').all()).results.filter((l) => visible.includes(l.key));
  const out = { me: pub(user), stores: await getStores(env), stores_food: await getStores(env, 'food'), lists: [] };
  if (!lists.length) return out;
  const ph = lists.map(() => '?').join(',');
  const ids = lists.map((l) => l.id);
  const secs = (await env.DB.prepare(`SELECT id, list_id, name FROM sections WHERE list_id IN (${ph}) ORDER BY pos, id`).bind(...ids).all()).results;
  const rows = (
    await env.DB.prepare(
      `SELECT i.id, i.section_id, i.parent_id, i.text, i.done, i.store, i.shop, i.link, i.priority, i.due, i.created_by
       FROM items i JOIN sections s ON s.id = i.section_id
       WHERE s.list_id IN (${ph}) AND COALESCE(i.deleted, 0) = 0 ORDER BY i.pos, i.id`
    ).bind(...ids).all()
  ).results;
  const byId = {};
  const tops = {};
  for (const r of rows) {
    const it = { id: r.id, text: r.text, done: !!r.done, store: r.store || '', shop: r.shop || '', link: r.link || '', priority: r.priority || 'normal', due: r.due || '', created_by: r.created_by, kids: [] };
    byId[r.id] = it;
    if (!r.parent_id) (tops[r.section_id] = tops[r.section_id] || []).push(it);
  }
  for (const r of rows) if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].kids.push(byId[r.id]);
  for (const l of lists) {
    out.lists.push({
      id: l.id,
      key: l.key,
      name: l.name,
      sections: secs.filter((s) => s.list_id === l.id).map((s) => ({ id: s.id, name: s.name, items: tops[s.id] || [] })),
    });
  }
  return out;
}

async function getItem(env, id) {
  return env.DB.prepare(
    `SELECT i.*, s.list_id, l.key AS list_key FROM items i
     JOIN sections s ON s.id = i.section_id JOIN lists l ON l.id = s.list_id WHERE i.id = ?`
  ).bind(id).first();
}

async function getSection(env, id) {
  return env.DB.prepare('SELECT s.id, s.list_id, s.name, l.key AS list_key FROM sections s JOIN lists l ON l.id = s.list_id WHERE s.id = ?').bind(id).first();
}

async function recalcParent(env, pid) {
  if (!pid) return;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS d FROM items WHERE parent_id = ? AND COALESCE(deleted, 0) = 0').bind(pid).first();
  if (r && r.n > 0) await env.DB.prepare('UPDATE items SET done = ?, updated_at = ? WHERE id = ?').bind(r.d === r.n ? 1 : 0, Date.now(), pid).run();
}

// Keeps a link only if it is a real web address. A bare "amazon.com/x" gets https:// put in front.
function cleanLink(v) {
  let t = String(v == null ? '' : v).trim().slice(0, 500);
  if (!t) return '';
  if (!/^https?:\/\//i.test(t)) t = /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(t) ? 'https://' + t : '';
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) {
    return '';
  }
}
const clean = (s, max = 300) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- writing ----------
async function nextPos(env, sectionId, parentId) {
  const r = parentId
    ? await env.DB.prepare('SELECT MAX(pos) AS m FROM items WHERE parent_id = ?').bind(parentId).first()
    : await env.DB.prepare('SELECT MAX(pos) AS m FROM items WHERE section_id = ? AND parent_id IS NULL').bind(sectionId).first();
  return (r && r.m != null ? r.m : -1) + 1;
}

async function createItem(env, user, b) {
  let sectionId = b.section_id;
  if (!sectionId && b.list_id && b.shopping) {
    // Shopping quick add: goes into a "Shopping" section of that list, made on demand.
    const list = await env.DB.prepare('SELECT id, key FROM lists WHERE id = ?').bind(b.list_id).first();
    if (!list || !canSee(user, list.key)) return fail('Not found', 404);
    let s = await env.DB.prepare("SELECT id FROM sections WHERE list_id = ? AND name = 'Shopping'").bind(list.id).first();
    if (!s) {
      if (!isParent(user)) return fail('Ask Dad to add a Shopping section first.', 403);
      const mp = await env.DB.prepare('SELECT MAX(pos) AS m FROM sections WHERE list_id = ?').bind(list.id).first();
      const r = await env.DB.prepare('INSERT INTO sections (list_id, name, pos) VALUES (?,?,?)').bind(list.id, 'Shopping', (mp && mp.m != null ? mp.m : -1) + 1).run();
      s = { id: r.meta.last_row_id };
    }
    sectionId = s.id;
  }
  const sec = await getSection(env, sectionId);
  if (!sec || !canSee(user, sec.list_key)) return fail('Not found', 404);
  const text = clean(b.text);
  if (!text) return fail('Type something first.');
  let parentId = null;
  if (b.parent_id) {
    const p = await getItem(env, b.parent_id);
    if (!p || p.section_id !== sec.id || p.parent_id) return fail('Not found', 404);
    parentId = p.id;
  }
  const shop = b.shop === 'food' ? 'food' : '';
  const stores = await getStores(env, shop);
  const id = await insertItem(env, sec.id, parentId, text, await nextPos(env, sec.id, parentId), user.id);
  const extra = [];
  if (b.store && stores.includes(b.store)) {
    extra.push(['store', b.store]);
    if (shop) extra.push(['shop', shop]);
  }
  if (['high', 'low'].includes(b.priority)) extra.push(['priority', b.priority]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(b.due || '')) extra.push(['due', b.due]);
  if (b.link && cleanLink(b.link)) extra.push(['link', cleanLink(b.link)]);
  for (const [k, v] of extra) await env.DB.prepare(`UPDATE items SET ${k} = ? WHERE id = ?`).bind(v, id).run();
  await recalcParent(env, parentId);
  return json({ id });
}

async function patchItem(env, user, id, b) {
  const it = await getItem(env, id);
  if (!it || !canSee(user, it.list_key)) return fail('Not found', 404);
  const ownsIt = isParent(user) || it.created_by === user.id;
  const editing = ['text', 'store', 'shop', 'link', 'priority', 'due', 'deleted', 'section_id', 'parent_id'].some((k) => k in b);
  if (editing && !ownsIt) return fail('You can check this off, but only the person who added it can change it.', 403);
  if (('section_id' in b || 'parent_id' in b) && !isParent(user)) return fail('Only Dad can move items between lists or group them.', 403);
  const shop = 'shop' in b ? (b.shop === 'food' ? 'food' : '') : it.shop || '';
  const stores = await getStores(env, shop);
  const sets = [];
  const vals = [];
  let oldParent = null;
  let newParent = null;
  if ('shop' in b) {
    sets.push('shop = ?');
    vals.push(shop);
  }
  if ('parent_id' in b) {
    // Put under another item in the same section, or (null) turn a sub item back into a normal item.
    if (b.parent_id) {
      const p = await getItem(env, b.parent_id);
      if (!p || p.id === it.id || p.section_id !== it.section_id || p.parent_id || p.deleted) return fail('Pick an item in the same section.');
      const kids = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE parent_id = ? AND COALESCE(deleted, 0) = 0').bind(it.id).first();
      if (kids && kids.n > 0) return fail('This item has sub items. Move or delete those first.');
      sets.push('parent_id = ?', 'pos = ?');
      vals.push(p.id, await nextPos(env, it.section_id, p.id));
      newParent = p.id;
    } else if (it.parent_id) {
      sets.push('parent_id = ?', 'pos = ?');
      vals.push(null, await nextPos(env, it.section_id, null));
    }
    oldParent = it.parent_id;
  }
  if ('text' in b) {
    const t = clean(b.text);
    if (!t) return fail('Type something first.');
    sets.push('text = ?');
    vals.push(t);
  }
  if ('store' in b) {
    sets.push('store = ?');
    vals.push(b.store && stores.includes(b.store) ? b.store : '');
  }
  if ('link' in b) {
    sets.push('link = ?');
    vals.push(cleanLink(b.link));
  }
  if ('priority' in b) {
    sets.push('priority = ?');
    vals.push(['high', 'low'].includes(b.priority) ? b.priority : 'normal');
  }
  if ('due' in b) {
    sets.push('due = ?');
    vals.push(/^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : '');
  }
  if ('deleted' in b) {
    sets.push('deleted = ?');
    vals.push(b.deleted ? 1 : 0);
  }
  if ('section_id' in b && !it.parent_id && Number(b.section_id) !== it.section_id) {
    // Move to another section or list. Sub items follow, and it lands at the end of that section.
    const sec = await getSection(env, b.section_id);
    if (!sec || !canSee(user, sec.list_key)) return fail('Pick a place to move it to.');
    sets.push('section_id = ?', 'pos = ?');
    vals.push(sec.id, await nextPos(env, sec.id, null));
    await env.DB.prepare('UPDATE items SET section_id = ? WHERE parent_id = ?').bind(sec.id, it.id).run();
  }
  if ('done' in b) {
    sets.push('done = ?');
    vals.push(b.done ? 1 : 0);
  }
  if (!sets.length) return json({ ok: true });
  sets.push('updated_at = ?');
  vals.push(Date.now());
  await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  if ('done' in b) await env.DB.prepare('UPDATE items SET done = ?, updated_at = ? WHERE parent_id = ? AND COALESCE(deleted, 0) = 0').bind(b.done ? 1 : 0, Date.now(), id).run();
  if ('deleted' in b) await env.DB.prepare('UPDATE items SET deleted = ?, updated_at = ? WHERE parent_id = ?').bind(b.deleted ? 1 : 0, Date.now(), id).run();
  if ('done' in b || 'deleted' in b) await recalcParent(env, it.parent_id);
  if ('parent_id' in b) {
    await recalcParent(env, oldParent);
    await recalcParent(env, newParent);
  }
  return json({ ok: true });
}

// Slide an item up or down inside its own group. { before: id } puts it ahead of that item,
// { to: 'top' } puts it first, and anything else puts it last.
async function moveWithin(env, user, id, b) {
  const it = await getItem(env, id);
  if (!it || !canSee(user, it.list_key) || it.deleted) return fail('Not found', 404);
  if (!(isParent(user) || it.created_by === user.id)) return fail('Only the person who added it can move it.', 403);
  const rows = it.parent_id
    ? (await env.DB.prepare('SELECT id FROM items WHERE parent_id = ? AND COALESCE(deleted, 0) = 0 ORDER BY pos, id').bind(it.parent_id).all()).results
    : (await env.DB.prepare('SELECT id FROM items WHERE section_id = ? AND parent_id IS NULL AND COALESCE(deleted, 0) = 0 ORDER BY pos, id').bind(it.section_id).all()).results;
  const ids = rows.map((r) => r.id).filter((x) => x !== it.id);
  let at = ids.length;
  if (b.to === 'top') at = 0;
  else if (b.before) {
    at = ids.indexOf(Number(b.before));
    if (at < 0) return fail('Not found', 404);
  }
  ids.splice(at, 0, it.id);
  await env.DB.batch(ids.map((x, i) => env.DB.prepare('UPDATE items SET pos = ? WHERE id = ?').bind(i, x)));
  return json({ ok: true });
}

async function sections(env, user, method, id, request) {
  if (!isParent(user)) return fail('Only Dad can change sections.', 403);
  const b = method === 'DELETE' ? {} : await request.json().catch(() => ({}));
  if (method === 'POST') {
    const list = await env.DB.prepare('SELECT id, key FROM lists WHERE id = ?').bind(b.list_id).first();
    const name = clean(b.name, 60);
    if (!list || !canSee(user, list.key) || !name) return fail('Give the section a name.');
    const mp = await env.DB.prepare('SELECT MAX(pos) AS m FROM sections WHERE list_id = ?').bind(list.id).first();
    const r = await env.DB.prepare('INSERT INTO sections (list_id, name, pos) VALUES (?,?,?)').bind(list.id, name, (mp && mp.m != null ? mp.m : -1) + 1).run();
    return json({ id: r.meta.last_row_id });
  }
  const sec = await getSection(env, id);
  if (!sec || !canSee(user, sec.list_key)) return fail('Not found', 404);
  if (method === 'PATCH') {
    if ('list_id' in b) {
      // Move the whole section, with everything in it, to another list.
      const list = await env.DB.prepare('SELECT id, key FROM lists WHERE id = ?').bind(b.list_id).first();
      if (!list || !canSee(user, list.key)) return fail('Pick a list to move it to.');
      if (list.id !== sec.list_id) {
        const mp = await env.DB.prepare('SELECT MAX(pos) AS m FROM sections WHERE list_id = ?').bind(list.id).first();
        await env.DB.prepare('UPDATE sections SET list_id = ?, pos = ? WHERE id = ?').bind(list.id, (mp && mp.m != null ? mp.m : -1) + 1, sec.id).run();
      }
    }
    if ('name' in b) {
      const name = clean(b.name, 60);
      if (!name) return fail('Give the section a name.');
      await env.DB.prepare('UPDATE sections SET name = ? WHERE id = ?').bind(name, sec.id).run();
    }
    return json({ ok: true });
  }
  await env.DB.batch([env.DB.prepare('DELETE FROM items WHERE section_id = ?').bind(sec.id), env.DB.prepare('DELETE FROM sections WHERE id = ?').bind(sec.id)]);
  return json({ ok: true });
}

// Many lines at once: one item per line, an indented line becomes a sub item.
async function bulk(env, user, request) {
  if (!isParent(user)) return fail('Only Dad can add a bunch at once.', 403);
  const b = await request.json().catch(() => ({}));
  const sec = await getSection(env, b.section_id);
  if (!sec || !canSee(user, sec.list_key)) return fail('Not found', 404);
  let pos = await nextPos(env, sec.id, null);
  let last = null;
  let lastKids = 0;
  let n = 0;
  for (const raw of String(b.text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const text = clean(raw.trim().replace(/^([-*•]|\[[ xX]?\]|\d+[.)])\s+/, ''));
    if (!text) continue;
    if (/^(\t|\s{2,})/.test(raw) && last) await insertItem(env, sec.id, last, text, lastKids++, user.id);
    else {
      last = await insertItem(env, sec.id, null, text, pos++, user.id);
      lastKids = 0;
    }
    n++;
  }
  return json({ added: n });
}

// Brings in the backup file from the first (browser only) version of the app.
async function importOld(env, user, request) {
  if (!isParent(user)) return fail('Only Dad can bring in a backup.', 403);
  const b = await request.json().catch(() => ({}));
  const old = b.state;
  if (!old || !Array.isArray(old.lists)) return fail('That does not look like a backup from the first version.');
  const plan = { personal: [], work: [], 'roman-doug': [] };
  for (const L of old.lists) {
    for (const S of L.sections || []) {
      if (L.key === 'personal' && S.key === 'roman') plan['roman-doug'].push({ name: 'Projects', items: S.items || [] });
      else if (plan[L.key]) plan[L.key].push(S);
    }
  }
  let count = 0;
  for (const key of Object.keys(plan)) {
    if (!plan[key].length) continue;
    const list = await env.DB.prepare('SELECT id FROM lists WHERE key = ?').bind(key).first();
    const oldSecs = (await env.DB.prepare('SELECT id FROM sections WHERE list_id = ?').bind(list.id).all()).results;
    for (const s of oldSecs) await env.DB.prepare('DELETE FROM items WHERE section_id = ?').bind(s.id).run();
    await env.DB.prepare('DELETE FROM sections WHERE list_id = ?').bind(list.id).run();
    let sp = 0;
    for (const S of plan[key]) {
      const r = await env.DB.prepare('INSERT INTO sections (list_id, name, pos) VALUES (?,?,?)').bind(list.id, clean(S.name, 60) || 'Section', sp++).run();
      let ip = 0;
      for (const it of S.items || []) {
        const text = clean(it.text);
        if (!text) continue;
        const id = await insertItem(env, r.meta.last_row_id, null, text, ip++, 'doug', it.done);
        count++;
        for (const [k, kid] of (it.kids || []).entries()) {
          const kt = clean(kid.text);
          if (kt) {
            await insertItem(env, r.meta.last_row_id, id, kt, k, 'doug', kid.done);
            count++;
          }
        }
        await recalcParent(env, id);
      }
    }
  }
  return json({ imported: count });
}

async function saveStores(env, user, request) {
  if (!isParent(user)) return fail('Only Dad can change the store list.', 403);
  const b = await request.json().catch(() => ({}));
  const list = (Array.isArray(b.stores) ? b.stores : []).map((s) => clean(s, 30)).filter(Boolean).slice(0, 12);
  if (!list.length) return fail('Keep at least one store.');
  await env.DB.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)').bind(b.kind === 'food' ? 'stores_food' : 'stores', JSON.stringify([...new Set(list)])).run();
  return json({ ok: true });
}


// ---------- chores ----------
// days is '' for every day, or a list like '1,3,5' (Sunday is 0). person is a user id or 'all'.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dow = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
const addDays = (day, n) => new Date(new Date(day + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const dueOn = (c, day) => !c.days.length || c.days.includes(dow(day));
const parseDays = (v) => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort();
const choreVisible = (c, user) => user.role === 'parent' || c.person === user.id || c.person === 'all';

async function choreState(env, user, today) {
  const rows = (await env.DB.prepare('SELECT id, text, person, days FROM chores WHERE COALESCE(deleted, 0) = 0 ORDER BY id').all()).results;
  const from = addDays(today, -7);
  const done = (await env.DB.prepare('SELECT chore_id, day FROM chore_done WHERE day >= ?').bind(from).all()).results;
  const doneSet = new Set(done.map((r) => r.chore_id + '|' + r.day));
  const out = [];
  for (const r of rows) {
    const c = { id: r.id, text: r.text, person: r.person, days: r.days ? r.days.split(',').map(Number) : [] };
    if (!choreVisible(c, user)) continue;
    let missed = '';
    for (let i = 1; i <= 7 && !missed; i++) {
      const d = addDays(today, -i);
      if (dueOn(c, d)) {
        if (!doneSet.has(c.id + '|' + d)) missed = d;
        break; // only the most recent scheduled day counts
      }
    }
    out.push({ ...c, today: dueOn(c, today), done: doneSet.has(c.id + '|' + today), missed });
  }
  return out;
}

async function chores(env, user, method, id, request, url) {
  const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}));
  const sub = url.pathname.split('/').filter(Boolean)[3];
  if (sub === 'done' && method === 'POST') {
    const row = await env.DB.prepare('SELECT id, person FROM chores WHERE id = ? AND COALESCE(deleted, 0) = 0').bind(id).first();
    if (!row || !choreVisible({ person: row.person }, user)) return fail('Not found.', 404);
    const day = String(body.day || '');
    if (!DAY_RE.test(day)) return fail('Bad date.');
    if (body.done) await env.DB.prepare('INSERT OR REPLACE INTO chore_done (chore_id, day, by) VALUES (?, ?, ?)').bind(id, day, user.id).run();
    else await env.DB.prepare('DELETE FROM chore_done WHERE chore_id = ? AND day = ?').bind(id, day).run();
    return json({ ok: true });
  }
  if (user.role !== 'parent') return fail('Only a parent can change chores.', 403);
  const person = (v) => (v === 'all' || USERS.some((u) => u.id === v) ? v : null);
  if (method === 'POST') {
    const text = String(body.text || '').trim().slice(0, 200);
    const who = person(body.person);
    if (!text || !who) return fail('Add a name and pick who it is for.');
    const r = await env.DB.prepare('INSERT INTO chores (text, person, days, created) VALUES (?, ?, ?, ?)').bind(text, who, parseDays(body.days).join(','), DAY_RE.test(body.day || '') ? body.day : '').run();
    return json({ id: r.meta.last_row_id });
  }
  const row = id ? await env.DB.prepare('SELECT * FROM chores WHERE id = ?').bind(id).first() : null;
  if (!row) return fail('Not found.', 404);
  if (method === 'DELETE') {
    await env.DB.prepare('UPDATE chores SET deleted = 1 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  if (method === 'PATCH') {
    const text = 'text' in body ? String(body.text || '').trim().slice(0, 200) || row.text : row.text;
    const who = 'person' in body ? person(body.person) || row.person : row.person;
    const days = 'days' in body ? parseDays(body.days).join(',') : row.days;
    await env.DB.prepare('UPDATE chores SET text = ?, person = ?, days = ? WHERE id = ?').bind(text, who, days, id).run();
    return json({ ok: true });
  }
  return fail('Not found', 404);
}

// ---------- the kid's week (Sunday to Saturday) ----------
const weekStartOf = (day) => addDays(day, -dow(day));

async function weekState(env, today) {
  const kid = USERS.find((u) => u.role === 'kid');
  if (!kid) return null;
  const rows = (await env.DB.prepare('SELECT id, person, days, created FROM chores WHERE COALESCE(deleted, 0) = 0').all()).results
    .filter((c) => c.person === kid.id || c.person === 'all')
    .map((c) => ({ id: c.id, days: c.days ? c.days.split(',').map(Number) : [], created: c.created || '' }));
  if (!rows.length) return null;
  const thisWeek = weekStartOf(today);
  const first = addDays(thisWeek, -28);
  const done = (await env.DB.prepare('SELECT chore_id, day FROM chore_done WHERE day >= ?').bind(first).all()).results;
  const doneSet = new Set(done.map((r) => r.chore_id + '|' + r.day));
  const goals = (await env.DB.prepare('SELECT week, target, reward, closed FROM week_goals WHERE week >= ?').bind(first).all()).results;
  const goalOf = (w) => goals.find((g) => g.week === w) || { week: w, target: 80, reward: '', closed: 0 };
  const count = (w, upTo) => {
    let total = 0, got = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i);
      if (d > upTo) break;
      for (const c of rows) {
        if (c.created && d < c.created) continue;
        if (!dueOn(c, d)) continue;
        total++;
        if (doneSet.has(c.id + '|' + d)) got++;
      }
    }
    return { total, got, pct: total ? Math.round((got / total) * 100) : 0 };
  };
  const shape = (w, upTo) => {
    const g = goalOf(w);
    const c = count(w, upTo);
    return { week: w, target: g.target, reward: g.reward || '', closed: !!g.closed, total: c.total, done: c.got, pct: c.pct, earned: c.total > 0 && c.pct >= g.target };
  };
  const out = { kid: kid.id, name: kid.name, ...shape(thisWeek, today), history: [] };
  for (let i = 1; i <= 4; i++) {
    const w = addDays(thisWeek, -7 * i);
    const h = shape(w, addDays(w, 6));
    if (h.total > 0) out.history.push(h);
  }
  return out;
}

async function saveWeek(env, user, request) {
  if (!isParent(user)) return fail('Only Dad can set the weekly goal.', 403);
  const b = await request.json().catch(() => ({}));
  const week = String(b.week || '');
  if (!DAY_RE.test(week) || dow(week) !== 0) return fail('Bad week.');
  const cur = (await env.DB.prepare('SELECT target, reward, closed FROM week_goals WHERE week = ?').bind(week).first()) || { target: 80, reward: '', closed: 0 };
  let target = cur.target;
  if ('target' in b) {
    target = Math.round(Number(b.target));
    if (!(target >= 1 && target <= 100)) return fail('Pick a goal from 1 to 100.');
  }
  const reward = 'reward' in b ? clean(b.reward, 120) : cur.reward;
  const closed = 'closed' in b ? (b.closed ? 1 : 0) : cur.closed;
  await env.DB.prepare('INSERT OR REPLACE INTO week_goals (week, target, reward, closed) VALUES (?, ?, ?, ?)').bind(week, target, reward, closed).run();
  return json({ ok: true });
}

async function customIdeas(env) {
  const r = await env.DB.prepare("SELECT v FROM settings WHERE k = 'ideas_custom'").first();
  try {
    const a = JSON.parse(r ? r.v : '[]');
    return Array.isArray(a) ? a.map((x) => String(x)) : [];
  } catch (e) {
    return [];
  }
}

async function addIdea(env, user, request) {
  if (!isParent(user)) return fail('Only Dad can add ideas for now.', 403);
  const b = await request.json().catch(() => ({}));
  const text = clean(b.text, 120);
  if (!text) return fail('Type an idea first.');
  const list = await customIdeas(env);
  if (list.length >= 100) return fail('That is a lot of ideas. Time to use some.');
  if (!list.includes(text)) list.push(text);
  await env.DB.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)').bind('ideas_custom', JSON.stringify(list)).run();
  return json({ ok: true, ideas_custom: list });
}

// ---------- routing ----------
async function route(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'items', '12']
  const [, name, rawId] = parts;
  const id = rawId ? Number(rawId) : null;
  const method = request.method;

  if (name === 'users' && method === 'GET') return json({ users: USERS.map((u) => ({ id: u.id, name: u.name })) });
  if (name === 'login' && method === 'POST') return login(env, request);
  if (name === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });

  if (name === 'pin' && parts[2] === 'recover' && method === 'POST') return recoverPin(env, request);
  let user = await userFromRequest(env, request);
  if (!user) return fail('Please sign in.', 401);
  if (name === 'recovery' && method === 'POST') return makeRecovery(env, user);

  // Dad resets Roman's PIN. This also clears a lockout.
  if (name === 'pin' && parts[2] === 'reset' && method === 'POST') return resetPin(env, user, request);

  // Dad can look at the app exactly as Roman sees it. Reading only: nothing can be changed this way.
  const viewAs = request.headers.get('X-View-As');
  if (viewAs && isParent(user)) {
    const k = USERS.find((u) => u.id === viewAs && u.role === 'kid');
    if (k) {
      if (method !== 'GET') return fail('You are only looking as ' + k.name + '. Go back to your own view to change things.', 403);
      user = k;
    }
  }

  if (name === 'me' && method === 'GET') return json({ user: pub(user) });
  if (name === 'state' && method === 'GET') {
    const state = await buildState(env, user);
    const d = url.searchParams.get('d');
    state.chores = await choreState(env, user, DAY_RE.test(d || '') ? d : new Date().toISOString().slice(0, 10));
    state.people = USERS.map((u) => ({ id: u.id, name: u.name, role: u.role }));
    state.week = await weekState(env, DAY_RE.test(d || '') ? d : new Date().toISOString().slice(0, 10));
    state.ideas_custom = isParent(user) ? await customIdeas(env) : [];
    state.recovery_set = isParent(user) ? !!(await env.DB.prepare('SELECT 1 AS x FROM recovery WHERE user = ?').bind(user.id).first()) : false;
    return json(state);
  }
  if (name === 'chores' && ['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return chores(env, user, method, id, request, url);
  if (name === 'pin' && method === 'POST') return changePin(env, user, request);
  if (name === 'items' && id && parts[3] === 'move' && method === 'POST') return moveWithin(env, user, id, await request.json().catch(() => ({})));
  if (name === 'items' && method === 'POST') return createItem(env, user, await request.json().catch(() => ({})));
  if (name === 'items' && id && method === 'PATCH') return patchItem(env, user, id, await request.json().catch(() => ({})));
  if (name === 'items' && id && method === 'DELETE') return patchItem(env, user, id, { deleted: true });
  if (name === 'sections' && ['POST', 'PATCH', 'DELETE'].includes(method)) return sections(env, user, method, id, request);
  if (name === 'bulk' && method === 'POST') return bulk(env, user, request);
  if (name === 'import' && method === 'POST') return importOld(env, user, request);
  if (name === 'week' && method === 'PATCH') return saveWeek(env, user, request);
  if (name === 'ideas' && method === 'POST') return addIdea(env, user, request);
  if (name === 'stores' && method === 'PATCH') return saveStores(env, user, request);
  return fail('Not found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      await ensureSchema(env);
      return await route(request, env, url);
    } catch (e) {
      console.error(e);
      return fail('Something went wrong on the server.', 500);
    }
  },
};
