// Sample data for index.html?demo (the real list comes from the game).
function t(name, category) { return { name: name, category: category, toggle: true, action: false, args: [] }; }
function a(name, category, args) { return { name: name, category: category, toggle: false, action: true, args: args || [] }; }
function ta(name, category, args) { return { name: name, category: category, toggle: true, action: true, args: args }; }
var player = { name: "Player", kind: "player" };
var enemy = { name: "E", kind: "enemy" };

export var demo = {
  catalog: {
    version: "v1.0.0",
    hacks: {
      GodMode: t("God Mode", "Self"), GhostMode: t("Ghost Mode", "Self"), SuperJump: t("Super Jump", "Self"),
      SuperSpeed: t("Super Speed", "Self"), NoClip: t("No Clip", "Self"), UnlimitedStamina: t("Unlimited Stamina", "Self"),
      NightVision: t("Night Vision", "Visuals"), FreeCam: t("Free Cam", "Self"), DropAllItems: a("Drop All Items", "Self"),
      TeleportShip: a("Teleport Ship", "Self"), SellQuota: a("Sell Quota", "Self"),
      Teleport: a("Teleport", "Self", [{ name: "Pos", kind: "vector3" }, { name: "Elevator", kind: "bool" }, { name: "Ship", kind: "bool" }, { name: "Factory", kind: "bool" }]),
      Experience: a("Experience", "Self", [{ name: "Amount", kind: "number", integer: true }, { name: "Type", kind: "enum", options: ["Add", "Remove", "Set"] }]),
      KillPlayer: a("Kill Player", "Players", [player]), HealPlayer: a("Heal Player", "Players", [player]),
      LightningStrikePlayer: a("Lightning Strike Player", "Players", [player]), SpiderWebPlayer: a("Spider Web Player", "Players", [player]),
      SpectatePlayer: ta("Spectate Player", "Players", [player]), MiniCam: ta("Mini Cam", "Players", [player]),
      DemiGod: ta("Demi God", "Players", [player]), DeathNotifications: t("Death Notifications", "Players"),
      TeleportAllEnemies: a("Teleport All Enemies", "Players", [player, { name: "Enemies", kind: "allEnemies" }]),
      EnemyControl: ta("Enemy Control", "Enemies", [enemy]), KillAllEnemies: a("Kill All Enemies", "Enemies"),
      StunAllEnemies: a("Stun All Enemies", "Enemies"), KillNearbyEnemies: a("Kill Nearby Enemies", "Enemies", [{ name: "Distance", kind: "number", integer: true }]),
      TeleportEnemy: a("Teleport Enemy", "Enemies", [player, enemy]),
      PlayerESP: t("Player ESP", "Visuals"), EnemyESP: t("Enemy ESP", "Visuals"), ObjectESP: t("Object ESP", "Visuals"), FOV: t("FOV", "Visuals"), NoVisor: t("No Visor", "Visuals"),
      ModifyCredits: a("Modify Credits", "Server", [{ name: "Amount", kind: "number", integer: true }, { name: "Type", kind: "enum", options: ["Add", "Remove", "Set"] }]),
      Message: a("Message", "Server", [{ name: "Msg", kind: "text" }, { name: "Type", kind: "number", integer: true }, { name: "Id", kind: "number", integer: true }]),
      StartGame: a("Start Game", "Server"), EndGame: a("End Game", "Server"), Shoplifter: t("Shoplifter", "Server"),
      ToggleShipLights: a("Toggle Ship Lights", "Troll"), ToggleShipHorn: a("Toggle Ship Horn", "Troll"), PJSpammer: t("PJ Spammer", "Troll"), BerserkAllTurrets: a("Berserk All Turrets", "Troll")
    },
    settings: {
      f_movementSpeed: { name: "Movement Speed", type: "float" }, f_jumpForce: { name: "Jump Force", type: "float" },
      f_fov: { name: "Fov", type: "float" }, i_menuFontSize: { name: "Menu Font Size", type: "int" },
      b_FPSCounter: { name: "FPS Counter", type: "bool" }, b_NoFog: { name: "No Fog", type: "bool" }
    }
  },
  state: {
    menuOpen: false,
    toggles: { GodMode: true, NightVision: true, PlayerESP: true, EnemyESP: true, SpectatePlayer: false, MiniCam: true, DemiGod: true },
    targets: { spectating: -1, miniCam: 1, demiGod: [1], controlling: "Loot Bug", controlTarget: 1, aiDriving: false },
    settings: { f_movementSpeed: 4.6, f_jumpForce: 15.2, f_fov: 90, i_menuFontSize: 14, b_FPSCounter: false, b_NoFog: true },
    game: { inRound: true, landed: true, inShipPhase: false, moon: "41 Experimentation", isHost: true, credits: 360, quota: 130, fulfilled: 84, daysLeft: 2, localName: "You", alive: true, health: 100, position: [12.5, -219.3, 64.1] },
    players: [
      { id: 0, clientId: 0, name: "You", dead: false, health: 100, local: true, inside: true },
      { id: 1, clientId: 1, name: "Friend", dead: false, health: 45, local: false, inside: true },
      { id: 2, clientId: 2, name: "Other", dead: true, health: 0, local: false, inside: false }
    ],
    enemies: [
      { id: 101, name: "Loot Bug", dead: false, inside: true, distance: 14 },
      { id: 102, name: "Bracken", dead: false, inside: true, distance: 38 },
      { id: 103, name: "Eyeless Dog", dead: false, inside: false, distance: 120 }
    ]
  }
};

// Sample sections (the real ones come from the game, matching the in-game menu).
var sampleGroups = {
  GodMode: "Survival", GhostMode: "Survival",
  SuperJump: "Movement", SuperSpeed: "Movement", NoClip: "Movement", UnlimitedStamina: "Movement", FreeCam: "Movement", Teleport: "Movement", TeleportShip: "Movement",
  DropAllItems: "Items & Inventory", SellQuota: "Items & Inventory", Experience: "Items & Inventory",
  PlayerESP: "People & Creatures", EnemyESP: "People & Creatures", ObjectESP: "Loot", FOV: "Camera & Screen", NoVisor: "Camera & Screen", NightVision: "Camera & Screen"
};
var sampleOrder = 0;
Object.keys(sampleGroups).forEach(function (key) {
  var h = demo.catalog.hacks[key];
  if (h) { h.group = sampleGroups[key]; h.order = sampleOrder++; }
});

// Sample sliders (the real ones come from the game).
demo.catalog.hacks.FOV.slider = { setting: "f_fov", min: 10, max: 180, step: 1 };
demo.catalog.hacks.SuperSpeed.slider = { setting: "f_movementSpeed", min: 4.6, max: 24.6, step: 0.5 };
demo.catalog.hacks.SuperJump.slider = { setting: "f_jumpForce", min: 13, max: 213, step: 0.5 };
demo.state.toggles.FOV = true;
demo.state.toggles.SuperSpeed = true;

// Sample hunt (Hunt Player in the Enemies tab).
demo.catalog.hacks.HuntPlayer = { name: "Hunt Player", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
demo.catalog.hacks.StopAllHunts = { name: "Stop All Hunts", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [] };
demo.state.targets = demo.state.targets || {};
demo.state.targets.hunts = [{ enemy: 1, enemyName: "Bracken", player: "Friend" }];
if (demo.catalog.hacks.KillNearbyEnemies) { demo.catalog.hacks.KillNearbyEnemies.slider = { setting: "f_enemyKillDistance", min: 5, max: 50, step: 1 }; }
demo.state.settings.f_enemyKillDistance = 15;

// Sample in-game tools (the real lists come from the game once a lobby is loaded).
demo.catalog.hacks.X_SpawnEnemy = { name: "Spawn Enemy (host)", category: "Enemies", group: "Enemy spawner", toggle: false, action: true,
  args: [{ name: "Enemy", kind: "enum", options: ["Bracken", "Loot Bug", "Hygrodere", "Jester", "Masked", "Thumper"] }, { name: "Amount", kind: "number", integer: true, optional: true, hint: "1" }, { name: "Outside", kind: "bool" }] };
demo.catalog.hacks.X_KillEnemy = { name: "Kill Enemy", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }] };
demo.catalog.hacks.X_StunEnemy = { name: "Stun Enemy", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }] };
demo.catalog.hacks.X_StealItems = { name: "Steal Items Enemy", category: "Enemies", group: "Enemies", only: "HoarderBugAI", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }] };
demo.catalog.hacks.X_SpawnItem = { name: "Spawn Item (host)", category: "Server", group: "Spawning (host)", toggle: false, action: true,
  args: [{ name: "Item", kind: "enum", options: [] }, { name: "Amount", kind: "number", integer: true, optional: true, hint: "1" }, { name: "Scrap Value", kind: "number", integer: true, optional: true, hint: "random" }] };
demo.catalog.hacks.AggroHunt = { name: "Aggro Hunt", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
demo.catalog.hacks.PersistentHunt = { name: "Persistent Hunt", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
demo.catalog.settings.b_StealthMode = { name: "Stealth Mode", type: "bool" };
demo.state.settings.b_StealthMode = false;
// Monster types, so monster-specific buttons can be matched (the real game sends these).
(demo.state.enemies || []).forEach(function (e) {
  e.type = e.name === "Loot Bug" ? "HoarderBugAI" : e.name === "Eyeless Dog" ? "MouthDogAI" : e.name === "Bracken" ? "FlowermanAI" : "EnemyAI";
});
demo.catalog.hacks.X_StealItems.only = "HoarderBugAI";
demo.catalog.hacks.AggroHunt.only = "MouthDogAI";
// The real Troll / Players / Server sections (same sizes as the game sends), to check the layout.
var realSections = [
  ["Troll", "Monsters", "Force Tentacle Attack,Spawn Loot Bug Infestation,Spawn Masked Enemy", ""],
  ["Troll", "Ship & Facility", "Eject Everyone,Open Ship Door Space,Toggle Factory Lights,Toggle Mineshaft Elevator,Toggle Ship Lights", "Open Ship Door Space"],
  ["Troll", "Shotguns", "Shoot All Shotguns,Spam Shoot All Shotguns", "Spam Shoot All Shotguns"],
  ["Troll", "Sounds", "PJ Spammer,Slide Taunt,Toggle Car Horn,Toggle Deposit Desk Door Sound,Toggle Ship Horn,Toggle Terminal Sound", "*"],
  ["Troll", "Traps & Explosives", "Berserk All Turrets,Blow Up All Landmines,Explode All Jetpacks,Explode Cruiser,Explode Jetpacks On Grab,Force Bridge Fall,Force Small Bridge Fall,Toggle All Landmines,Toggle All Turrets,Toggle Vehicle Magnet", "Berserk All Turrets,Explode Jetpacks On Grab,Toggle All Landmines,Toggle All Turrets"],
  ["Players", "Player actions", "Kill Everyone,Kill Everyone Else", ""],
  ["Server", "Info display", "Display Bodies,Display Credits,Display Deadline,Display Enemies,Display Map Objects,Display Quota,Display Ship Objects,Toggle All Displays", "*Toggle All Displays"],
  ["Server", "Lobby", "Disconnect,Show Offensive Lobby Names", "Show Offensive Lobby Names"],
  ["Server", "Round", "Clear Meteor Shower,End Game,Force Meteor Shower,Reset Ship,Start Game", ""],
  ["Server", "Spawning (host)", "Spawn Landmine,Spawn More Scrap,Spawn Spike Roof Trap,Spawn Turret", ""],
  ["Server", "Unlocks", "Unlock All Ship Items,Unlock All Suits", ""]
];
realSections.forEach(function (s) {
  s[2].split(",").forEach(function (name) {
    var key = name.replace(/[^A-Za-z]/g, "");
    var isToggle = s[3] === "*" || (s[3].charAt(0) === "*" ? name !== s[3].substring(1) : s[3].split(",").indexOf(name) >= 0);
    demo.catalog.hacks[key] = { name: name, category: s[0], group: s[1], toggle: isToggle, action: !isToggle, args: [] };
  });
});
["DeathNotifications", "DemiGod", "MiniCam", "SpectatePlayer", "TeleportAllEnemies"].forEach(function (k) { demo.catalog.hacks[k].group = "Player actions"; });
["StartGame", "EndGame"].forEach(function (k) { demo.catalog.hacks[k].group = "Round"; });
demo.catalog.hacks.ModifyCredits.group = "Money & Quota"; demo.catalog.hacks.Shoplifter.group = "Money & Quota"; demo.catalog.hacks.Message.group = "Chat";
["ToggleShipLights", "ToggleShipHorn", "PJSpammer", "BerserkAllTurrets"].forEach(function (k) { demo.catalog.hacks[k].group = demo.catalog.hacks[k].group || "Sounds"; });

// Hunt With All: every monster walks to the chosen player.
demo.catalog.hacks.HuntWithAll = { name: "Hunt With All", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Player", kind: "player" }] };

// Sample map (the real one is drawn by the game from its walkable floor).
function encode(cells) {
  var out = "";
  var run = cells[0];
  var count = 0;
  for (var i = 0; i < cells.length; i++) {
    if (cells[i] === run) { count++; continue; }
    out += String.fromCharCode(97 + run) + count;
    run = cells[i];
    count = 1;
  }
  return out + String.fromCharCode(97 + run) + count;
}
function grid(x0, z0, cell, w, h, paint) {
  var cells = new Array(w * h).fill(0);
  paint(function (ax, az, bx, bz, v) {
    for (var z = az; z < bz; z++) { for (var x = ax; x < bx; x++) { if (x >= 0 && z >= 0 && x < w && z < h) { cells[z * w + x] = v; } } }
  }, cells, w, h);
  return { x0: x0, z0: z0, cell: cell, w: w, h: h, data: encode(cells) };
}
demo.map = {
  moon: "41 Experimentation", seed: 1234,
  inside: grid(-100, -80, 1.5, 140, 110, function (rect) {
    rect(10, 10, 40, 30, 2); rect(40, 18, 70, 22, 2); rect(70, 8, 95, 40, 2); rect(80, 40, 84, 70, 1); rect(60, 70, 110, 95, 1);
    rect(20, 30, 24, 75, 2); rect(10, 75, 50, 100, 3); rect(50, 85, 60, 89, 3); rect(110, 80, 130, 84, 1); rect(118, 50, 136, 80, 4);
  }),
  outside: grid(-250, -200, 2.5, 200, 170, function (rect, cells, w, h) {
    for (var z = 0; z < h; z++) {
      for (var x = 0; x < w; x++) {
        var dx = (x - 100) / 90;
        var dz = (z - 85) / 75;
        var r = 1 + 0.18 * Math.sin(x / 9) + 0.15 * Math.cos(z / 7);
        if (dx * dx + dz * dz < r * 0.8) { cells[z * w + x] = 1 + Math.min(3, Math.floor(((Math.sin(x / 20) + Math.cos(z / 25)) + 2) * 1.0)); }
      }
    }
    rect(60, 60, 75, 66, 0); rect(120, 100, 128, 130, 0);
  }),
  doors: [
    { x: -40, z: 20, inside: false, main: true }, { x: 60, z: -70, inside: false, main: false },
    { x: -82, z: -62, inside: true, main: true }, { x: 95, z: 40, inside: true, main: false }
  ]
};
demo.state.game.mapSeed = 1234;
demo.state.game.ship = [10, -20];
demo.state.players[0].pos = [-60, -40]; demo.state.players[0].item = "Shovel";
demo.state.players[1].pos = [-10, -48]; demo.state.players[1].item = "Flashlight";
demo.state.players[2].pos = [30, -10];
demo.state.enemies[0].pos = [-55, -28];
demo.state.enemies[1].pos = [20, 50];
demo.state.enemies[2].pos = [-120, 60];
demo.state.enemies.push({ id: 104, name: "Roaming Locusts", type: "DocileLocustBeesAI", dead: false, inside: false, distance: 67, pos: [-90, 30] });
demo.state.items = [
  { n: "Large axle", v: 52, i: true, p: [-70, -35] }, { n: "Gold bar", v: 160, i: true, p: [40, 10] },
  { n: "Brass bell", v: 63, i: true, p: [-20, -60] }, { n: "Whoopie cushion", v: 9, i: false, p: [-30, 25] },
  { n: "Cash register", v: 120, i: true, p: [41, 11] }, { n: "Toy robot", v: 70, i: true, p: [42, 9] },
  { n: "Shovel", v: 0, i: true, p: [-68, -33] }, { n: "Magnifying glass", v: 44, i: false, p: [-29, 27] }
];

demo.catalog.hacks.X_TargetPlayer ={ name: "Target Player (anger at)", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
demo.catalog.hacks.X_KillPlayerWithEnemy = { name: "Kill Player With Enemy", category: "Enemies", group: "Enemies", toggle: false, action: true, not: ["DocileLocustBeesAI", "DoublewingAI", "FlowerSnakeEnemy", "DressGirlAI"], args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
