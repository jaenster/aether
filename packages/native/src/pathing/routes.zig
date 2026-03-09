pub const Target = union(enum) {
    exit: u32, // target level number
    preset: u32, // preset object ID
    coord: struct { x: u16, y: u16 },
};

pub const RouteStep = struct {
    level: u32,
    target: Target,
};

pub const Route = struct {
    name: [*:0]const u16,
    steps: []const RouteStep,
};

// Level numbers (1.14d)
const LVL = struct {
    const ROGUE_ENCAMPMENT = 1;
    const BLOOD_MOOR = 2;
    const DEN_OF_EVIL = 8;
    const DARK_WOOD = 6;
    const TOWER_CELLAR_5 = 20;
    const CATACOMBS_4 = 37;
    const LUT_GHOLEIN = 40;
    const ARCANE_SANCTUARY = 74;
    const KURAST_DOCKS = 75;
    const DURANCE_3 = 102;
    const PANDEMONIUM_FORTRESS = 103;
    const RIVER_OF_FLAMES = 107;
    const CHAOS_SANCTUARY = 108;
    const HARROGATH = 109;
    const FRIGID_HIGHLANDS = 111;
    const NIHLATHAKS_TEMPLE = 122;
    const WORLDSTONE_KEEP_1 = 128;
    const WORLDSTONE_KEEP_2 = 129;
    const WORLDSTONE_KEEP_3 = 130;
    const THRONE_OF_DESTRUCTION = 131;
    const TOWER_CELLAR_1 = 16;
    const TOWER_CELLAR_2 = 17;
    const TOWER_CELLAR_3 = 18;
    const TOWER_CELLAR_4 = 19;
    const FORGOTTEN_TOWER = 20;
    const BLACK_MARSH = 9;
    const OUTER_CLOISTER = 28;
};

// Chaos Sanctuary run: from River of Flames through seals
const chaos_steps = [_]RouteStep{
    .{ .level = LVL.RIVER_OF_FLAMES, .target = .{ .exit = LVL.CHAOS_SANCTUARY } },
    .{ .level = LVL.CHAOS_SANCTUARY, .target = .{ .preset = 392 } }, // Seal 1
    .{ .level = LVL.CHAOS_SANCTUARY, .target = .{ .preset = 393 } }, // Seal 2
    .{ .level = LVL.CHAOS_SANCTUARY, .target = .{ .preset = 394 } }, // Seal 3
    .{ .level = LVL.CHAOS_SANCTUARY, .target = .{ .preset = 395 } }, // Seal 4
    .{ .level = LVL.CHAOS_SANCTUARY, .target = .{ .preset = 396 } }, // Seal 5
};

// Baal run: WSK1 -> WSK2 -> WSK3 -> Throne
const baal_steps = [_]RouteStep{
    .{ .level = LVL.WORLDSTONE_KEEP_1, .target = .{ .exit = LVL.WORLDSTONE_KEEP_2 } },
    .{ .level = LVL.WORLDSTONE_KEEP_2, .target = .{ .exit = LVL.WORLDSTONE_KEEP_3 } },
    .{ .level = LVL.WORLDSTONE_KEEP_3, .target = .{ .exit = LVL.THRONE_OF_DESTRUCTION } },
    .{ .level = LVL.THRONE_OF_DESTRUCTION, .target = .{ .preset = 569 } }, // Throne Portal
};

// Countess: Tower Cellar levels
const countess_steps = [_]RouteStep{
    .{ .level = LVL.TOWER_CELLAR_1, .target = .{ .exit = LVL.TOWER_CELLAR_2 } },
    .{ .level = LVL.TOWER_CELLAR_2, .target = .{ .exit = LVL.TOWER_CELLAR_3 } },
    .{ .level = LVL.TOWER_CELLAR_3, .target = .{ .exit = LVL.TOWER_CELLAR_4 } },
    .{ .level = LVL.TOWER_CELLAR_4, .target = .{ .exit = LVL.FORGOTTEN_TOWER } },
};

// Mephisto: Durance 3
const mephisto_steps = [_]RouteStep{
    .{ .level = LVL.DURANCE_3, .target = .{ .preset = 357 } }, // Near Mephisto
};

// Andariel: Catacombs 4
const andariel_steps = [_]RouteStep{
    .{ .level = LVL.CATACOMBS_4, .target = .{ .coord = .{ .x = 22561, .y = 9553 } } }, // Andariel spawn
};

// Summoner: Arcane Sanctuary
const summoner_steps = [_]RouteStep{
    .{ .level = LVL.ARCANE_SANCTUARY, .target = .{ .preset = 250 } }, // Summoner
};

// Pindleskin: Nihlathak's Temple entrance area
const pindleskin_steps = [_]RouteStep{
    .{ .level = LVL.HARROGATH, .target = .{ .exit = LVL.NIHLATHAKS_TEMPLE } },
};

pub const routes = [_]Route{
    .{ .name = &toU16("Chaos"), .steps = &chaos_steps },
    .{ .name = &toU16("Baal"), .steps = &baal_steps },
    .{ .name = &toU16("Countess"), .steps = &countess_steps },
    .{ .name = &toU16("Mephisto"), .steps = &mephisto_steps },
    .{ .name = &toU16("Andariel"), .steps = &andariel_steps },
    .{ .name = &toU16("Summoner"), .steps = &summoner_steps },
    .{ .name = &toU16("Pindleskin"), .steps = &pindleskin_steps },
};

fn toU16(comptime s: []const u8) [s.len:0]u16 {
    var result: [s.len:0]u16 = undefined;
    for (s, 0..) |c, i| result[i] = c;
    return result;
}
