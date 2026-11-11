// Lethal Menu Remote panel.
// Plain ES2017 on purpose (no optional chaining / ?? / top-level await) so it runs on older tablet Chrome.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, set, push, update, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

var TAB_ORDER = ["Self", "Players", "Enemies", "Visuals", "Server", "Troll", "Other", "Settings"];
// index.html?demo shows the panel with sample data, without signing in (handy to check the layout on a device).
var DEMO = /[?&]demo\b/.test(location.search);
var ONLINE_WINDOW_MS = 30000;

var app = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db = getDatabase(app);

var user = null;
var serverOffset = 0;
var ownerUnsub = null;
var ownerSubs = [];
var deviceIndex = {};
var deviceInfo = {};
var infoSubs = {};
var pendingDevices = {};
var currentDev = null;
var devSubs = [];
var catalog = null;
var state = null;
var lastResultSeen = undefined;
var activeTab = loadPref("tab") || "Self";
var search = "";
var ui = freshUi();
var pendingToggles = {};

function freshUi() {
  return { toggles: {}, rows: {}, playerSelects: [], enemySelects: [], settings: {}, playersBox: null, enemiesBox: null, sigPlayers: "", sigEnemies: "" };
}

// ---------- helpers ----------
function $(id) { return document.getElementById(id); }

function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null || value === false) { return; }
      if (key === "class") { node.className = value; }
      else if (key === "text") { node.textContent = value; }
      else if (key.indexOf("on") === 0) { node.addEventListener(key.substring(2), value); }
      else { node.setAttribute(key, value === true ? "" : value); }
    });
  }
  (children || []).forEach(function (child) {
    if (child === null || child === undefined) { return; }
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return node;
}

function loadPref(key) { try { return localStorage.getItem("lmr." + key); } catch (e) { return null; } }
function savePref(key, value) { try { localStorage.setItem("lmr." + key, value); } catch (e) { /* private mode */ } }

function show(view) {
  ["view-login", "view-claim", "view-denied", "view-app"].forEach(function (id) {
    $(id).classList.toggle("hidden", id !== view);
  });
  $("boot").classList.add("hidden");
}

function toast(message, kind) {
  var node = el("div", { class: "toast " + (kind || ""), text: message });
  $("toasts").appendChild(node);
  setTimeout(function () { if (node.parentNode) { node.parentNode.removeChild(node); } }, 3500);
}

function friendlyError(err) {
  var code = (err && err.code) || "";
  var map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with that email. Use Create account.",
    "auth/email-already-in-use": "That email already has an account. Sign in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Authentication.",
    "auth/popup-blocked": "The browser blocked the Google popup.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "PERMISSION_DENIED": "Permission denied (are the database rules deployed?)."
  };
  return map[code] || (err && err.message) || String(err);
}

function serverNow() { return Date.now() + serverOffset; }

function isOnline(info) {
  return !!(info && info.online && info.lastSeen && serverNow() - info.lastSeen < ONLINE_WINDOW_MS);
}

function shortName(hackName) {
  var stripped = hackName.replace(/\s*Player\s*/g, " ").replace(/\s+/g, " ").trim();
  return stripped || hackName;
}

// ---------- auth ----------
$("login-form").addEventListener("submit", function (e) {
  e.preventDefault();
  $("login-error").textContent = "";
  signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-password").value)
    .catch(function (err) { $("login-error").textContent = friendlyError(err); });
});

$("btn-create").addEventListener("click", function () {
  $("login-error").textContent = "";
  var email = $("login-email").value.trim();
  var password = $("login-password").value;
  if (!email || password.length < 6) {
    $("login-error").textContent = "Enter an email and a password (6+ characters) first.";
    return;
  }
  createUserWithEmailAndPassword(auth, email, password)
    .catch(function (err) { $("login-error").textContent = friendlyError(err); });
});

$("btn-google").addEventListener("click", function () {
  $("login-error").textContent = "";
  signInWithPopup(auth, new GoogleAuthProvider())
    .catch(function (err) { $("login-error").textContent = friendlyError(err); });
});

document.addEventListener("click", function (e) {
  var target = e.target.closest ? e.target.closest("[data-action='signout']") : null;
  if (target) { signOut(auth); }
});

$("btn-claim").addEventListener("click", function () {
  set(ref(db, "owner"), user.uid).catch(function (err) { $("claim-error").textContent = friendlyError(err); });
});

onAuthStateChanged(auth, function (u) {
  if (DEMO) { return; }
  user = u;
  stopOwner();
  if (ownerUnsub) { ownerUnsub(); ownerUnsub = null; }
  if (!u) { show("view-login"); return; }
  ownerUnsub = onValue(ref(db, "owner"), function (snap) {
    var owner = snap.val();
    if (!owner) {
      stopOwner();
      $("claim-email").textContent = u.email || u.displayName || "this account";
      show("view-claim");
    } else if (owner !== u.uid) {
      stopOwner();
      show("view-denied");
    } else {
      show("view-app");
      startOwner();
    }
  }, function (err) { toast(friendlyError(err), "fail"); });
});

// ---------- owner data ----------
function startOwner() {
  if (ownerSubs.length) { return; }
  ownerSubs.push(onValue(ref(db, ".info/serverTimeOffset"), function (snap) { serverOffset = snap.val() || 0; }));
  ownerSubs.push(onValue(ref(db, "pending"), function (snap) { pendingDevices = snap.val() || {}; renderPending(); }));
  ownerSubs.push(onValue(ref(db, "deviceIndex"), function (snap) { deviceIndex = snap.val() || {}; syncDevices(); }));
}

function stopOwner() {
  ownerSubs.forEach(function (unsub) { unsub(); });
  ownerSubs = [];
  Object.keys(infoSubs).forEach(function (id) { infoSubs[id](); });
  infoSubs = {};
  deviceInfo = {};
  selectDevice(null);
}

function syncDevices() {
  Object.keys(infoSubs).forEach(function (id) {
    if (!deviceIndex[id]) { infoSubs[id](); delete infoSubs[id]; delete deviceInfo[id]; }
  });
  Object.keys(deviceIndex).forEach(function (id) {
    if (!infoSubs[id]) {
      infoSubs[id] = onValue(ref(db, "devices/" + id + "/info"), function (snap) {
        deviceInfo[id] = snap.val();
        renderDeviceSelect();
        refreshOnline();
      });
    }
  });
  var ids = Object.keys(deviceIndex);
  var preferred = loadPref("device");
  if (!currentDev || !deviceIndex[currentDev]) {
    selectDevice(ids.indexOf(preferred) >= 0 ? preferred : (ids[0] || null));
  }
  renderDeviceSelect();
}

function deviceLabel(id) {
  var info = deviceInfo[id];
  var name = (info && info.name) || (deviceIndex[id] && deviceIndex[id].name) || id.substring(0, 6);
  return name + (isOnline(info) ? " (online)" : " (offline)");
}

function renderDeviceSelect() {
  var select = $("device-select");
  select.innerHTML = "";
  var ids = Object.keys(deviceIndex);
  ids.forEach(function (id) {
    select.appendChild(el("option", { value: id, text: deviceLabel(id), selected: id === currentDev }));
  });
  select.disabled = ids.length < 2;
  $("no-device").classList.toggle("hidden", ids.length > 0);
  $("device-view").classList.toggle("hidden", !currentDev);
}

$("device-select").addEventListener("change", function (e) { selectDevice(e.target.value); });

function renderPending() {
  var box = $("pending");
  box.innerHTML = "";
  var ids = Object.keys(pendingDevices);
  box.classList.toggle("hidden", ids.length === 0);
  ids.forEach(function (id) {
    var p = pendingDevices[id] || {};
    box.appendChild(el("div", { class: "pending-item" }, [
      el("div", null, [
        el("div", { text: "New PC wants access: " + (p.name || "Unknown") }),
        el("div", { class: "muted", text: "Only approve if this code matches the one in your in-game menu." })
      ]),
      el("span", { class: "code", text: p.code || "?" }),
      el("div", null, [
        el("button", { class: "btn primary", type: "button", text: "Approve", onclick: function () { approveDevice(id, p.name); } }),
        el("button", { class: "btn", type: "button", text: "Dismiss", onclick: function () { remove(ref(db, "pending/" + id)); } })
      ])
    ]));
  });
}

function approveDevice(id, name) {
  var changes = {};
  changes["devices/" + id + "/approved"] = true;
  changes["deviceIndex/" + id] = { name: name || "PC", added: serverTimestamp() };
  changes["pending/" + id] = null;
  update(ref(db), changes)
    .then(function () { toast("Approved " + (name || "PC"), "ok"); selectDevice(id); })
    .catch(function (err) { toast(friendlyError(err), "fail"); });
}

$("btn-remove-device").addEventListener("click", function () {
  if (!currentDev) { return; }
  if (!window.confirm("Remove this PC? It will have to be approved again.")) { return; }
  var changes = {};
  changes["devices/" + currentDev] = null;
  changes["deviceIndex/" + currentDev] = null;
  update(ref(db), changes).catch(function (err) { toast(friendlyError(err), "fail"); });
});

// ---------- selected device ----------
function selectDevice(id) {
  devSubs.forEach(function (unsub) { unsub(); });
  devSubs = [];
  currentDev = id;
  catalog = null;
  state = null;
  lastResultSeen = undefined;
  pendingToggles = {};
  $("content").innerHTML = "";
  $("game-strip").innerHTML = "";
  $("tabs").innerHTML = "";
  $("device-view").classList.toggle("hidden", !id);
  if (!id) { return; }
  savePref("device", id);
  var base = "devices/" + id + "/";
  devSubs.push(onValue(ref(db, base + "catalog"), function (snap) {
    catalog = snap.val();
    renderTabs();
    buildContent();
  }));
  devSubs.push(onValue(ref(db, base + "state"), function (snap) {
    state = snap.val();
    applyState();
  }));
  devSubs.push(onValue(ref(db, base + "lastResult"), function (snap) {
    var result = snap.val();
    var resultId = result ? result.id : null;
    if (lastResultSeen !== undefined && result && resultId !== lastResultSeen) {
      toast(result.message || (result.ok ? "Done" : "Failed"), result.ok ? "ok" : "fail");
    }
    lastResultSeen = resultId;
  }));
  renderDeviceSelect();
  refreshOnline();
}

function refreshOnline() {
  var info = currentDev ? deviceInfo[currentDev] : null;
  var online = isOnline(info);
  $("device-dot").className = "dot " + (currentDev ? (online ? "on" : "off") : "");
  $("offline-note").classList.toggle("hidden", !currentDev || online);
  var meta = [];
  if (info && info.version) { meta.push("Menu " + info.version); }
  if (info && info.lastSeen) { meta.push("last seen " + new Date(info.lastSeen).toLocaleTimeString()); }
  $("device-meta").textContent = meta.join(" | ");
}
setInterval(function () { refreshOnline(); }, 3000);

function send(command) {
  if (DEMO) { toast("Demo: would send " + JSON.stringify(command), "ok"); return Promise.resolve(); }
  if (!currentDev) { return Promise.resolve(); }
  var payload = Object.assign({ at: serverTimestamp() }, command);
  if (!isOnline(deviceInfo[currentDev])) { toast("PC is offline; command may be ignored", "fail"); }
  return push(ref(db, "devices/" + currentDev + "/commands"), payload)
    .catch(function (err) { toast(friendlyError(err), "fail"); });
}

$("btn-eject").addEventListener("click", function () {
  if (window.confirm("Eject the menu from the game? You can load it again with Pause in game.")) {
    send({ type: "eject" });
  }
});

$("btn-menu").addEventListener("click", function () {
  send({ type: "menu", open: !(state && state.menuOpen) });
});

var searchTimer = null;
$("search").addEventListener("input", function (e) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () {
    search = e.target.value.trim().toLowerCase();
    renderTabs();
    buildContent();
  }, 150);
});

// ---------- catalog rendering ----------
function hackEntries() {
  var hacks = (catalog && catalog.hacks) || {};
  return Object.keys(hacks).map(function (key) {
    var h = hacks[key];
    return { key: key, name: h.name || key, category: h.category || "Other", toggle: !!h.toggle, action: !!h.action, args: h.args || [] };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function matchesSearch(text) { return !search || text.toLowerCase().indexOf(search) >= 0; }

function settingEntries() {
  var settings = (catalog && catalog.settings) || {};
  return Object.keys(settings).map(function (key) {
    return { key: key, name: settings[key].name || key, type: settings[key].type };
  }).filter(function (s) { return matchesSearch(s.name); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function isSingleArg(h, kind) { return h.action && h.args.length === 1 && h.args[0].kind === kind; }

function renderTabs() {
  var tabs = $("tabs");
  tabs.innerHTML = "";
  if (!catalog) { return; }
  var counts = {};
  hackEntries().forEach(function (h) {
    if (matchesSearch(h.name)) { counts[h.category] = (counts[h.category] || 0) + 1; }
  });
  counts.Settings = settingEntries().length;
  TAB_ORDER.forEach(function (tab) {
    if (!counts[tab] && tab !== "Players" && tab !== "Enemies" && tab !== "Settings") { return; }
    tabs.appendChild(el("button", {
      class: "tab" + (tab === activeTab ? " active" : ""),
      type: "button",
      onclick: function () { activeTab = tab; savePref("tab", tab); renderTabs(); buildContent(); }
    }, [tab, el("span", { class: "count", text: String(counts[tab] || 0) })]));
  });
}

function buildContent() {
  var content = $("content");
  content.innerHTML = "";
  ui = freshUi();
  if (!catalog) {
    content.appendChild(el("p", { class: "muted", text: "Waiting for the menu to send its feature list... (start the game with the menu loaded)" }));
    return;
  }
  if (activeTab === "Settings") {
    buildSettings(content);
  } else {
    if (activeTab === "Players" && !search) {
      content.appendChild(el("div", { class: "section-title", text: "Players in lobby" }));
      ui.playersBox = content.appendChild(el("div", { class: "cards" }));
    }
    if (activeTab === "Enemies" && !search) {
      content.appendChild(el("div", { class: "section-title", text: "Enemies" }));
      ui.enemiesBox = content.appendChild(el("div", { class: "cards" }));
    }
    var list = hackEntries().filter(function (h) {
      if (!matchesSearch(h.name)) { return false; }
      if (h.category !== activeTab) { return false; }
      // Single-target hacks are shown as buttons on the player/enemy cards instead.
      if (activeTab === "Players" && !search && isSingleArg(h, "player") && !h.toggle) { return false; }
      if (activeTab === "Enemies" && !search && isSingleArg(h, "enemy") && !h.toggle) { return false; }
      return true;
    });
    if (list.length) {
      content.appendChild(el("div", { class: "section-title", text: activeTab === "Players" || activeTab === "Enemies" ? "More" : activeTab }));
      var grid = content.appendChild(el("div", { class: "grid" }));
      list.forEach(function (h) { grid.appendChild(hackRow(h)); });
    } else if (!ui.playersBox && !ui.enemiesBox) {
      content.appendChild(el("p", { class: "muted", text: search ? "Nothing matches your search on this tab." : "Nothing here." }));
    }
  }
  applyState(true);
}

function hackRow(h) {
  var row = el("div", { class: "row" });
  var head = el("div", { class: "row-head" }, [el("span", { class: "row-name", text: h.name })]);
  row.appendChild(head);
  ui.rows[h.key] = row;

  if (h.toggle) {
    var input = el("input", { type: "checkbox", "aria-label": h.name });
    input.addEventListener("change", function () {
      if (input.checked && h.action && h.args.length) {
        input.checked = false;
        toast("Pick a target below, then press " + (h.toggle ? "Start" : "Run"), "fail");
        return;
      }
      pendingToggles[h.key] = { value: input.checked, until: Date.now() + 4000 };
      row.classList.toggle("on", input.checked);
      send({ type: "toggle", hack: h.key, value: input.checked });
    });
    ui.toggles[h.key] = input;
    head.appendChild(el("label", { class: "switch" }, [input, el("span", { class: "track" })]));
  }

  if (h.action && !h.args.length) {
    head.appendChild(el("button", { class: "btn small", type: "button", text: "Run", onclick: function () { send({ type: "run", hack: h.key, args: [] }); } }));
  } else if (h.action) {
    var getters = [];
    var argsBox = el("div", { class: "row-args" });
    h.args.forEach(function (arg) { getters.push(argControl(arg, argsBox)); });
    argsBox.appendChild(el("button", {
      class: "btn primary small run",
      type: "button",
      text: h.toggle ? "Start" : "Run",
      onclick: function () {
        var values = [];
        for (var i = 0; i < getters.length; i++) {
          var value = getters[i]();
          if (value === undefined) { toast("Fill in " + h.args[i].name, "fail"); return; }
          values.push(value);
        }
        send({ type: "run", hack: h.key, args: values });
      }
    }));
    row.appendChild(argsBox);
  }
  return row;
}

// Builds the input for one argument and returns a function that reads it (undefined = missing).
function argControl(arg, box) {
  var label = el("label", { class: "arg" }, [arg.name]);
  box.appendChild(label);
  if (arg.kind === "player" || arg.kind === "enemy") {
    var select = el("select");
    label.appendChild(select);
    (arg.kind === "player" ? ui.playerSelects : ui.enemySelects).push(select);
    return function () { return select.value === "" ? undefined : Number(select.value); };
  }
  if (arg.kind === "allEnemies") {
    label.appendChild(el("span", { text: "all enemies" }));
    return function () { return true; };
  }
  if (arg.kind === "enum") {
    var enumSelect = el("select");
    (arg.options || []).forEach(function (o) { enumSelect.appendChild(el("option", { value: o, text: o })); });
    label.appendChild(enumSelect);
    return function () { return enumSelect.value; };
  }
  if (arg.kind === "bool") {
    var check = el("input", { type: "checkbox" });
    label.appendChild(el("label", { class: "switch" }, [check, el("span", { class: "track" })]));
    return function () { return check.checked; };
  }
  if (arg.kind === "vector3") {
    label.className = "arg vec";
    var xyz = [0, 1, 2].map(function (i) { return el("input", { type: "number", step: "any", inputmode: "decimal", placeholder: "xyz".charAt(i) }); });
    var mine = el("button", {
      class: "btn small", type: "button", text: "My position",
      onclick: function () {
        var p = state && state.game && state.game.position;
        if (!p) { toast("Position unknown (not in a round?)", "fail"); return; }
        xyz.forEach(function (input, i) { input.value = p[i]; });
      }
    });
    label.appendChild(el("div", { class: "vec-inputs" }, xyz.concat([mine])));
    return function () {
      var values = xyz.map(function (input) { return parseFloat(input.value); });
      return values.some(isNaN) ? undefined : values;
    };
  }
  if (arg.kind === "number") {
    var num = el("input", { type: "number", step: arg.integer ? "1" : "any", inputmode: arg.integer ? "numeric" : "decimal" });
    label.appendChild(num);
    return function () {
      var v = arg.integer ? parseInt(num.value, 10) : parseFloat(num.value);
      return isNaN(v) ? undefined : v;
    };
  }
  var text = el("input", { type: "text" });
  label.appendChild(text);
  return function () { return text.value === "" ? undefined : text.value; };
}

function buildSettings(content) {
  content.appendChild(el("div", { class: "toolbar-actions" }, [
    el("button", { class: "btn small", type: "button", text: "Save settings to file", onclick: function () { send({ type: "saveSettings" }); } })
  ]));
  content.appendChild(el("div", { class: "section-title", text: "Menu settings (applied instantly)" }));
  var grid = content.appendChild(el("div", { class: "grid" }));
  var entries = settingEntries();
  if (!entries.length) { grid.appendChild(el("p", { class: "muted", text: "No settings match." })); }
  entries.forEach(function (s) {
    var row = el("div", { class: "row" });
    var head = el("div", { class: "row-head" }, [el("span", { class: "row-name", text: s.name })]);
    row.appendChild(head);
    var input;
    if (s.type === "bool") {
      input = el("input", { type: "checkbox", "aria-label": s.name });
      input.addEventListener("change", function () { send({ type: "setting", name: s.key, value: input.checked }); });
      head.appendChild(el("label", { class: "switch" }, [input, el("span", { class: "track" })]));
    } else {
      input = el("input", { class: "setting-input", type: "number", step: s.type === "int" ? "1" : "any", inputmode: s.type === "int" ? "numeric" : "decimal" });
      input.addEventListener("change", function () {
        var v = s.type === "int" ? parseInt(input.value, 10) : parseFloat(input.value);
        if (isNaN(v)) { toast("Not a number", "fail"); return; }
        send({ type: "setting", name: s.key, value: v });
      });
      head.appendChild(input);
    }
    ui.settings[s.key] = { input: input, type: s.type };
    grid.appendChild(row);
  });
}

// ---------- live state ----------
function applyState(force) {
  renderStrip();
  if (!state) { return; }
  $("btn-menu").textContent = state.menuOpen ? "Close menu in game" : "Open menu in game";

  var toggles = state.toggles || {};
  var now = Date.now();
  Object.keys(ui.toggles).forEach(function (key) {
    var actual = !!toggles[key];
    var pending = pendingToggles[key];
    if (pending && pending.until > now && pending.value !== actual) { return; }
    delete pendingToggles[key];
    ui.toggles[key].checked = actual;
    if (ui.rows[key]) { ui.rows[key].classList.toggle("on", actual); }
  });

  var settings = state.settings || {};
  Object.keys(ui.settings).forEach(function (key) {
    var entry = ui.settings[key];
    if (document.activeElement === entry.input || settings[key] === undefined) { return; }
    if (entry.type === "bool") { entry.input.checked = !!settings[key]; }
    else if (String(entry.input.value) !== String(settings[key])) { entry.input.value = settings[key]; }
  });

  var players = state.players || [];
  var enemies = (state.enemies || []).filter(function (e) { return !e.dead; });
  var sigP = JSON.stringify(players);
  var sigE = JSON.stringify(enemies.map(function (e) { return [e.id, e.name, e.distance]; }));
  if (force || sigP !== ui.sigPlayers) {
    ui.sigPlayers = sigP;
    fillSelects(ui.playerSelects, players.map(function (p) {
      return { value: p.id, text: p.name + (p.local ? " (you)" : "") + (p.dead ? " (dead)" : "") };
    }));
    renderPlayers(players);
  }
  if (force || sigE !== ui.sigEnemies) {
    ui.sigEnemies = sigE;
    fillSelects(ui.enemySelects, enemies.map(function (e) {
      return { value: e.id, text: e.name + " (" + e.distance + "m" + (e.inside ? ", inside" : "") + ")" };
    }));
    renderEnemies(enemies);
  }
}

function fillSelects(selects, options) {
  selects.forEach(function (select) {
    var previous = select.value;
    select.innerHTML = "";
    if (!options.length) { select.appendChild(el("option", { value: "", text: "none available" })); return; }
    options.forEach(function (o) { select.appendChild(el("option", { value: String(o.value), text: o.text })); });
    if (previous && options.some(function (o) { return String(o.value) === previous; })) { select.value = previous; }
  });
}

function renderStrip() {
  var strip = $("game-strip");
  strip.innerHTML = "";
  function chip(label, value) { strip.appendChild(el("span", { class: "chip" }, [label + " ", el("b", { text: String(value) })])); }
  if (!state || !state.game) { chip("Status", currentDev ? "waiting for game" : "-"); return; }
  var g = state.game;
  if (!g.inRound) { chip("Status", "Main menu / lobby list"); return; }
  chip("Moon", g.moon || "-");
  chip("Phase", g.inShipPhase ? "In orbit" : (g.landed ? "Landed" : "Travelling"));
  if (g.localName) { chip("You", g.alive ? g.localName + " (" + g.health + " HP)" : g.localName + " (dead)"); }
  chip("Credits", g.credits);
  if (g.quota !== undefined) { chip("Quota", g.fulfilled + " / " + g.quota); chip("Days left", g.daysLeft); }
  chip("Host", g.isHost ? "yes" : "no");
}

function renderPlayers(players) {
  var box = ui.playersBox;
  if (!box) { return; }
  box.innerHTML = "";
  if (!players.length) { box.appendChild(el("div", { class: "empty-list", text: "No players (join a lobby first)." })); return; }
  var actions = hackEntries().filter(function (h) { return isSingleArg(h, "player"); });
  players.forEach(function (p) {
    var buttons = actions.map(function (h) {
      return el("button", {
        class: "btn small", type: "button", text: shortName(h.name),
        onclick: function () { send({ type: "run", hack: h.key, args: [p.id] }); }
      });
    });
    box.appendChild(el("div", { class: "entity" + (p.dead ? " dead" : "") }, [
      el("div", { class: "entity-head" }, [
        el("span", { class: "entity-name", text: p.name + (p.local ? " (you)" : "") }),
        el("span", { class: "entity-meta", text: p.dead ? "dead" : p.health + " HP" + (p.inside ? " | inside" : "") })
      ]),
      el("div", { class: "entity-actions" }, buttons)
    ]));
  });
}

function renderEnemies(enemies) {
  var box = ui.enemiesBox;
  if (!box) { return; }
  box.innerHTML = "";
  if (!enemies.length) { box.appendChild(el("div", { class: "empty-list", text: "No living enemies right now." })); return; }
  var actions = hackEntries().filter(function (h) { return isSingleArg(h, "enemy"); });
  enemies.slice().sort(function (a, b) { return a.distance - b.distance; }).forEach(function (e) {
    var buttons = actions.map(function (h) {
      return el("button", {
        class: "btn small", type: "button", text: h.name.replace(/\s*Enemy\s*/g, " ").trim() || h.name,
        onclick: function () { send({ type: "run", hack: h.key, args: [e.id] }); }
      });
    });
    box.appendChild(el("div", { class: "entity" }, [
      el("div", { class: "entity-head" }, [
        el("span", { class: "entity-name", text: e.name }),
        el("span", { class: "entity-meta", text: e.distance + "m" + (e.inside ? " | inside" : " | outside") })
      ]),
      el("div", { class: "entity-actions" }, buttons)
    ]));
  });
}

// ---------- demo mode ----------
if (DEMO) {
  import("./demo.js").then(function (m) {
    show("view-app");
    deviceIndex = { demo: { name: "Demo PC" } };
    deviceInfo = { demo: { name: "Demo PC", online: true, lastSeen: Date.now(), version: m.demo.catalog.version } };
    pendingDevices = { laptop: { name: "LAPTOP", code: "K7Q2MZ" } };
    serverOffset = 0;
    currentDev = "demo";
    catalog = m.demo.catalog;
    state = m.demo.state;
    renderPending();
    renderDeviceSelect();
    renderTabs();
    buildContent();
    refreshOnline();
    setInterval(function () { deviceInfo.demo.lastSeen = Date.now(); }, 5000);
  });
}
