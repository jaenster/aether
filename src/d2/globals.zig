const types = @import("types.zig");
const UnitAny = types.UnitAny;
const UnitHashTableCollection = types.UnitHashTableCollection;
const D2CharSelStrc = types.D2CharSelStrc;
const AutomapLayer = types.AutomapLayer;

const DWORD = u32;

fn globalRef(comptime T: type, comptime addr: usize) *T {
    return @ptrFromInt(addr);
}

fn globalPtr(comptime T: type, comptime addr: usize) **T {
    return @ptrFromInt(addr);
}

// Unit hash tables
pub fn clientSideUnits() *UnitHashTableCollection {
    return globalRef(UnitHashTableCollection, 0x7A5270);
}

pub fn serverSideUnits() *UnitHashTableCollection {
    return globalRef(UnitHashTableCollection, 0x7A5E70);
}

// Player
pub fn playerUnit() *?*UnitAny {
    return @ptrFromInt(0x7A6A70);
}

pub fn noPickUp() *DWORD {
    return globalRef(DWORD, 0x7A6A90);
}

// Game info
pub fn gameInfo() *?*anyopaque {
    return @ptrFromInt(0x7A0438);
}

pub fn currentGameType() *c_int {
    return globalRef(c_int, 0x7A0610);
}

// Window handles
pub fn hInst() *?*anyopaque {
    return @ptrFromInt(0x7C8CA8);
}

pub fn hWnd() *?*anyopaque {
    return @ptrFromInt(0x7C8CBC);
}

// Char select / launcher
pub fn charSelStrcFirst() *?*D2CharSelStrc {
    return @ptrFromInt(0x779DC0);
}

pub fn gnSelectedCharGameState() *c_int {
    return globalRef(c_int, 0x7795E8);
}

pub fn oogCurrentCharSelectionMode() *c_int {
    return globalRef(c_int, 0x7795EC);
}

pub fn iniDataLauncher() *?*anyopaque {
    return @ptrFromInt(0x7795D4);
}

// Automap
pub fn automapLayer() *?*types.AutomapLayer {
    return @ptrFromInt(0x7A5164);
}

pub fn automapOffset() *types.POINT {
    return @ptrFromInt(0x7A5198);
}

// Screen
pub fn screenWidth() *c_int {
    return @ptrFromInt(0x71146C);
}

pub fn screenHeight() *c_int {
    return @ptrFromInt(0x711470);
}

pub fn divisor() *c_int {
    return @ptrFromInt(0x711254);
}
