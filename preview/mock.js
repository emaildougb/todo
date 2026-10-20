/* Preview only: pretends to be the server, in memory. Nothing saves. */
(function () {
  window.__PREVIEW = true;
  var CFG = window.__CFG, nid = 1, db = { lists: [], secs: [], items: [], stores: CFG.stores.slice(), food: CFG.foodStores.slice() };
  var me = null;
  function add(secId, parent, text, extra) {
    var it = { id: nid++, sec: secId, parent: parent || 0, text: text, done: false, store: '', shop: '', priority: 'normal', due: '', by: 'doug', del: false };
    for (var k in (extra || {})) it[k] = extra[k];
    db.items.push(it); return it;
  }
  CFG.lists.forEach(function (l, i) {
    var L = { id: i + 1, key: l.key, name: l.name, members: l.members }; db.lists.push(L);
    (CFG.seed[l.key] || []).forEach(function (s) {
      var S = { id: nid++, list: L.id, name: s.name }; db.secs.push(S);
      s.items.forEach(function (x) {
        if (typeof x === 'string') add(S.id, 0, x);
        else { var p = add(S.id, 0, x.text); x.kids.forEach(function (k) { add(S.id, p.id, k); }); }
      });
    });
  });
  // Sample parts so the Shopping tab has something to show. Clearly labeled.
  function find(text) { return db.items.filter(function (i) { return i.text.indexOf(text) === 0; })[0]; }
  var tr = find('Trailer'), rf = find('Roof');
  if (tr) { add(tr.sec, tr.id, 'Sample: trailer light kit', { store: 'Harbor Freight' }); add(tr.sec, tr.id, 'Sample: 3/8 inch grade 8 bolts', { store: 'Home Depot' }); }
  if (rf) add(rf.sec, rf.id, 'Sample: roofing screws, 250 count', { store: 'Home Depot' });
  var roman = db.lists.filter(function (l) { return l.key === 'roman'; })[0];
  var rs = db.secs.filter(function (s) { return s.list === roman.id; })[0];
  add(rs.id, 0, 'Sample: clean my room', { by: 'roman' });

  var chores = [], cid = 1, cdone = {};
  function addChore(t, person, days) { chores.push({ id: cid++, text: t, person: person, days: days, del: false }); }
  addChore('Sample: feed the dog', 'roman', []); addChore('Sample: take out the trash', 'roman', [2, 4]); addChore('Sample: make bed', 'roman', []);
  addChore('Sample: laundry', 'doug', [1, 3, 5]);
  function localDay(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dow(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
  function addD(d, n) { return new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10); }
  function dueOn(c, d) { return !c.days.length || c.days.indexOf(dow(d)) >= 0; }
  [1, 2, 3].forEach(function (id) { cdone[id + '|' + localDay(-1)] = 1; cdone[4 + '|' + localDay(-2)] = 1; });
  function choreState(today) {
    return chores.filter(function (c) { return !c.del && (me.role === 'parent' || c.person === me.id || c.person === 'all'); }).map(function (c) {
      var missed = '';
      for (var i = 1; i <= 7; i++) { var d = addD(today, -i); if (dueOn(c, d)) { if (!cdone[c.id + '|' + d]) missed = d; break; } }
      return { id: c.id, text: c.text, person: c.person, days: c.days, today: dueOn(c, today), done: !!cdone[c.id + '|' + today], missed: missed };
    });
  }
  function pub(u) { return u; }
  function visible(l) { return l.members.indexOf(me.id) >= 0; }
  function state() {
    var out = { me: me, stores: db.stores, stores_food: db.food, lists: [] };
    db.lists.filter(visible).forEach(function (l) {
      var o = { id: l.id, key: l.key, name: l.name, sections: [] };
      db.secs.filter(function (s) { return s.list === l.id; }).forEach(function (s) {
        var tops = [];
        db.items.filter(function (i) { return i.sec === s.id && !i.del && !i.parent; }).forEach(function (i) {
          tops.push({ id: i.id, text: i.text, done: i.done, store: i.store, shop: i.shop, priority: i.priority, due: i.due, created_by: i.by,
            kids: db.items.filter(function (k) { return k.parent === i.id && !k.del; }).map(function (k) {
              return { id: k.id, text: k.text, done: k.done, store: k.store, shop: k.shop, priority: k.priority, due: k.due, created_by: k.by, kids: [] }; }) });
        });
        o.sections.push({ id: s.id, name: s.name, items: tops });
      });
      out.lists.push(o);
    });
    return out;
  }
  function item(id) { return db.items.filter(function (i) { return i.id === id; })[0]; }
  function recalc(pid) { if (!pid) return; var k = db.items.filter(function (x) { return x.parent === pid && !x.del; }); if (k.length) item(pid).done = k.every(function (x) { return x.done; }); }
  function res(status, obj) { return new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json' } }); }
  function kid() { return me.role === 'kid'; }

  window.fetch = function (url, o) {
    o = o || {}; var m = (o.method || 'GET').toUpperCase(), b = o.body ? JSON.parse(o.body) : {}, p = String(url).split('?')[0], x;
    return new Promise(function (ok) {
      setTimeout(function () { ok(route()); }, 20);
    });
    function route() {
      if (p === '/api/users') return res(200, { users: CFG.users.map(function (u) { return { id: u.id, name: u.name }; }) });
      if (p === '/api/me') return me ? res(200, { user: me }) : res(401, { error: 'Not signed in.' });
      if (p === '/api/login') { me = CFG.users.filter(function (u) { return u.id === b.user; })[0]; return me ? res(200, { user: me }) : res(401, { error: 'Wrong PIN.' }); }
      if (p === '/api/logout') { me = null; return res(200, {}); }
      if (!me) return res(401, { error: 'Not signed in.' });
      if (p === '/api/state') { var st = state(); var dm = /[?&]d=([\d-]+)/.exec(String(url)); st.chores = choreState(dm ? dm[1] : new Date().toISOString().slice(0, 10)); st.people = CFG.users.map(function (u) { return { id: u.id, name: u.name }; }); return res(200, st); }
      var cm = /^\/api\/chores(?:\/(\d+))?(?:\/(done))?$/.exec(p);
      if (cm) {
        var cx = cm[1] ? chores.filter(function (c) { return c.id === +cm[1]; })[0] : null;
        if (cm[2]) { if (!cx) return res(404, { error: 'Not found.' }); if (b.done) cdone[cx.id + '|' + b.day] = 1; else delete cdone[cx.id + '|' + b.day]; return res(200, {}); }
        if (kid()) return res(403, { error: 'Only a parent can change chores.' });
        if (m === 'POST') { addChore(b.text, b.person, b.days || []); return res(200, {}); }
        if (cx && m === 'DELETE') { cx.del = true; return res(200, {}); }
        return res(404, { error: 'Not found.' });
      }
      if (p === '/api/pin') return res(200, { ok: true });
      if (p === '/api/stores') { var sl = b.stores.map(function (s) { return String(s).trim(); }).filter(Boolean); if (b.kind === 'food') db.food = sl; else db.stores = sl; return res(200, {}); }
      if (p === '/api/import') return res(200, { imported: 0 });
      if (p === '/api/items' && m === 'POST') {
        var sec = b.section_id;
        if (b.shopping) {
          var ss = db.secs.filter(function (s) { return s.list === b.list_id; });
          var sh = ss.filter(function (s) { return s.name === 'Shopping'; })[0];
          if (!sh) { if (kid()) sh = ss[0]; else { sh = { id: nid++, list: b.list_id, name: 'Shopping' }; db.secs.push(sh); } }
          sec = sh.id;
        }
        var sl2 = b.shop === 'food' ? db.food : db.stores, st = sl2.indexOf(b.store) >= 0 ? b.store : '';
        var it = add(sec, b.parent_id || 0, b.text, { store: st, shop: st && b.shop === 'food' ? 'food' : '', priority: b.priority || 'normal', by: me.id });
        recalc(it.parent); return res(200, { id: it.id });
      }
      var mv = /^\/api\/items\/(\d+)\/move$/.exec(p);
      if (mv && m === 'POST') {
        var mi = item(+mv[1]); if (!mi) return res(404, { error: 'Not found.' });
        if (kid() && mi.by !== me.id) return res(403, { error: 'Only the person who added it can move it.' });
        var grp = db.items.filter(function (k) { return !k.del && k.parent === mi.parent && k.sec === mi.sec && k !== mi; });
        db.items = db.items.filter(function (k) { return k !== mi; });
        var at = b.to === 'top' ? grp[0] : (b.before ? grp.filter(function (k) { return k.id === +b.before; })[0] : null);
        if (at) db.items.splice(db.items.indexOf(at), 0, mi);
        else { var lastk = grp[grp.length - 1]; if (lastk) db.items.splice(db.items.indexOf(lastk) + 1, 0, mi); else db.items.push(mi); }
        return res(200, {});
      }
      var mm = /^\/api\/items\/(\d+)$/.exec(p);
      if (mm) {
        var i = item(+mm[1]); if (!i) return res(404, { error: 'Not found.' });
        var own = !kid() || i.by === me.id;
        if (m === 'DELETE') { if (!own) return res(403, { error: 'You can only delete your own items.' }); i.del = true; recalc(i.parent); return res(200, {}); }
        var edits = ['text', 'store', 'shop', 'priority', 'due', 'deleted', 'section_id', 'parent_id'].some(function (k) { return k in b; });
        if (edits && !own) return res(403, { error: 'You can only change your own items.' });
        if ('text' in b) i.text = String(b.text).trim() || i.text;
        if (('section_id' in b || 'parent_id' in b) && kid()) return res(403, { error: 'Only Dad can move items between lists or group them.' });
        if ('shop' in b) i.shop = b.shop === 'food' ? 'food' : '';
        if ('store' in b) i.store = (i.shop === 'food' ? db.food : db.stores).indexOf(b.store) >= 0 ? b.store : '';
        if ('parent_id' in b) {
          var oldp = i.parent;
          if (b.parent_id) { var pp = item(+b.parent_id); if (!pp || pp.sec !== i.sec || pp.parent || pp.id === i.id) return res(400, { error: 'Pick an item in the same section.' }); if (db.items.some(function (k) { return k.parent === i.id && !k.del; })) return res(400, { error: 'This item has sub items. Move or delete those first.' }); i.parent = pp.id; }
          else i.parent = 0;
          recalc(oldp); recalc(i.parent);
        } else if ('section_id' in b && !i.parent && +b.section_id !== i.sec) {
          var ns = db.secs.filter(function (s) { return s.id === +b.section_id; })[0]; if (!ns) return res(400, { error: 'Pick a place to move it to.' });
          i.sec = ns.id; db.items.forEach(function (k) { if (k.parent === i.id) k.sec = ns.id; });
          db.items = db.items.filter(function (k) { return k !== i; }); db.items.push(i);
        }
        if ('priority' in b) i.priority = b.priority; if ('due' in b) i.due = b.due;
        if ('deleted' in b) { i.del = !!b.deleted; recalc(i.parent); }
        if ('done' in b) { i.done = !!b.done; db.items.forEach(function (k) { if (k.parent === i.id) k.done = i.done; }); recalc(i.parent); }
        return res(200, {});
      }
      if (kid()) return res(403, { error: 'Only a parent can do that.' });
      if (p === '/api/sections' && m === 'POST') { db.secs.push({ id: nid++, list: b.list_id, name: b.name }); return res(200, {}); }
      if (p === '/api/bulk') {
        var n = 0, last = null;
        String(b.text).split('\n').forEach(function (ln) {
          var ind = /^\s+/.test(ln), t = ln.replace(/^\s*([-*•]|\d+[.)]|\[[ x]\])\s*/, '').trim(); if (!t) return;
          var r = add(b.section_id, ind && last ? last.id : 0, t); if (!ind) last = r; n++;
        });
        return res(200, { added: n });
      }
      mm = /^\/api\/sections\/(\d+)$/.exec(p);
      if (mm && m === 'DELETE') { db.secs = db.secs.filter(function (s) { return s.id !== +mm[1]; }); return res(200, {}); }
      if (mm && m === 'PATCH') { var ps = db.secs.filter(function (s) { return s.id === +mm[1]; })[0]; if (ps && 'list_id' in b) ps.list = +b.list_id; if (ps && 'name' in b) ps.name = b.name; return res(200, {}); }
      return res(404, { error: 'Not found.' });
    }
  };
  window.__mock = { as: function (id) { me = CFG.users.filter(function (u) { return u.id === id; })[0]; } };
})();
