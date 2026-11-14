// Lethal Menu Remote panel.
// Plain ES2017 on purpose (no optional chaining / ?? / top-level await) so it runs on older tablet Chrome.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, get, push, update, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

// Tabs are in a fixed order; everything inside them (sections, features, players, enemies, dropdowns) is A-Z.
var TAB_ORDER = ["Visuals", "Troll", "Self", "Players", "Enemies", "Map", "Server", "Settings"];

// There is no "Other" tab. A feature the menu didn't give a tab (an older menu version, or a new feature) goes
// to the tab its name fits: anything about enemies to Enemies, about players to Players, the rest to Self.
function tabFor(key, category) {
  if (category && category !== "Other" && TAB_ORDER.indexOf(category) >= 0) { return category; }
  if (/Enem|Hunt|Monster/i.test(key)) { return "Enemies"; }
  if (/Player/i.test(key)) { return "Players"; }
  return "Self";
}
// Tabs that are always shown, even when no feature belongs to them.
var FIXED_TABS = { Players: true, Enemies: true, Map: true, Settings: true };
// index.html?demo shows the panel with sample data, without signing in (handy to check the layout on a device).
var DEMO = /[?&]demo\b/.test(location.search);
var ONLINE_WINDOW_MS = 30000;

var app = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db = getDatabase(app);

var user = null;
var serverOffset = 0;
var profile = null;
var profileUnsub = null;
var ownerSubs = [];
var deviceIndex = {};
var deviceInfo = {};
var infoSubs = {};
var currentDev = null;
var devSubs = [];
var catalog = null;
var state = null;
var lastResultSeen = undefined;
var activeTab = loadPref("tab") || "Self";
if (TAB_ORDER.indexOf(activeTab) < 0) { activeTab = "Enemies"; } // e.g. the old "Other" tab was open last time
var search = "";
var ui = freshUi();
var pendingToggles = {};

function freshUi() {
  return { toggles: {}, rows: {}, sliders: {}, enemyMeta: {}, enemyPlayerSelect: null, enemyNote: null, playerSelects: [], enemySelects: [], settings: {}, playersBox: null, enemiesBox: null, sigPlayers: "", sigEnemies: "" };
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
  ["view-login", "view-username", "view-app"].forEach(function (id) {
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
    "auth/user-not-found": "No account with that email. Use Create an account.",
    "auth/invalid-email": "That email address does not look right.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/missing-email": "Enter your email first.",
    "auth/email-already-in-use": "That email already has an account. Sign in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Authentication.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "PERMISSION_DENIED": "Permission denied (are the database rules deployed?)."
  };
  return map[code] || (err && err.message) || String(err);
}

function serverNow() { return Date.now() + serverOffset; }

function isOnline(info) {
  return !!(info && info.online && info.lastSeen && serverNow() - info.lastSeen < ONLINE_WINDOW_MS);
}

// A-Z, ignoring upper/lower case.
function byText(a, b) { return String(a).toLowerCase().localeCompare(String(b).toLowerCase()); }

function shortName(hackName) {
  var stripped = hackName.replace(/\s*Player\s*/g, " ").replace(/\s+/g, " ").trim();
  return stripped || hackName;
}

// ---------- accounts ----------
var USERNAME_RE = /^[a-z0-9_]{3,20}$/;
var signupMode = false;

function setSignupMode(on) {
  signupMode = on;
  Array.prototype.forEach.call(document.querySelectorAll(".signup-only"), function (n) { n.classList.toggle("hidden", !on); });
  $("auth-submit").textContent = on ? "Create account" : "Sign in";
  $("auth-switch").textContent = on ? "I already have an account" : "Create an account";
  $("auth-intro").textContent = on ? "Make an account, then pair your PC with a code from the in-game menu." : "Sign in to control your PC.";
  $("auth-password").setAttribute("autocomplete", on ? "new-password" : "current-password");
  $("auth-error").textContent = "";
}

$("auth-switch").addEventListener("click", function () { setSignupMode(!signupMode); });

function cleanUsername(value) { return String(value || "").trim().toLowerCase(); }

// Claims usernames/{name} and writes the profile in one step; fails if the name is taken.
function claimUsername(name) {
  if (!USERNAME_RE.test(name)) {
    return Promise.reject(new Error("Username must be 3-20 characters: letters, numbers or _."));
  }
  return get(ref(db, "usernames/" + name)).then(function (snap) {
    if (snap.exists() && snap.val() !== user.uid) { throw new Error("That username is taken."); }
    var changes = {};
    changes["usernames/" + name] = user.uid;
    changes["users/" + user.uid + "/profile"] = { username: name, created: serverTimestamp() };
    return update(ref(db), changes);
  }).catch(function (err) {
    if (err && err.code === "PERMISSION_DENIED") { throw new Error("That username is taken."); }
    throw err;
  });
}

// Username typed on the sign-up form, claimed as soon as the new account exists.
var pendingUsername = null;

$("auth-form").addEventListener("submit", function (e) {
  e.preventDefault();
  $("auth-error").textContent = "";
  var email = $("auth-email").value.trim();
  var password = $("auth-password").value;
  if (!signupMode) {
    signInWithEmailAndPassword(auth, email, password).catch(function (err) { $("auth-error").textContent = friendlyError(err); });
    return;
  }
  var name = cleanUsername($("auth-username").value);
  if (!USERNAME_RE.test(name)) { $("auth-error").textContent = "Username must be 3-20 characters: letters, numbers or _."; return; }
  if (password.length < 6) { $("auth-error").textContent = "Password must be at least 6 characters."; return; }
  if (password !== $("auth-password2").value) { $("auth-error").textContent = "The passwords do not match."; return; }
  pendingUsername = name;
  createUserWithEmailAndPassword(auth, email, password).catch(function (err) {
    pendingUsername = null;
    $("auth-error").textContent = friendlyError(err);
  });
});

$("auth-forgot").addEventListener("click", function () {
  var email = $("auth-email").value.trim();
  if (!email) { $("auth-error").textContent = "Type your email above, then press Forgot password again."; return; }
  sendPasswordResetEmail(auth, email)
    .then(function () { $("auth-error").textContent = ""; toast("If that email has an account, a reset link is on its way.", "ok"); })
    .catch(function (err) { $("auth-error").textContent = friendlyError(err); });
});

$("btn-pick-username").addEventListener("click", function () {
  $("pick-error").textContent = "";
  claimUsername(cleanUsername($("pick-username").value)).catch(function (err) { $("pick-error").textContent = friendlyError(err); });
});

document.addEventListener("click", function (e) {
  if (!e.target.closest) { return; }
  if (e.target.closest("[data-action='signout']")) { signOut(auth); }
  if (e.target.closest("[data-action='add-pc']")) { openPairBox(); }
});

onAuthStateChanged(auth, function (u) {
  if (DEMO) { return; }
  user = u;
  profile = null;
  stopAccount();
  if (profileUnsub) { profileUnsub(); profileUnsub = null; }
  if (!u) { show("view-login"); return; }
  if (pendingUsername) {
    var name = pendingUsername;
    pendingUsername = null;
    claimUsername(name).catch(function (err) {
      $("pick-username").value = name;
      $("pick-error").textContent = friendlyError(err) + " Pick another.";
    });
  }
  profileUnsub = onValue(ref(db, "users/" + u.uid + "/profile"), function (snap) {
    profile = snap.val();
    if (!profile || !profile.username) {
      stopAccount();
      show("view-username");
      return;
    }
    $("account-name").textContent = profile.username;
    show("view-app");
    startAccount();
  }, function (err) { toast(friendlyError(err), "fail"); });
});

// ---------- this account's PCs ----------
function startAccount() {
  if (ownerSubs.length) { return; }
  ownerSubs.push(onValue(ref(db, ".info/serverTimeOffset"), function (snap) { serverOffset = snap.val() || 0; }));
  ownerSubs.push(onValue(ref(db, "users/" + user.uid + "/devices"), function (snap) { deviceIndex = snap.val() || {}; syncDevices(); }));
}

function stopAccount() {
  ownerSubs.forEach(function (unsub) { unsub(); });
  ownerSubs = [];
  Object.keys(infoSubs).forEach(function (id) { infoSubs[id](); });
  infoSubs = {};
  deviceInfo = {};
  deviceIndex = {};
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
      }, function () { deviceInfo[id] = null; renderDeviceSelect(); });
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
  // This runs every few seconds (each PC's "last seen" time); only reword the list, don't rebuild it.
  var ids = Object.keys(deviceIndex).sort(function (a, b) { return byText(deviceLabel(a).replace(/ \((online|offline)\)$/, ""), deviceLabel(b).replace(/ \((online|offline)\)$/, "")) || (a < b ? -1 : 1); });
  var wanted = ids.map(function (id) { return { value: id, text: deviceLabel(id) }; });
  if (!ids.length) { wanted = [{ value: "", text: "No PCs yet" }]; }
  syncOptions(select, wanted, currentDev || "");
  select.disabled = ids.length < 2;
  $("no-device").classList.toggle("hidden", ids.length > 0);
  $("device-view").classList.toggle("hidden", !currentDev);
}

$("device-select").addEventListener("change", function (e) { selectDevice(e.target.value); });

// ---------- pairing a PC with a code ----------
function openPairBox() {
  $("pair-box").classList.remove("hidden");
  $("pair-error").textContent = "";
  $("pair-code").value = "";
  $("pair-code").focus();
}

$("btn-add-pc").addEventListener("click", openPairBox);
$("btn-pair-cancel").addEventListener("click", function () { $("pair-box").classList.add("hidden"); });
$("pair-code").addEventListener("keydown", function (e) { if (e.key === "Enter") { pairDevice(); } });
$("btn-pair").addEventListener("click", function () { pairDevice(); });

function pairDevice() {
  var code = $("pair-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  $("pair-error").textContent = "";
  if (code.length < 6 || code.length > 10) { $("pair-error").textContent = "The code is 8 characters, shown in the in-game menu."; return; }
  if (DEMO) { toast("Demo: would pair code " + code, "ok"); return; }
  $("btn-pair").disabled = true;
  get(ref(db, "pairCodes/" + code)).then(function (snap) {
    var pc = snap.val();
    if (!pc || !pc.device) { throw new Error("Code not found. Check it, or wait for the menu to show a new one."); }
    if (pc.at && serverNow() - pc.at > 600000) { throw new Error("That code expired. The menu shows a new one; use that."); }
    var changes = {};
    changes["devices/" + pc.device + "/owner"] = { uid: user.uid, username: profile.username, code: code, at: serverTimestamp() };
    changes["users/" + user.uid + "/devices/" + pc.device] = { name: pc.name || "PC", added: serverTimestamp() };
    return update(ref(db), changes).then(function () {
      $("pair-box").classList.add("hidden");
      toast("Paired " + (pc.name || "PC") + ". It connects within a few seconds.", "ok");
      selectDevice(pc.device);
    }, function (err) {
      if (err && err.code === "PERMISSION_DENIED") { throw new Error("That PC is already paired to an account (or the code just expired)."); }
      throw err;
    });
  }).catch(function (err) {
    $("pair-error").textContent = friendlyError(err);
  }).then(function () { $("btn-pair").disabled = false; });
}

$("btn-remove-device").addEventListener("click", function () {
  if (!currentDev) { return; }
  if (!window.confirm("Remove this PC from your account? It will show a new pairing code in the menu.")) { return; }
  var dev = currentDev;
  var changes = {};
  changes["devices/" + dev] = null;
  changes["users/" + user.uid + "/devices/" + dev] = null;
  update(ref(db), changes).catch(function () {
    // The PC entry may already be gone (e.g. it was reset); still drop it from the list.
    var only = {};
    only["users/" + user.uid + "/devices/" + dev] = null;
    return update(ref(db), only);
  }).catch(function (err) { toast(friendlyError(err), "fail"); });
});

// ---------- selected device ----------
function selectDevice(id) {
  devSubs.forEach(function (unsub) { unsub(); });
  devSubs = [];
  currentDev = id;
  lastMapPing = 0;
  catalog = null;
  state = null;
  lastResultSeen = undefined;
  pendingToggles = {};
  setMapData(null);
  $("content").innerHTML = "";
  $("game-strip").innerHTML = "";
  $("tabs").innerHTML = "";
  runningBarSig = "";
  $("running-bar").innerHTML = "";
  $("running-bar").classList.add("hidden");
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
    // Just opened the site on the Map tab, or picked another PC: tell the game the map is being watched.
    if (activeTab === "Map" && Date.now() - lastMapPing > 20000) { mapPing(true); }
    applyState();
  }));
  devSubs.push(onValue(ref(db, base + "map"), function (snap) {
    setMapData(snap.val());
  }, function () { /* database rules without the map yet: the Map tab just says there is no map */ }));
  devSubs.push(onValue(ref(db, base + "lastResult"), function (snap) {
    var result = snap.val();
    var resultId = result ? result.id : null;
    // Map pings answer "pong" quietly (older menus don't mark them quiet, hence the message check).
    if (lastResultSeen !== undefined && result && resultId !== lastResultSeen && !result.quiet && result.message !== "pong") {
      toast(result.message || (result.ok ? "Done" : "Failed"), result.ok ? "ok" : "fail");
    }
    lastResultSeen = resultId;
  }));
  renderDeviceSelect();
  refreshOnline();
}

// The last enemy list a PC sent goes stale the moment it goes offline (those monsters may be long dead or the
// round over), so while it's offline the website shows no enemies, no hunts, and no monster dots on the map.
var wasOnline = null;

function pcOnline() { return isOnline(currentDev ? deviceInfo[currentDev] : null); }

function liveEnemies() {
  return pcOnline() ? ((state && state.enemies) || []).filter(function (e) { return !e.dead; }) : [];
}

function noEnemiesText() { return pcOnline() ? "No living enemies right now" : "PC is offline: no enemies shown"; }

function refreshOnline() {
  var info = currentDev ? deviceInfo[currentDev] : null;
  var online = isOnline(info);
  if (wasOnline !== null && online !== wasOnline) { applyState(true); } // went offline/online: clear or bring back the enemies
  wasOnline = online;
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
// Features and settings the menu no longer has (removed in v1.4.8). An older menu, or a PC that was offline
// since before the update, still lists them; never show them.
var REMOVED = { AntiKick: true, b_DisplayLMUsers: true, b_DisplayHostKickedLobbies: true };

function hackEntries() {
  var hacks = (catalog && catalog.hacks) || {};
  return Object.keys(hacks).filter(function (key) { return !REMOVED[key]; }).map(function (key) {
    var h = hacks[key];
    var tab = tabFor(key, h.category);
    var placed = tab === h.category;
    return {
      key: key, name: h.name || key, category: tab, group: placed && h.group && h.group !== "Other" ? h.group : tab,
      toggle: !!h.toggle, action: !!h.action, args: h.args || [], slider: h.slider || null, only: h.only || null, not: h.not || null
    };
  }).sort(function (a, b) { return byText(a.name, b.name); });
}

function matchesSearch(text) { return !search || text.toLowerCase().indexOf(search) >= 0; }

function settingEntries() {
  var settings = (catalog && catalog.settings) || {};
  return Object.keys(settings).filter(function (key) { return !REMOVED[key]; }).map(function (key) {
    return { key: key, name: settings[key].name || key, type: settings[key].type };
  }).filter(function (s) { return matchesSearch(s.name); }).sort(function (a, b) { return byText(a.name, b.name); });
}

function isSingleArg(h, kind) { return h.action && h.args.length === 1 && h.args[0].kind === kind; }

// Needs exactly one enemy and one player (Hunt, Teleport Enemy...). On the Enemies tab these are buttons on
// each enemy's card, using the player picked once at the top, instead of a row with two dropdowns each.
function isEnemyPlayerPair(h) {
  if (!h.action || h.toggle || h.args.length !== 2) { return false; }
  var kinds = h.args.map(function (a) { return a.kind; }).sort().join(",");
  return kinds === "enemy,player";
}

// Short button names for the enemy cards.
var ENEMY_BUTTON_NAMES = {
  HuntPlayer: "Hunt", PersistentHunt: "Persistent hunt", AggroHunt: "Aggro hunt", TeleportEnemy: "Teleport to player",
  X_TargetPlayer: "Anger at player", X_KillPlayerWithEnemy: "Kill player"
};
function enemyButtonName(h) { return ENEMY_BUTTON_NAMES[h.key] || h.name.replace(/\s*Enemy\s*/g, " ").trim() || h.name; }

// Does this action fit this enemy? Some only make sense for one monster (matched by its type, or its name).
function fitsEnemy(h, e) {
  if (h.not && h.not.indexOf(e.type) >= 0) { return false; } // e.g. "Kill player" on monsters that can't hurt anyone
  return !h.only || h.only === e.type || h.only === e.name;
}

// The player picked at the top of the Enemies tab (null if none, or they're not in the lobby).
function enemyTabTarget() {
  var v = ui.enemyPlayerSelect ? ui.enemyPlayerSelect.value : enemyTabPlayer;
  if (v === "" || v == null) { return null; }
  return ((state && state.players) || []).filter(function (p) { return String(p.id) === String(v); })[0] || null;
}

// Re-draw the enemy cards (the picked player changed, or moved inside/outside).
function refreshEnemyCards() { ui.sigEnemies = ""; applyState(false); }

var enemyTabPlayer = loadPref("enemyPlayer") || "";

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
    if (!counts[tab] && !FIXED_TABS[tab]) { return; }
    tabs.appendChild(el("button", {
      class: "tab" + (tab === activeTab ? " active" : ""),
      type: "button",
      onclick: function () {
        var wasMap = activeTab === "Map";
        activeTab = tab;
        savePref("tab", tab);
        renderTabs();
        buildContent();
        if (wasMap !== (tab === "Map")) { mapPing(tab === "Map"); }
      }
    }, [tab, tab === "Map" ? null : el("span", { class: "count", text: String(counts[tab] || 0) })]));
  });
}

function buildContent() {
  var content = $("content");
  content.innerHTML = "";
  ui = freshUi();
  mapUi = null;
  if (!catalog) {
    content.appendChild(el("p", { class: "muted", text: "Waiting for the menu to send its feature list... (start the game with the menu loaded)" }));
    return;
  }
  if (activeTab === "Settings") {
    buildSettings(content);
  } else if (activeTab === "Map") {
    buildMap(content);
  } else {
    if (activeTab === "Players" && !search) {
      content.appendChild(el("div", { class: "section-title", text: "Players in lobby" }));
      ui.playersBox = content.appendChild(el("div", { class: "cards" }));
    }
    if (activeTab === "Enemies" && !search) {
      content.appendChild(el("div", { class: "section-title", text: "Enemies" }));
      // One player picker for every enemy's Hunt / Anger / Teleport buttons.
      var pick = el("select", { "aria-label": "Player" });
      pick.addEventListener("change", function () { enemyTabPlayer = pick.value; savePref("enemyPlayer", pick.value); refreshEnemyCards(); });
      ui.playerSelects.push(pick);
      ui.enemyPlayerSelect = pick;
      content.appendChild(el("div", { class: "pick-bar" }, [el("span", { class: "pick-label", text: "Player for the hunt / anger / teleport buttons:" }), pick]));
      // Only the monsters in the same place as that player (inside or outside) are shown; this line says so.
      ui.enemyNote = content.appendChild(el("div", { class: "cards-note hidden" }));
      ui.enemiesBox = content.appendChild(el("div", { class: "cards" }));
    }
    var list = hackEntries().filter(function (h) {
      if (!matchesSearch(h.name)) { return false; }
      if (h.category !== activeTab) { return false; }
      // Single-target hacks are shown as buttons on the player/enemy cards instead.
      if (activeTab === "Players" && !search && isSingleArg(h, "player") && !h.toggle) { return false; }
      // On the Enemies tab everything aimed at one enemy lives on that enemy's card: single-enemy actions
      // (Enemy Control included; "Running now" has its Stop button) and enemy+player ones.
      if (activeTab === "Enemies" && !search && (isSingleArg(h, "enemy") || isEnemyPlayerPair(h))) { return false; }
      return true;
    });
    if (list.length) {
      // One box per section, sections A-Z, features A-Z inside each.
      var byGroup = {};
      list.forEach(function (h) { (byGroup[h.group] = byGroup[h.group] || []).push(h); });
      if (ui.playersBox || ui.enemiesBox) { content.appendChild(el("div", { class: "section-title", text: "Features" })); }
      var groups = content.appendChild(el("div", { class: "groups" }));
      Object.keys(byGroup).sort(byText).forEach(function (name) {
        groups.appendChild(groupBox(name, byGroup[name].map(hackRow)));
      });
    } else if (!ui.playersBox && !ui.enemiesBox) {
      content.appendChild(el("p", { class: "muted", text: search ? "Nothing matches your search on this tab." : "Nothing here." }));
    }
  }
  applyState(true);
  if (ui.enemyPlayerSelect) {
    // Keep the player you picked last time; otherwise start on the first living player who isn't you.
    var ps = ui.enemyPlayerSelect;
    var has = function (v) { return v !== "" && Array.prototype.some.call(ps.options, function (o) { return o.value === v; }); };
    if (has(enemyTabPlayer)) { ps.value = enemyTabPlayer; }
    else {
      var other = ((state && state.players) || []).filter(function (p) { return !p.local && !p.dead; }).sort(function (a, b) { return byText(a.name, b.name); })[0];
      if (other && has(String(other.id))) { ps.value = String(other.id); }
      enemyTabPlayer = ps.value;
    }
    refreshEnemyCards();
  }
}

function groupBox(title, rows) {
  return el("section", { class: "group" }, [
    el("div", { class: "group-title" }, [el("span", { text: title }), el("span", { class: "count", text: String(rows.length) })]),
    el("div", { class: "group-body" }, rows)
  ]);
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

  if (h.slider) {
    row.appendChild(sliderControl(h.slider, h.toggle));
  }

  if (h.action && !h.args.length) {
    head.appendChild(el("button", { class: "btn small", type: "button", text: "Run", onclick: function () { send({ type: "run", hack: h.key, args: [] }); } }));
  } else if (h.action) {
    var getters = [];
    var argsBox = el("div", { class: "row-args" });
    // A feature whose slider IS its one number (Kill Nearby Enemies' distance): Run sends the slider value,
    // instead of showing a second box for the same thing.
    var sliderIsArg = !!h.slider && !h.toggle && h.args.filter(function (a) { return a.kind === "number"; }).length === 1;
    h.args.forEach(function (arg) {
      if (sliderIsArg && arg.kind === "number") {
        var sl = ui.sliders[h.slider.setting];
        getters.push(function () {
          var v = parseFloat(sl.input.value);
          return isNaN(v) ? undefined : (arg.integer ? Math.round(v) : v);
        });
        return;
      }
      getters.push(argControl(arg, argsBox));
    });
    // When the slider is the only input, Run sits right next to it instead of on a line of its own.
    var runHolder = (sliderIsArg && h.args.length === 1 && row.querySelector(".row-slider")) || argsBox;
    runHolder.appendChild(el("button", {
      class: "btn primary small run",
      type: "button",
      text: h.toggle ? "Start" : "Run",
      onclick: function () {
        var values = [];
        for (var i = 0; i < getters.length; i++) {
          var value = getters[i]();
          if (value === undefined && h.args[i].optional) { values.push(null); continue; } // left empty on purpose
          if (value === undefined) { toast((h.args[i].kind === "enemy" || h.args[i].kind === "player" ? "Pick " : "Fill in ") + argName(h.args[i]).toLowerCase(), "fail"); return; }
          values.push(value);
        }
        send({ type: "run", hack: h.key, args: values });
      }
    }));
    if (runHolder === argsBox) { row.appendChild(argsBox); }
  }
  return row;
}

// The slider the in-game menu shows next to a feature (FOV, speed, jump...). On a toggle it only shows while
// the feature is on. Dragging updates the number; letting go sends it to the game.
function sliderControl(s, onlyWhenOn) {
  var decimals = s.step < 1 ? (String(s.step).split(".")[1] || "").length : 0;
  var range = el("input", { type: "range", min: s.min, max: s.max, step: s.step, "aria-label": "Value" });
  var value = el("span", { class: "slider-value", text: "-" });
  var box = el("div", { class: "row-slider" + (onlyWhenOn ? " when-on" : "") }, [range, value]);
  function shown(v) { return Number(v).toFixed(decimals); }
  range.addEventListener("input", function () { value.textContent = shown(range.value); });
  range.addEventListener("change", function () {
    value.textContent = shown(range.value);
    ui.sliders[s.setting].until = Date.now() + 3000;
    send({ type: "setting", name: s.setting, value: parseFloat(range.value) });
  });
  ui.sliders[s.setting] = { input: range, label: value, shown: shown, until: 0 };
  return box;
}

// Builds the input for one argument and returns a function that reads it (undefined = missing).
// The game names some inputs after one-letter code names ("E"); show what they are instead.
function argName(arg) {
  if (arg.kind === "enemy") { return "Enemy"; }
  if (arg.kind === "player") { return "Player"; }
  if (arg.kind === "vector3") { return "Position"; }
  return arg.name && arg.name.length > 2 ? arg.name : "Value";
}

function argControl(arg, box) {
  var label = el("label", { class: "arg" }, [argName(arg)]);
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
    // Lists like enemy types and items only exist once the game has a lobby loaded.
    if (!(arg.options || []).length) { enumSelect.appendChild(el("option", { value: "", text: "Nothing yet (join a lobby first)" })); }
    label.appendChild(enumSelect);
    return function () { return enumSelect.value === "" ? undefined : enumSelect.value; };
  }
  if (arg.kind === "bool") {
    label.className = "arg bool";
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
    label.className = "arg num";
    var num = el("input", { type: "number", step: arg.integer ? "1" : "any", inputmode: arg.integer ? "numeric" : "decimal", placeholder: arg.hint || undefined });
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
  var entries = settingEntries();
  if (!entries.length) { content.appendChild(el("p", { class: "muted", text: "No settings match." })); return; }
  var rows = [];
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
    rows.push(row);
  });
  content.appendChild(el("div", { class: "groups single" }, [groupBox("Menu settings (applied instantly)", rows)]));
}

// ---------- live state ----------
function applyState(force) {
  renderStrip();
  renderRunningBar();
  drawMap();
  if (!state) { return; }
  $("btn-menu").textContent = state.menuOpen ? "Close menu in game" : "Open menu in game";
  // Stealth Mode: the PC shows no menu and no notifications; this website is the only control.
  var stealth = !!(state.settings && state.settings.b_StealthMode);
  var stealthBtn = $("btn-stealth");
  if (!stealthBtn) {
    stealthBtn = el("button", {
      id: "btn-stealth", type: "button", class: "btn small",
      onclick: function () {
        var on = !!(state && state.settings && state.settings.b_StealthMode);
        send({ type: "setting", name: "b_StealthMode", value: !on });
      }
    });
    $("btn-menu").parentNode.insertBefore(stealthBtn, $("btn-menu"));
    $("btn-menu").style.marginLeft = "6px";
  }
  stealthBtn.textContent = stealth ? "Stealth: ON" : "Stealth: off";
  stealthBtn.className = "btn small" + (stealth ? " primary" : "");
  $("btn-menu").disabled = stealth; // the in-game menu can't be opened while stealth is on

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

  Object.keys(ui.sliders).forEach(function (key) {
    var sl = ui.sliders[key];
    // Don't jump the slider back while it is being dragged or the new value is on its way.
    if (settings[key] === undefined || document.activeElement === sl.input || sl.until > now) { return; }
    sl.input.value = settings[key];
    sl.label.textContent = sl.shown(settings[key]);
  });

  var players = state.players || [];
  var enemies = liveEnemies();
  var sigP = JSON.stringify([players, state.targets || null]);
  // Which enemies exist (not how far away they are): the cards are only rebuilt when this changes.
  var chosen = enemyTabTarget();
  var sigE = JSON.stringify([enemies.map(function (e) { return [e.id, e.name, e.inside]; }), chosen ? [chosen.id, chosen.inside, chosen.dead] : null]);
  fillSelects(ui.playerSelects, players.map(function (p) {
    return { value: p.id, name: p.name, text: p.name + (p.local ? " (you)" : "") + (p.dead ? " (dead)" : "") };
  }), "No players (join a lobby first)");
  fillSelects(ui.enemySelects, enemies.map(function (e) {
    return { value: e.id, name: e.name, text: e.name + " (" + e.distance + "m" + (e.inside ? ", inside" : "") + ")" };
  }), noEnemiesText());
  if (force || sigP !== ui.sigPlayers) {
    ui.sigPlayers = sigP;
    renderPlayers(players);
  }
  if (force || sigE !== ui.sigEnemies) {
    ui.sigEnemies = sigE;
    renderEnemies(enemies);
  } else {
    // Same enemies as before: just refresh each card's distance text, so buttons don't blink under your finger.
    enemies.forEach(function (e) {
      var meta = ui.enemyMeta[e.id];
      var text = enemyMetaText(e);
      if (meta && meta.textContent !== text) { meta.textContent = text; }
    });
  }
}

// Brings a dropdown's choices up to date WITHOUT rebuilding it when it doesn't have to. Rebuilding a dropdown
// while its list is open makes the browser close and reopen it (the flicker), and live data arrives twice a
// second. So: never touch one that is in use, and when only the wording changed (an enemy's distance, a PC going
// online) just reword the existing choices.
function syncOptions(select, wanted, keepValue) {
  if (document.activeElement === select) { return; } // open or focused: leave it alone, the next update catches up
  var i;
  var same = select.options.length === wanted.length;
  for (i = 0; same && i < wanted.length; i++) {
    if (select.options[i].value !== wanted[i].value) { same = false; }
  }
  if (same) {
    for (i = 0; i < wanted.length; i++) {
      if (select.options[i].text !== wanted[i].text) { select.options[i].text = wanted[i].text; }
    }
  } else {
    var previous = keepValue === undefined ? select.value : keepValue;
    select.innerHTML = "";
    wanted.forEach(function (o) { select.appendChild(el("option", { value: o.value, text: o.text })); });
    if (previous !== "" && wanted.some(function (o) { return o.value === previous; })) { select.value = previous; }
  }
  if (keepValue !== undefined && select.value !== keepValue && wanted.some(function (o) { return o.value === keepValue; })) { select.value = keepValue; }
}

// options: [{ value, text, name }]. Listed A-Z by name (then by id), so the order doesn't jump around as the
// distance or health shown in the text changes.
function fillSelects(selects, options, emptyText) {
  var wanted = options.slice().sort(function (a, b) {
    return byText(a.name === undefined ? a.text : a.name, b.name === undefined ? b.text : b.name) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
  }).map(function (o) { return { value: String(o.value), text: o.text }; });
  if (!wanted.length) { wanted = [{ value: "", text: emptyText }]; }
  selects.forEach(function (select) { syncOptions(select, wanted); });
}

function renderStrip() {
  var strip = $("game-strip");
  strip.innerHTML = "";
  // Every box has a fixed width (wide enough for its longest value), and they're always in the same order,
  // so nothing shifts around when a number changes or someone picks something up.
  function chip(label, value, width) {
    strip.appendChild(el("span", { class: "chip", style: width ? "min-width:" + width + "ch" : "" }, [label + " ", el("b", { text: String(value) })]));
  }
  if (!state || !state.game) { chip("Status", currentDev ? "waiting for game" : "-"); return; }
  var g = state.game;
  if (!g.inRound) { chip("Status", "Main menu / lobby list"); return; }
  chip("Moon", g.moon || "-", 19);
  chip("Phase", g.inShipPhase ? "In orbit" : (g.landed ? "Landed" : "Travelling"), 17);
  // A card per player: you first, then everyone else A-Z.
  var players = (state.players || []).slice().sort(function (a, b) { return (b.local ? 1 : 0) - (a.local ? 1 : 0) || byText(a.name, b.name); });
  players.forEach(function (p) { strip.appendChild(playerChip(p)); });
  if (!players.length && g.localName) { chip(g.localName, g.alive ? g.health + " HP" : "dead"); }
  chip("Credits", g.credits, 14);
  chip("Quota", g.quota !== undefined ? g.fulfilled + " / " + g.quota : "-", 18);
  chip("Days left", g.daysLeft !== undefined ? g.daysLeft : "-", 13);
  chip("Host", g.isHost ? "yes" : "no", 11);
  chip("Stealth", state.settings && state.settings.b_StealthMode ? "on" : "off", 13);
}

function playerChip(p) {
  var parts = [el("b", { text: p.name })];
  if (p.dead) {
    parts.push(el("span", { text: "Dead" }));
  } else {
    parts.push(el("span", { class: "hp" + (p.health < 40 ? " low" : ""), text: p.health + " HP" }));
    parts.push(" | " + (p.inside ? "Inside" : "Outside"));
    if (p.item) { parts.push(el("span", { class: "pchip-item", text: p.item })); }
  }
  return el("span", { class: "chip pchip" + (p.local ? " me" : "") + (p.dead ? " dead" : ""), title: p.name + (p.item ? " | holding " + p.item : "") }, parts);
}

// Camera-style hacks that only make sense on other players (same rule as the in-game menu).
var NOT_ON_SELF = { SpectatePlayer: true, MiniCam: true };

function targetsOf() {
  var t = (state && state.targets) || {};
  return { spectating: t.spectating === undefined ? -1 : t.spectating, miniCam: t.miniCam === undefined ? -1 : t.miniCam, demiGod: t.demiGod || [], controlling: pcOnline() ? (t.controlling || null) : null,
    controlTarget: t.controlTarget === undefined ? -1 : t.controlTarget, aiDriving: !!t.aiDriving, hunts: pcOnline() ? (t.hunts || []) : [] };
}

function nameOfClient(players, clientId) {
  for (var i = 0; i < players.length; i++) {
    if (players[i].clientId === clientId) { return players[i].name; }
  }
  return "player";
}

// Builds the button for one player action; toggles that are already aimed at this player become "Stop".
function playerActionButton(h, p, targets) {
  var label = shortName(h.name);
  var active = false;
  var command = { type: "run", hack: h.key, args: [p.id] };
  if (h.key === "SpectatePlayer" && targets.spectating === p.clientId) {
    active = true; label = "Stop spectating"; command = { type: "toggle", hack: h.key, value: false };
  } else if (h.key === "MiniCam" && targets.miniCam === p.clientId) {
    active = true; label = "Stop mini cam"; command = { type: "toggle", hack: h.key, value: false };
  } else if (h.key === "DemiGod" && targets.demiGod.indexOf(p.clientId) >= 0) {
    // Running Demi God again on the same player removes it.
    active = true; label = "Remove demi god";
  }
  return el("button", {
    class: "btn small" + (active ? " primary" : ""), type: "button", text: label,
    onclick: function () { send(command); }
  });
}

// "Running now" bar under the game info, on every tab: one tap to stop control / cameras.
var runningBarSig = "";

function renderRunningBar() {
  var bar = $("running-bar");
  var players = (state && state.players) || [];
  var targets = targetsOf();
  var toggles = (state && state.toggles) || {};
  // Rebuild only when something shown here changed, so an open dropdown is not closed by live updates.
  var sig = JSON.stringify([targets, !!toggles.FreeCam, players.map(function (p) { return [p.id, p.clientId, p.name, p.dead, p.local]; })]);
  if (sig === runningBarSig) { return; }
  // The target picker lives in this bar: don't rebuild the bar while it is open (the next update will).
  if (document.activeElement && document.activeElement.tagName === "SELECT" && bar.contains(document.activeElement)) { return; }
  runningBarSig = sig;
  bar.innerHTML = "";
  var stops = [];
  var controlExtras = [];
  function stop(label, command) {
    stops.push(el("button", { class: "btn small primary", type: "button", text: label, onclick: function () { send(command); } }));
  }
  if (targets.controlling) {
    stop("Stop controlling " + targets.controlling, { type: "toggle", hack: "EnemyControl", value: false });
    // Who the controlled monster goes after (T in game), and who drives it (F9 in game).
    var pick = el("select", { "aria-label": "Attack target" });
    pick.appendChild(el("option", { value: "-1", text: "Target: nearest other player" }));
    // Other players A-Z, then your own body last (only picked on purpose).
    players.filter(function (p) { return !p.dead; }).sort(function (a, b) { return (a.local ? 1 : 0) - (b.local ? 1 : 0) || byText(a.name, b.name); }).forEach(function (p) {
      pick.appendChild(el("option", { value: String(p.id), text: "Target: " + (p.local ? "yourself (" + p.name + ")" : p.name), selected: p.clientId === targets.controlTarget }));
    });
    pick.addEventListener("change", function () { send({ type: "controlTarget", player: Number(pick.value) }); });
    controlExtras.push(pick);
    controlExtras.push(el("button", {
      class: "btn small" + (targets.aiDriving ? " primary" : ""), type: "button",
      text: targets.aiDriving ? "AI driving (take back)" : "Let AI drive",
      onclick: function () { send({ type: "controlAI", value: !targets.aiDriving }); }
    }));
  }
  if (targets.spectating >= 0) { stop("Stop spectating " + nameOfClient(players, targets.spectating), { type: "toggle", hack: "SpectatePlayer", value: false }); }
  if (targets.miniCam >= 0) { stop("Stop mini cam (" + nameOfClient(players, targets.miniCam) + ")", { type: "toggle", hack: "MiniCam", value: false }); }
  // Monsters walking to a player with Hunt Player.
  targets.hunts.forEach(function (h) {
    stop("Stop " + h.enemyName + (h.persistent ? " hunting " : " walking to ") + h.player, { type: "stopHunt", enemy: h.enemy });
  });
  if (toggles.FreeCam && !targets.controlling) { stop("Stop free cam", { type: "toggle", hack: "FreeCam", value: false }); }
  bar.classList.toggle("hidden", stops.length === 0);
  if (stops.length) {
    bar.appendChild(el("span", { class: "running-label", text: "Running now:" }));
    stops.forEach(function (b) { bar.appendChild(b); });
    controlExtras.forEach(function (x) { bar.appendChild(x); });
  }
}

function renderPlayers(players) {
  var box = ui.playersBox;
  if (!box) { return; }
  box.innerHTML = "";
  box.className = "cards";
  var targets = targetsOf();
  if (!players.length) { box.appendChild(el("div", { class: "empty-list", text: "No players (join a lobby first)." })); return; }
  var actions = hackEntries().filter(function (h) { return isSingleArg(h, "player"); });
  actions.sort(function (a, b) { return byText(shortName(a.name), shortName(b.name)); });
  players.slice().sort(function (a, b) { return byText(a.name, b.name); }).forEach(function (p) {
    var buttons = actions.filter(function (h) { return !(p.local && NOT_ON_SELF[h.key]); }).map(function (h) {
      return playerActionButton(h, p, targets);
    });
    box.appendChild(el("div", { class: "entity" + (p.dead ? " dead" : "") }, [
      el("div", { class: "entity-head" }, [
        el("span", { class: "entity-name", text: p.name + (p.local ? " (you)" : "") }),
        el("span", { class: "entity-meta", text: p.dead ? "dead" : p.health + " HP" + (p.inside ? " | inside" : " | outside") + (p.item ? " | " + p.item : "") })
      ]),
      el("div", { class: "entity-actions" }, buttons)
    ]));
  });
  packCards(box);
}

// Player/enemy cards: as many columns as fit (each at least CARD_MIN wide), and each card in turn goes into
// the shortest column. Cards keep reading left to right, and no column ends up with a big hole under it.
var CARD_MIN = 270;
var CARD_GAP = 8;

function packCards(box) {
  if (!box) { return; }
  var cards = [].slice.call(box.querySelectorAll(".entity"));
  if (!cards.length) { return; } // "No players" style messages stay as they are
  // Remember the A-Z order the first time, so re-dealing after a resize keeps it (the columns change the DOM order).
  cards.forEach(function (card, n) { if (!card.getAttribute("data-order")) { card.setAttribute("data-order", String(n)); } });
  cards.sort(function (x, y) { return Number(x.getAttribute("data-order")) - Number(y.getAttribute("data-order")); });
  var width = box.clientWidth;
  var count = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP)));
  box.innerHTML = "";
  var cols = [];
  var heights = [];
  for (var i = 0; i < count; i++) {
    cols.push(box.appendChild(el("div", { class: "card-col" })));
    heights.push(0);
  }
  cards.forEach(function (card) {
    var best = 0;
    for (var j = 1; j < count; j++) { if (heights[j] < heights[best]) { best = j; } }
    cols[best].appendChild(card);
    heights[best] += (card.offsetHeight || 1) + CARD_GAP;
  });
  box.className = "cards packed";
  box.setAttribute("data-cols", String(count));
}

// Re-deal the cards only when the number of columns that fit changes.
window.addEventListener("resize", function () {
  [ui.playersBox, ui.enemiesBox].forEach(function (box) {
    if (!box || !box.getAttribute("data-cols")) { return; }
    var fit = Math.max(1, Math.floor((box.clientWidth + CARD_GAP) / (CARD_MIN + CARD_GAP)));
    if (String(fit) !== box.getAttribute("data-cols")) { packCards(box); }
  });
});

function enemyMetaText(e) { return e.distance + "m" + (e.inside ? " | inside" : " | outside"); }

function renderEnemies(enemies) {
  var box = ui.enemiesBox;
  ui.enemyMeta = {};
  if (!box) { return; }
  box.innerHTML = "";
  box.className = "cards";
  if (ui.enemyNote) { ui.enemyNote.classList.add("hidden"); }
  if (!enemies.length) {
    box.appendChild(el("div", { class: "empty-list", text: noEnemiesText() + "." }));
    // The per-enemy actions (Teleport, Hunt, Kill...) live on the enemy cards; say so, so they aren't "missing".
    var onCards = hackEntries().filter(function (h) { return isSingleArg(h, "enemy") || isEnemyPlayerPair(h); })
      .map(enemyButtonName).sort(byText);
    if (onCards.length) {
      box.appendChild(el("div", { class: "empty-list", text: "Each enemy gets a card with: " + onCards.join(", ") + "." }));
    }
    return;
  }
  // Only the monsters where the picked player is (inside or outside). A dead player shows them all.
  var who = enemyTabTarget();
  var note = ui.enemyNote;
  if (who && !who.dead) {
    var where = who.inside ? "inside" : "outside";
    var hidden = enemies.filter(function (e) { return !!e.inside !== !!who.inside; }).length;
    enemies = enemies.filter(function (e) { return !!e.inside === !!who.inside; });
    if (note) {
      note.textContent = "Showing the monsters " + where + ", where " + (who.local ? "you are" : who.name + " is") + (hidden ? " (" + hidden + " " + (who.inside ? "outside" : "inside") + " hidden)." : ".");
      note.classList.remove("hidden");
    }
    if (!enemies.length) {
      box.appendChild(el("div", { class: "empty-list", text: "No monsters " + where + " right now." }));
      return;
    }
  } else if (note) {
    note.classList.add("hidden");
  }
  var byName = function (a, b) { return byText(enemyButtonName(a), enemyButtonName(b)); };
  var actions = hackEntries().filter(function (h) { return isSingleArg(h, "enemy"); }).sort(byName);
  var pairActions = hackEntries().filter(isEnemyPlayerPair).sort(byName);
  // A-Z by name; several of the same kind keep a fixed order so the cards don't swap places as they move.
  enemies.slice().sort(function (a, b) { return byText(a.name, b.name) || a.id - b.id; }).forEach(function (e) {
    // Some actions only fit one kind of monster (webs for the Bunker Spider, stealing for the Hoarding Bug).
    var buttons = actions.filter(function (h) { return fitsEnemy(h, e); }).map(function (h) {
      return el("button", {
        class: "btn small", type: "button", text: enemyButtonName(h),
        onclick: function () { send({ type: "run", hack: h.key, args: [e.id] }); }
      });
    });
    // Actions that also need a player use the one picked at the top of the tab.
    var pairButtons = pairActions.filter(function (h) { return fitsEnemy(h, e); }).map(function (h) {
      return el("button", {
        class: "btn small", type: "button", text: enemyButtonName(h),
        onclick: function () {
          var chosen = ui.enemyPlayerSelect ? ui.enemyPlayerSelect.value : "";
          if (chosen === "") { toast("Pick a player at the top of the Enemies tab first", "fail"); return; }
          send({ type: "run", hack: h.key, args: h.args.map(function (a) { return a.kind === "enemy" ? e.id : Number(chosen); }) });
        }
      });
    });
    box.appendChild(el("div", { class: "entity" }, [
      el("div", { class: "entity-head" }, [
        el("span", { class: "entity-name", text: e.name }),
        (ui.enemyMeta[e.id] = el("span", { class: "entity-meta", text: enemyMetaText(e) }))
      ]),
      el("div", { class: "entity-actions" }, buttons),
      pairButtons.length ? el("div", { class: "entity-sub", text: "With the chosen player" }) : null,
      pairButtons.length ? el("div", { class: "entity-actions" }, pairButtons) : null
    ]));
  });
  packCards(box);
}

// ---------- map ----------
// There are no pictures of the facility to download (it's built at random every day), so the game draws the
// map itself from the floor monsters walk on and sends it once per landing (devices/{id}/map). The dots
// (players, monsters, ship) come with the live state twice a second.
var mapData = null;
var mapImages = {};
var mapUi = null;
var mapMode = loadPref("mapMode") || "auto"; // auto = wherever you are; "outside", "inside", or "both" side by side
var mapZoom = 1;
var mapItems = loadPref("mapItems") !== "0"; // show items lying around (scrap etc.)

// The game only sends positions (players, monsters, items) while someone has the Map tab open: this tells it.
// Sent on opening the tab and every 20 seconds while it stays open; the game stops after 45s without one.
var lastMapPing = 0;
function mapPing(on) {
  if (DEMO || !currentDev || !isOnline(deviceInfo[currentDev])) { return; }
  lastMapPing = on ? Date.now() : 0;
  push(ref(db, "devices/" + currentDev + "/commands"), { at: serverTimestamp(), type: "ping", map: !!on }).catch(function () { /* not important */ });
}
setInterval(function () { if (activeTab === "Map") { mapPing(true); } }, 20000);
var mapPans = {}; // per map ("outside"/"inside"): how far it was dragged from the centre, in map cells

function resetMapPan() { mapPans = { outside: { x: 0, y: 0 }, inside: { x: 0, y: 0 } }; }
resetMapPan();

function setMapData(data) {
  mapData = data;
  mapImages = {};
  resetMapPan();
  drawMap();
}

// The grid comes as run-length text: a letter (a = no floor, b-e = floor, low to high) and how many in a row.
function decodeGrid(g) {
  var out = new Uint8Array(g.w * g.h);
  var re = /([a-e])(\d+)/g;
  var m;
  var i = 0;
  while ((m = re.exec(g.data)) !== null) {
    var value = m[1].charCodeAt(0) - 97;
    var count = Number(m[2]);
    if (value) { out.fill(value, i, Math.min(i + count, out.length)); }
    i += count;
  }
  return out;
}

var FLOOR_SHADES = [null, [52, 58, 68], [66, 74, 86], [82, 92, 106], [100, 111, 128]];
var WALL_SHADE = [176, 186, 200];

// Turns one grid into a small picture (one pixel per cell); walls are the floor cells next to empty ones.
function floorImage(which) {
  if (mapImages[which]) { return mapImages[which]; }
  var g = mapData && mapData[which];
  if (!g || !g.data || !g.w || !g.h) { return null; }
  var cells = decodeGrid(g);
  var w = g.w;
  var h = g.h;
  var canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext("2d");
  var img = ctx.createImageData(w, h);
  for (var z = 0; z < h; z++) {
    for (var x = 0; x < w; x++) {
      var v = cells[z * w + x];
      if (!v) { continue; }
      var edge = x === 0 || z === 0 || x === w - 1 || z === h - 1 ||
        !cells[z * w + x - 1] || !cells[z * w + x + 1] || !cells[(z - 1) * w + x] || !cells[(z + 1) * w + x];
      var shade = edge ? WALL_SHADE : FLOOR_SHADES[v];
      var p = ((h - 1 - z) * w + x) * 4; // grid row 0 is south; picture row 0 is the top
      img.data[p] = shade[0];
      img.data[p + 1] = shade[1];
      img.data[p + 2] = shade[2];
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  mapImages[which] = { canvas: canvas, grid: g };
  return mapImages[which];
}

function legendItem(color, text) {
  return el("span", {}, [el("i", { style: "background:" + color }), text]);
}

var MAP_MODES = [["auto", "Follow me"], ["outside", "Outside"], ["inside", "Inside"], ["both", "Both"]];

function buildMap(content) {
  var bar = el("div", { class: "map-bar" });
  var buttons = {};
  MAP_MODES.forEach(function (b) {
    buttons[b[0]] = bar.appendChild(el("button", {
      class: "btn small", type: "button", text: b[1],
      onclick: function () { mapMode = b[0]; savePref("mapMode", b[0]); resetMapPan(); drawMap(); }
    }));
  });
  bar.appendChild(el("button", { class: "btn small", type: "button", text: "Zoom out", onclick: function () { zoomMap(1 / 1.5); } }));
  bar.appendChild(el("button", { class: "btn small", type: "button", text: "Zoom in", onclick: function () { zoomMap(1.5); } }));
  var itemsBtn = bar.appendChild(el("button", {
    class: "btn small", type: "button",
    onclick: function () { mapItems = !mapItems; savePref("mapItems", mapItems ? "1" : "0"); drawMap(); }
  }));
  var info = bar.appendChild(el("span", { class: "map-info" }));
  var box = el("div", { class: "map-panels" });
  content.appendChild(bar);
  content.appendChild(box);
  content.appendChild(el("div", { class: "map-legend" }, [
    legendItem("#3cb371", "You"), legendItem("#4a90d9", "Players"), legendItem("#8a8a8a", "Dead"),
    legendItem("#e5534b", "Monsters"), legendItem("#e0b341", "Ship"), legendItem("#ff8c1a", "Doors"), legendItem("#c792ea", "Items")
  ]));
  mapUi = { box: box, panels: [], info: info, buttons: buttons, itemsBtn: itemsBtn };
  drawMap();
}

// One map on screen: a canvas you can drag (each map keeps its own position) and wheel-zoom.
function makeMapPanel() {
  var canvas = el("canvas", { "aria-label": "Map" });
  var empty = el("div", { class: "map-empty" });
  var title = el("div", { class: "map-panel-title" });
  var wrap = el("div", { class: "map-wrap" }, [canvas, empty]);
  var panel = { node: el("div", { class: "map-panel" }, [title, wrap]), canvas: canvas, wrap: wrap, empty: empty, title: title, which: "outside", scale: 1 };
  var drag = null;
  canvas.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ } });
  canvas.addEventListener("pointermove", function (e) {
    if (!drag) { return; }
    var pan = mapPans[panel.which];
    pan.x -= (e.clientX - drag.x) / panel.scale;
    pan.y -= (e.clientY - drag.y) / panel.scale;
    drag = { x: e.clientX, y: e.clientY };
    drawMap();
  });
  canvas.addEventListener("pointerup", function () { drag = null; });
  canvas.addEventListener("pointercancel", function () { drag = null; });
  canvas.addEventListener("wheel", function (e) {
    if (e.deltaY > 0 && mapZoom === 1) { return; } // fully zoomed out: let the page scroll
    e.preventDefault();
    zoomMap(e.deltaY < 0 ? 1.25 : 1 / 1.25);
  }, { passive: false });
  return panel;
}

function zoomMap(factor) {
  mapZoom = Math.min(12, Math.max(1, mapZoom * factor));
  if (mapZoom === 1) { resetMapPan(); }
  drawMap();
}

window.addEventListener("resize", function () { drawMap(); });

function drawMap() {
  if (!mapUi || activeTab !== "Map" || !document.body.contains(mapUi.box)) { return; }
  var g = (state && state.game) || {};
  var players = (state && state.players) || [];
  var me = players.filter(function (p) { return p.local; })[0];
  var maps = mapMode === "both" ? ["outside", "inside"] : [mapMode === "auto" ? (me && me.inside ? "inside" : "outside") : mapMode];
  Object.keys(mapUi.buttons).forEach(function (k) { mapUi.buttons[k].className = "btn small" + (k === mapMode ? " primary" : ""); });
  mapUi.itemsBtn.textContent = mapItems ? "Items: on" : "Items: off";
  mapUi.itemsBtn.className = "btn small" + (mapItems ? " primary" : "");

  // One canvas, or two side by side (stacked on a narrow screen).
  if (mapUi.panels.length !== maps.length) {
    mapUi.box.innerHTML = "";
    mapUi.panels = maps.map(function () { var p = makeMapPanel(); mapUi.box.appendChild(p.node); return p; });
  }
  mapUi.box.className = "map-panels" + (maps.length > 1 ? " both" : "");

  var problem = null;
  if (!g.inRound || g.inShipPhase || !g.landed) { problem = "Land on a moon to see the map."; }
  else if (!mapData) { problem = "Waiting for the map from the game (it's made a few seconds after landing)."; }
  else if (g.mapSeed !== undefined && mapData.seed !== g.mapSeed) { problem = "Waiting for this moon's map..."; }
  mapUi.info.textContent = problem ? "" : mapData.moon + (maps.length > 1 ? " | Outside and inside" : " | " + (maps[0] === "inside" ? "Inside the facility" : "Outside") + (mapMode === "auto" ? " (following you)" : ""));

  maps.forEach(function (which, i) {
    var panel = mapUi.panels[i];
    panel.which = which;
    panel.title.textContent = maps.length > 1 ? (which === "inside" ? "Inside" : "Outside") : "";
    panel.title.style.display = maps.length > 1 ? "" : "none";
    drawMapPanel(panel, which, problem, maps.length > 1);
  });
}

function drawMapPanel(panel, which, problem, both) {
  var g = (state && state.game) || {};
  var players = (state && state.players) || [];
  var enemies = liveEnemies();
  var me = players.filter(function (p) { return p.local; })[0];

  var cssW = panel.wrap.clientWidth || 300;
  var cssH = Math.round(Math.min(Math.max(window.innerHeight * (both ? 0.55 : 0.65), 260), cssW * 1.1));
  var dpr = window.devicePixelRatio || 1;
  var canvas = panel.canvas;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
  }
  var ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  var floor = problem ? null : floorImage(which);
  if (!problem && !floor) { problem = which === "inside" ? "This moon has no inside." : "No outside map for this moon."; }
  panel.empty.textContent = problem || "";
  panel.empty.style.display = problem ? "" : "none";
  if (problem) { return; }

  var grid = floor.grid;
  var scale = Math.min(cssW / grid.w, cssH / grid.h) * mapZoom;
  panel.scale = scale;
  function toGrid(pos) { return { x: (pos[0] - grid.x0) / grid.cell, y: grid.h - (pos[1] - grid.z0) / grid.cell }; }
  // Zoomed in on "Follow me": keep you in the middle. Otherwise the map stays where you zoomed/dragged it.
  var centre = { x: grid.w / 2, y: grid.h / 2 };
  if (mapMode === "auto" && mapZoom > 1 && me && me.pos && !me.dead && (me.inside ? "inside" : "outside") === which) { centre = toGrid(me.pos); }
  var pan = mapPans[which];
  var ox = cssW / 2 - (centre.x + pan.x) * scale;
  var oy = cssH / 2 - (centre.y + pan.y) * scale;
  function screen(pos) { var q = toGrid(pos); return { x: ox + q.x * scale, y: oy + q.y * scale }; }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(floor.canvas, ox, oy, grid.w * scale, grid.h * scale);

  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  function label(s, text, color, below) {
    var y = below ? s.y + 17 : s.y - 10;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(text, s.x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, s.x, y);
  }
  function dot(s, r, color) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#000";
    ctx.stroke();
  }
  var inside = which === "inside";
  (mapData.doors || []).filter(function (d) { return !!d.inside === inside; }).forEach(function (d) {
    var s = screen([d.x, d.z]);
    ctx.fillStyle = "#ff8c1a";
    ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
    label(s, d.main ? "Main entrance" : "Fire exit", "#ffb066", true);
  });
  if (!inside && g.ship) {
    var ship = screen(g.ship);
    ctx.fillStyle = "#e0b341";
    ctx.fillRect(ship.x - 10, ship.y - 6, 20, 12);
    label(ship, "Ship", "#e0b341", true);
  }
  if (mapItems) {
    // Small purple diamonds; names (and value) once zoomed in enough to read them.
    ((state && state.items) || []).filter(function (it) { return it.p && !!it.i === inside; }).forEach(function (it) {
      var s = screen(it.p);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x + 4, s.y); ctx.lineTo(s.x, s.y + 4); ctx.lineTo(s.x - 4, s.y);
      ctx.closePath();
      ctx.fillStyle = "#c792ea";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000";
      ctx.stroke();
      if (mapZoom >= 2.5) { label(s, it.n + (it.v ? " ($" + it.v + ")" : ""), "#dcc2f2", true); }
    });
  }
  enemies.filter(function (e) { return e.pos && !!e.inside === inside; }).forEach(function (e) {
    var s = screen(e.pos);
    dot(s, 5, "#e5534b");
    label(s, e.name, "#f2a19c");
  });
  // Players last so they sit on top; you on top of everyone.
  players.filter(function (p) { return p.pos && !!p.inside === inside; }).sort(function (a, b) { return (a.local ? 1 : 0) - (b.local ? 1 : 0); }).forEach(function (p) {
    var s = screen(p.pos);
    if (p.dead) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#8a8a8a";
      ctx.beginPath();
      ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5);
      ctx.moveTo(s.x + 5, s.y - 5); ctx.lineTo(s.x - 5, s.y + 5);
      ctx.stroke();
      label(s, p.name + " (dead)", "#aaaaaa");
    } else {
      dot(s, p.local ? 7 : 6, p.local ? "#3cb371" : "#4a90d9");
      label(s, p.name, p.local ? "#7be0a5" : "#9cc7f2");
    }
  });
}

// ---------- demo mode ----------
if (DEMO) {
  import("./demo.js").then(function (m) {
    show("view-app");
    deviceIndex = { demo: { name: "Demo PC" } };
    // index.html?demo&offline shows the demo PC as offline (what the panel looks like when the game is closed).
    var demoOffline = /[?&]offline\b/.test(location.search);
    deviceInfo = { demo: { name: "Demo PC", online: !demoOffline, lastSeen: Date.now() - (demoOffline ? 600000 : 0), version: m.demo.catalog.version } };
    $("account-name").textContent = "demo_user";
    serverOffset = 0;
    currentDev = "demo";
    catalog = m.demo.catalog;
    state = m.demo.state;
    mapData = m.demo.map || null;
    renderDeviceSelect();
    renderTabs();
    buildContent();
    refreshOnline();
    setInterval(function () { if (!demoOffline) { deviceInfo.demo.lastSeen = Date.now(); } }, 5000);
    // Like the real thing: enemies move, so their distances change twice a second.
    setInterval(function () {
      (state.enemies || []).forEach(function (e) {
        e.distance = Math.max(1, e.distance + (Math.random() < 0.5 ? -1 : 1));
        if (e.pos) { e.pos = [e.pos[0] + (Math.random() - 0.5) * 2, e.pos[1] + (Math.random() - 0.5) * 2]; }
      });
      applyState();
      renderDeviceSelect();
    }, 500);
  });
}
