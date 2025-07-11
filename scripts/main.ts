import {
  world,
  system,
  Player,
  ItemStack,
  Entity,
  ItemStack as MinecraftItemStack,
  EquipmentSlot,
} from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const LOBBY_POS = { x: 0, y: -60, z: 0 };
const teleportedPlayers = new Set<string>();
let ownerName: string | null = null;
let selectedMapIndex = 0;
let selectedHunters = 1;
let gameStarted = false;

const maps = [
  { name: "Astralis Forest", pos: { x: 100, y: -60, z: 100 } },
  { name: "Urban Market", pos: { x: 300, y: -60, z: 200 } },
  { name: "Kazakh Village", pos: { x: 500, y: -60, z: 300 } },
];

const hiderData = new Map<string, { hearts: number; cooldown: number; propEntity?: Entity; blockId?: string }>();

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (!teleportedPlayers.has(player.name)) {
      teleportedPlayers.add(player.name);
      if (!ownerName) {
        ownerName = player.name;
        world.sendMessage(`[Server] ${ownerName} is set as the world owner.`);
      }
      try {
        player.teleport(LOBBY_POS);
        player.onScreenDisplay.setTitle("§l§6Prop Hunt: §bAstralis", {
          fadeInDuration: 1,
          stayDuration: 80,
          fadeOutDuration: 20,
        });
        if (player.name === ownerName) {
          giveAdminCompass(player);
        }
      } catch (e) {
        console.error("[Error] " + e);
      }
    }
  }
}, 20);

world.beforeEvents.itemUse.subscribe((event) => {
  const item = event.itemStack;
  const player = event.source;
  if (item?.typeId === "minecraft:compass" && item.nameTag === "Admin Compass" && player.name === ownerName) {
    system.run(() => {
      const form = new ActionFormData();
      form.title("Prop Hunt Setup");
      form.body("Choose an action:");
      form.button(`Map: ${maps[selectedMapIndex].name}`);
      form.button(`Hunters: ${selectedHunters}`);
      form.button("Start Game");
      form.show(player).then((response) => {
        if (response.canceled || response.selection === undefined) return;
        const selection = response.selection;
        if (selection === 0) showMapSelector(player);
        else if (selection === 1) showHunterSelector(player);
        else if (selection === 2) startGame();
      });
    });
  }
});

function giveAdminCompass(player: Player) {
  const inventory = player.getComponent("inventory")?.container;
  if (!inventory) return;
  const alreadyHas = Array.from({ length: inventory.size }, (_, i) => inventory.getItem(i)).filter(
    (item) => item?.typeId === "minecraft:compass" && item?.nameTag === "Admin Compass"
  );
  if (alreadyHas.length === 0) {
    const compass = new ItemStack("minecraft:compass", 1);
    compass.nameTag = "Admin Compass";
    inventory.addItem(compass);
    player.sendMessage("[Server] Admin compass given.");
  }
}

function showMapSelector(player: Player) {
  system.run(() => {
    const form = new ActionFormData();
    form.title("Select Map");
    form.body("Choose a map:");
    maps.forEach((m) => form.button(m.name));
    form.show(player).then((response) => {
      if (response.canceled || response.selection === undefined) return;
      selectedMapIndex = response.selection;
      player.sendMessage(`[Server] Map selected: ${maps[selectedMapIndex].name}`);
    });
  });
}

function showHunterSelector(player: Player) {
  system.run(() => {
    const form = new ActionFormData();
    form.title("Select Hunters");
    form.body("How many hunters?");
    form.button("1");
    form.button("2");
    form.button("3");
    form.show(player).then((response) => {
      if (response.canceled || response.selection === undefined) return;
      selectedHunters = response.selection + 1;
      player.sendMessage(`[Server] Hunters selected: ${selectedHunters}`);
    });
  });
}

function startGame() {
  gameStarted = true;
  const map = maps[selectedMapIndex];
  const players = [...world.getPlayers()];
  const shuffled = players.sort(() => Math.random() - 0.5);

  let hunters: Player[] = [];
  let hiders: Player[] = [];

  for (const p of shuffled) {
    if (p.name === ownerName) hiders.push(p);
    else if (hunters.length < selectedHunters) hunters.push(p);
    else hiders.push(p);
  }

  for (const player of hunters) {
    player.teleport(map.pos);
    player.runCommand("gamemode survival");
    player.onScreenDisplay.setTitle("§l§cRole: HUNTER", { fadeInDuration: 1, stayDuration: 60, fadeOutDuration: 20 });
  }

  for (const player of hiders) {
    player.teleport(map.pos);
    player.runCommand("gamemode adventure");
    player.runCommand("effect @s invisibility 99999 1 true");
    player.addTag("hider");
    hiderData.set(player.name, { hearts: 3, cooldown: 0 });
    player.onScreenDisplay.setTitle("§l§aRole: HIDER", { fadeInDuration: 1, stayDuration: 60, fadeOutDuration: 20 });
  }

  world.sendMessage("The game has started. Good luck!");
}

world.afterEvents.entityHitBlock.subscribe((ev) => {
  const player = ev.damagingEntity;
  const block = ev.hitBlockPermutation;
  if (!(player instanceof Player) || !player.hasTag("hider") || !gameStarted) return;

  const data = hiderData.get(player.name);
  if (!data || data.cooldown > 0) {
    player.sendMessage(`§eCooldown: ${data?.cooldown ?? 0}s`);
    return;
  }

  data.cooldown = 30;

  if (data.propEntity?.isValid) data.propEntity.kill();

  player.runCommand("effect @s invisibility 99999 1 true");

  const stand = world.getDimension("overworld").spawnEntity("minecraft:armor_stand", player.location);
  stand.addTag("block");
  stand.runCommand("effect @s invisibility 99999 1 true");

  // Надеваем блок на голову
  const blockItem = new MinecraftItemStack(block.type.id, 1);
  const equip = stand.getComponent("equippable");
  equip?.setEquipment(EquipmentSlot.Head, blockItem);

  data.propEntity = stand;
  data.blockId = block.type.id;

  player.sendMessage(`§aNow disguised as ${block.type.id}`);
});

system.runInterval(() => {
  for (const [name, info] of hiderData) {
    if (info.cooldown > 0) info.cooldown--;
    const player = world.getPlayers().find((p) => p.name === name);
    if (player && info.propEntity?.isValid) {
      const { x, y, z } = player.location;
      info.propEntity.teleport({ x, y: y - 1.4, z });
    }
  }
}, 2);

world.beforeEvents.playerLeave.subscribe((ev) => {
  const data = hiderData.get(ev.player.name);
  if (data?.propEntity?.isValid) {
    data.propEntity.kill();
  }
  hiderData.delete(ev.player.name);
});
