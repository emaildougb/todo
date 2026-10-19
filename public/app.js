/* To Do app. Plain JavaScript, no build step. Everything draws into #app. */
(function () {
  'use strict';

  var APP_VER = '1.0.0';
  var NEWS = [
    { v: '1.0.0', d: 'Oct 18, 2026', notes: ['First shared version: Personal, Work, and Roman lists, chores for Roman, shopping by store, PIN sign in, and one list on every phone.'] },
  ];

  var S = {
    me: null, users: [], data: null, raw: '', view: 'home', listKey: null, sheet: null,
    toast: null, drafts: {}, choreDays: [], editChore: 0, hideDone: false, newer: false, pop: null, loginUser: '', err: '', busy: false,
  };
  var app = document.getElementById('app');
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  // ---------- talking to the server ----------
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== '/api/login' && path !== '/api/pin') {
          S.me = null; S.data = null; S.raw = ''; render();
          throw new Error('signed out');
        }
        if (!r.ok) throw new Error(j.error || 'Something went wrong.');
        return j;
      });
    });
  }

  function loadState(quiet) {
    return api('GET', '/api/state?d=' + today()).then(function (j) {
      var raw = JSON.stringify(j);
      if (raw !== S.raw) { S.raw = raw; S.data = j; if (!quiet || canRedraw()) render(); }
    });
  }
  function canRedraw() {
    var a = document.activeElement;
    return !S.sheet && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  // ---------- finding things ----------
  function findItem(id) {
    var out = null;
    S.data.lists.forEach(function (l) {
      l.sections.forEach(function (s) {
        s.items.forEach(function (it) {
          if (it.id === id) out = { it: it, sec: s, list: l, parent: null };
          it.kids.forEach(function (k) { if (k.id === id) out = { it: k, sec: s, list: l, parent: it }; });
        });
      });
    });
    return out;
  }
  function isParent() { return S.me && S.me.role === 'parent'; }
  function canEdit(it) { return isParent() || it.created_by === S.me.id; }
  function itemDone(it) { return it.kids.length ? it.kids.every(function (k) { return k.done; }) : it.done; }
  function stats(l) {
    var t = 0, d = 0;
    l.sections.forEach(function (s) {
      s.items.forEach(function (it) {
        if (it.kids.length) it.kids.forEach(function (k) { t++; if (k.done) d++; });
        else { t++; if (it.done) d++; }
      });
    });
    return [d, t];
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDue(s) { var p = s.split('-'); return MONTHS[+p[1] - 1] + ' ' + +p[2]; }
  function shopRows() {
    var rows = [];
    S.data.lists.forEach(function (l) {
      l.sections.forEach(function (s) {
        s.items.forEach(function (it) {
          if (it.store) rows.push({ it: it, list: l, where: l.name + ' › ' + s.name });
          it.kids.forEach(function (k) { if (k.store) rows.push({ it: k, list: l, where: l.name + ' › ' + it.text }); });
        });
      });
    });
    return rows;
  }

  // ---------- small pieces of screen ----------
  var ICONS = {
    home: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    lists: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l2 2 3-3"/><path d="M4 14l2 2 3-3"/><path d="M13 7h7M13 15h7"/></svg>',
    shop: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8a3 3 0 016 0"/></svg>',
    chores: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  };

  function theme() { var t = document.documentElement.getAttribute('data-theme'); return t || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function top(title, sub) {
    return '<div class="top"><div><h1>' + esc(title) + '</h1><div class="sub">' + esc(sub || '') + '</div></div>' +
      '<div class="topbtns"><button class="themebtn" data-act="theme" aria-label="Switch light or dark">' + (theme() === 'dark' ? '\u2600' : '\u263E') + '</button><button class="refresh' + (S.newer ? ' new' : '') + '" data-act="refresh">' + (S.newer ? '↻ Update ready' : '↻ Refresh') + '</button></div></div>';
  }

  function options(stores, current, blankLabel) {
    var h = '<option value="">' + esc(blankLabel) + '</option>';
    var list = stores.slice();
    if (current && list.indexOf(current) < 0) list.push(current);
    list.forEach(function (s) { h += '<option value="' + esc(s) + '"' + (s === current ? ' selected' : '') + '>' + esc(s) + '</option>'; });
    return h;
  }

  function metaHtml(it) {
    var h = '';
    if (it.store) h += '<span class="chip store">' + esc(it.store) + '</span>';
    if (it.priority === 'high') h += '<span class="chip hi">High</span>';
    if (it.due) h += '<span class="chip' + (it.due < today() && !it.done ? ' late' : '') + '">' + fmtDue(it.due) + '</span>';
    return h ? '<div class="meta">' + h + '</div>' : '';
  }

  function rowHtml(it, isKid) {
    var has = !isKid && it.kids.length;
    var dn = has ? itemDone(it) : it.done;
    if (S.hideDone && dn) return '';
    var h = '<div class="' + (isKid ? 'kid' : 'item') + (dn ? ' done' : '') + (S.pop === it.id ? ' pop' : '') + '" data-id="' + it.id + '">' +
      '<input type="checkbox" data-act="toggle" aria-label="Done"' + (dn ? ' checked' : '') + '>' +
      '<div class="body" data-act="open"><span class="t">' + esc(it.text) + '</span>' + metaHtml(it) + '</div>';
    if (has) h += '<span class="count">' + it.kids.filter(function (k) { return k.done; }).length + '/' + it.kids.length + '</span>';
    h += '</div>';
    if (has) it.kids.forEach(function (k) { h += rowHtml(k, true); });
    return h;
  }

  function paneHtml(l, on) {
    var st = stats(l), pct = st[1] ? Math.round(st[0] / st[1] * 100) : 0;
    var h = '<div class="pane' + (on ? ' on' : '') + '" data-list="' + l.id + '">' +
      '<div class="pane-head"><h2>' + esc(l.name) + '</h2><span class="count">' + st[0] + ' of ' + st[1] + ' done</span></div>' +
      '<div class="bar"><div style="width:' + pct + '%"></div></div>';
    l.sections.forEach(function (s) {
      var d = 0, t = 0;
      s.items.forEach(function (it) {
        if (it.kids.length) it.kids.forEach(function (k) { t++; if (k.done) d++; });
        else { t++; if (it.done) d++; }
      });
      h += '<section class="sec" data-sec="' + s.id + '"><div class="sec-head"><h3>' + esc(s.name) + '</h3><span class="count">' + d + '/' + t + '</span>' +
        (isParent() ? '<button class="icon" data-act="delsec" title="Delete section" aria-label="Delete section">&times;</button>' : '') + '</div>';
      s.items.forEach(function (it) { h += rowHtml(it, false); });
      h += '<div class="add"><div class="addrow"><input type="text" data-draft="add-' + s.id + '" placeholder="Add an item" enterkeyhint="done" autocomplete="off">' +
        '<button class="pri" data-act="add">Add</button></div>' +
        '<details><summary>More</summary><div class="morerow"><select data-draft="st-' + s.id + '">' + options(S.data.stores, '', 'No store') + '</select>' +
        '<select data-draft="pr-' + s.id + '"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div></details></div></section>';
    });
    if (isParent()) {
      h += '<details class="bulk"><summary>Add a bunch</summary><div style="margin-top:8px"><textarea rows="5" data-draft="bulk-' + l.id + '" placeholder="One item per line. Indent a line to make it a sub item."></textarea>' +
        '<div class="addrow"><select data-draft="bulksec-' + l.id + '" style="flex:1">';
      l.sections.forEach(function (s) { h += '<option value="' + s.id + '">' + esc(s.name) + '</option>'; });
      h += '</select><button class="pri" data-act="bulk">Add all</button></div></div></details>' +
        '<div class="newsec"><input type="text" data-draft="newsec-' + l.id + '" placeholder="New section name" enterkeyhint="done"><button class="pri" data-act="newsec">Add section</button></div>';
    }
    return h + '</div>';
  }

  // ---------- the four screens ----------
  function greeting() { var hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; }
  function dueLine(open) {
    var t = today(), due = 0;
    S.data.lists.forEach(function (l) { l.sections.forEach(function (sec) { sec.items.forEach(function (it) {
      if (it.due && it.due <= t && !itemDone(it)) due++;
      it.kids.forEach(function (k) { if (k.due && k.due <= t && !k.done) due++; });
    }); }); });
    due += (S.data.chores || []).filter(function (c) { return c.today && !c.done; }).length;
    return due + ' due today \u00B7 ' + open + ' open';
  }
  function badgeFor(key) {
    var n = 0;
    if (key === 'lists') S.data.lists.forEach(function (l) { var st = stats(l); n += st[1] - st[0]; });
    if (key === 'chores') n = (S.data.chores || []).filter(function (c) { return (c.today && !c.done) || (!c.today && c.missed); }).length;
    if (key === 'shop') n = shopRows().filter(function (r) { return !r.it.done; }).length;
    return n;
  }
  function upNext(l) {
    var out = [];
    l.sections.forEach(function (sec) {
      sec.items.forEach(function (it) { if (!itemDone(it)) out.push(it); });
    });
    out.sort(function (x, y) { return (y.priority === 'high') - (x.priority === 'high'); });
    return out;
  }

  function homeView() {
    var lists = S.data.lists, open = 0;
    lists.forEach(function (l) { var s = stats(l); open += s[1] - s[0]; });
    var shop = shopRows().filter(function (r) { return !r.it.done; }).length;
    var h = top(greeting() + ', ' + S.me.name, dueLine(open));
    lists.forEach(function (l) {
      var s = stats(l), pct = s[1] ? Math.round(s[0] / s[1] * 100) : 0, next = upNext(l), mine = l.key === 'personal' || l.key === 'work';
      h += '<div class="homecard' + (mine ? ' big' : '') + '"><button class="homehead" data-act="gotolist" data-key="' + esc(l.key) + '"><span class="name">' + esc(l.name) + '</span>' +
        '<span class="num">' + s[0] + ' of ' + s[1] + ' done</span></button><div class="bar"><div style="width:' + pct + '%"></div></div>';
      if (!next.length) h += '<div class="empty small">' + (s[1] ? 'All done.' : 'Nothing here yet.') + '</div>';
      next.slice(0, mine ? 4 : 3).forEach(function (it) {
        var kids = it.kids.length ? '<span class="count">' + it.kids.filter(function (k) { return k.done; }).length + '/' + it.kids.length + '</span>' : '';
        h += '<div class="item" data-id="' + it.id + '"><input type="checkbox" data-act="toggle" aria-label="Done"' + (it.done ? ' checked' : '') + '>' +
          '<div class="body" data-act="open"><span class="t">' + esc(it.text) + '</span>' + metaHtml(it) + '</div>' + kids + '</div>';
      });
      if (next.length > (mine ? 4 : 3)) h += '<button class="more" data-act="gotolist" data-key="' + esc(l.key) + '">See all ' + next.length + ' open</button>';
      h += '</div>';
    });
    var cr = (S.data.chores || []).filter(function (c) { return c.today; });
    if (cr.length) {
      var cd = cr.filter(function (c) { return c.done; }).length, mine = S.me.role === 'kid';
      h = h.replace('<div class="homecard', '<div class="homecard');
      var chtml = '<div class="homecard' + (mine ? ' big' : '') + '"><button class="homehead" data-act="gotochores"><span class="name">Chores today</span><span class="num">' + cd + ' of ' + cr.length + ' done</span></button><div class="bar"><div style="width:' + Math.round(cd / cr.length * 100) + '%"></div></div>';
      cr.slice(0, 4).forEach(function (c) { chtml += choreLine(c); });
      chtml += '</div>';
      h = mine ? h.replace('</div><div class="homecard', '</div>' + chtml + '<div class="homecard') : h;
      if (!mine) h += chtml;
    }
    h += '<button class="tile shop wide" data-act="gotoshop"><span class="name">Shopping</span><span class="num">' + shop + ' to buy</span></button>';
    if (!lists.length) h += '<div class="empty">No lists to show yet.</div>';
    return h;
  }


  // ---------- chores ----------
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dayName(d) { return DAYS[new Date(d + 'T12:00:00').getDay()]; }
  function personName(id) { if (id === 'all') return 'Everyone'; var p = (S.data.people || []).filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; }
  function schedule(c) { return c.days.length ? c.days.map(function (d) { return DAYS[d]; }).join(', ') : 'Every day'; }
  function choreRows() { return (S.data.chores || []).filter(function (c) { return c.today || c.missed; }); }
  function choreOpen() { return choreRows().filter(function (c) { return !(c.today && c.done) && !(!c.today && c.missed === ''); }).length; }
  function choreLine(c) {
    var late = c.missed && !c.done;
    return '<div class="item' + (c.done ? ' done' : '') + '" data-chore="' + c.id + '"><input type="checkbox" data-act="chorecheck" aria-label="Done"' + (c.done ? ' checked' : '') + '>' +
      '<div class="body"><span class="t">' + esc(c.text) + '</span>' +
      (late && c.today ? '<div class="meta"><span class="chip late">Missed since ' + dayName(c.missed) + '</span></div>' : '') + '</div></div>';
  }
  function choresView() {
    var h = top('Chores', 'Today, ' + MONTHS[new Date().getMonth()] + ' ' + new Date().getDate());
    var rows = (S.data.chores || []).filter(function (c) { return c.today; });
    var by = {};
    rows.forEach(function (c) { (by[c.person] = by[c.person] || []).push(c); });
    var order = Object.keys(by).sort();
    if (!rows.length) h += '<div class="empty">No chores today.</div>';
    order.forEach(function (who) {
      var list = by[who], d = list.filter(function (c) { return c.done; }).length;
      h += '<div class="pane on"><div class="pane-head"><h2>' + esc(personName(who)) + '</h2><span class="count">' + d + ' of ' + list.length + ' done</span></div>' +
        '<section class="sec">' + list.map(choreLine).join('') + '</section></div>';
    });
    var olds = (S.data.chores || []).filter(function (c) { return !c.today && c.missed; });
    if (olds.length) {
      h += '<div class="pane on"><div class="pane-head"><h2>Missed</h2></div><section class="sec">';
      olds.forEach(function (c) {
        h += '<div class="item" data-chore="' + c.id + '" data-day="' + c.missed + '"><input type="checkbox" data-act="chorecheck" aria-label="Done">' +
          '<div class="body"><span class="t">' + esc(c.text) + '</span><div class="meta"><span class="chip late">Missed since ' + dayName(c.missed) + '</span></div></div></div>';
      });
      h += '</section></div>';
    }
    if (isParent()) {
      h += '<div class="pane on"><div class="pane-head"><h2>All chores</h2></div><section class="sec">';
      (S.data.chores || []).forEach(function (c) {
        h += '<div class="item" data-chore="' + c.id + '"><div class="body"><span class="t">' + esc(c.text) + '</span><div class="meta"><span class="chip">' + esc(personName(c.person)) + '</span><span class="chip">' + esc(schedule(c)) + '</span></div></div>' +
          '<button class="icon" data-act="delchore" aria-label="Delete chore">&times;</button></div>';
      });
      h += '<div class="add"><div class="addrow"><input type="text" data-draft="chore-text" placeholder="New chore" enterkeyhint="done" autocomplete="off"></div>' +
        '<div class="morerow"><select data-draft="chore-person">';
      (S.data.people || []).forEach(function (p) { h += '<option value="' + esc(p.id) + '"' + (p.id === 'roman' ? ' selected' : '') + '>' + esc(p.name) + '</option>'; });
      h += '<option value="all">Everyone</option></select></div><div class="chips days">';
      DAYS.forEach(function (n, i) { h += '<button class="' + (S.choreDays.indexOf(i) >= 0 ? 'on' : '') + '" data-act="choreday" data-v="' + i + '">' + n + '</button>'; });
      h += '</div><p class="hint">No days picked means every day.</p><div class="addrow"><button class="pri" data-act="addchore">Add chore</button></div></div></section></div>';
    }
    return h;
  }

  function listsView() {
    var lists = S.data.lists;
    if (!lists.some(function (l) { return l.key === S.listKey; })) S.listKey = lists[0] ? lists[0].key : null;
    var h = top('Lists', 'Check things off, tap an item for details');
    h += '<div class="chips">';
    lists.forEach(function (l) { h += '<button class="' + (l.key === S.listKey ? 'on' : '') + '" data-act="pick" data-key="' + esc(l.key) + '">' + esc(l.name) + '</button>'; });
    h += '</div><div class="panes">';
    lists.forEach(function (l) { h += paneHtml(l, l.key === S.listKey); });
    return h + '</div>';
  }

  function shopView() {
    var rows = shopRows();
    var h = top('Shopping', 'Parts and supplies from every list');
    h += '<div class="quick"><input type="text" data-draft="shop-text" placeholder="Add something to buy" enterkeyhint="done" autocomplete="off"><div class="row2">' +
      '<select data-draft="shop-store">' + options(S.data.stores, S.data.stores[0], 'No store') + '</select><select data-draft="shop-list">';
    S.data.lists.forEach(function (l) { h += '<option value="' + l.id + '"' + (l.key === 'roman-doug' ? ' selected' : '') + '>' + esc(l.name) + '</option>'; });
    h += '</select></div><button class="pri" data-act="shopadd">Add</button></div>';
    if (!rows.length) return h + '<div class="empty">Nothing to buy. Give any item a store (tap it, then pick a store) and it shows up here.</div>';
    var groups = {}, order = S.data.stores.slice();
    rows.forEach(function (r) { if (order.indexOf(r.it.store) < 0) order.push(r.it.store); (groups[r.it.store] = groups[r.it.store] || []).push(r); });
    order.forEach(function (name) {
      var g = groups[name]; if (!g) return;
      var open = g.filter(function (r) { return !r.it.done; }), got = g.filter(function (r) { return r.it.done; });
      h += '<div class="store-head"><h2>' + esc(name) + '</h2><span class="count">' + open.length + ' to buy</span></div><div class="sec">';
      var line = function (r) {
        return '<div class="shoprow' + (r.it.done ? ' done' : '') + '" data-id="' + r.it.id + '"><input type="checkbox" data-act="toggle"' + (r.it.done ? ' checked' : '') + ' aria-label="Bought">' +
          '<div class="body" data-act="open"><span class="t">' + esc(r.it.text) + '</span><div class="path">' + esc(r.where) + '</div></div></div>';
      };
      open.forEach(function (r) { h += line(r); });
      if (!open.length) h += '<div class="shoprow"><span class="count">All bought</span></div>';
      if (got.length) { h += '<details style="padding:8px 14px"><summary>Bought (' + got.length + ')</summary></details>'; got.forEach(function (r) { h += line(r); }); }
      h += '</div>';
    });
    return h;
  }

  function settingsView() {
    var h = top('Settings', 'Signed in as ' + S.me.name);
    h += '<div class="card"><h3>Account</h3><div class="addrow"><button class="ghost" data-act="signout">Sign out</button></div></div>';
    h += '<div class="card"><h3>Change my PIN</h3><p>Use 4 to 8 digits.</p><div class="addrow"><input type="password" inputmode="numeric" data-draft="pin-old" placeholder="Current PIN" autocomplete="off" style="flex:1">' +
      '<input type="password" inputmode="numeric" data-draft="pin-new" placeholder="New PIN" autocomplete="off" style="flex:1"><button class="pri" data-act="changepin">Save</button></div></div>';
    h += '<div class="card"><h3>Put it on your Home Screen</h3><p>On iPhone, open this page in Safari, tap the Share button, then Add to Home Screen. It opens like a real app.</p></div>';
    h += '<div class="card"><h3>Reminders to your phone</h3><p>Coming in the next version. On iPhone they only work from the Home Screen app.</p></div>';
    if (isParent()) {
      h += '<div class="card"><h3>Stores</h3><p>The stores you can tag items with, separated by commas.</p><div class="addrow"><input type="text" data-draft="stores" value="' + esc(S.data.stores.join(', ')) + '" style="flex:1"><button class="pri" data-act="savestores">Save</button></div></div>';
      h += '<div class="card"><h3>Bring in my old list</h3><p>Paste the backup from the first version of the app. It replaces Personal, Work, and the Roman projects with what is in the backup.</p><textarea rows="4" data-draft="import" placeholder="Paste backup here"></textarea><div class="addrow"><button class="ghost" data-act="import">Bring it in</button></div></div>';
    }
    h += '<div class="card"><h3>Back up</h3><p>Copies everything you can see so you can save it in a note.</p><div class="addrow"><button class="ghost" data-act="backup">Copy a backup</button><button class="ghost" data-act="hidedone">' + (S.hideDone ? 'Show finished items' : 'Hide finished items') + '</button></div></div>';
    h += '<div class="card"><h3>About</h3><p>Version ' + esc(APP_VER) + '</p><ul class="news">';
    NEWS.forEach(function (n) { n.notes.forEach(function (t) { h += '<li><b>' + esc(n.v) + '</b> (' + esc(n.d) + '): ' + esc(t) + '</li>'; }); });
    return h + '</ul></div>';
  }

  function sheetHtml() {
    if (!S.sheet) return '';
    var f = findItem(S.sheet.id);
    if (!f) { S.sheet = null; return ''; }
    var it = f.it, sh = S.sheet, ed = canEdit(it);
    var h = '<div class="scrim" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="Item details">';
    h += '<label>What</label><input type="text" data-sheet="text" value="' + esc(sh.text) + '"' + (ed ? '' : ' disabled') + '>';
    h += '<label>Store</label><select data-sheet="store"' + (ed ? '' : ' disabled') + '>' + options(S.data.stores, sh.store, 'No store') + '</select>';
    h += '<label>Priority</label><div class="seg">';
    [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].forEach(function (p) { h += '<button class="' + (sh.priority === p[0] ? 'on' : '') + '" data-act="pri" data-v="' + p[0] + '"' + (ed ? '' : ' disabled') + '>' + p[1] + '</button>'; });
    h += '</div><label>Due date</label><input type="date" data-sheet="due" value="' + esc(sh.due) + '"' + (ed ? '' : ' disabled') + '>';
    if (!f.parent && ed) {
      h += '<label>Add a sub item</label><div class="addrow"><input type="text" data-sheet="sub" value="' + esc(sh.sub || '') + '" placeholder="Sub item" style="flex:1"><button class="ghost" data-act="addsub">Add</button></div>';
    }
    h += '<div class="btns">' + (ed ? '<button class="ghost danger" data-act="deleteitem">Delete</button>' : '') +
      '<button class="ghost" data-act="closesheet">' + (ed ? 'Cancel' : 'Close') + '</button>' + (ed ? '<button class="pri" data-act="savesheet">Save</button>' : '') + '</div></div>';
    return h;
  }

  function loginView() {
    var h = '<div class="login"><h1>To Do</h1><div class="sub">Who is this?</div><div class="who">';
    S.users.forEach(function (u) { h += '<button class="' + (u.id === S.loginUser ? 'on' : '') + '" data-act="who" data-id="' + esc(u.id) + '">' + esc(u.name) + '</button>'; });
    h += '</div><input type="password" inputmode="numeric" autocomplete="off" data-draft="login-pin" placeholder="PIN" enterkeyhint="go"><div class="err" id="err">' + esc(S.err) + '</div><button class="pri" data-act="login">Sign in</button></div>';
    return h;
  }

  // ---------- drawing ----------
  function render() {
    var keep = {};
    if (!S.me || !S.data) {
      app.innerHTML = loginView();
    } else {
      var views = { home: homeView, lists: listsView, chores: choresView, shop: shopView, settings: settingsView };
      var body = (views[S.view] || homeView)();
      var tab = function (key, label) { var bn = badgeFor(key); return '<button class="' + (S.view === key ? 'on' : '') + '" data-act="tab" data-v="' + key + '"><span class="ico">' + ICONS[key] + (bn ? '<i class="badge' + (key === 'chores' ? ' red' : '') + '">' + (bn > 99 ? '99+' : bn) + '</i>' : '') + '</span><span>' + label + '</span></button>'; };
      app.innerHTML = '<div class="shell"><nav class="tabs">' + tab('home', 'Home') + tab('lists', 'Lists') + tab('chores', 'Chores') + tab('shop', 'Shopping') + tab('settings', 'Settings') + '</nav><main class="main">' + body + '</main></div>' +
        sheetHtml() + (S.toast ? '<div class="toast"><span>' + esc(S.toast.msg) + '</span>' + (S.toast.undo ? '<button data-act="undo">Undo</button>' : '') + '</div>' : '');
    }
    app.querySelectorAll('[data-draft]').forEach(function (el) {
      var k = el.getAttribute('data-draft');
      if (S.drafts[k] !== undefined) el.value = S.drafts[k];
    });
    S.pop = null;
  }

  var toastTimer = null;
  function toast(msg, undo) {
    S.toast = { msg: msg, undo: undo || null };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { S.toast = null; if (canRedraw()) render(); }, 6000);
    render();
  }
  function fail(e) { if (e && e.message !== 'signed out') toast(e.message || 'Something went wrong.'); }
  function clearDrafts(prefix) { Object.keys(S.drafts).forEach(function (k) { if (k.indexOf(prefix) === 0) delete S.drafts[k]; }); }

  // ---------- actions ----------
  function setDone(id, v) {
    var f = findItem(id); if (!f) return;
    f.it.done = v; f.it.kids.forEach(function (k) { k.done = v; });
    if (f.parent) f.parent.done = f.parent.kids.every(function (k) { return k.done; });
  }
  function toggle(id, v) {
    setDone(id, v); S.pop = v ? id : null; S.raw = '';
    render();
    api('PATCH', '/api/items/' + id, { done: v }).then(function () { return loadState(true); }).catch(function (e) { fail(e); loadState(); });
    if (v) toast('Checked off', function () { toggle(id, false); });
  }

  var actions = {
    tab: function (b) { S.view = b.dataset.v; render(); window.scrollTo(0, 0); },
    gotolist: function (b) { S.listKey = b.dataset.key; S.view = 'lists'; render(); window.scrollTo(0, 0); },
    theme: function () {
      var next = theme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next); store('todo-theme', next); render();
    },
    gotochores: function () { S.view = 'chores'; render(); window.scrollTo(0, 0); },
    choreday: function (b) { var d = +b.dataset.v, i = S.choreDays.indexOf(d); if (i >= 0) S.choreDays.splice(i, 1); else S.choreDays.push(d); render(); },
    chorecheck: function (b) {
      var row = b.closest('[data-chore]'), id = +row.dataset.chore, day = row.dataset.day || today(), v = b.checked;
      var c = (S.data.chores || []).filter(function (x) { return x.id === id; })[0];
      if (c) { if (day === today()) c.done = v; else if (v) c.missed = ''; S.pop = null; S.raw = ''; render(); }
      api('POST', '/api/chores/' + id + '/done', { day: day, done: v }).then(function () { return loadState(true); }).catch(function (e) { fail(e); loadState(); });
    },
    addchore: function () {
      var text = (S.drafts['chore-text'] || '').trim(); if (!text) return;
      api('POST', '/api/chores', { text: text, person: S.drafts['chore-person'] || 'roman', days: S.choreDays })
        .then(function () { clearDrafts('chore-text'); S.choreDays = []; S.raw = ''; return loadState(); }).then(function () { toast('Chore added'); }).catch(fail);
    },
    delchore: function (b) {
      var id = +b.closest('[data-chore]').dataset.chore;
      api('DELETE', '/api/chores/' + id).then(function () { S.raw = ''; return loadState(); }).then(function () { toast('Chore deleted'); }).catch(fail);
    },
    gotoshop: function () { S.view = 'shop'; render(); window.scrollTo(0, 0); },
    pick: function (b) { S.listKey = b.dataset.key; render(); },
    who: function (b) { S.loginUser = b.dataset.id; S.err = ''; store('todo-last-user', S.loginUser); render(); var p = app.querySelector('[data-draft="login-pin"]'); if (p) p.focus(); },
    login: function () {
      var pin = S.drafts['login-pin'] || '';
      if (!S.loginUser) { S.err = 'Pick who you are first.'; return render(); }
      api('POST', '/api/login', { user: S.loginUser, pin: pin }).then(function (j) {
        S.me = j.user; delete S.drafts['login-pin']; S.err = ''; S.raw = '';
        return loadState();
      }).catch(function (e) { S.err = e.message; delete S.drafts['login-pin']; render(); });
    },
    signout: function () { api('POST', '/api/logout').then(function () { S.me = null; S.data = null; S.raw = ''; S.view = 'home'; render(); }); },
    refresh: function () {
      checkUpdate(function (newer) {
        if (newer) location.reload();
        else loadState().then(function () { toast('You have the latest.'); }).catch(fail);
      });
    },
    toggle: function (b) { var id = +b.closest('[data-id]').dataset.id; toggle(id, b.checked); },
    open: function (b) {
      var id = +b.closest('[data-id]').dataset.id, f = findItem(id); if (!f) return;
      S.sheet = { id: id, text: f.it.text, store: f.it.store, priority: f.it.priority, due: f.it.due, sub: '' }; render();
    },
    closesheet: function () { S.sheet = null; render(); },
    pri: function (b) { S.sheet.priority = b.dataset.v; render(); },
    savesheet: function () {
      var sh = S.sheet, f = findItem(sh.id);
      var body = { text: sh.text, store: sh.store, priority: sh.priority, due: sh.due };
      S.sheet = null; S.raw = '';
      api('PATCH', '/api/items/' + sh.id, body).then(function () { return loadState(); }).catch(function (e) { fail(e); loadState(); });
    },
    addsub: function () {
      var sh = S.sheet, f = findItem(sh.id), text = (sh.sub || '').trim(); if (!text) return;
      api('POST', '/api/items', { section_id: f.sec.id, parent_id: sh.id, text: text }).then(function () { sh.sub = ''; S.raw = ''; return loadState(); }).then(function () { toast('Sub item added'); }).catch(fail);
    },
    deleteitem: function () {
      var id = S.sheet.id; S.sheet = null; S.raw = '';
      api('DELETE', '/api/items/' + id).then(function () { return loadState(); }).then(function () {
        toast('Deleted', function () { api('PATCH', '/api/items/' + id, { deleted: false }).then(function () { S.raw = ''; return loadState(); }).catch(fail); });
      }).catch(fail);
    },
    add: function (b) {
      var sec = b.closest('[data-sec]'), sid = +sec.dataset.sec;
      var text = (S.drafts['add-' + sid] || '').trim(); if (!text) return;
      api('POST', '/api/items', { section_id: sid, text: text, store: S.drafts['st-' + sid] || '', priority: S.drafts['pr-' + sid] || 'normal' })
        .then(function () { clearDrafts('add-' + sid); clearDrafts('st-' + sid); clearDrafts('pr-' + sid); S.raw = ''; return loadState(); }).catch(fail);
    },
    shopadd: function () {
      var text = (S.drafts['shop-text'] || '').trim(); if (!text) return;
      var lid = +(S.drafts['shop-list'] || (S.data.lists.filter(function (l) { return l.key === 'roman-doug'; })[0] || S.data.lists[0]).id);
      api('POST', '/api/items', { list_id: lid, shopping: true, text: text, store: S.drafts['shop-store'] !== undefined ? S.drafts['shop-store'] : S.data.stores[0] })
        .then(function () { delete S.drafts['shop-text']; S.raw = ''; return loadState(); }).catch(fail);
    },
    bulk: function (b) {
      var pane = b.closest('[data-list]'), lid = pane.dataset.list;
      var text = S.drafts['bulk-' + lid] || '', sid = +(S.drafts['bulksec-' + lid] || pane.querySelector('[data-draft^="bulksec-"]').value);
      if (!text.trim()) return;
      api('POST', '/api/bulk', { section_id: sid, text: text }).then(function (j) { clearDrafts('bulk-' + lid); S.raw = ''; return loadState().then(function () { toast('Added ' + j.added + ' items'); }); }).catch(fail);
    },
    newsec: function (b) {
      var pane = b.closest('[data-list]'), lid = +pane.dataset.list, name = (S.drafts['newsec-' + lid] || '').trim(); if (!name) return;
      api('POST', '/api/sections', { list_id: lid, name: name }).then(function () { clearDrafts('newsec-' + lid); S.raw = ''; return loadState(); }).catch(fail);
    },
    delsec: function (b) {
      var sid = +b.closest('[data-sec]').dataset.sec;
      if (!confirm('Delete this section and everything in it?')) return;
      api('DELETE', '/api/sections/' + sid).then(function () { S.raw = ''; return loadState(); }).catch(fail);
    },
    changepin: function () {
      api('POST', '/api/pin', { old: S.drafts['pin-old'] || '', new: S.drafts['pin-new'] || '' })
        .then(function () { clearDrafts('pin-'); toast('PIN changed'); }).catch(fail);
    },
    savestores: function () {
      var list = (S.drafts['stores'] !== undefined ? S.drafts['stores'] : S.data.stores.join(', ')).split(',');
      api('PATCH', '/api/stores', { stores: list }).then(function () { clearDrafts('stores'); S.raw = ''; return loadState(); }).then(function () { toast('Stores saved'); }).catch(fail);
    },
    import: function () {
      var raw = S.drafts['import'] || '', state;
      try { state = JSON.parse(raw); } catch (e) { return toast('That is not a valid backup.'); }
      if (!confirm('Replace Personal, Work, and the Roman projects with this backup?')) return;
      api('POST', '/api/import', { state: state }).then(function (j) { clearDrafts('import'); S.raw = ''; return loadState().then(function () { toast('Brought in ' + j.imported + ' items'); }); }).catch(fail);
    },
    backup: function () {
      var text = JSON.stringify(S.data, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Backup copied'); }, function () { toast('Could not copy. Try again.'); });
      else toast('Could not copy on this browser.');
    },
    hidedone: function () { S.hideDone = !S.hideDone; store('todo-hide', S.hideDone ? '1' : '0'); render(); },
    undo: function () { var u = S.toast && S.toast.undo; S.toast = null; if (u) u(); else render(); },
  };

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || !app.contains(b)) return;
    // Taps on text open the item, but a tap on a link-like control should not also toggle.
    var fn = actions[b.dataset.act]; if (fn) fn(b, e);
  });
  app.addEventListener('input', function (e) {
    var d = e.target.getAttribute && e.target.getAttribute('data-draft');
    if (d) S.drafts[d] = e.target.value;
    var f = e.target.getAttribute && e.target.getAttribute('data-sheet');
    if (f && S.sheet) S.sheet[f] = e.target.value;
  });
  app.addEventListener('change', function (e) {
    var d = e.target.getAttribute && e.target.getAttribute('data-draft');
    if (d) S.drafts[d] = e.target.value;
    var f = e.target.getAttribute && e.target.getAttribute('data-sheet');
    if (f && S.sheet) S.sheet[f] = e.target.value;
  });
  app.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t.matches('[data-draft^="add-"], [data-draft="shop-text"], [data-draft="chore-text"], [data-draft^="newsec-"], [data-draft="login-pin"], [data-draft="stores"]')) {
      var btn = t.closest('.add, .quick, .newsec, .login, .card'); btn = btn && btn.querySelector('button.pri'); if (btn) btn.click();
    }
    if (t.matches('[data-sheet="sub"]')) actions.addsub();
    if (t.matches('[data-sheet="text"]')) actions.savesheet();
  });

  // ---------- updates and keeping fresh ----------
  var lastCheck = 0;
  function checkUpdate(cb) {
    if (window.__PREVIEW || typeof fetch !== 'function') return cb && cb(false);
    fetch('/app.js?check=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var m = /APP_VER\s*=\s*'([^']+)'/.exec(t), newer = !!(m && m[1] !== APP_VER);
      S.newer = newer;
      if (cb) cb(newer);
      else if (newer) {
        var a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName), last = +(sessionStorage.getItem('todo-upd') || 0);
        if (!typing && !S.sheet && Date.now() - last > 60000) { try { sessionStorage.setItem('todo-upd', String(Date.now())); } catch (e) {} location.reload(); }
        else if (canRedraw()) render();
      }
    }).catch(function () { if (cb) cb(false); });
  }

  setInterval(function () { if (S.me && document.visibilityState === 'visible') loadState(true).catch(function () {}); }, 15000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (S.me) loadState(true).catch(function () {}); checkUpdate(); }
  });
  if (window.visualViewport) {
    var lift = function () { var v = window.visualViewport; document.documentElement.style.setProperty('--kb', Math.max(0, window.innerHeight - v.height - v.offsetTop) + 'px'); };
    window.visualViewport.addEventListener('resize', lift); window.visualViewport.addEventListener('scroll', lift);
  }

  function start() {
    S.hideDone = store('todo-hide') === '1';
    var th = store('todo-theme'); if (th) document.documentElement.setAttribute('data-theme', th);
    S.loginUser = store('todo-last-user') || '';
    S.me = null; S.data = null; S.raw = ''; S.view = 'home'; S.sheet = null;
    api('GET', '/api/users').then(function (u) {
      S.users = u.users;
      if (!S.users.some(function (x) { return x.id === S.loginUser; })) S.loginUser = '';
      return api('GET', '/api/me').then(function (m) { S.me = m.user; return loadState(); }).catch(function () { render(); });
    }).catch(function () { app.innerHTML = '<div class="login"><h1>To Do</h1><div class="err">Could not reach the server. Check your connection and try again.</div></div>'; });
    checkUpdate();
  }

  window.TodoApp = { start: start };
  start();
})();
