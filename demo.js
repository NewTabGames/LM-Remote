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
