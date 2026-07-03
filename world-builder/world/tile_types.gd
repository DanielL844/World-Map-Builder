class_name TileTypes
extends RefCounted
## Central registry of tile / biome types.
##
## The integer id of each type is stored (as one byte) in chunk data and in save
## files, so these values MUST stay stable across versions. Add new types at the
## end; never renumber existing ones.

enum Type {
	DEEP_WATER = 0,
	SHALLOW_WATER = 1,
	SAND = 2,
	GRASS = 3,
	FOREST = 4,
	JUNGLE = 5,
	SAVANNA = 6,
	DESERT = 7,
	BADLANDS = 8,
	TUNDRA = 9,
	SNOW = 10,
	SWAMP = 11,
	ROCK = 12,
}

## Total number of tile types. Keep in sync with the enum above.
const COUNT := 13

## Display colour per type. Index == Type value (must stay ordered 0..COUNT-1).
## Static var (not const) because Color("hex") is a runtime constructor.
static var COLORS: Array[Color] = [
	Color("1b3a5b"), # 0  Deep Water
	Color("2f6d9e"), # 1  Shallow Water
	Color("d9c48a"), # 2  Sand
	Color("6fae4b"), # 3  Grass
	Color("2f7d32"), # 4  Forest
	Color("1f5e2a"), # 5  Jungle
	Color("bfae5a"), # 6  Savanna
	Color("d8b24a"), # 7  Desert
	Color("a05a3a"), # 8  Badlands
	Color("9fb0a0"), # 9  Tundra
	Color("eef2f5"), # 10 Snow
	Color("4f6b52"), # 11 Swamp
	Color("8a8a8a"), # 12 Rock
]

## Human-readable name per type. Index == Type value.
const NAMES: Array[String] = [
	"Deep Water", "Shallow Water", "Sand", "Grass", "Forest", "Jungle",
	"Savanna", "Desert", "Badlands", "Tundra", "Snow", "Swamp", "Rock",
]
