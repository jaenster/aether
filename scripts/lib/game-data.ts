import { getUnitStat, getDifficulty, getUnitHP, getUnitMaxHP, getUnitMP, getSkillLevel as _getSkillLevel } from "diablo:native";
import { getBaseStat } from "./txt.js";

// Stat IDs
const STAT_LEVEL = 12;
const STAT_FCR = 105;

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

const damageTypes = ["Physical", "Fire", "Lightning", "Magic", "Cold", "Poison", "?", "?", "?", "Physical"];

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

// Skill radius for AoE modifier
const skillRadius: Record<number, number> = {
  55: 3, 56: 12, 92: 24, 154: 12, 249: 24, 250: 24, 251: 3,
};

// Nova-like skills (centered on caster, not target)
const novaLike: Record<number, boolean> = {
  44: true, 48: true, 92: true, 112: true, 154: true, 249: true, 250: true,
};

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

function monsterMaxHP(monId: number, areaId: number, adjustLevel = 0): number {
  const diff = getDifficulty();
  const mlvl = Math.min(HPLookup.length - 1, monsterLevel(monId, areaId) + adjustLevel);
  const hpField = ["maxHP", "maxHP(N)", "maxHP(H)"][diff];
  return HPLookup[mlvl][diff] * getBaseStat("monstats", monId, hpField) / 100;
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
  return fields ? getBaseStat("monstats", monId, fields[diff]) : 0;
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

export function skillDamage(skillId: number): DamageInfo {
  if (skillId === 0) return { type: "Physical", pmin: 2, pmax: 8, min: 0, max: 0 };
  if (skillLevel(skillId) < 1) {
    return { type: damageTypes[getBaseStat("skills", skillId, "EType")] || "Physical", pmin: 0, pmax: 0, min: 0, max: 0 };
  }

  const dmg = baseSkillDamage(skillId);
  let mastery = 1, psynergy = 1, synergy = 1;

  // Apply synergies
  const sc = synergyCalc[skillId];
  if (sc) {
    for (let c = 0; c < sc.length; c += 2) {
      const sl = baseLevel(sc[c]);
      if (skillId === 229 || skillId === 244) {
        if (sc[c] === 229 || sc[c] === 244) {
          psynergy += sl * sc[c + 1];
        } else {
          synergy += sl * sc[c + 1];
        }
      } else {
        psynergy += sl * sc[c + 1];
        synergy += sl * sc[c + 1];
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

export function monsterEffort(monId: number, areaId: number, conviction = 0, ampDmg = 0): EffortResult {
  const result: EffortResult = { effort: Infinity, skill: -1, type: "Physical" };
  const hp = monsterMaxHP(monId, areaId);
  const isUndead = getBaseStat("monstats", monId, "hUndead") || getBaseStat("monstats", monId, "lUndead");

  // Iterate known skill IDs (the player's skills)
  // For now, check all common skill IDs and skip ones we don't have
  for (let sk = 0; sk < 360; sk++) {
    if (nonDamage[sk]) continue;
    if (skillLevel(sk) < 1) continue;
    if (skillCooldown(sk)) continue;

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
    // TODO: use Skill.getManaCost when available
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
  const fcr = getUnitStat(STAT_FCR, 0);
  const effectiveFCR = Math.min(75, (fcr * 120 / (fcr + 120)) | 0);
  const isLightning = skillId === 49 || skillId === 53;
  const baseCastRate = [20, isLightning ? 19 : 14, 16, 16, 14, 15, 17][charClass];

  if (isLightning) {
    return Math.round(256 * baseCastRate / (256 * (100 + effectiveFCR) / 100));
  }
  return Math.ceil(256 * baseCastRate / Math.floor(256 * (100 + effectiveFCR) / 100)) - 1;
}

export { resistMap, pierceMap, masteryMap, convictionEligible, nonDamage, damageTypes };
