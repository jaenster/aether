aether.log("init.lua loaded")

local allocs, frees, fog = aether.getAllocStats()
if fog then
    aether.log(string.format("allocator: FOG pool (%d allocs, %d frees so far)", allocs, frees))
else
    aether.log("allocator: libc fallback")
end

local tick_count = 0

function onTick()
    tick_count = tick_count + 1
    if tick_count % 1000 == 0 then
        local x, y = aether.getPlayerPos()
        if x then
            aether.log(string.format("tick %d — pos %d,%d", tick_count, x, y))
        end
    end
end
