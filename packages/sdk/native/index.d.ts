
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
  export function logVerbose(message: string): void;

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
  /** Get monster max HP from txt tables for current difficulty. */
  export function monGetMaxHP(classId: number): number;

  // Item properties
  export function itemGetQuality(unitId: number): number;
  export function itemGetFlags(unitId: number): number;
  export function itemGetLocation(unitId: number): number;
  export function itemGetLocationRaw(unitId: number): number;
  export function itemGetCode(unitId: number): string;
  export function itemGetRunewordIndex(unitId: number): number;

  // Tile properties
  export function tileGetDestArea(unitId: number): number;

  // Player
  export function meGetCharName(): string;
  export function meGetUnitId(): number;

  // Actions
  export function clickMap(type: number, shift: number, x: number, y: number): void;
  export function move(x: number, y: number): void;
  export function selectSkill(skillId: number, hand: number): void;
  export function castSkillAt(x: number, y: number): void;
  /** Cast right skill at world coords via packet (works off-screen, no animation). */
  export function castSkillPacket(x: number, y: number): void;
  export function getRightSkill(): number;
  export function getUIFlag(flag: number): boolean;
  export function say(message: string): void;
  export function interact(type: number, unitId: number): void;
  export function runToEntity(type: number, unitId: number): void;

  // Map & pathfinding
  export function getExits(): string | null;
  export function findPath(x: number, y: number): string | null;
  export function findTelePath(x: number, y: number): string | null;
  export function findPreset(type: number, classid: number): string | undefined;

  // Skills
  export function getSkillLevel(skillId: number, includeItems: number): number;

  // Locale strings
  export function getLocaleString(index: number): string;

  // Txt record access
  export function txtReadField(table: number, row: number, column: number, signed: number): number;
  export function txtReadFieldU(table: number, row: number, column: number, signed: number): number;

  // NPC interaction
  export function closeNPCInteract(): void;
  export function npcMenuSelect(menuIndex: number): boolean;

  // Merc
  /** Returns merc state: -1 = no merc, 0 = dead, 1+ = HP percent */
  export function getMercState(): number;

  // Game control
  export function exitGame(): void;
  export function exitClient(): void;
  export function takeWaypoint(waypointUnitId: number, destArea: number): void;

  // Raw packet sending — accepts Uint8Array with packet bytes
  export function sendPacket(data: Uint8Array): void;

  // Packet hooks — S2C interception
  export function registerPacketHook(opcode: number): void;
  export function getPacketData(): Uint8Array;
  export function getPacketSize(): number;
  export function injectPacket(data: Uint8Array): void;

  // Collision & spatial
  export function getCollision(x: number, y: number): number;
  /** Get collision for a rectangle. Returns hex string: 4 chars per tile, row-major. */
  export function getCollisionRect(x: number, y: number, w: number, h: number): string;
  /** Get all Room1 bounding boxes: "x,y,w,h;x,y,w,h;..." */
  export function getRooms(): string;
  export function hasLineOfSight(x1: number, y1: number, x2: number, y2: number): number;
  export function getMapSeed(): number;
  export function getRoomSeed(x: number, y: number): string;

  // Screen output
  export function printScreen(message: string, color: number): void;

  // Quest / waypoint / player type
  export function getQuest(questId: number, subId: number): number;
  export function hasWaypoint(wpIndex: number): boolean;
  export function meGetClassId(): number;
  export function meGetGameType(): number;
  export function meGetPlayerType(): number;
  export function meGetLevel(): number;
  export function meGetGold(): number;
  export function meGetGoldStash(): number;
  export function clickItem(mode: number, unitId: number): void;
  export function getInteractedNPC(): number;

  // OOG control system
  /** Snapshot all OOG controls and return count. Call before get/find. */
  export function oogControlCount(): number;
  /** Get control info by index: "type,state,x,y,w,h" */
  export function oogControlGetInfo(index: number): string;
  /** Get text from editbox or button label by index */
  export function oogControlGetText(index: number): string;
  /** Set text on an editbox control */
  export function oogControlSetText(index: number, text: string): boolean;
  /** Click/invoke a control's callback */
  export function oogControlClick(index: number): boolean;
  /** Simulate a mouse click at screen coordinates (for OOG screens) */
  export function oogClickScreen(x: number, y: number): void;
  /** Find control by criteria (-1 = wildcard). Returns index or -1. */
  export function oogControlFind(type: number, x: number, y: number, w: number, h: number): number;
  /** Get all controls as JSON array with type/state/x/y/w/h/text */
  export function oogControlGetAll(): string;
  /** Select a class on the create char screen (calls ClickOnClassCreate) */
  export function oogSelectClass(classId: number): boolean;
  /** Select a character by name and enter game (single player) */
  export function oogSelectChar(name: string): boolean;

  // File persistence (reads/writes next to Game.exe)
  /** Read a file from the game directory. Returns contents or "" if not found. */
  export function readFile(filename: string): string;
  /** Write a file to the game directory. Returns true on success. */
  export function writeFile(filename: string, content: string): boolean;
