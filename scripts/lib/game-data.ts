import { getUnitStat, getDifficulty, getUnitHP, getUnitMaxHP, getUnitMP, getSkillLevel as _getSkillLevel } from "diablo:native";
import { getBaseStat } from "./txt.js";
import { Skill } from "diablo:constants";
import type { SkillProjectile } from "./attack-types.js"

// Reverse map: skill ID → name from enum
const _skillNames: Record<number, string> = {}
for (const [name, id] of Object.entries(Skill)) {
  if (typeof id === 'number' && !_skillNames[id]) _skillNames[id] = name
}

export function skillName(skillId: number): string {
  return _skillNames[skillId] ?? `skill${skillId}`
}

/** Read a missile's effective reach in game units (sub-tiles).
 *  Returns Vel * Range, or 0 if the missile doesn't exist. */
export function getMissileReach(missileId: number): { range: number, vel: number, maxVel: number, reach: number } {
  const range = getBaseStat("missiles", missileId, "Range")
  const vel = getBaseStat("missiles", missileId, "Vel")
  const maxVel = getBaseStat("missiles", missileId, "MaxVel")
  // Reach = velocity * lifetime in frames. Vel is in sub-tiles/frame.
  return { range, vel, maxVel, reach: vel * range }
}

/** Look up a skill's server missile and compute its reach. */
export function getSkillMissileReach(skillId: number): { missileId: number, range: number, vel: number, maxVel: number, reach: number } | null {
  const missileId = getBaseStat("skills", skillId, "srvmissile")
  if (missileId <= 0) return null
  return { missileId, ...getMissileReach(missileId) }
}

// Stat IDs
const STAT_LEVEL = 12;
const STAT_STR = 0;
const STAT_DEX = 1;
const STAT_MINDMG = 21;
const STAT_MAXDMG = 22;
const STAT_SECONDARY_MINDMG = 23;
const STAT_SECONDARY_MAXDMG = 24;
const STAT_DAMAGEPERCENT = 25; // enhanced damage %
const STAT_IAS = 93;
const STAT_FCR = 105;
const STAT_FIRE_MINDMG = 159;
const STAT_FIRE_MAXDMG = 160;
const STAT_LIGHT_MINDMG = 161;
const STAT_LIGHT_MAXDMG = 162;
const STAT_MAGIC_MINDMG = 163;
const STAT_MAGIC_MAXDMG = 164;
const STAT_COLD_MINDMG = 165;
const STAT_COLD_MAXDMG = 166;

// Mastery stat IDs by element
const masteryMap: Record<string, number> = {
  Fire: 329, Lightning: 330, Cold: 331, Poison: 332, Magic: 357,
};

// Pierce stat IDs by element
const pierceMap: Record<string, number> = {
  Fire: 333, Lightning: 334, Cold: 335, Poison: 336, Magic: 358,
};

// Resist stat IDs for reading player stats
const resistMap: Record<string, number> = {
  Physical: 36, Magic: 37, Fire: 39, Lightning: 41, Cold: 43, Poison: 45,
};

// Conviction-eligible elements
const convictionEligible: Record<string, boolean> = { Fire: true, Lightning: true, Cold: true };

// Lower Resist-eligible elements (includes Poison, unlike Conviction)
const lowerResistEligible: Record<string, boolean> = { Fire: true, Lightning: true, Cold: true, Poison: true };

const damageTypes = ["Physical", "Fire", "Lightning", "Magic", "Cold", "Poison", "?", "?", "?", "Physical"];

// --- Skills to ignore (armor/buff auras evaluated as attacks) ---
const ignoreSkill: Record<number, boolean> = {
  // Sorc armor skills
  40: true,   // Frozen Armor
  50: true,   // Shiver Armor
  60: true,   // Chilling Armor
  // Sorc warmth
  37: true,   // Warmth
  // Sorc energy shield
  58: true,   // Energy Shield
  // Sorc buffs/passive/summons (not direct attacks)
  48: true,   // Enchant (buff)
  57: true,   // Thunder Storm (passive proc, not castable)
  62: true,   // Hydra (summon turret, AI-controlled)
  // Paladin auras (non-damaging)
  99: true,   // Prayer
  100: true,  // Defiance
  104: true,  // Cleansing
  105: true,  // Vigor
  108: true,  // Meditation
  109: true,  // Redemption
  110: true,  // Salvation
  111: true,  // Concentration
  113: true,  // Fanaticism
  115: true,  // Conviction (debuff, not attack)
  125: true,  // Resist Fire/Cold/Lightning
  // Necro curses (handled as debuffs, not attacks)
  66: true,   // Amplify Damage
  71: true,   // Dim Vision
  72: true,   // Weaken
  76: true,   // Iron Maiden
  77: true,   // Terror
  81: true,   // Confuse
  82: true,   // Life Tap
  86: true,   // Attract
  87: true,   // Decrepify
  91: true,   // Lower Resist
  // Barb warcries (buffs)
  130: true,  // Howl
  132: true,  // Find Potion
  137: true,  // Shout
  138: true,  // Find Item
  139: true,  // Taunt
  146: true,  // Battle Cry
  149: true,  // War Cry (debuff)
  150: true,  // Battle Orders
  155: true,  // Battle Command
  // Druid summon/buff
  226: true,  // Raven (summon, skip as attack)
  231: true,  // Poison Creeper (summon)
  236: true,  // Carrion Vine (summon)
  241: true,  // Solar Creeper (summon)
  246: true,  // Heart of Wolverine (summon)
  247: true,  // Summon Spirit Wolf (summon)
  237: true,  // Summon Dire Wolf (summon)
  248: true,  // Summon Grizzly (summon)
  227: true,  // Spirit of Barbs (summon)
  221: true,  // Oak Sage (summon)
  // Assassin shadow/blade
  268: true,  // Burst of Speed
  269: true,  // Cloak of Shadows
  277: true,  // Shadow Warrior
  278: true,  // Shadow Master
  279: true,  // Venom
  // Amazon passives
  8: true,    // Inner Sight
  17: true,   // Slow Missiles
  28: true,   // Decoy
  29: true,   // Avoid
  30: true,   // Valkyrie
  // Teleport itself (not an attack)
  54: true,   // Teleport
};

// Pre-attack skills (cast before engaging, not during combat loop)
const preAttackable: Record<number, boolean> = {
  138: true,  // Find Item
  149: true,  // War Cry
  150: true,  // Battle Orders
  155: true,  // Battle Command
  279: true,  // Venom
  268: true,  // Burst of Speed
};

// Synergy calc table: skillId → [synergySkillId, bonus, ...]
const synergyCalc: Record<number, number[]> = {
  // sorc fire
  36: [47, 0.16, 56, 0.16], 41: [37, 0.13], 46: [37, 0.04, 51, 0.01],
  47: [36, 0.14, 56, 0.14], 51: [37, 0.04, 41, 0.01], 52: [37, 0.09],
  56: [36, 0.05, 47, 0.05], 62: [36, 0.03, 47, 0.03],
  // sorc lightning
  38: [49, 0.06], 49: [38, 0.08, 48, 0.08, 53, 0.08],
  53: [38, 0.04, 48, 0.04, 49, 0.04],
  // sorc cold
  39: [44, 0.15, 45, 0.15, 55, 0.15, 59, 0.15, 64, 0.15],
  44: [59, 0.10, 64, 0.10], 45: [39, 0.08, 59, 0.08, 64, 0.08],
  55: [39, 0.05, 45, 0.05, 64, 0.05], 59: [39, 0.05, 45, 0.05, 55, 0.05],
  64: [39, 0.02],
  // assassin traps
  251: [256, 0.09, 261, 0.09, 262, 0.09, 271, 0.09, 272, 0.09, 276, 0.09],
  256: [261, 0.11, 271, 0.11, 276, 0.11],
  261: [251, 0.06, 271, 0.06, 276, 0.06],
  262: [251, 0.08, 272, 0.08], 271: [256, 0.12, 261, 0.12, 276, 0.12],
  272: [251, 0.10, 276, 0.10, 262, 0.07], 276: [271, 0.12],
  // necro bone
  67: [78, 0.15, 84, 0.15, 88, 0.15, 93, 0.15],
  73: [83, 0.20, 92, 0.20], 83: [73, 0.15, 92, 0.15],
  84: [67, 0.07, 78, 0.07, 88, 0.07, 93, 0.07],
  92: [73, 0.10, 83, 0.10], 93: [67, 0.06, 78, 0.06, 84, 0.06, 88, 0.06],
  // barb
  154: [130, 0.06, 137, 0.06, 146, 0.06],
  // paladin combat
  101: [112, 0.50, 121, 0.50], 112: [108, 0.14, 115, 0.14], 121: [118, 0.07],
  // paladin auras
  102: [100, 0.18, 125, 0.06], 114: [105, 0.15, 125, 0.07], 118: [110, 0.12, 125, 0.04],
  // druid elemental
  225: [229, 0.23, 234, 0.23], 229: [244, 0.10, 225, 0.08],
  234: [225, 0.12, 244, 0.12], 244: [229, 0.12, 234, 0.12, 249, 0.12],
  249: [225, 0.14, 229, 0.14, 244, 0.14], 230: [250, 0.15, 235, 0.15],
  240: [245, 0.10, 250, 0.10], 245: [235, 0.09, 240, 0.09, 250, 0.09],
  250: [240, 0.09, 245, 0.09],
  // druid feral
  238: [222, 0.18], 239: [225, 0.22, 229, 0.22, 234, 0.22, 244, 0.22],
  // amazon bow/xbow
  11: [21, 0.12], 21: [11, 0.08], 31: [11, 0.12],
  7: [16, 0.12], 16: [7, 0.12], 27: [16, 0.10],
  // amazon spear/javelin
  14: [20, 0.10, 24, 0.10, 34, 0.10, 35, 0.10],
  20: [14, 0.03, 24, 0.03, 34, 0.03, 35, 0.03],
  24: [14, 0.10, 20, 0.10, 34, 0.10, 35, 0.10],
  34: [14, 0.08, 20, 0.08, 24, 0.10, 35, 0.10],
  35: [14, 0.01, 20, 0.01, 24, 0.01, 34, 0.01],
  15: [25, 0.12], 25: [15, 0.10],
};

// Skills where synergy only applies to max (not min) elemental damage
const noMinSynergy = [14, 20, 24, 34, 35, 49, 53, 118, 256, 261, 271, 276];

// Poison/duration damage multiplier
const skillMult: Record<number, number> = {
  15: 25, 25: 25, 41: 25, 46: 75, 51: 75, 73: 25, 83: 25, 92: 25,
  222: 25, 225: 75, 230: 25, 238: 25, 272: 25 / 3,
};

// Skills that don't deal direct damage
const nonDamage: Record<number, boolean> = {
  54: true, 217: true, 218: true, 219: true, 220: true, 117: true, 278: true,
  261: true, 271: true, 276: true, 262: true, 272: true,
};

// Skill radius for AoE modifier (explosion/splash radius in game units)
const skillRadius: Record<number, number> = {
  36: 2,   // Fire Bolt — no splash, but small AoE on impact
  42: 10,  // Static Field — ~3.3 yards = ~10 units
  44: 12,  // Frost Nova — ~4 yards radius
  47: 4,   // Fireball — explosion radius
  48: 10,  // Nova — measured ~12 sub-tile max, use 10 for reliable hits
  55: 6,   // Blizzard
  56: 12,  // Meteor
  59: 4,   // Blizzard (Ice Blast)
  64: 5,   // Frozen Orb — shards fan out
  67: 0,   // Teeth — projectile
  83: 0,   // Bone Spear — line
  84: 0,   // Bone Spirit — seeking single
  92: 24,  // Corpse Explosion
  112: 6,  // Blessed Hammer — spiral
  154: 12, // War Cry
  229: 4,  // Tornado
  234: 3,  // Fissure
  244: 5,  // Volcano
  249: 24, // Armageddon
  250: 24, // Hurricane
  251: 3,  // Fire Blast (trap)
};

// Nova-like skills (centered on caster, not target)
const novaLike: Record<number, boolean> = {
  44: true, 48: true, 92: true, 112: true, 154: true, 249: true, 250: true,
};

// --- Projectile behavior classification ---

// Skills whose projectiles pierce through multiple targets
const piercingSkills = new Set<number>([
  38,   // Charged Bolt (spreads)
  49,   // Lightning (pierces)
  53,   // Chain Lightning (jumps)
  84,   // Bone Spirit (seeking, effectively reaches target)
  34,   // Lightning Fury (pierces)
  35,   // Lightning Strike
  24,   // Charged Strike (bolts spread from target)
]);

// Ground-targeted AoE skills (land at target position, ignore obstacles)
const groundAoeSkills = new Set<number>([
  55,   // Blizzard
  56,   // Meteor
  64,   // Frozen Orb
  59,   // Ice Blast (but more projectile-like — keep for now)
  62,   // Hydra
  249,  // Armageddon
]);

/** Classify a skill's projectile behavior for line-of-fire evaluation */
export function skillProjectileType(skillId: number): SkillProjectile {
  if (novaLike[skillId]) return 'nova'
  if (groundAoeSkills.has(skillId)) return 'ground_aoe'
  if (piercingSkills.has(skillId)) return 'pierces'

  // Check if melee: no missile, range < 2
  const srvMissile = getBaseStat("skills", skillId, "srvmissile") as number
  const cltMissile = getBaseStat("skills", skillId, "cltmissile") as number
  const range = getBaseStat("skills", skillId, "range") as number
  if (srvMissile <= 0 && cltMissile <= 0 && range < 2) return 'melee'

  // Default projectile: stops on first hit
  return 'stops'
}

// --- Static Field ---

/** Static Field: % of current HP as damage, capped by difficulty.
 *  Returns effective HP removed per cast (not a skill damage calc). */
export function staticFieldDamage(monCurrentHp: number, diff: number): number {
  // Static Field removes 25% of current HP
  // But has a floor: Normal=0%, NM=33%, Hell=50%
  const floors = [0, 0.33, 0.50]
  const floor = floors[diff] ?? 0.50
  // If monster HP% is already at or below the floor, static does nothing
  // We need monMaxHp to compute this properly, but approximate: if hp > floor * maxHp
  // For now, assume it works (caller should check the floor condition)
  return monCurrentHp * 0.25
}

/** Can Static Field still reduce this monster? Checks HP% > difficulty floor. */
export function staticFieldEffective(monHp: number, monMaxHp: number, diff: number): boolean {
  const floors = [0, 0.33, 0.50]
  const floor = floors[diff] ?? 0.50
  return monMaxHp > 0 && (monHp / monMaxHp) > floor
}

// HP lookup table per monster level [normal, nightmare, hell]
const HPLookup = [
  [1,1,1],[7,107,830],[9,113,852],[12,120,875],[15,125,897],[17,132,920],
  [20,139,942],[23,145,965],[27,152,987],[31,157,1010],[35,164,1032],
  [36,171,1055],[40,177,1077],[44,184,1100],[48,189,1122],[52,196,1145],
  [56,203,1167],[60,209,1190],[64,216,1212],[68,221,1235],[73,228,1257],
  [78,236,1280],[84,243,1302],[89,248,1325],[94,255,1347],[100,261,1370],
  [106,268,1392],[113,275,1415],[120,280,1437],[126,287,1460],[134,320,1482],
  [142,355,1505],[150,388,1527],[158,423,1550],[166,456,1572],[174,491,1595],
  [182,525,1617],[190,559,1640],[198,593,1662],[206,627,1685],[215,661,1707],
  [225,696,1730],[234,729,1752],[243,764,1775],[253,797,1797],[262,832,1820],
  [271,867,1842],[281,900,1865],[290,935,1887],[299,968,1910],[310,1003,1932],
  [321,1037,1955],[331,1071,1977],[342,1105,2000],[352,1139,2030],[363,1173,2075],
  [374,1208,2135],[384,1241,2222],[395,1276,2308],[406,1309,2394],[418,1344,2480],
  [430,1379,2567],[442,1412,2653],[454,1447,2739],[466,1480,2825],[477,1515,2912],
  [489,1549,2998],[501,1583,3084],[513,1617,3170],[525,1651,3257],[539,1685,3343],
  [552,1720,3429],[565,1753,3515],[579,1788,3602],[592,1821,3688],[605,1856,3774],
  [618,1891,3860],[632,1924,3947],[645,1959,4033],[658,1992,4119],[673,2027,4205],
  [688,2061,4292],[702,2095,4378],[717,2129,4464],[732,2163,4550],[746,2197,4637],
  [761,2232,4723],[775,2265,4809],[790,2300,4895],[805,2333,4982],[821,2368,5068],
  [837,2403,5154],[853,2436,5240],[868,2471,5327],[884,2504,5413],[900,2539,5499],
  [916,2573,5585],[932,2607,5672],[948,2641,5758],[964,2675,5844],[982,2709,5930],
  [999,2744,6017],[1016,2777,6103],[1033,2812,6189],[1051,2845,6275],[1068,2880,6362],
  [1085,2915,6448],[1103,2948,6534],[1120,2983,6620],[1137,3016,6707],[10000,10000,10000],
];

export interface DamageInfo {
  type: string;
  pmin: number;
  pmax: number;
  min: number;
  max: number;
  undeadOnly?: boolean;
}

export interface EffortResult {
  effort: number;
  skill: number;
  type: string;
}

// Staged damage calc: applies per-level scaling across breakpoint tiers
function stagedDamage(l: number, a: number, b: number, c: number, d: number, e: number, f: number, hitshift = 0, mult = 1): number {
  if (l > 28) { a += f * (l - 28); l = 28; }
  if (l > 22) { a += e * (l - 22); l = 22; }
  if (l > 16) { a += d * (l - 16); l = 16; }
  if (l > 8) { a += c * (l - 8); l = 8; }
  a += b * (Math.max(0, l) - 1);
  return (mult * a) << hitshift;
}

function skillLevel(skillId: number): number {
  return _getSkillLevel(skillId, 1); // effective level with +skills
}

function baseLevel(skillId: number): number {
  return _getSkillLevel(skillId, 0); // base hard points only
}

function monsterLevel(monId: number, areaId: number): number {
  const diff = getDifficulty();
  if (diff > 0) {
    // NM/Hell: level determined by area
    // TODO: read area level from levels.txt when available
    return getBaseStat("monstats", monId, "Level");
  }
  return getBaseStat("monstats", monId, "Level");
}

export function monsterMaxHP(monId: number, areaId: number, adjustLevel = 0): number {
  const diff = getDifficulty();
  const mlvl = Math.min(HPLookup.length - 1, monsterLevel(monId, areaId) + adjustLevel);
  const hpField = ["maxHP", "maxHP(N)", "maxHP(H)"][diff]!;
  return HPLookup[mlvl]![diff]! * getBaseStat("monstats", monId, hpField) / 100;
}

function monsterResist(monId: number, type: string): number {
  const diff = getDifficulty();
  const fieldMap: Record<string, string[]> = {
    Physical:  ["ResDm", "ResDm(N)", "ResDm(H)"],
    Magic:     ["ResMa", "ResMa(N)", "ResMa(H)"],
    Fire:      ["ResFi", "ResFi(N)", "ResFi(H)"],
    Lightning: ["ResLi", "ResLi(N)", "ResLi(H)"],
    Cold:      ["ResCo", "ResCo(N)", "ResCo(H)"],
    Poison:    ["ResPo", "ResPo(N)", "ResPo(H)"],
  };
  const fields = fieldMap[type];
  return fields ? getBaseStat("monstats", monId, fields[diff]!) : 0;
}

function skillCooldown(skillId: number): boolean {
  return getBaseStat("skills", skillId, "delay") !== -1;
}

export function baseSkillDamage(skillId: number): DamageInfo {
  const l = skillLevel(skillId);
  const m = skillMult[skillId] || 1;
  const hs = getBaseStat("skills", skillId, "HitShift");

  if (skillId === 70) {
    // Raise Skeleton — physical only from EMin/EMax fields
    return {
      type: "Physical",
      pmin: stagedDamage(l,
        getBaseStat("skills", skillId, "EMin"), getBaseStat("skills", skillId, "EMinLev1"),
        getBaseStat("skills", skillId, "EMinLev2"), getBaseStat("skills", skillId, "EMinLev3"),
        getBaseStat("skills", skillId, "EMinLev4"), getBaseStat("skills", skillId, "EMinLev5"), hs, m),
      pmax: stagedDamage(l,
        getBaseStat("skills", skillId, "EMax"), getBaseStat("skills", skillId, "EMaxLev1"),
        getBaseStat("skills", skillId, "EMaxLev2"), getBaseStat("skills", skillId, "EMaxLev3"),
        getBaseStat("skills", skillId, "EMaxLev4"), getBaseStat("skills", skillId, "EMaxLev5"), hs, m),
      min: 0, max: 0,
    };
  }

  const etype = getBaseStat("skills", skillId, "EType");
  return {
    type: damageTypes[etype] || "Physical",
    pmin: stagedDamage(l,
      getBaseStat("skills", skillId, "MinDam"), getBaseStat("skills", skillId, "MinLevDam1"),
      getBaseStat("skills", skillId, "MinLevDam2"), getBaseStat("skills", skillId, "MinLevDam3"),
      getBaseStat("skills", skillId, "MinLevDam4"), getBaseStat("skills", skillId, "MinLevDam5"), hs, m),
    pmax: stagedDamage(l,
      getBaseStat("skills", skillId, "MaxDam"), getBaseStat("skills", skillId, "MaxLevDam1"),
      getBaseStat("skills", skillId, "MaxLevDam2"), getBaseStat("skills", skillId, "MaxLevDam3"),
      getBaseStat("skills", skillId, "MaxLevDam4"), getBaseStat("skills", skillId, "MaxLevDam5"), hs, m),
    min: etype ? stagedDamage(l,
      getBaseStat("skills", skillId, "EMin"), getBaseStat("skills", skillId, "EMinLev1"),
      getBaseStat("skills", skillId, "EMinLev2"), getBaseStat("skills", skillId, "EMinLev3"),
      getBaseStat("skills", skillId, "EMinLev4"), getBaseStat("skills", skillId, "EMinLev5"), hs, m) : 0,
    max: etype ? stagedDamage(l,
      getBaseStat("skills", skillId, "EMax"), getBaseStat("skills", skillId, "EMaxLev1"),
      getBaseStat("skills", skillId, "EMaxLev2"), getBaseStat("skills", skillId, "EMaxLev3"),
      getBaseStat("skills", skillId, "EMaxLev4"), getBaseStat("skills", skillId, "EMaxLev5"), hs, m) : 0,
  };
}

/** Compute melee Attack damage from equipped weapon stats + buffs (Enchant, etc.) */
function meleeAttackDamage(): DamageInfo {
  // Physical: weapon damage + enhanced damage + str/dex bonus
  let pmin = getUnitStat(STAT_MINDMG, 0) + getUnitStat(STAT_SECONDARY_MINDMG, 0)
  let pmax = getUnitStat(STAT_MAXDMG, 0) + getUnitStat(STAT_SECONDARY_MAXDMG, 0)
  if (pmin < 1) pmin = 1
  if (pmax < pmin) pmax = pmin
  // Enhanced damage % (from gear, skills, etc.)
  const ed = getUnitStat(STAT_DAMAGEPERCENT, 0)
  // Str/dex contribution to physical damage
  const str = getUnitStat(STAT_STR, 0)
  const dex = getUnitStat(STAT_DEX, 0)
  // D2 melee: physical damage * (1 + ED/100) * (1 + STR/100) for most weapons
  const physMult = (100 + ed) / 100 * (100 + str) / 100
  pmin = (pmin * physMult) | 0
  pmax = (pmax * physMult) | 0

  // Elemental damage from buffs (Enchant gives fire, Holy Shock gives lightning, etc.)
  // These are already included in the unit's stats by the server
  const fireMin = getUnitStat(STAT_FIRE_MINDMG, 0)
  const fireMax = getUnitStat(STAT_FIRE_MAXDMG, 0)
  const lightMin = getUnitStat(STAT_LIGHT_MINDMG, 0)
  const lightMax = getUnitStat(STAT_LIGHT_MAXDMG, 0)
  const coldMin = getUnitStat(STAT_COLD_MINDMG, 0)
  const coldMax = getUnitStat(STAT_COLD_MAXDMG, 0)
  const magicMin = getUnitStat(STAT_MAGIC_MINDMG, 0)
  const magicMax = getUnitStat(STAT_MAGIC_MAXDMG, 0)

  // Sum all elemental as "bonus" damage. Use the highest element as the type
  // for resistance calculations
  const eleTotals = [
    { type: "Fire" as string, min: fireMin, max: fireMax },
    { type: "Lightning", min: lightMin, max: lightMax },
    { type: "Cold", min: coldMin, max: coldMax },
    { type: "Magic", min: magicMin, max: magicMax },
  ]
  const totalEleMin = fireMin + lightMin + coldMin + magicMin
  const totalEleMax = fireMax + lightMax + coldMax + magicMax

  // Use dominant element type for resistance lookup (simplification)
  let bestEle = "Physical"
  let bestEleAvg = 0
  for (const e of eleTotals) {
    const avg = (e.min + e.max) / 2
    if (avg > bestEleAvg) { bestEleAvg = avg; bestEle = e.type }
  }

  return {
    type: totalEleMax > pmax ? bestEle : "Physical",
    pmin, pmax,
    min: totalEleMin, max: totalEleMax,
  }
}

export function skillDamage(skillId: number): DamageInfo {
  if (skillId === 0) return meleeAttackDamage();
  const sl = skillLevel(skillId);
  if (sl < 1) {
    // Still compute base damage for level-0 starting skills (e.g. Fire Bolt at level 1)
    // The game lets you use them, they just do base damage from txt
    const base = baseSkillDamage(skillId);
    if (base.pmin > 0 || base.pmax > 0 || base.min > 0 || base.max > 0) {
      return base; // has txt damage even at level 0
    }
    return { type: damageTypes[getBaseStat("skills", skillId, "EType")] || "Physical", pmin: 0, pmax: 0, min: 0, max: 0 };
  }

  const dmg = baseSkillDamage(skillId);
  let mastery = 1, psynergy = 1, synergy = 1;

  // Apply synergies
  const sc = synergyCalc[skillId];
  if (sc) {
    for (let c = 0; c < sc.length; c += 2) {
      const sl = baseLevel(sc[c]!);
      if (skillId === 229 || skillId === 244) {
        if (sc[c] === 229 || sc[c] === 244) {
          psynergy += sl * sc[c + 1]!;
        } else {
          synergy += sl * sc[c + 1]!;
        }
      } else {
        psynergy += sl * sc[c + 1]!;
        synergy += sl * sc[c + 1]!;
      }
    }
  }

  // Spirit of Barbs / Heart of Wolverine / Oak Sage summon synergy
  if (skillId === 227 || skillId === 237 || skillId === 247) {
    const sl = skillLevel(247);
    psynergy += 0.15 + sl * 0.10;
    synergy += 0.15 + sl * 0.10;
  }

  // Apply mastery
  const masteryStatId = masteryMap[dmg.type];
  if (masteryStatId) {
    mastery = 1 + getUnitStat(masteryStatId, 0) / 100;
    dmg.min *= mastery;
    dmg.max *= mastery;
  }

  // Apply synergies to physical and elemental
  dmg.pmin *= psynergy;
  dmg.pmax *= psynergy;
  if (noMinSynergy.indexOf(skillId) < 0) dmg.min *= synergy;
  dmg.max *= synergy;

  // Special skill multipliers
  switch (skillId) {
    case 102: dmg.min *= 6; dmg.max *= 6; break; // holy fire
    case 114: dmg.min *= 5; dmg.max *= 5; break; // holy freeze
    case 118: dmg.min *= 6; dmg.max *= 6; break; // holy shock
    case 249: dmg.pmin = dmg.pmax = 0; break; // armageddon
    case 24: dmg.max *= 3 + ((skillLevel(24) / 5) | 0); break; // charged strike
  }

  // HitShift >> 8 normalization
  dmg.pmin >>= 8;
  dmg.pmax >>= 8;
  dmg.min >>= 8;
  dmg.max >>= 8;

  // Post-shift multipliers
  switch (skillId) {
    case 59: dmg.min *= 2; dmg.max *= 2; break; // blizzard
    case 62: dmg.min *= 3; dmg.max *= 3; break; // hydra
    case 64: dmg.min *= 5; dmg.max *= 5; break; // frozen orb
    case 70: { // raise skeleton
      let sl = skillLevel(70);
      const shots = sl < 4 ? sl : (2 + sl / 3) | 0;
      sl = Math.max(0, sl - 3);
      dmg.pmin = shots * (dmg.pmin + 1 + skillLevel(69) * 2) * (1 + sl * 0.07);
      dmg.pmax = shots * (dmg.pmax + 2 + skillLevel(69) * 2) * (1 + sl * 0.07);
      break;
    }
    case 101: dmg.undeadOnly = true; break; // holy bolt
    case 112: { // blessed hammer (concentration bonus)
      const sl = skillLevel(113);
      if (sl > 0) {
        mastery = (100 + ((45 + sl * 15) >> 1)) / 100;
        dmg.min *= mastery;
        dmg.max *= mastery;
      }
      break;
    }
    case 221: { const s = Math.min(5, skillLevel(221)); dmg.pmin *= s; dmg.pmax *= s; break; } // raven
    case 227: { const s = Math.min(5, skillLevel(227)); dmg.pmin *= s; dmg.pmax *= s; break; } // spirit wolf
    case 237: { const s = Math.min(3, skillLevel(237)); dmg.pmin *= s; dmg.pmax *= s; break; } // dire wolf
    case 240: dmg.pmin *= 3; dmg.pmax *= 3; break; // twister
    case 261: case 262: case 271: case 272: case 276:
      dmg.min *= 5; dmg.max *= 5; break; // traps (5 out at once)
  }

  dmg.pmin |= 0;
  dmg.pmax |= 0;
  dmg.min |= 0;
  dmg.max |= 0;
  return dmg;
}

// AoE modifier: how many monsters a skill hits
function dmgModifier(skillId: number, monId: number): number {
  const avgPack = (getBaseStat("monstats", monId, "MinGrp") + getBaseStat("monstats", monId, "PartyMin")
    + getBaseStat("monstats", monId, "MaxGrp") + getBaseStat("monstats", monId, "PartyMax")) / 2;

  let hitcap = 1;
  switch (skillId) {
    case 15: case 25: case 16: case 27: case 31: case 35: case 44: case 48:
    case 56: case 59: case 64: case 83: case 92: case 112: case 154: case 229:
    case 234: case 249: case 244: case 250: case 251: case 261: case 262:
    case 55: case 47: case 42:
      hitcap = Infinity; break;
    case 34: hitcap = 1 + skillLevel(34); break;
    case 38: hitcap = 2 + skillLevel(38); break;
    case 67: hitcap = 1 + skillLevel(67); break;
    case 53: hitcap = 5 + ((skillLevel(53) / 5) | 0); break;
    case 24: hitcap = 3 + ((skillLevel(24) / 5) | 0); break;
    case 49: case 84: case 271: case 276:
      hitcap = avgPack ? Math.sqrt(avgPack / Math.PI) * 2 : 1; break;
  }
  return Math.min(avgPack || 1, hitcap);
}

export function monsterEffort(monId: number, areaId: number, conviction = 0, ampDmg = 0, minRange = 0): EffortResult {
  const result: EffortResult = { effort: Infinity, skill: -1, type: "Physical" };
  const hp = monsterMaxHP(monId, areaId);
  const isUndead = getBaseStat("monstats", monId, "hUndead") || getBaseStat("monstats", monId, "lUndead");

  for (let sk = 0; sk < 360; sk++) {
    if (nonDamage[sk]) continue;
    if (ignoreSkill[sk]) continue;
    if (skillLevel(sk) < 1) continue;
    if (skillCooldown(sk)) continue;
    if (minRange > 0 && skillRange(sk) < minRange) continue;

    const dmg = skillDamage(sk);
    if (dmg.pmin === 0 && dmg.pmax === 0 && dmg.min === 0 && dmg.max === 0) continue;
    if (dmg.undeadOnly && !isUndead) continue;

    let avgPDmg = (dmg.pmin + dmg.pmax) / 2;
    let avgDmg = (dmg.min + dmg.max) / 2;
    let totalDmg = 0;

    // Physical damage with amp
    if (avgPDmg > 0) {
      let presist = monsterResist(monId, "Physical");
      presist -= (presist >= 100 ? ampDmg / 5 : ampDmg);
      presist = Math.max(-100, Math.min(100, presist));
      totalDmg += avgPDmg * (100 - presist) / 100;
    }

    // Elemental damage with conviction + pierce
    if (avgDmg > 0) {
      let resist = monsterResist(monId, dmg.type);
      const pierceStat = pierceMap[dmg.type];
      const pierce = pierceStat ? getUnitStat(pierceStat, 0) : 0;

      if (convictionEligible[dmg.type]) {
        resist -= (resist >= 100 ? conviction / 5 : conviction);
      }
      if (resist < 100) {
        resist = Math.max(-100, resist - pierce);
      } else {
        resist = 100;
      }
      totalDmg += avgDmg * (100 - resist) / 100;
    }

    if (totalDmg <= 0) continue;

    let effort = Math.ceil(hp / totalDmg);
    effort /= dmgModifier(sk, monId);

    // Mana penalty
    const mp = getUnitMP();
    if (mp < 20) effort *= 5;

    if (effort <= result.effort) {
      result.effort = effort;
      result.skill = sk;
      result.type = dmg.type;
    }
  }

  return result;
}

export function castingFrames(skillId: number, charClass: number): number {
  // Melee skills: use IAS formula instead of FCR
  const isMelee = skillId === 0 || (
    (getBaseStat("skills", skillId, "srvmissile") as number) <= 0 &&
    (getBaseStat("skills", skillId, "cltmissile") as number) <= 0 &&
    (getBaseStat("skills", skillId, "range") as number) < 2
  )
  if (isMelee) {
    const ias = getUnitStat(STAT_IAS, 0)
    const eias = Math.floor(120 * ias / (120 + ias))
    // Base attack frames by class (human form, 1H swing)
    // ama=16, sor=18, nec=18, pal=16, bar=14, dru=18, ass=16
    const baseFrames = [16, 18, 18, 16, 14, 18, 16][charClass] ?? 16
    return Math.max(7, Math.ceil(baseFrames * 256 / Math.floor(256 * (100 + eias) / 100)))
  }

  const fcr = getUnitStat(STAT_FCR, 0);
  const effectiveFCR = Math.min(75, (fcr * 120 / (fcr + 120)) | 0);
  const isLightning = skillId === 49 || skillId === 53;

  const baseCastRate = [20, isLightning ? 19 : 14, 16, 16, 14, 15, 17][charClass]!;

  if (isLightning) {
    return Math.round(256 * baseCastRate / (256 * (100 + effectiveFCR) / 100));
  }
  return Math.ceil(256 * baseCastRate / Math.floor(256 * (100 + effectiveFCR) / 100)) - 1;
}

/** Channeled skills: effective range + DPS divisor.
 *  skillDamage() returns tooltip damage which is comparable to non-channeled skills,
 *  but channeled skills require holding for many frames AND have short range, making
 *  them dramatically worse than instant-cast AoE. The divisor accounts for:
 *  - Must stand still (can't dodge)
 *  - Short range means more repositioning
 *  - Can't hit-and-run like FireBall/Nova */
const channeledSkills: Record<number, { range: number, divisor: number }> = {
  52: { range: 6, divisor: 5 },   // Inferno — short cone, must hold
  56: { range: 10, divisor: 4 },  // Arctic Blast — slightly better range
}

export function isChanneled(skillId: number): boolean {
  return skillId in channeledSkills
}

export function skillRange(skillId: number): number {
  // Channeled skills have short range despite having missiles
  if (channeledSkills[skillId]) return channeledSkills[skillId].range

  // Ranged/AoE: skill has a missile → default 25 (like kolbot)
  const missile = getBaseStat("skills", skillId, "srvmissile") as number
  if (missile > 0) return 25

  // Ground-targeted AoE skills (Blizzard, Meteor, etc.) — cast anywhere in range
  const cltMissile = getBaseStat("skills", skillId, "cltmissile") as number
  if (cltMissile > 0) return 25

  // range field: 0=melee, 1=h2h/both, 2+=ranged
  const r = getBaseStat("skills", skillId, "range") as number
  if (r >= 2) return 25

  // Melee
  return 3
}

// --- Live unit-based evaluation ---

import type { Monster } from "diablo:game"
import type { Pos, ActionScore } from "./attack-types.js"

/** Read actual resist from a live monster unit (not txt) */
export function unitResist(mon: Monster, type: string): number {
  const statId = resistMap[type]
  if (!statId) return 0
  return mon.getStat(statId, 0)
}

/** Compute average damage of a skill against a specific live unit */
export function skillDamageVsUnit(skillId: number, mon: Monster): number {
  const dmg = skillDamage(skillId)
  if (dmg.pmin === 0 && dmg.pmax === 0 && dmg.min === 0 && dmg.max === 0) return 0

  const isUndead = getBaseStat("monstats", mon.classid, "hUndead") || getBaseStat("monstats", mon.classid, "lUndead")
  if (dmg.undeadOnly && !isUndead) return 0

  let total = 0

  // Physical
  const avgP = (dmg.pmin + dmg.pmax) / 2
  if (avgP > 0) {
    const presist = Math.max(-100, Math.min(100, unitResist(mon, "Physical")))
    total += avgP * (100 - presist) / 100
  }

  // Elemental
  const avgE = (dmg.min + dmg.max) / 2
  if (avgE > 0) {
    let resist = unitResist(mon, dmg.type)
    const pierceStat = pierceMap[dmg.type]
    const pierce = pierceStat ? getUnitStat(pierceStat, 0) : 0
    if (resist < 100) {
      resist = Math.max(-100, resist - pierce)
    } else {
      resist = 100
    }
    total += avgE * (100 - resist) / 100
  }

  return total
}

function distXY(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2, dy = y1 - y2
  return Math.sqrt(dx * dx + dy * dy)
}

/** Mana cost for a skill at current level. Reads from skills.txt fields. */
export function skillManaCost(skillId: number): number {
  const lvl = skillLevel(skillId)
  if (lvl < 1) return 0
  const baseMana = getBaseStat("skills", skillId, "mana")
  const lvlMana = getBaseStat("skills", skillId, "lvlmana")
  const minMana = getBaseStat("skills", skillId, "minmana")
  // mana + lvlmana * (level - 1), floored at minmana. Shift >> 8 for fixed point.
  const cost = Math.max(minMana, baseMana + lvlMana * (lvl - 1)) >> 8
  return Math.max(0, cost)
}

/** Is a skill centered on the caster (nova-like) vs aimed at a target? */
export function isNova(skillId: number): boolean {
  return !!novaLike[skillId]
}

/** Get splash/AoE radius for a skill (0 = single target) */
export function splashRadius(skillId: number): number {
  return skillRadius[skillId] || 0
}

// --- Line-of-fire check ---

/** Check if any monster blocks the projectile line from caster to target.
 *  Returns list of monsters along the line (within ~2 unit radius of the path). */
function monstersAlongLine(casterPos: Pos, targetPos: Pos, monsters: Monster[], target: Monster): Monster[] {
  const dx = targetPos.x - casterPos.x
  const dy = targetPos.y - casterPos.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return []

  const nx = dx / len, ny = dy / len
  const blockers: Monster[] = []
  const hitRadius = 2 // approximate unit collision radius

  for (const mon of monsters) {
    if (mon.unitId === target.unitId) continue // skip the target itself
    // Project monster position onto the line
    const mx = mon.x - casterPos.x, my = mon.y - casterPos.y
    const proj = mx * nx + my * ny
    if (proj < 0 || proj > len) continue // behind caster or past target
    // Perpendicular distance from the line
    const perp = Math.abs(mx * ny - my * nx)
    if (perp <= hitRadius) {
      blockers.push(mon)
    }
  }

  // Sort by distance from caster (first hit first)
  blockers.sort((a, b) => {
    const da = (a.x - casterPos.x) ** 2 + (a.y - casterPos.y) ** 2
    const db = (b.x - casterPos.x) ** 2 + (b.y - casterPos.y) ** 2
    return da - db
  })

  return blockers
}

/** Compute reach factor: how much of the skill's damage reaches the primary target.
 *  1.0 = full damage, 0.0 = completely blocked. */
function reachFactor(skillId: number, casterPos: Pos, targetPos: Pos, monsters: Monster[], target: Monster): number {
  const projType = skillProjectileType(skillId)

  switch (projType) {
    case 'nova':
    case 'ground_aoe':
      return 1.0 // no pathing modifier

    case 'pierces':
      return 1.0 // reaches target regardless

    case 'melee': {
      // Melee: can only hit adjacent. If target is behind others, factor is low.
      const blockers = monstersAlongLine(casterPos, targetPos, monsters, target)
      return blockers.length === 0 ? 1.0 : 0.3
    }

    case 'stops': {
      // Projectile stops on first hit. Check if anything is in the way.
      const blockers = monstersAlongLine(casterPos, targetPos, monsters, target)
      if (blockers.length === 0) return 1.0

      // If the closest blocker is close to the target, splash may still reach
      const closestBlocker = blockers[0]!
      const blockerToTarget = distXY(closestBlocker.x, closestBlocker.y, target.x, target.y)
      const splash = splashRadius(skillId)
      if (splash > 0 && blockerToTarget <= splash) {
        // Splash reaches — diminished based on distance
        return Math.max(0.3, 1.0 - blockerToTarget / (splash * 2))
      }
      return 0.1 // blocked, minimal splash
    }
  }
}

/**
 * Evaluate a skill cast from `castFromPos` aimed at `targetPos` against a group of monsters.
 *
 * @param actualCasterPos - Where the caster actually is right now (for reposition calc)
 * @param castFromPos - Where the caster would cast from (=actualCasterPos for targeted, =desired pos for nova)
 *
 * Scoring: totalUsefulDmg / (frameCost * sqrt(manaCost))
 * - "useful damage" is capped at each monster's current HP (overkill penalty)
 * - Line-of-fire affects reach to primary target for 'stops' skills
 * - Piercing skills score bonus for monsters along the projectile path
 * - groupModifier scales urgency per monster
 */
export function evaluateBattlefield(
  skillId: number,
  actualCasterPos: Pos,
  castFromPos: Pos,
  targetPos: Pos,
  monsters: Monster[],
  charClass: number,
  primaryTarget?: Monster,
  groupModifier?: (target: Monster, nearby: Monster[]) => number,
): ActionScore {
  const range = skillRange(skillId)
  const splash = splashRadius(skillId)
  const nova = isNova(skillId)
  const frames = castingFrames(skillId, charClass)
  const projType = skillProjectileType(skillId)

  let totalUsefulDmg = 0
  let primaryDmg = 0
  let hit = 0

  // For piercing skills: also score monsters along the projectile line
  const pierceLineHits: Set<number> = new Set()
  if (projType === 'pierces' && primaryTarget) {
    const lineMonsters = monstersAlongLine(castFromPos, { x: primaryTarget.x, y: primaryTarget.y }, monsters, primaryTarget)
    for (const m of lineMonsters) {
      const dmg = skillDamageVsUnit(skillId, m)
      if (dmg <= 0) continue
      const monHp = m.hp > 0 ? m.hp : 1
      const useful = Math.min(dmg, monHp)
      const urgency = groupModifier ? groupModifier(m, monsters) : 1.0
      totalUsefulDmg += useful * urgency
      hit++
      pierceLineHits.add(m.unitId)
    }
  }

  for (const mon of monsters) {
    if (pierceLineHits.has(mon.unitId)) continue // already counted for pierce

    // For nova: distance from cast position. For targeted: distance from target point.
    const d = nova
      ? distXY(castFromPos.x, castFromPos.y, mon.x, mon.y)
      : distXY(targetPos.x, targetPos.y, mon.x, mon.y)

    // Check if monster is in range of the effect
    const effectiveRadius = nova ? splash || range : (splash > 0 ? splash : 3)
    if (d > effectiveRadius) continue

    const dmg = skillDamageVsUnit(skillId, mon)
    if (dmg <= 0) continue

    // Cap useful damage at monster's current HP (overkill penalty)
    const monHp = mon.hp > 0 ? mon.hp : 1
    let useful = Math.min(dmg, monHp)

    // Apply group urgency modifier
    const urgency = groupModifier ? groupModifier(mon, monsters) : 1.0
    useful *= urgency

    // Line-of-fire: if this is the primary target and skill stops, apply reach factor
    const isPrimary = primaryTarget && mon.unitId === primaryTarget.unitId
    if (isPrimary && projType === 'stops') {
      const reach = reachFactor(skillId, castFromPos, targetPos, monsters, primaryTarget)
      useful *= reach
      primaryDmg = dmg * reach
    } else if (isPrimary) {
      primaryDmg = dmg
    }

    totalUsefulDmg += useful
    hit++
  }

  // Check if caster needs to reposition
  const moveDist = distXY(actualCasterPos.x, actualCasterPos.y, castFromPos.x, castFromPos.y)
  let needsReposition: boolean
  if (nova) {
    // Nova: re-evaluate from actual position. Score reflects what we'd hit NOW,
    // not from the hypothetical optimal position. Add movement cost if we'd need to move.
    const novaRange = splash || range
    let hitsFromCurrent = 0
    let dmgFromCurrent = 0
    for (const mon of monsters) {
      if (distXY(actualCasterPos.x, actualCasterPos.y, mon.x, mon.y) <= novaRange) {
        const d = skillDamageVsUnit(skillId, mon)
        if (d > 0) {
          hitsFromCurrent++
          const monHp = mon.hp > 0 ? mon.hp : 1
          dmgFromCurrent += Math.min(d, monHp) * (groupModifier ? groupModifier(mon, monsters) : 1.0)
        }
      }
    }
    // Use actual hits/damage from current position for scoring
    if (hitsFromCurrent > 0) {
      // Can hit from here — use current-position damage, no movement needed
      totalUsefulDmg = dmgFromCurrent
      hit = hitsFromCurrent
      needsReposition = false
    } else {
      // Nothing in range — need to move, add movement cost
      needsReposition = true
    }
  } else {
    needsReposition = distXY(actualCasterPos.x, actualCasterPos.y, targetPos.x, targetPos.y) > range
  }
  // Teleport costs ~9 cast frames + 1 frame per 30 units of travel
  const teleFrames = needsReposition ? 9 + Math.ceil(moveDist / 30) : 0
  const totalFrames = frames + teleFrames

  // Mana cost — score = totalUsefulDmg / (frameCost * sqrt(manaCost))
  const manaCost = skillManaCost(skillId)
  const currentMp = getUnitMP()
  let score = 0

  if (totalFrames > 0 && hit > 0) {
    const manaDenom = manaCost > 0 ? Math.sqrt(manaCost) : 1
    score = totalUsefulDmg / (totalFrames * manaDenom)

    // Can't afford it: score 0
    if (manaCost > currentMp) score = 0
    // Low mana: penalize if < 3 casts remaining
    else if (manaCost > 0) score *= Math.min(1, currentMp / (manaCost * 3))
    // Primary target takes 0 damage (immune) — score 0 so we pick a skill that works
    if (primaryTarget && primaryDmg <= 0) score = 0
    // Channeled skills: divide score by penalty (short range + must hold still)
    const ch = channeledSkills[skillId]
    if (ch) score /= ch.divisor
  }

  return {
    skillId,
    casterPos: nova ? castFromPos : actualCasterPos,
    targetPos: nova ? castFromPos : targetPos,
    dpsPerFrame: score,
    primaryDmg,
    monstersHit: hit,
    frameCost: totalFrames,
    manaCost,
    needsReposition,
  }
}

/**
 * Rank all viable skill+position combos for a caster against visible monsters.
 * Returns sorted list (best first) so the caller can skip cooldown/unavailable skills.
 */
// Cached candidate skill list — rebuilt when player level changes
let _candidateCache: { charClass: number, level: number, skills: number[] } | null = null

function getCandidateSkills(charClass: number): number[] {
  const level = getUnitStat(12, 0) // current player level
  if (_candidateCache && _candidateCache.charClass === charClass && _candidateCache.level === level) {
    return _candidateCache.skills
  }

  const skills: number[] = []
  let hasRangedSkill = false
  for (let sk = 1; sk < 360; sk++) {
    if (nonDamage[sk]) continue
    if (ignoreSkill[sk]) continue

    const sl = skillLevel(sk)
    if (sl >= 1) {
      skills.push(sk)
      if (getBaseStat("skills", sk, "range") > 0) hasRangedSkill = true
      continue
    }

    // Level-0 class starting skill — check class + required level + has txt damage
    const skClass = getBaseStat("skills", sk, "charclass")
    if (skClass !== charClass) continue
    // Must meet the skill's required level
    const reqLvl = getBaseStat("skills", sk, "reqlevel")
    if (reqLvl > level) continue
    const bd = baseSkillDamage(sk)
    if (bd.pmin > 0 || bd.pmax > 0 || bd.min > 0 || bd.max > 0) {
      skills.push(sk)
      if (getBaseStat("skills", sk, "range") > 0) hasRangedSkill = true
    }
  }

  // Only include basic Attack (skill 0) if player has no ranged skills
  if (!hasRangedSkill) skills.unshift(0)

  _candidateCache = { charClass, level, skills }
  return skills
}

export function rankActions(
  casterPos: Pos,
  monsterFilter: (m: Monster) => boolean,
  allMonsters: Monster[],
  charClass: number,
  primaryTarget?: Monster,
  skillFilter?: (skillId: number) => boolean,
  maxResults = 5,
  groupModifier?: (target: Monster, nearby: Monster[]) => number,
): ActionScore[] {
  const monsters = allMonsters.filter(monsterFilter)
  if (monsters.length === 0) return []

  const results: ActionScore[] = []

  // Build candidate target positions from actual monsters
  // For targeted skills: aim at each monster. For novas: cast from near each monster.
  const monsterPositions: Pos[] = []
  const seen = new Set<string>()
  for (const m of monsters) {
    const key = `${m.x},${m.y}`
    if (!seen.has(key)) {
      seen.add(key)
      monsterPositions.push({ x: m.x, y: m.y })
    }
  }

  // Also add cluster center for AoE skills
  if (monsters.length > 2) {
    let sx = 0, sy = 0, n = 0
    for (const m of monsters) {
      if (distXY(casterPos.x, casterPos.y, m.x, m.y) < 40) {
        sx += m.x; sy += m.y; n++
      }
    }
    if (n > 0) {
      const cx = (sx / n) | 0, cy = (sy / n) | 0
      const key = `${cx},${cy}`
      if (!seen.has(key)) monsterPositions.push({ x: cx, y: cy })
    }
  }

  // Track best score per skill (don't add same skill twice at different positions)
  const bestPerSkill = new Map<number, ActionScore>()

  // Combined filter: ignoreSkill + user-provided filter
  const effectiveFilter = (sk: number) => {
    if (ignoreSkill[sk]) return false
    return skillFilter ? skillFilter(sk) : true
  }

  // Check for Static Field (skill 42) as a special case
  const staticLevel = skillLevel(42)
  if (staticLevel > 0 && effectiveFilter(42)) {
    const diff = getDifficulty()
    for (const castPos of monsterPositions) {
      let totalUseful = 0, hitCount = 0
      for (const mon of monsters) {
        const d = distXY(castPos.x, castPos.y, mon.x, mon.y)
        if (d > 10) continue
        if (!staticFieldEffective(mon.hp, mon.hpmax, diff)) continue
        totalUseful += staticFieldDamage(mon.hp, diff)
        hitCount++
      }
      if (hitCount > 0) {
        const frames = castingFrames(42, charClass)
        const manaCost = skillManaCost(42)
        const manaDenom = manaCost > 0 ? Math.sqrt(manaCost) : 1
        const moveDist = distXY(casterPos.x, casterPos.y, castPos.x, castPos.y)
        const needsRepo = moveDist > 5
        const teleFrames = needsRepo ? 9 + Math.ceil(moveDist / 30) : 0
        const totalFrames = frames + teleFrames
        let score = totalUseful / (totalFrames * manaDenom)
        const currentMp = getUnitMP()
        if (manaCost > currentMp) score = 0
        else if (manaCost > 0) score *= Math.min(1, currentMp / (manaCost * 3))

        const prev = bestPerSkill.get(42)
        if (!prev || score > prev.dpsPerFrame) {
          bestPerSkill.set(42, {
            skillId: 42,
            casterPos: castPos,
            targetPos: castPos,
            dpsPerFrame: score,
            primaryDmg: primaryTarget ? staticFieldDamage(primaryTarget.hp, diff) : 0,
            monstersHit: hitCount,
            frameCost: totalFrames,
            manaCost,
            needsReposition: needsRepo,
          })
        }
      }
    }
  }

  // Build cached candidate skill list (recalculated when level changes)
  const candidates = getCandidateSkills(charClass)

  const currentMp = getUnitMP()

  for (const sk of candidates) {
    if (sk === 42) continue // Static Field handled above
    if (!effectiveFilter(sk)) continue
    if (skillCooldown(sk)) continue

    // Skip if not enough mana (skill 0 = basic attack costs 0)
    if (sk > 0) {
      const manaCost = skillManaCost(sk)
      if (manaCost > currentMp) continue
    }

    const dmg = skillDamage(sk)
    if (dmg.pmin === 0 && dmg.pmax === 0 && dmg.min === 0 && dmg.max === 0) continue

    const nova = isNova(sk)

    for (const targetPos of monsterPositions) {
      // For novas: cast from the target position (we teleport there).
      // For targeted: cast from actual caster position, aim at monster.
      const castFromPos = nova ? targetPos : casterPos
      const score = evaluateBattlefield(sk, casterPos, castFromPos, targetPos, monsters, charClass, primaryTarget, groupModifier)
      if (score.monstersHit === 0) continue

      const prev = bestPerSkill.get(sk)
      if (!prev || score.dpsPerFrame > prev.dpsPerFrame) {
        bestPerSkill.set(sk, score)
      }
    }
  }

  results.push(...bestPerSkill.values())
  results.sort((a, b) => b.dpsPerFrame - a.dpsPerFrame)
  return results.slice(0, maxResults)
}

/** Convenience: return the single best action, or null */
export function findBestAction(
  casterPos: Pos,
  monsterFilter: (m: Monster) => boolean,
  allMonsters: Monster[],
  charClass: number,
  primaryTarget?: Monster,
  skillFilter?: (skillId: number) => boolean,
  groupModifier?: (target: Monster, nearby: Monster[]) => number,
): ActionScore | null {
  const ranked = rankActions(casterPos, monsterFilter, allMonsters, charClass, primaryTarget, skillFilter, 1, groupModifier)
  return ranked[0] ?? null
}

// --- Pre-attack (spawn prediction) functions ---

import type { SpawnEvent, PreAttackAction } from "./attack-types.js"

// Impact delay in frames for skills with meaningful delay between cast and damage landing.
// Most skills are instant (cast frames only). These are the exceptions.
const impactDelay: Record<number, number> = {
  56: 60,   // Meteor — ~60 frames after cast animation
  55: 20,   // Blizzard — ~20 frames for first shard wave
  64: 12,   // Frozen Orb — ~12 frames travel to center
  234: 30,  // Fissure — ~30 frames for fissure eruptions
  244: 40,  // Volcano — ~40 frames for eruption
  249: 20,  // Armageddon — ~20 frames for first rock
}

/** Total frames from button press to damage landing at target position. */
export function skillLeadTime(skillId: number, distance: number, charClass: number): number {
  const castFrames = castingFrames(skillId, charClass)
  const delay = impactDelay[skillId] ?? 0

  // Projectile travel time for missile skills (not ground AoE)
  let travelTime = 0
  if (delay === 0 && !groundAoeSkills.has(skillId) && !novaLike[skillId]) {
    const missile = getBaseStat("skills", skillId, "srvmissile") as number
    if (missile > 0) {
      const speed = getBaseStat("missiles", missile, "Vel") as number
      if (speed > 0) travelTime = Math.ceil(distance / speed)
    }
  }

  return castFrames + delay + travelTime
}

/** Compute average damage of a skill against a classId using txt resists (no live unit needed). */
export function skillDamageVsClassId(skillId: number, classId: number): number {
  const dmg = skillDamage(skillId)
  if (dmg.pmin === 0 && dmg.pmax === 0 && dmg.min === 0 && dmg.max === 0) return 0

  const isUndeadMon = getBaseStat("monstats", classId, "hUndead") || getBaseStat("monstats", classId, "lUndead")
  if (dmg.undeadOnly && !isUndeadMon) return 0

  let total = 0

  const avgP = (dmg.pmin + dmg.pmax) / 2
  if (avgP > 0) {
    const presist = Math.max(-100, Math.min(100, monsterResist(classId, "Physical")))
    total += avgP * (100 - presist) / 100
  }

  const avgE = (dmg.min + dmg.max) / 2
  if (avgE > 0) {
    let resist = monsterResist(classId, dmg.type)
    const pierceStat = pierceMap[dmg.type]
    const pierce = pierceStat ? getUnitStat(pierceStat, 0) : 0
    if (resist < 100) {
      resist = Math.max(-100, resist - pierce)
    } else {
      resist = 100
    }
    total += avgE * (100 - resist) / 100
  }

  return total
}

function distPos(a: Pos, b: Pos): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Decide what to do right now given a predicted spawn event.
 * Returns cast/reposition/wait based on timing.
 */
export function preAttackAdvice(myPos: Pos, event: SpawnEvent, charClass: number): PreAttackAction {
  // Find best skill: highest damage / castFrames ratio vs this classId
  let bestSkill = -1
  let bestRatio = 0

  for (let sk = 0; sk < 360; sk++) {
    if (nonDamage[sk]) continue
    if (ignoreSkill[sk]) continue
    if (skillLevel(sk) < 1) continue
    if (skillCooldown(sk)) continue

    const dmg = skillDamageVsClassId(sk, event.classId)
    if (dmg <= 0) continue

    const frames = castingFrames(sk, charClass)
    const ratio = dmg / frames
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestSkill = sk
    }
  }

  if (bestSkill < 0) return { type: 'wait' }

  const range = skillRange(bestSkill)
  const nova = isNova(bestSkill)

  // Where to stand for casting
  const castPos: Pos = nova ? event.pos : myPos
  const dist = distPos(myPos, event.pos)
  const needsReposition = nova ? dist > 5 : dist > range

  // Teleport cost: ~1 frame per 30 units + cast frames
  const teleFrames = needsReposition ? Math.max(1, Math.ceil(dist / 30)) : 0
  const leadTime = skillLeadTime(bestSkill, distPos(castPos, event.pos), charClass) + teleFrames

  const timing = event.framesUntilSpawn - leadTime

  // Fire window: timing is within [-2, +4] — cast now
  if (timing >= -2 && timing <= 4) {
    const aimPos = nova ? event.pos : event.pos
    return { type: 'cast', skill: bestSkill, x: aimPos.x, y: aimPos.y }
  }

  // Need to reposition and have time — do it now if we'd arrive with enough lead time
  if (needsReposition && timing > 4) {
    const repoTarget = nova ? event.pos : myPos // for non-nova, stay put — only move if nova
    if (nova) return { type: 'reposition', x: event.pos.x, y: event.pos.y }
  }

  return { type: 'wait' }
}

export { resistMap, pierceMap, masteryMap, convictionEligible, lowerResistEligible, nonDamage, damageTypes, ignoreSkill, preAttackable, piercingSkills };
