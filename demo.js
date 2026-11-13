// Sample data for index.html?demo (the real list comes from the game).
function t(name, category) { return { name: name, category: category, toggle: true, action: false, args: [] }; }
function a(name, category, args) { return { name: name, category: category, toggle: false, action: true, args: args || [] }; }
function ta(name, category, args) { return { name: name, category: category, toggle: true, action: true, args: args }; }
var player = { name: "Player", kind: "player" };
var enemy = { name: "E", kind: "enemy" };

export var demo = {
  catalog: {
    version: "v1.4.7",
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
    targets: { spectating: -1, miniCam: 1, demiGod: [1], controlling: "Hoarding bug", controlTarget: 1, aiDriving: false },
    settings: { f_movementSpeed: 4.6, f_jumpForce: 15.2, f_fov: 90, i_menuFontSize: 14, b_FPSCounter: false, b_NoFog: true },
    game: { inRound: true, landed: true, inShipPhase: false, moon: "41 Experimentation", isHost: true, credits: 360, quota: 130, fulfilled: 84, daysLeft: 2, localName: "You", alive: true, health: 100, position: [12.5, -219.3, 64.1] },
    players: [
      { id: 0, clientId: 0, name: "You", dead: false, health: 100, local: true, inside: true },
      { id: 1, clientId: 1, name: "Friend", dead: false, health: 45, local: false, inside: true },
      { id: 2, clientId: 2, name: "Other", dead: true, health: 0, local: false, inside: false }
    ],
    enemies: [
      { id: 101, name: "Hoarding bug", dead: false, inside: true, distance: 14 },
      { id: 102, name: "Bracken", dead: false, inside: true, distance: 38 },
      { id: 103, name: "Eyeless dog", dead: false, inside: false, distance: 120 }
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
  args: [{ name: "Enemy", kind: "enum", options: ["Blob", "Flowerman", "Hoarding bug", "Jester", "Masked", "Thumper"] }, { name: "Amount", kind: "number", integer: true, optional: true, hint: "1" }, { name: "Outside", kind: "bool" }] };
demo.catalog.hacks.X_KillEnemy = { name: "Kill Enemy", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }] };
demo.catalog.hacks.X_StunEnemy = { name: "Stun Enemy", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }] };
demo.catalog.hacks.X_StealItems = { name: "Steal Items Enemy", category: "Enemies", group: "Enemies", only: "Hoarding bug", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }] };
demo.catalog.hacks.X_SpawnItem = { name: "Spawn Item (host)", category: "Server", group: "Spawning (host)", toggle: false, action: true,
  args: [{ name: "Item", kind: "enum", options: [] }, { name: "Amount", kind: "number", integer: true, optional: true, hint: "1" }, { name: "Scrap Value", kind: "number", integer: true, optional: true, hint: "random" }] };
demo.catalog.hacks.AggroHunt = { name: "Aggro Hunt", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
demo.catalog.hacks.PersistentHunt = { name: "Persistent Hunt", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
demo.catalog.settings.b_StealthMode = { name: "Stealth Mode", type: "bool" };
demo.state.settings.b_StealthMode = false;
// Monster types, so monster-specific buttons can be matched (the real game sends these).
(demo.state.enemies || []).forEach(function (e) {
  e.type = e.name === "Hoarding bug" ? "HoarderBugAI" : e.name === "Eyeless dog" ? "MouthDogAI" : e.name === "Bracken" ? "FlowermanAI" : "EnemyAI";
});
demo.catalog.hacks.X_StealItems.only = "HoarderBugAI";
demo.catalog.hacks.AggroHunt.only = "MouthDogAI";
demo.catalog.hacks.X_TargetPlayer = { name: "Target Player (anger at)", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
demo.catalog.hacks.X_KillPlayerWithEnemy = { name: "Kill Player With Enemy", category: "Enemies", group: "Enemies", toggle: false, action: true, args: [{ name: "Enemy", kind: "enemy" }, { name: "Player", kind: "player" }] };
