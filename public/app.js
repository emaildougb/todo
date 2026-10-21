/* To Do app. Plain JavaScript, no build step. Everything draws into #app. */
(function () {
  'use strict';

  var APP_VER = '1.3.0';
  var NEWS = [
    { v: '1.3.0', d: 'Oct 20, 2026', notes: ['Dad can tap View as Roman to see the app the way Roman sees it (look only), and can reset Roman\u2019s PIN from Settings. The garage car is gone for now.'] },
    { v: '1.2.0', d: 'Oct 20, 2026', notes: ["Roman's Wish List with links, a countdown to Christmas and his birthday, Roman's week with a percent goal and reward, a bank of weekly idea suggestions, and a garage with flip up headlights."] },
    { v: '1.1.0', d: 'Oct 20, 2026', notes: ['Swipe left to delete, slide items up and down with the grip, move items and whole sections between lists, group items under a parent, Food and Other shopping lists, stacked list buttons, and an instant Add.'] },
    { v: '1.0.0', d: 'Oct 18, 2026', notes: ['First shared version: Personal, Work, and Roman lists, chores for Roman, shopping by store, PIN sign in, and one list on every phone.'] },
  ];

  var S = {
    me: null, users: [], data: null, raw: '', view: 'home', listKey: null, sheet: null,
    toast: null, drafts: {}, choreDays: [], editChore: 0, hideDone: false, newer: false, pop: null, loginUser: '', err: '', busy: false,
    adding: false, pendingShop: [], shopTab: 'other', viewAs: '', realMe: null,
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
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, S.viewAs ? { 'X-View-As': S.viewAs } : {}),
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
    return !drag && !S.sheet && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
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
  // kind: 'food', 'other', or nothing for both.
  function shopRows(kind) {
    var rows = [];
    var keep = function (it) { return it.store && (!kind || (it.shop === 'food') === (kind === 'food')); };
    S.data.lists.forEach(function (l) {
      l.sections.forEach(function (s) {
        s.items.forEach(function (it) {
          if (keep(it)) rows.push({ it: it, list: l, where: l.name + ' › ' + s.name });
          it.kids.forEach(function (k) { if (keep(k)) rows.push({ it: k, list: l, where: l.name + ' › ' + it.text }); });
        });
      });
    });
    return rows;
  }
  function storesFor(kind) { return (kind === 'food' ? S.data.stores_food : S.data.stores) || []; }
  function firstView() { return S.me && S.me.role === 'kid' ? 'chores' : 'home'; }
  // Every section of every list, for the Move to picker.
  function moveTargets() {
    var out = [];
    S.data.lists.forEach(function (l) { l.sections.forEach(function (s) { out.push({ list: l, sec: s }); }); });
    return out;
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
    if (it.link) h += '<a class="chip linkchip" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">Open link</a>';
    return h ? '<div class="meta">' + h + '</div>' : '';
  }

  var TRASH = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>';
  var FLAGS = { high: '⚑', normal: '⚐', low: '↓' };

  // Every list row sits in a .swrap: the trash button waits behind it, and the grip on the right slides it up or down.
  function rowHtml(it, isKid, parentId) {
    var has = !isKid && it.kids.length;
    var dn = has ? itemDone(it) : it.done;
    if (S.hideDone && dn) return '';
    var cls = (isKid ? 'kid' : 'item') + (dn ? ' done' : '') + (S.pop === it.id ? ' pop' : '');
    var par = parentId || 0;
    if (it.saving) {
      return '<div class="swrap" data-par="' + par + '"><div class="' + cls + ' saving"><input type="checkbox" disabled aria-label="Saving"><div class="body"><span class="t">' + esc(it.text) + '</span></div><span class="count">saving</span></div></div>';
    }
    var ed = canEdit(it);
    var h = '<div class="swrap" data-par="' + par + '">' +
      (ed ? '<button class="swdel" data-act="swipedel" data-swid="' + it.id + '" aria-label="Delete">' + TRASH + '</button>' : '') +
      '<div class="' + cls + '" data-id="' + it.id + '">' +
      '<input type="checkbox" data-act="toggle" aria-label="Done"' + (dn ? ' checked' : '') + '>' +
      '<div class="body" data-act="open"><span class="t">' + esc(it.text) + '</span>' + metaHtml(it) + '</div>';
    if (has) h += '<span class="count">' + it.kids.filter(function (k) { return k.done; }).length + '/' + it.kids.length + '</span>';
    if (ed) h += '<button class="flag ' + (it.priority || 'normal') + '" data-act="flag" aria-label="Priority: ' + (it.priority || 'normal') + '. Tap to change.">' + FLAGS[it.priority || 'normal'] + '</button>' +
      '<span class="grip" data-grip="1" role="button" aria-label="Hold and slide to reorder">≡</span>';
    h += '</div></div>';
    if (has) it.kids.forEach(function (k) { h += rowHtml(k, true, it.id); });
    return h;
  }

  function paneHtml(l, on) {
    var st = stats(l), pct = st[1] ? Math.round(st[0] / st[1] * 100) : 0;
    var h = '<div class="pane' + (on ? ' on' : '') + '" data-list="' + l.id + '">' +
      '<div class="pane-head"><h2>' + esc(l.name) + '</h2><span class="count">' + st[0] + ' of ' + st[1] + ' done</span></div>' +
      '<div class="bar"><div style="width:' + pct + '%"></div></div>';
    if (l.key === 'roman-doug' && S.me.role === 'kid') h += '<div class="letdad">Anything you want to do with Dad? Let him know right here.</div>';
    l.sections.forEach(function (s) {
      var d = 0, t = 0;
      s.items.forEach(function (it) {
        if (it.kids.length) it.kids.forEach(function (k) { t++; if (k.done) d++; });
        else { t++; if (it.done) d++; }
      });
      var mv = '';
      if (isParent() && S.data.lists.length > 1) {
        mv = '<select class="movesel" data-movesec="1" aria-label="Move this section to another list"><option value="">Move to…</option>';
        S.data.lists.forEach(function (o) { if (o.id !== l.id) mv += '<option value="' + o.id + '">' + esc(o.name) + '</option>'; });
        mv += '</select>';
      }
      h += '<section class="sec" data-sec="' + s.id + '"><div class="sec-head"><h3>' + esc(s.name) + '</h3><span class="count">' + d + '/' + t + '</span>' + mv +
        (isParent() ? '<button class="icon" data-act="delsec" title="Delete section" aria-label="Delete section">&times;</button>' : '') + '</div>';
      s.items.forEach(function (it) { h += rowHtml(it, false, 0); });
      h += '<div class="add"><div class="addrow"><input type="text" data-draft="add-' + s.id + '" placeholder="Add an item" enterkeyhint="done" autocomplete="off">' +
        '<button class="pri" data-act="add">Add</button></div>' +
        '<details><summary>More</summary><div class="morerow">' + (l.key === 'wish' ? '<input type="url" data-draft="ln-' + s.id + '" placeholder="Link (optional)" autocomplete="off" autocapitalize="off">' : '<select data-draft="st-' + s.id + '">' + options(S.data.stores, '', 'No store') + '</select>') +
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
    var h = top(greeting() + ', ' + S.me.name, dueLine(open)) + weekCardHtml() + ideaLineHtml() + countdownHtml();
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


  // ---------- the week goal, ideas, countdown ----------
  // [idea, seasons (w winter, p spring, u summer, f fall, a any), cost (0 free, 1 small, 2 bigger)]
  var IDEAS = [
    ['Pancake breakfast, Roman picks the toppings', 'a', 1], ['Movie night with popcorn, he picks the movie', 'a', 1],
    ['Drive to a car meet or just look at cool cars together', 'a', 0], ['Wash and wax a vehicle together', 'a', 0],
    ['Build something out of scrap wood in the shop', 'a', 0], ['An hour on the motorcycle project, Roman runs the wrenches', 'a', 0],
    ['Hunt for a treasure at a pull a part yard', 'a', 1], ['Burger or pizza night, Roman cooks and Dad helps', 'a', 1],
    ['Arcade or go karts', 'a', 2], ['Harbor Freight trip, Roman picks one tool under $20', 'a', 1],
    ['Bowling', 'a', 2], ['Board game tournament, loser does the dishes', 'a', 0],
    ['Build a Lego or model car kit together', 'a', 1], ['Watch a classic car movie together', 'a', 0],
    ['Lunch date, just the two of you, his pick', 'a', 2], ['Shoot hoops or throw the football', 'a', 0],
    ['Teach him one new skill: oil change, tire check, or a jump start', 'a', 0], ['Pick a YouTube build video and try to copy it', 'a', 0],
    ['Dessert run, any treat he wants', 'a', 1], ['Stay up late with snacks and a video game together', 'a', 0],
    ['Sketch his dream car and price out the parts', 'a', 0], ['Roman picks the music for a whole car ride', 'a', 0],
    ['Homemade ice cream or milkshakes', 'a', 1], ['Build a birdhouse', 'a', 1],
    ['Hot cocoa and a puzzle', 'w', 1], ['Sledding or snow play if it snows', 'w', 0],
    ['Blanket fort and a movie inside it', 'w', 0], ['Bake cookies together', 'w', 1],
    ['Rock climbing gym', 'w', 2], ['Drive around to see Christmas lights', 'w', 0],
    ['Garage project with the heater on', 'w', 0], ['Fly a kite', 'p', 1],
    ['Bike ride and ice cream', 'p', 1], ['Plant a tomato or pepper plant together', 'p', 1],
    ['Hike to a waterfall', 'p', 0], ['Muddy bike day on a trail', 'p', 0],
    ['Go to a baseball game', 'p', 2], ['Yard cleanup, then a treat', 'p', 1],
    ['Swim at the lake or river', 'u', 0], ['Backyard campout', 'u', 0],
    ['BBQ, Roman picks the meat', 'u', 1], ['Fishing trip', 'u', 1],
    ['Sprinkler run or water balloon fight', 'u', 0], ['Day trip to the coast', 'u', 2],
    ['Go to a car show', 'u', 0], ['Evening drive with the windows down and an ice cream stop', 'u', 1],
    ['Bonfire and s\u2019mores', 'u', 1], ['Minibike ride day', 'u', 0],
    ['Pumpkin patch or corn maze', 'f', 2], ['Carve pumpkins', 'f', 1],
    ['Watch a football game together with snacks', 'f', 1], ['Chili cook off at home', 'f', 1],
    ['Rake leaves, then jump in the pile', 'f', 0], ['Apple picking and a pie', 'f', 2],
    ['Cozy fire and a movie', 'f', 0],
  ];
  var SEASON_OF = ['w', 'w', 'p', 'p', 'p', 'u', 'u', 'u', 'f', 'f', 'f', 'w'];
  function allIdeas() { return IDEAS.map(function (x) { return x[0]; }).concat((S.data && S.data.ideas_custom) || []); }
  function ideaPool() {
    var ssn = SEASON_OF[new Date().getMonth()];
    var base = IDEAS.filter(function (x) { return x[1] === 'a' || x[1] === ssn; }).map(function (x) { return x[0]; });
    return base.concat((S.data && S.data.ideas_custom) || []);
  }
  function usedIdeas() { try { var a = JSON.parse(store('todo-ideas-used') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function markUsed(text) {
    if (!text || allIdeas().indexOf(text) < 0) return;
    var u = usedIdeas(); if (u.indexOf(text) < 0) u.push(text); store('todo-ideas-used', JSON.stringify(u.slice(-100)));
  }
  function nextIdea() {
    var used = usedIdeas(), cur = S.drafts['wk-reward'];
    var pool = ideaPool().filter(function (x) { return used.indexOf(x) < 0 && x !== cur; });
    if (!pool.length) { store('todo-ideas-used', '[]'); pool = ideaPool().filter(function (x) { return x !== cur; }); }
    return pool[Math.floor(Math.random() * pool.length)] || '';
  }
  // The same idea all week long, for everyone, so it does not jump around.
  function weekIdea() {
    var wk = S.data.week ? S.data.week.week : today(), n = 0, pool = ideaPool();
    for (var i = 0; i < wk.length; i++) n = (n * 31 + wk.charCodeAt(i)) % 100003;
    return pool[n % pool.length] || '';
  }
  function plusDays(d, n) { var x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }

  function weekCardHtml() {
    var w = S.data.week; if (!w) return '';
    var ed = isParent(), pct = Math.min(100, w.pct);
    var h = '<div class="weekcard' + (w.earned ? ' earned' : '') + '"><div class="wk-head"><span class="name">' + esc(w.name) + '\u2019s week</span><span class="num">' + fmtDue(w.week) + ' to ' + fmtDue(plusDays(w.week, 6)) + '</span></div>' +
      '<div class="goalbar"><div style="width:' + pct + '%"></div><i style="left:' + w.target + '%" title="Goal"></i></div>' +
      '<div class="goalline"><b>' + w.pct + '%</b> so far (' + w.done + ' of ' + w.total + ' chores). Goal: ' + w.target + '%.</div>';
    if (w.reward) h += '<div class="reward">Reward: <b>' + esc(w.reward) + '</b></div>';
    else h += '<div class="reward muted">' + (ed ? 'No reward picked yet.' : 'Dad has not picked a reward yet.') + '</div>';
    if (w.earned) h += w.closed ? '<div class="earnedtag paid">Earned and paid out</div>' : '<div class="earnedtag">Earned!' + (ed ? ' <button class="ghost" data-act="paid" data-week="' + w.week + '">Paid out</button>' : '') + '</div>';
    if (ed) {
      var open = Object.keys(S.drafts).some(function (k) { return k.indexOf('wk-') === 0 || k.indexOf('idea-') === 0; });
      h += '<details class="goaledit"' + (open ? ' open' : '') + '><summary>Set the goal and reward</summary>' +
        '<label>Goal percent</label><input type="number" inputmode="numeric" min="1" max="100" data-draft="wk-target" value="' + w.target + '">' +
        '<label>Reward (money, a gift, or time with Dad)</label><input type="text" data-draft="wk-reward" value="' + esc(w.reward) + '" placeholder="What does Roman earn?" autocomplete="off">' +
        '<div class="addrow"><button class="ghost" data-act="idea">Need an idea?</button><button class="pri" data-act="saveweek">Save</button></div>' +
        '<label>Add your own idea</label><div class="addrow"><input type="text" data-draft="idea-new" placeholder="Something fun to do" autocomplete="off" style="flex:1"><button class="ghost" data-act="newidea">Add</button></div></details>';
    }
    if (w.history.length) {
      h += '<div class="wkhist"><h4>Past weeks</h4>';
      w.history.forEach(function (x) {
        h += '<div class="wkrow"><span>' + fmtDue(x.week) + '</span><span>' + x.pct + '% (goal ' + x.target + '%)</span><span class="' + (x.earned ? 'ok' : 'miss') + '">' + (x.earned ? (x.closed ? 'Paid out' : 'Earned') : 'Missed') + '</span>' +
          (ed && x.earned && !x.closed ? '<button class="ghost" data-act="paid" data-week="' + x.week + '">Paid out</button>' : '') + '</div>' +
          (x.reward ? '<div class="wkreward">' + esc(x.reward) + '</div>' : '');
      });
      h += '</div>';
    }
    return h + '</div>';
  }
  function ideaLineHtml() {
    if (!isParent() || !S.data.week) return '';
    var t = weekIdea(); if (!t) return '';
    return '<div class="ideacard"><span class="il">Idea for this week</span><b>' + esc(t) + '</b><button class="ghost" data-act="useidea">Use it as the reward</button></div>';
  }
  function daysUntil(m, d) {
    var t = new Date(), a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()), y = t.getFullYear(), n = Date.UTC(y, m, d);
    if (n < a) { y++; n = Date.UTC(y, m, d); }
    return { days: Math.round((n - a) / 86400000), year: y };
  }
  function wishCount(name) {
    var n = 0;
    S.data.lists.forEach(function (l) { if (l.key === 'wish') l.sections.forEach(function (s) { if (s.name.toLowerCase() === name) s.items.forEach(function (it) { if (!itemDone(it)) n++; }); }); });
    return n;
  }
  function countdownHtml() {
    if (!S.data.lists.some(function (l) { return l.key === 'wish'; })) return '';
    var kidView = S.me.role === 'kid', nm = S.data.week ? S.data.week.name : 'Roman';
    var one = function (info, label, extra, cnt) {
      var dd = info.days === 0 ? 'Today!' : info.days === 1 ? '1 day' : info.days + ' days';
      return '<button class="cd" data-act="gotolist" data-key="wish"><span class="cdn">' + dd + '</span><span class="cdl">' + esc(label) + '</span><span class="cdx">' + esc(extra + (cnt ? (extra ? ' \u00B7 ' : '') + cnt + (cnt === 1 ? ' idea' : ' ideas') : '')) + '</span></button>';
    };
    var xm = daysUntil(11, 25), bd = daysUntil(5, 14);
    return '<div class="countdown">' + one(xm, 'until Christmas', '', wishCount('christmas')) +
      one(bd, 'until ' + (kidView ? 'your' : nm + '\u2019s') + ' birthday', 'Turns ' + (bd.year - 2014), wishCount('birthday')) + '</div>';
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
    var h = top('Chores', 'Today, ' + MONTHS[new Date().getMonth()] + ' ' + new Date().getDate()) + weekCardHtml();
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
    h += '<div class="listgrid">';
    lists.forEach(function (l) {
      var st = stats(l), left = st[1] - st[0];
      h += '<button class="' + (l.key === S.listKey ? 'on' : '') + '" data-act="pick" data-key="' + esc(l.key) + '"><span class="ln">' + esc(l.name) + '</span>' + (left ? '<span class="lc">' + left + '</span>' : '') + '</button>';
    });
    h += '</div><div class="panes">';
    lists.forEach(function (l) { h += paneHtml(l, l.key === S.listKey); });
    return h + '</div>';
  }

  function shopView() {
    var kind = S.shopTab === 'food' ? 'food' : 'other', stores = storesFor(kind);
    var rows = shopRows(kind);
    var left = function (k) { return shopRows(k).filter(function (r) { return !r.it.done; }).length; };
    var nf = left('food'), no = left('other');
    var h = top('Shopping', 'Food, and everything else');
    h += '<div class="shoptabs"><button class="' + (kind === 'food' ? 'on' : '') + '" data-act="shoptab" data-v="food"><span class="ln">Food</span>' + (nf ? '<span class="lc">' + nf + '</span>' : '') + '</button>' +
      '<button class="' + (kind === 'other' ? 'on' : '') + '" data-act="shoptab" data-v="other"><span class="ln">Other</span>' + (no ? '<span class="lc">' + no + '</span>' : '') + '</button></div>';
    h += '<div class="quick"><input type="text" data-draft="shop-text" placeholder="' + (kind === 'food' ? 'Add food to buy' : 'Add something to buy') + '" enterkeyhint="done" autocomplete="off"><div class="row2">' +
      '<select data-draft="shop-store">' + options(stores, stores[0], 'No store') + '</select><select data-draft="shop-list">';
    S.data.lists.forEach(function (l) { h += '<option value="' + l.id + '"' + (l.key === 'roman-doug' ? ' selected' : '') + '>' + esc(l.name) + '</option>'; });
    h += '</select></div><button class="pri" data-act="shopadd">Add</button></div>';
    var pend = S.pendingShop.filter(function (p) { return p.shop === kind; });
    if (pend.length) {
      h += '<div class="sec">';
      pend.forEach(function (p) { h += '<div class="shoprow saving"><input type="checkbox" disabled aria-label="Saving"><div class="body"><span class="t">' + esc(p.text) + '</span></div><span class="count">saving</span></div>'; });
      h += '</div>';
    }
    if (!rows.length && !pend.length) return h + '<div class="empty">' + (kind === 'food' ? 'No food on the list. Add something above.' : 'Nothing to buy. Add something above, or give any item a store (tap it, then pick a store) and it shows up here.') + '</div>';
    var groups = {}, order = stores.slice();
    rows.forEach(function (r) { if (order.indexOf(r.it.store) < 0) order.push(r.it.store); (groups[r.it.store] = groups[r.it.store] || []).push(r); });
    order.forEach(function (name) {
      var g = groups[name]; if (!g) return;
      var open = g.filter(function (r) { return !r.it.done; }), got = g.filter(function (r) { return r.it.done; });
      h += '<div class="store-head"><h2>' + esc(name) + '</h2><span class="count">' + open.length + ' to buy</span></div><div class="sec">';
      var line = function (r) {
        var ed = canEdit(r.it);
        return '<div class="swrap">' + (ed ? '<button class="swdel" data-act="swipedel" data-swid="' + r.it.id + '" aria-label="Delete">' + TRASH + '</button>' : '') +
          '<div class="shoprow' + (r.it.done ? ' done' : '') + '" data-id="' + r.it.id + '"><input type="checkbox" data-act="toggle"' + (r.it.done ? ' checked' : '') + ' aria-label="Bought">' +
          '<div class="body" data-act="open"><span class="t">' + esc(r.it.text) + '</span><div class="path">' + esc(r.where) + '</div></div></div></div>';
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
    if (isParent() && !S.viewAs) {
      var kidp = (S.data.people || []).filter(function (x) { return x.role === 'kid'; })[0];
      if (kidp) h += '<div class="card"><h3>' + esc(kidp.name) + '</h3><p>See the app exactly the way ' + esc(kidp.name) + ' sees it. You can look but not change anything while you are in there.</p><div class="addrow"><button class="ghost" data-act="viewas" data-id="' + esc(kidp.id) + '">View as ' + esc(kidp.name) + '</button></div>' +
        '<p style="margin-top:14px">Reset his PIN (4 to 8 digits). This also clears any lockout.</p><div class="addrow"><input type="password" inputmode="numeric" data-draft="rst-pin" placeholder="New PIN for ' + esc(kidp.name) + '" autocomplete="off" style="flex:1"><button class="pri" data-act="resetpin" data-id="' + esc(kidp.id) + '">Reset PIN</button></div></div>';
    }
    h += '<div class="card"><h3>Put it on your Home Screen</h3><p>On iPhone, open this page in Safari, tap the Share button, then Add to Home Screen. It opens like a real app.</p></div>';
    h += '<div class="card"><h3>Reminders to your phone</h3><p>Coming in the next version. On iPhone they only work from the Home Screen app.</p></div>';
    if (isParent()) {
      h += '<div class="card"><h3>Other stores</h3><p>Stores for the Other shopping list, separated by commas.</p><div class="addrow"><input type="text" data-draft="stores" value="' + esc(S.data.stores.join(', ')) + '" style="flex:1"><button class="pri" data-act="savestores" data-kind="">Save</button></div></div>';
      h += '<div class="card"><h3>Food stores</h3><p>Stores for the Food shopping list, separated by commas.</p><div class="addrow"><input type="text" data-draft="stores-food" value="' + esc(S.data.stores_food.join(', ')) + '" style="flex:1"><button class="pri" data-act="savestores" data-kind="food">Save</button></div></div>';
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
    h += '<label>Shopping list</label><div class="seg two">' +
      [['', 'Other'], ['food', 'Food']].map(function (p) { return '<button class="' + ((sh.shop || '') === p[0] ? 'on' : '') + '" data-act="shopsel" data-v="' + p[0] + '"' + (ed ? '' : ' disabled') + '>' + p[1] + '</button>'; }).join('') + '</div>';
    h += '<label>Store</label><select data-sheet="store"' + (ed ? '' : ' disabled') + '>' + options(storesFor(sh.shop), sh.store, 'No store') + '</select>';
    h += '<label>Priority</label><div class="seg">';
    [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].forEach(function (p) { h += '<button class="' + (sh.priority === p[0] ? 'on' : '') + '" data-act="pri" data-v="' + p[0] + '"' + (ed ? '' : ' disabled') + '>' + p[1] + '</button>'; });
    if (f.list.key === 'wish') h += '</div><label>Link (optional)</label><input type="url" data-sheet="link" value="' + esc(sh.link || '') + '" placeholder="Where to find it" autocapitalize="off"' + (ed ? '' : ' disabled') + '><label>Due date</label>';
    else h += '</div><label>Due date</label><input type="date" data-sheet="due" value="' + esc(sh.due) + '"' + (ed ? '' : ' disabled') + '>';
    if (!f.parent && ed) {
      h += '<label>Add a sub item</label><div class="addrow"><input type="text" data-sheet="sub" value="' + esc(sh.sub || '') + '" placeholder="Sub item" style="flex:1"><button class="ghost" data-act="addsub">Add</button></div>';
    }
    if (isParent()) {
      if (!f.parent) {
        h += '<label>Move to</label><select data-sheet="sec">';
        S.data.lists.forEach(function (l) {
          h += '<optgroup label="' + esc(l.name) + '">';
          l.sections.forEach(function (s) { h += '<option value="' + s.id + '"' + (s.id === +sh.sec ? ' selected' : '') + '>' + esc(s.name) + '</option>'; });
          h += '</optgroup>';
        });
        h += '</select>';
      }
      // Put under: only when the item has no sub items of its own, and only inside its own section.
      if (f.parent || !f.it.kids.length) {
        h += '<label>' + (f.parent ? 'Sub item of' : 'Put under') + '</label><select data-sheet="par">' + (f.parent ? '' : '<option value="">Nothing, keep it on its own</option>');
        f.sec.items.forEach(function (p) { if (p.id !== it.id) h += '<option value="' + p.id + '"' + (+sh.par === p.id ? ' selected' : '') + '>' + esc(p.text) + '</option>'; });
        if (f.parent) h = h.replace('<select data-sheet="par">', '<select data-sheet="par"><option value="">Make it a normal item</option>');
        h += '</select>';
      }
    }
    if (ed) h += '<div class="seg two" style="margin-top:12px"><button data-act="sheettop">Move to top</button><button data-act="sheetbottom">Send to bottom</button></div>';
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
      var tabs = S.me.role === 'kid'
        ? tab('chores', 'Chores') + tab('lists', 'Lists') + tab('shop', 'Shopping') + tab('home', 'Home') + tab('settings', 'Settings')
        : tab('home', 'Home') + tab('lists', 'Lists') + tab('chores', 'Chores') + tab('shop', 'Shopping') + tab('settings', 'Settings');
      var vbar = S.viewAs ? '<div class="vbar"><span>Viewing as ' + esc(S.me.name) + '. Look only.</span><button data-act="viewback">Back to ' + esc(S.realMe.name) + '</button></div>' : '';
      app.innerHTML = vbar + '<div class="shell"><nav class="tabs">' + tabs + '</nav><main class="main">' + body + '</main></div>' +
        sheetHtml() + (S.toast ? '<div class="toast"><span>' + esc(S.toast.msg) + '</span>' + (S.toast.undo ? '<button data-act="undo">Undo</button>' : '') + '</div>' : '');
    }
    app.querySelectorAll('[data-draft]').forEach(function (el) {
      var k = el.getAttribute('data-draft');
      if (S.drafts[k] !== undefined) el.value = S.drafts[k];
    });
    S.pop = null; openRow = null;
  }

  var toastTimer = null;
  function toast(msg, undo) {
    S.toast = { msg: msg, undo: undo || null };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { S.toast = null; if (canRedraw()) render(); }, 6000);
    render();
  }
  function fail(e) { if (e && e.message !== 'signed out') toast(e.message || 'Something went wrong.'); }

  // ---------- a little tap feel ----------
  // Android phones buzz. On iPhone (iOS 17.4 and newer) flipping a hidden switch gives a small tick.
  var hapticEl = null;
  function tickOnce() {
    try {
      if (navigator.vibrate && !/iPhone|iPad/.test(navigator.userAgent)) { navigator.vibrate(12); return; }
      if (!hapticEl) {
        hapticEl = document.createElement('label');
        hapticEl.setAttribute('aria-hidden', 'true');
        hapticEl.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        var inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', '');
        hapticEl.appendChild(inp); document.body.appendChild(hapticEl);
      }
      hapticEl.click();
    } catch (e) {}
  }
  function tick() { tickOnce(); }
  function firm() { tickOnce(); setTimeout(tickOnce, 70); }

  // Take an item out of the screen's copy right away, before the server answers.
  function removeLocal(id) {
    S.data.lists.forEach(function (l) { l.sections.forEach(function (s) {
      s.items = s.items.filter(function (it) { return it.id !== id; });
      s.items.forEach(function (it) { it.kids = it.kids.filter(function (k) { return k.id !== id; }); });
    }); });
  }
  function moveItem(id, body) {
    api('POST', '/api/items/' + id + '/move', body).then(function () { return loadState(); }).catch(function (e) { fail(e); loadState(); });
  }
  function reorderLocal(id, before) {
    var f = findItem(id); if (!f) return;
    var arr = f.parent ? f.parent.kids : f.sec.items, i = arr.indexOf(f.it);
    arr.splice(i, 1);
    var at = -1; arr.forEach(function (x, n) { if (x.id === before) at = n; });
    if (at < 0) arr.push(f.it); else arr.splice(at, 0, f.it);
  }
  function deleteItem(id) {
    firm(); removeLocal(id); S.raw = ''; render();
    api('DELETE', '/api/items/' + id).then(function () { return loadState(); }).then(function () {
      toast('Deleted', function () { api('PATCH', '/api/items/' + id, { deleted: false }).then(function () { S.raw = ''; return loadState(); }).catch(fail); });
    }).catch(function (e) { fail(e); loadState(); });
  }
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
    viewas: function (b) {
      var id = b.dataset.id, nm = ((S.data.people || []).filter(function (x) { return x.id === id; })[0] || {}).name || 'Roman';
      S.realMe = S.me; S.viewAs = id; S.me = { id: id, name: nm, role: 'kid' }; S.view = 'chores'; S.sheet = null; S.raw = '';
      loadState().then(function () { window.scrollTo(0, 0); }).catch(fail);
    },
    viewback: function () {
      S.me = S.realMe; S.realMe = null; S.viewAs = ''; S.view = 'settings'; S.sheet = null; S.raw = '';
      loadState().then(function () { window.scrollTo(0, 0); }).catch(fail);
    },
    resetpin: function (b) {
      var pin = (S.drafts['rst-pin'] || '').trim();
      if (!/^\d{4,8}$/.test(pin)) return toast('Use 4 to 8 digits.');
      api('POST', '/api/pin/reset', { user: b.dataset.id, pin: pin }).then(function () { clearDrafts('rst-'); toast('PIN changed. They can sign in now.'); }).catch(fail);
    },
    idea: function () { S.drafts['wk-reward'] = nextIdea(); render(); },
    useidea: function () { S.drafts['wk-reward'] = weekIdea(); S.view = 'chores'; render(); window.scrollTo(0, 0); },
    saveweek: function () {
      var w = S.data.week; if (!w) return;
      var t = parseInt(S.drafts['wk-target'] !== undefined ? S.drafts['wk-target'] : w.target, 10);
      if (!(t >= 1 && t <= 100)) return toast('Pick a goal from 1 to 100.');
      var r = (S.drafts['wk-reward'] !== undefined ? S.drafts['wk-reward'] : w.reward).trim();
      api('PATCH', '/api/week', { week: w.week, target: t, reward: r })
        .then(function () { clearDrafts('wk-'); markUsed(r); S.raw = ''; return loadState(); }).then(function () { toast('Goal saved'); }).catch(fail);
    },
    newidea: function () {
      var t = (S.drafts['idea-new'] || '').trim(); if (!t) return;
      api('POST', '/api/ideas', { text: t }).then(function () { clearDrafts('idea-'); S.raw = ''; return loadState(); }).then(function () { toast('Idea added'); }).catch(fail);
    },
    paid: function (b) {
      api('PATCH', '/api/week', { week: b.dataset.week, closed: true }).then(function () { S.raw = ''; return loadState(); }).then(function () { toast('Marked as paid out'); }).catch(fail);
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
      api('POST', '/api/chores', { text: text, person: S.drafts['chore-person'] || 'roman', days: S.choreDays, day: today() })
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
        S.me = j.user; S.view = firstView(); delete S.drafts['login-pin']; S.err = ''; S.raw = '';
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
      S.sheet = { id: id, text: f.it.text, store: f.it.store, shop: f.it.shop || '', priority: f.it.priority, due: f.it.due, link: f.it.link || '', sub: '', sec: f.sec.id, par: f.parent ? f.parent.id : '' }; render();
    },
    closesheet: function () { S.sheet = null; render(); },
    pri: function (b) { S.sheet.priority = b.dataset.v; render(); },
    savesheet: function () {
      var sh = S.sheet, f = findItem(sh.id);
      var body = { text: sh.text, store: sh.store, shop: sh.shop || '', priority: sh.priority, due: sh.due };
      if (f && f.list.key === 'wish') body.link = sh.link || '';
      if (isParent() && f) {
        var curPar = f.parent ? f.parent.id : '';
        if (!f.parent && +sh.sec && +sh.sec !== f.sec.id) body.section_id = +sh.sec;
        else if (String(sh.par || '') !== String(curPar)) body.parent_id = sh.par ? +sh.par : null;
      }
      S.sheet = null; S.raw = '';
      api('PATCH', '/api/items/' + sh.id, body).then(function () { return loadState(); }).catch(function (e) { fail(e); loadState(); });
    },
    addsub: function () {
      var sh = S.sheet, f = findItem(sh.id), text = (sh.sub || '').trim(); if (!text) return;
      api('POST', '/api/items', { section_id: f.sec.id, parent_id: sh.id, text: text }).then(function () { sh.sub = ''; S.raw = ''; return loadState(); }).then(function () { toast('Sub item added'); }).catch(fail);
    },
    deleteitem: function () { var id = S.sheet.id; S.sheet = null; deleteItem(id); },
    swipedel: function (b) { deleteItem(+b.dataset.swid); },
    shopsel: function (b) { S.sheet.shop = b.dataset.v; S.sheet.store = ''; render(); },
    sheettop: function () { var id = S.sheet.id; S.sheet = null; S.raw = ''; moveItem(id, { to: 'top' }); },
    sheetbottom: function () { var id = S.sheet.id; S.sheet = null; S.raw = ''; moveItem(id, {}); },
    flag: function (b) {
      var id = +b.closest('[data-id]').dataset.id, f = findItem(id); if (!f) return;
      var next = { normal: 'high', high: 'low', low: 'normal' }[f.it.priority || 'normal'];
      f.it.priority = next; S.raw = ''; render();
      api('PATCH', '/api/items/' + id, { priority: next }).then(function () { return loadState(true); }).catch(function (e) { fail(e); loadState(); });
    },
    shoptab: function (b) { S.shopTab = b.dataset.v; store('todo-shop', S.shopTab); delete S.drafts['shop-store']; render(); },
    add: function (b) {
      var sec = b.closest('[data-sec]'), sid = +sec.dataset.sec;
      var text = (S.drafts['add-' + sid] || '').trim(); if (!text || S.adding) return;
      var st = S.drafts['st-' + sid] || '', pr = S.drafts['pr-' + sid] || 'normal', ln = (S.drafts['ln-' + sid] || '').trim(), section = null;
      S.data.lists.forEach(function (l) { l.sections.forEach(function (x) { if (x.id === sid) section = x; }); });
      // Show it right away, dimmed, and let the server catch up.
      var tmp = { id: 'tmp' + Date.now(), text: text, done: false, store: st, shop: '', link: '', priority: pr, due: '', created_by: S.me.id, kids: [], saving: true };
      if (section) section.items.push(tmp);
      clearDrafts('add-' + sid); clearDrafts('st-' + sid); clearDrafts('pr-' + sid); clearDrafts('ln-' + sid);
      S.adding = true; S.raw = ''; tick(); render();
      api('POST', '/api/items', { section_id: sid, text: text, store: st, priority: pr, link: ln })
        .then(function () { return loadState(); })
        .catch(function (e) {
          if (section) section.items = section.items.filter(function (x) { return x !== tmp; });
          S.drafts['add-' + sid] = text; render(); fail(e);
        })
        .then(function () { S.adding = false; });
    },
    shopadd: function () {
      var text = (S.drafts['shop-text'] || '').trim(); if (!text || S.adding) return;
      var kind = S.shopTab === 'food' ? 'food' : 'other', stores = storesFor(kind);
      var lid = +(S.drafts['shop-list'] || (S.data.lists.filter(function (l) { return l.key === 'roman-doug'; })[0] || S.data.lists[0]).id);
      var st = S.drafts['shop-store'] !== undefined ? S.drafts['shop-store'] : stores[0];
      var pend = { text: text, shop: kind };
      S.pendingShop.push(pend); delete S.drafts['shop-text']; S.adding = true; tick(); render();
      api('POST', '/api/items', { list_id: lid, shopping: true, shop: kind === 'food' ? 'food' : '', text: text, store: st })
        .then(function () { S.raw = ''; return loadState(); })
        .catch(function (e) { S.drafts['shop-text'] = text; fail(e); })
        .then(function () { S.pendingShop = S.pendingShop.filter(function (x) { return x !== pend; }); S.adding = false; render(); });
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
    savestores: function (b) {
      var food = b && b.dataset.kind === 'food', key = food ? 'stores-food' : 'stores';
      var list = (S.drafts[key] !== undefined ? S.drafts[key] : storesFor(food ? 'food' : 'other').join(', ')).split(',');
      api('PATCH', '/api/stores', { stores: list, kind: food ? 'food' : '' }).then(function () { delete S.drafts[key]; S.raw = ''; return loadState(); }).then(function () { toast('Stores saved'); }).catch(fail);
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


  // ---------- swipe left to delete, and the grip to slide items ----------
  var sw = null, openRow = null, drag = null;
  function rowOf(wrap) { return wrap.querySelector(':scope > .item, :scope > .kid, :scope > .shoprow'); }
  function closeOpen() { if (openRow) { openRow.style.transform = ''; if (openRow.parentNode) openRow.parentNode.classList.remove('open'); openRow = null; } }

  app.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { sw = null; return; }
    var t = e.target, wrap = t.closest && t.closest('.swrap');
    if (t.closest && t.closest('.swdel')) { sw = null; return; }
    if (!wrap || !wrap.querySelector(':scope > .swdel') || t.closest('.grip, input, select, textarea, .flag')) { sw = null; return; }
    var row = rowOf(wrap); if (!row) { sw = null; return; }
    sw = { row: row, wrap: wrap, x: e.touches[0].clientX, y: e.touches[0].clientY, mode: '', base: row === openRow ? -80 : 0, cur: row === openRow ? -80 : 0 };
  }, { passive: true });
  app.addEventListener('touchmove', function (e) {
    if (!sw) return;
    var dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
    if (!sw.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) { sw.mode = 'h'; sw.row.style.transition = 'none'; if (openRow && openRow !== sw.row) closeOpen(); }
      else if (Math.abs(dy) > 8) sw.mode = 'v';
    }
    if (sw.mode === 'h') { sw.cur = Math.max(-96, Math.min(0, sw.base + dx)); sw.row.style.transform = 'translateX(' + sw.cur + 'px)'; }
  }, { passive: true });
  function swipeEnd() {
    if (!sw) return;
    var s = sw; sw = null;
    if (s.mode !== 'h') return;
    s.row.style.transition = '';
    if (s.cur < -40) {
      if (openRow && openRow !== s.row) closeOpen();
      s.row.style.transform = 'translateX(-80px)'; s.wrap.classList.add('open');
      if (openRow !== s.row) tick();
      openRow = s.row;
    } else {
      s.row.style.transform = ''; s.wrap.classList.remove('open');
      if (openRow === s.row) openRow = null;
    }
  }
  window.addEventListener('scroll', function () { if (openRow && !sw) closeOpen(); }, { passive: true });
  app.addEventListener('touchend', swipeEnd);
  app.addEventListener('touchcancel', swipeEnd);
  // While a row is slid open, a tap anywhere else only closes it.
  app.addEventListener('click', function (e) {
    if (!openRow || (e.target.closest && e.target.closest('.swdel'))) return;
    closeOpen(); e.stopPropagation(); e.preventDefault();
  }, true);

  app.addEventListener('pointerdown', function (e) {
    var g = e.target.closest && e.target.closest('.grip'); if (!g) return;
    var wrap = g.closest('.swrap'), row = wrap && rowOf(wrap), id = row && +row.dataset.id; if (!id) return;
    var sec = wrap.closest('.sec'), par = wrap.getAttribute('data-par');
    var cands = [].slice.call(sec.querySelectorAll('.swrap[data-par="' + par + '"]')).filter(function (w) { return w !== wrap && w.querySelector('[data-id]'); });
    e.preventDefault();
    try { g.setPointerCapture(e.pointerId); } catch (x) {}
    closeOpen();
    drag = { id: id, wrap: wrap, row: row, par: par, cands: cands, y0: e.clientY, before: null, moved: false, hidden: [] };
    if (par === '0') {   // fold its sub items away while it travels
      var n = wrap.nextElementSibling;
      while (n && n.getAttribute('data-par') === String(id)) { n.style.display = 'none'; drag.hidden.push(n); n = n.nextElementSibling; }
    }
    row.classList.add('dragging'); wrap.classList.add('dragwrap'); tick();
  });
  app.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    drag.row.style.transform = 'translateY(' + dy + 'px)';
    var before = null;
    drag.cands.forEach(function (w) { w.classList.remove('dropbefore', 'dropend'); });
    for (var i = 0; i < drag.cands.length; i++) {
      var r = drag.cands[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { before = drag.cands[i]; break; }
    }
    if (before) before.classList.add('dropbefore');
    else if (drag.cands.length) drag.cands[drag.cands.length - 1].classList.add('dropend');
    drag.before = before ? +before.querySelector('[data-id]').dataset.id : null;
  });
  function endDrag(cancel) {
    if (!drag) return;
    var d = drag; drag = null;
    d.row.style.transform = ''; d.row.classList.remove('dragging'); d.wrap.classList.remove('dragwrap');
    d.hidden.forEach(function (n) { n.style.display = ''; });
    d.cands.forEach(function (w) { w.classList.remove('dropbefore', 'dropend'); });
    if (cancel || !d.moved) return;
    reorderLocal(d.id, d.before); S.raw = ''; tick(); render();
    api('POST', '/api/items/' + d.id + '/move', d.before ? { before: d.before } : {}).then(function () { return loadState(true); }).catch(function (e) { fail(e); loadState(); });
  }
  app.addEventListener('pointerup', function () { endDrag(false); });
  app.addEventListener('pointercancel', function () { endDrag(true); });

  app.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a[href]')) return;
    var b = e.target.closest('[data-act]'); if (!b || !app.contains(b)) return;
    // Taps on text open the item, but a tap on a link-like control should not also toggle.
    if ((b.tagName === 'BUTTON' || b.type === 'checkbox') && !/^(add|shopadd|swipedel|deleteitem|closesheet|refresh|theme)$/.test(b.dataset.act)) tick();
    var fn = actions[b.dataset.act]; if (fn) fn(b, e);
  });
  app.addEventListener('input', function (e) {
    var d = e.target.getAttribute && e.target.getAttribute('data-draft');
    if (d) S.drafts[d] = e.target.value;
    var f = e.target.getAttribute && e.target.getAttribute('data-sheet');
    if (f && S.sheet) S.sheet[f] = e.target.value;
  });
  app.addEventListener('change', function (e) {
    if (e.target.matches && e.target.matches('[data-movesec]')) {
      var to = +e.target.value, sid = +e.target.closest('[data-sec]').dataset.sec;
      if (to) api('PATCH', '/api/sections/' + sid, { list_id: to }).then(function () { S.raw = ''; return loadState(); }).then(function () { tick(); toast('Section moved'); }).catch(fail);
      return;
    }
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
    S.hideDone = store('todo-hide') === '1'; S.shopTab = store('todo-shop') === 'food' ? 'food' : 'other';
    var th = store('todo-theme'); if (th) document.documentElement.setAttribute('data-theme', th);
    S.loginUser = store('todo-last-user') || '';
    S.me = null; S.data = null; S.raw = ''; S.view = 'home'; S.sheet = null;
    api('GET', '/api/users').then(function (u) {
      S.users = u.users;
      if (!S.users.some(function (x) { return x.id === S.loginUser; })) S.loginUser = '';
      return api('GET', '/api/me').then(function (m) { S.me = m.user; S.view = firstView(); return loadState(); }).catch(function () { render(); });
    }).catch(function () { app.innerHTML = '<div class="login"><h1>To Do</h1><div class="err">Could not reach the server. Check your connection and try again.</div></div>'; });
    checkUpdate();
  }

  window.TodoApp = { start: start };
  start();
})();
