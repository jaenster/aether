
  // State
  export function getArea(): number;
  export function getAct(): number;
  export function getUnitX(): number;
  export function getUnitY(): number;
  export function getUnitHP(): number;
  export function getUnitMaxHP(): number;
  export function getUnitMP(): number;
  export function getUnitMaxMP(): number;
  export function getUnitStat(stat: number, layer: number): number;
  export function inGame(): boolean;
  export function getDifficulty(): number;
  export function getTickCount(): number;
  export function log(message: string): void;

  // Unit iteration
  export function unitCount(type: number): number;
  export function unitAtIndex(index: number): number;
  export function unitValid(type: number, unitId: number): boolean;

  // Unit properties (handle-based: type, id)
  export function unitGetX(type: number, unitId: number): number;
  export function unitGetY(type: number, unitId: number): number;
  export function unitGetMode(type: number, unitId: number): number;
  export function unitGetClassId(type: number, unitId: number): number;
  export function unitGetStat(type: number, unitId: number, stat: number, layer: number): number;
  export function unitGetState(type: number, unitId: number, state: number): boolean;
  export function unitGetName(type: number, unitId: number): string;
  export function unitGetArea(type: number, unitId: number): number;
  export function unitGetFlags(type: number, unitId: number): number;
  export function unitGetOwnerId(type: number, unitId: number): number;
  export function unitGetOwnerType(type: number, unitId: number): number;

  // Monster properties
  export function monGetSpecType(unitId: number): number;
  export function monGetEnchants(unitId: number): number[];

  // Item properties
  export function itemGetQuality(unitId: number): number;
  export function itemGetFlags(unitId: number): number;
  export function itemGetLocation(unitId: number): number;
  export function itemGetCode(unitId: number): string;

  // Tile properties
  export function tileGetDestArea(unitId: number): number;

  // Player
  export function meGetCharName(): string;

  // Actions
  export function clickMap(type: number, shift: number, x: number, y: number): void;
  export function move(x: number, y: number): void;
  export function selectSkill(skillId: number, hand: number): void;
  export function castSkillAt(x: number, y: number): void;
  export function getUIFlag(flag: number): boolean;
  export function say(message: string): void;
  export function interact(type: number, unitId: number): void;
  export function runToEntity(type: number, unitId: number): void;

  // Map & pathfinding
  export function getExits(): string | null;
  export function findPath(x: number, y: number): string | null;
  export function findPreset(type: number, classid: number): string | undefined;

  // Skills
  export function getSkillLevel(skillId: number, includeItems: number): number;

  // Txt record access
  export function txtReadField(table: number, row: number, column: number, signed: number): number;
  export function txtReadFieldU(table: number, row: number, column: number, signed: number): number;

  // Process control
  export function exitGame(code: number): never;
