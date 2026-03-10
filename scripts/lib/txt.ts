import { txtReadField, txtReadFieldU } from "diablo:native";

// Table IDs matching native binding
const TBL_MONSTATS = 0;
const TBL_SKILLS = 1;
const TBL_LEVELS = 2;

// D2MonStatsTxt field offsets (struct size: 0x1A8)
const monStatsFields: Record<string, [number, number, boolean?]> = {
  // [offset, size, unsigned?]
  Id:           [0x000, 2, true],
  BaseId:       [0x002, 2],
  NextInClass:  [0x004, 2],
  NameStr:      [0x006, 2, true],
  DescStr:      [0x008, 2, true],
  // flags at 0x00C (bitfield, read as i32)
  flags:        [0x00C, 4],
  Code:         [0x010, 4],
  MonSound:     [0x014, 2],
  UMonSound:    [0x016, 2],
  MonStatsEx:   [0x018, 2],
  MonProp:      [0x01A, 2],
  MonType:      [0x01C, 2],
  AI:           [0x01E, 2],
  Spawn:        [0x020, 2],
  SpawnX:       [0x022, 1],
  SpawnY:       [0x023, 1],
  SpawnMode:    [0x024, 2],
  minion1:      [0x026, 2],
  minion2:      [0x028, 2],
  MonEquipTxt:  [0x02A, 2],
  nEquipOffset: [0x02C, 2],
  Rarity:       [0x02E, 2, true],
  MinGrp:       [0x030, 1, true],
  MaxGrp:       [0x031, 1, true],
  Velocity:     [0x032, 2],
  Run:          [0x034, 2],
  Align:        [0x036, 1],
  TransLvl:     [0x037, 1],
  threat:       [0x038, 1, true],
  // Level/Night/Hell at 0xAA-0xAE
  Level:        [0x0AA, 2],
  "Level(N)":   [0x0AC, 2],
  "Level(H)":   [0x0AE, 2],
  // HP fields
  minHP:        [0x0B0, 2, true],
  maxHP:        [0x0B2, 2, true],
  "minHP(N)":   [0x0B4, 2, true],
  "maxHP(N)":   [0x0B6, 2, true],
  "minHP(H)":   [0x0B8, 2, true],
  "maxHP(H)":   [0x0BA, 2, true],
  // Damage fields
  A1MinD:       [0x0DA, 2, true],
  A1MaxD:       [0x0DC, 2, true],
  "A1MinD(N)":  [0x0DE, 2, true],
  "A1MaxD(N)":  [0x0E0, 2, true],
  "A1MinD(H)":  [0x0E2, 2, true],
  "A1MaxD(H)":  [0x0E4, 2, true],
  A2MinD:       [0x0E6, 2, true],
  A2MaxD:       [0x0E8, 2, true],
  "A2MinD(N)":  [0x0EA, 2, true],
  "A2MaxD(N)":  [0x0EC, 2, true],
  "A2MinD(H)":  [0x0EE, 2, true],
  "A2MaxD(H)":  [0x0F0, 2, true],
  S1MinD:       [0x0F2, 2, true],
  S1MaxD:       [0x0F4, 2, true],
  "S1MinD(N)":  [0x0F6, 2, true],
  "S1MaxD(N)":  [0x0F8, 2, true],
  "S1MinD(H)":  [0x0FA, 2, true],
  "S1MaxD(H)":  [0x0FC, 2, true],
  // Experience
  Exp:          [0x0D4, 2, true],
  "Exp(N)":     [0x0D6, 2, true],
  "Exp(H)":     [0x0D8, 2, true],
  // Drain effectiveness
  Drain:        [0x0A0, 1],
  "Drain(N)":   [0x0A1, 1],
  "Drain(H)":   [0x0A2, 1],
  // Block
  ToBlock:      [0x0A3, 1, true],
  "ToBlock(N)": [0x0A4, 1, true],
  "ToBlock(H)": [0x0A5, 1, true],
  // Resistances (at 0x144-0x166, signed shorts for each diff)
  ResDm:        [0x144, 2],
  "ResDm(N)":   [0x146, 2],
  "ResDm(H)":   [0x148, 2],
  ResMa:        [0x14A, 2],
  "ResMa(N)":   [0x14C, 2],
  "ResMa(H)":   [0x14E, 2],
  ResFi:        [0x150, 2],
  "ResFi(N)":   [0x152, 2],
  "ResFi(H)":   [0x154, 2],
  ResLi:        [0x156, 2],
  "ResLi(N)":   [0x158, 2],
  "ResLi(H)":   [0x15A, 2],
  ResCo:        [0x15C, 2],
  "ResCo(N)":   [0x15E, 2],
  "ResCo(H)":   [0x160, 2],
  ResPo:        [0x162, 2],
  "ResPo(N)":   [0x164, 2],
  "ResPo(H)":   [0x166, 2],
  // Misc
  DamageRegen:  [0x09C, 2],
  neverCount:   [0x00C, 4], // bit 18 in flags — caller checks (flags >> 18) & 1
  killable:     [0x00C, 4], // bit 15 — (flags >> 15) & 1
  isMelee:      [0x00C, 4], // bit 1 — (flags >> 1) & 1
  boss:         [0x00C, 4], // bit 6
  primeevil:    [0x00C, 4], // bit 7
  npc:          [0x00C, 4], // bit 8
  lUndead:      [0x00C, 4], // bit 11
  hUndead:      [0x00C, 4], // bit 12
  demon:        [0x00C, 4], // bit 13
  flying:       [0x00C, 4], // bit 14
  switchai:     [0x00C, 4], // bit 16
  petIgnore:    [0x00C, 4], // bit 19
  deathDmg:     [0x00C, 4], // bit 24
  RangedType:   [0x036, 1], // Actually Align byte, reused — check context
  PartyMin:     [0x03A, 1, true],
  PartyMax:     [0x03B, 1, true],
  ColdEffect:   [0x0BC, 2],
  "ColdEffect(N)": [0x0BE, 2],
  "ColdEffect(H)": [0x0C0, 2],
};

// Bit positions for flag fields in the flags i32 at 0x00C
const monStatsFlagBits: Record<string, number> = {
  isSpawn: 0, isMelee: 1, noRatio: 2, opendoors: 3,
  SetBoss: 4, BossXfer: 5, boss: 6, primeevil: 7,
  npc: 8, interact: 9, inTown: 10, lUndead: 11,
  hUndead: 12, demon: 13, flying: 14, killable: 15,
  switchai: 16, nomultishot: 17, neverCount: 18, petIgnore: 19,
  deathDmg: 24,
};

// D2SkillsTxt field offsets (struct size: 0x23C)
const skillsFields: Record<string, [number, number, boolean?]> = {
  skill:        [0x000, 2],
  flags:        [0x004, 1, true],
  nFlags:       [0x006, 1, true],
  charclass:    [0x00C, 1],
  anim:         [0x010, 1],
  range:        [0x014, 1],
  SelectProc:   [0x015, 1],
  srvstfunc:    [0x02C, 2],
  srvdofunc:    [0x02E, 2],
  srvmissile:   [0x046, 2],
  srvmissilea:  [0x048, 2],
  srvmissileb:  [0x04A, 2],
  srvmissilec:  [0x04C, 2],
  aurafilter:   [0x050, 4],
  aurastate:    [0x080, 2],
  passivestate: [0x094, 2],
  cltmissile:   [0x0E8, 2],
  cltmissilea:  [0x0EA, 2],
  cltmissileb:  [0x0EC, 2],
  perdelay:     [0x128, 4],
  maxlvl:       [0x12C, 2],
  HitFlags:     [0x130, 4],
  Param1:       [0x148, 4],
  Param2:       [0x14C, 4],
  Param3:       [0x150, 4],
  Param4:       [0x154, 4],
  Param5:       [0x158, 4],
  Param6:       [0x15C, 4],
  Param7:       [0x160, 4],
  Param8:       [0x164, 4],
  reqlevel:     [0x174, 2],
  reqskill1:    [0x17E, 2],
  reqskill2:    [0x180, 2],
  reqskill3:    [0x182, 2],
  startmana:    [0x184, 2],
  minmana:      [0x186, 2],
  manashift:    [0x188, 2],
  mana:         [0x18A, 2],
  lvlmana:      [0x18C, 2],
  delay:        [0x190, 4],
  skilldesc:    [0x194, 2],
  ToHit:        [0x198, 4],
  LevToHit:     [0x19C, 4],
  HitShift:     [0x1A4, 1],
  SrcDam:       [0x1A5, 1, true],
  MinDam:       [0x1A8, 4],
  MaxDam:       [0x1AC, 4],
  MinLevDam1:   [0x1B0, 4],
  MinLevDam2:   [0x1B4, 4],
  MinLevDam3:   [0x1B8, 4],
  MinLevDam4:   [0x1BC, 4],
  MinLevDam5:   [0x1C0, 4],
  MaxLevDam1:   [0x1C4, 4],
  MaxLevDam2:   [0x1C8, 4],
  MaxLevDam3:   [0x1CC, 4],
  MaxLevDam4:   [0x1D0, 4],
  MaxLevDam5:   [0x1D4, 4],
  DmgSymPerCalc:[0x1D8, 4],
  EType:        [0x1DC, 4],
  EMin:         [0x1E0, 4],
  EMax:         [0x1E4, 4],
  EMinLev1:     [0x1E8, 4],
  EMinLev2:     [0x1EC, 4],
  EMinLev3:     [0x1F0, 4],
  EMinLev4:     [0x1F4, 4],
  EMinLev5:     [0x1F8, 4],
  EMaxLev1:     [0x1FC, 4],
  EMaxLev2:     [0x200, 4],
  EMaxLev3:     [0x204, 4],
  EMaxLev4:     [0x208, 4],
  EMaxLev5:     [0x20C, 4],
  EDmgSymPerCalc:[0x210, 4],
  ELen:         [0x214, 4],
  ELevLen1:     [0x218, 4],
  ELevLen2:     [0x21C, 4],
  ELevLen3:     [0x220, 4],
  ELenSymPerCalc:[0x224, 4],
  state1:       [0x22A, 2],
  state2:       [0x22C, 2],
  state3:       [0x22E, 2],
  aitype:       [0x230, 1],
  aibonus:      [0x232, 2],
  costmult:     [0x234, 4],
  costadd:      [0x238, 4],
};

const tableMap: Record<string, [number, Record<string, [number, number, boolean?]>]> = {
  monstats:  [TBL_MONSTATS, monStatsFields],
  monstats2: [TBL_MONSTATS, monStatsFields], // TODO: separate monstats2 if needed
  skills:    [TBL_SKILLS, skillsFields],
  Skills:    [TBL_SKILLS, skillsFields],
  levels:    [TBL_LEVELS, {}], // TODO: add level field offsets when needed
};

export function getBaseStat(table: string, id: number, field: string): number {
  const entry = tableMap[table];
  if (!entry) return 0;

  const [tableId, fields] = entry;

  // Check if this is a flag field (monstats bitfield at 0x00C)
  if (tableId === TBL_MONSTATS && monStatsFlagBits[field] !== undefined) {
    const flags = txtReadField(tableId, id, 0x00C, 4);
    return (flags >> monStatsFlagBits[field]) & 1;
  }

  const fieldDef = fields[field];
  if (!fieldDef) return 0;

  const [offset, size, unsigned] = fieldDef;
  return unsigned ? txtReadFieldU(tableId, id, offset, size) : txtReadField(tableId, id, offset, size);
}

export { monStatsFields, skillsFields, monStatsFlagBits };
