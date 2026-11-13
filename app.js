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
var TAB_ORDER = ["Visuals", "Troll", "Self", "Players", "Enemies", "Server", "Other", "Settings"];
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
var search = "";
var ui = freshUi();
var pendingToggles = {};

function freshUi() {
  return { toggles: {}, rows: {}, sliders: {}, playerSelects: [], enemySelects: [], settings: {}, playersBox: null, enemiesBox: null, sigPlayers: "", sigEnemies: "" };
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
  select.innerHTML = "";
  var ids = Object.keys(deviceIndex).sort(function (a, b) { return byText(deviceLabel(a), deviceLabel(b)); });
  ids.forEach(function (id) {
    select.appendChild(el("option", { value: id, text: deviceLabel(id), selected: id === currentDev }));
  });
  if (!ids.length) { select.appendChild(el("option", { value: "", text: "No PCs yet" })); }
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
  if (code.length !== 6) { $("pair-error").textContent = "The code is 6 characters, shown in the in-game menu."; return; }
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
  catalog = null;
  state = null;
  lastResultSeen = undefined;
  pendingToggles = {};
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
    return {
      key: key, name: h.name || key, category: h.category || "Other", group: h.group || h.category || "Other",
      toggle: !!h.toggle, action: !!h.action, args: h.args || [], slider: h.slider || null
    };
  }).sort(function (a, b) { return byText(a.name, b.name); });
}

function matchesSearch(text) { return !search || text.toLowerCase().indexOf(search) >= 0; }

function settingEntries() {
  var settings = (catalog && catalog.settings) || {};
  return Object.keys(settings).map(function (key) {
    return { key: key, name: settings[key].name || key, type: settings[key].type };
  }).filter(function (s) { return matchesSearch(s.name); }).sort(function (a, b) { return byText(a.name, b.name); });
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
    argsBox.appendChild(el("button", {
      class: "btn primary small run",
      type: "button",
      text: h.toggle ? "Start" : "Run",
      onclick: function () {
        var values = [];
        for (var i = 0; i < getters.length; i++) {
          var value = getters[i]();
          if (value === undefined) { toast((h.args[i].kind === "enemy" || h.args[i].kind === "player" ? "Pick " : "Fill in ") + argName(h.args[i]).toLowerCase(), "fail"); return; }
          values.push(value);
        }
        send({ type: "run", hack: h.key, args: values });
      }
    }));
    row.appendChild(argsBox);
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

  Object.keys(ui.sliders).forEach(function (key) {
    var sl = ui.sliders[key];
    // Don't jump the slider back while it is being dragged or the new value is on its way.
    if (settings[key] === undefined || document.activeElement === sl.input || sl.until > now) { return; }
    sl.input.value = settings[key];
    sl.label.textContent = sl.shown(settings[key]);
  });

  var players = state.players || [];
  var enemies = (state.enemies || []).filter(function (e) { return !e.dead; });
  var sigP = JSON.stringify([players, state.targets || null]);
  var sigE = JSON.stringify(enemies.map(function (e) { return [e.id, e.name, e.distance]; }));
  if (force || sigP !== ui.sigPlayers) {
    ui.sigPlayers = sigP;
    fillSelects(ui.playerSelects, players.map(function (p) {
      return { value: p.id, text: p.name + (p.local ? " (you)" : "") + (p.dead ? " (dead)" : "") };
    }), "No players (join a lobby first)");
    renderPlayers(players);
  }
  if (force || sigE !== ui.sigEnemies) {
    ui.sigEnemies = sigE;
    fillSelects(ui.enemySelects, enemies.map(function (e) {
      return { value: e.id, text: e.name + " (" + e.distance + "m" + (e.inside ? ", inside" : "") + ")" };
    }), "No living enemies right now");
    renderEnemies(enemies);
  }
}

function fillSelects(selects, options, emptyText) {
  selects.forEach(function (select) {
    var previous = select.value;
    select.innerHTML = "";
    if (!options.length) { select.appendChild(el("option", { value: "", text: emptyText })); return; }
    options.slice().sort(function (a, b) { return byText(a.text, b.text); }).forEach(function (o) { select.appendChild(el("option", { value: String(o.value), text: o.text })); });
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

// Camera-style hacks that only make sense on other players (same rule as the in-game menu).
var NOT_ON_SELF = { SpectatePlayer: true, MiniCam: true };

function targetsOf() {
  var t = (state && state.targets) || {};
  return { spectating: t.spectating === undefined ? -1 : t.spectating, miniCam: t.miniCam === undefined ? -1 : t.miniCam, demiGod: t.demiGod || [], controlling: t.controlling || null,
    controlTarget: t.controlTarget === undefined ? -1 : t.controlTarget, aiDriving: !!t.aiDriving, hunts: t.hunts || [] };
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
    pick.appendChild(el("option", { value: "-1", text: "Target: nearest player" }));
    players.filter(function (p) { return !p.local && !p.dead; }).sort(function (a, b) { return byText(a.name, b.name); }).forEach(function (p) {
      pick.appendChild(el("option", { value: String(p.id), text: "Target: " + p.name, selected: p.clientId === targets.controlTarget }));
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
    stop("Stop " + h.enemyName + " walking to " + h.player, { type: "stopHunt", enemy: h.enemy });
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
  function enemyLabel(h) { return h.name.replace(/\s*Enemy\s*/g, " ").trim() || h.name; }
  var actions = hackEntries().filter(function (h) { return isSingleArg(h, "enemy"); })
    .sort(function (a, b) { return byText(enemyLabel(a), enemyLabel(b)); });
  // A-Z by name; several of the same kind are listed nearest first.
  enemies.slice().sort(function (a, b) { return byText(a.name, b.name) || a.distance - b.distance; }).forEach(function (e) {
    var buttons = actions.map(function (h) {
      return el("button", {
        class: "btn small", type: "button", text: enemyLabel(h),
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
    $("account-name").textContent = "demo_user";
    serverOffset = 0;
    currentDev = "demo";
    catalog = m.demo.catalog;
    state = m.demo.state;
    renderDeviceSelect();
    renderTabs();
    buildContent();
    refreshOnline();
    setInterval(function () { deviceInfo.demo.lastSeen = Date.now(); }, 5000);
  });
}
