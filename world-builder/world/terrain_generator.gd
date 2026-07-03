class_name TerrainGenerator
extends RefCounted
## Procedural terrain: layered, domain-warped noise -> elevation, temperature and
## moisture -> biome tiles, plus noise-based winding rivers.
##
## First real port of the WorldForge idea. Every sample is a pure function of the
## world coordinate, so chunks generated independently still line up seamlessly.
## Tune the constants and thresholds freely.

var config: WorldConfig
var _elevation: FastNoiseLite
var _moisture: FastNoiseLite
var _temperature: FastNoiseLite
var _warp: FastNoiseLite
var _river: FastNoiseLite

const WARP_STRENGTH := 42.0   ## How far elevation coords are domain-warped (tiles).
const RIVER_WIDTH := 0.035    ## Half-width of river bands in noise space.


func _init(world_config: WorldConfig) -> void:
	config = world_config
	var s := config.world_seed
	_elevation = _make_noise(s, 0.004, 5)
	_moisture = _make_noise(s + 1337, 0.006, 3)
	_temperature = _make_noise(s + 4242, 0.0035, 2)
	_warp = _make_noise(s + 9001, 0.010, 2)
	_river = _make_noise(s + 5555, 0.006, 2)


func _make_noise(seed_value: int, frequency: float, octaves: int) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.noise_type = FastNoiseLite.TYPE_PERLIN
	n.seed = seed_value
	n.frequency = frequency
	n.fractal_octaves = octaves
	return n


func generate_chunk(chunk_coord: Vector2i) -> Chunk:
	var cs := config.chunk_size
	var chunk := Chunk.new(chunk_coord, cs)
	var base := chunk_coord * cs
	for ly in cs:
		for lx in cs:
			chunk.set_tile(lx, ly, _tile_at(base.x + lx, base.y + ly))
	return chunk


func _tile_at(wx: int, wy: int) -> int:
	var e := _elevation_at(wx, wy)

	if e < config.sea_level - 0.06:
		return TileTypes.Type.DEEP_WATER
	if e < config.sea_level:
		return TileTypes.Type.SHALLOW_WATER
	if e < config.sea_level + 0.015:
		return TileTypes.Type.SAND

	# Rivers carve through low / mid land (never mountains).
	if e < 0.72 and _is_river(wx, wy):
		return TileTypes.Type.SHALLOW_WATER

	if e > 0.88:
		return TileTypes.Type.SNOW
	if e > 0.78:
		return TileTypes.Type.ROCK

	var t := _temperature_at(wx, wy, e)
	var m := _norm(_moisture.get_noise_2d(float(wx), float(wy)))
	return _biome(e, t, m)


## Whittaker-ish biome from elevation, temperature (0 cold .. 1 hot) and moisture.
func _biome(e: float, t: float, m: float) -> int:
	if t < 0.20:
		return TileTypes.Type.SNOW if m > 0.5 else TileTypes.Type.TUNDRA
	if t < 0.35:
		return TileTypes.Type.TUNDRA

	if t > 0.72: # hot
		if m < 0.20:
			return TileTypes.Type.DESERT
		if m < 0.38:
			return TileTypes.Type.SAVANNA
		if m < 0.62:
			return TileTypes.Type.GRASS
		return TileTypes.Type.JUNGLE

	# temperate
	if m < 0.22:
		return TileTypes.Type.BADLANDS
	if m < 0.45:
		return TileTypes.Type.GRASS
	if m < 0.72:
		return TileTypes.Type.FOREST
	return TileTypes.Type.SWAMP if e < config.sea_level + 0.06 else TileTypes.Type.FOREST


func _elevation_at(wx: int, wy: int) -> float:
	var ox := _warp.get_noise_2d(float(wx), float(wy)) * WARP_STRENGTH
	var oy := _warp.get_noise_2d(float(wx) + 1000.0, float(wy) - 1000.0) * WARP_STRENGTH
	var e := _norm(_elevation.get_noise_2d(float(wx) + ox, float(wy) + oy))
	return _apply_island_falloff(wx, wy, e)


func _temperature_at(wx: int, wy: int, e: float) -> float:
	var tiles := config.world_tiles()
	var lat := absf((float(wy) / float(tiles.y)) * 2.0 - 1.0) # 0 equator .. 1 poles
	var t := (1.0 - lat) - maxf(e - config.sea_level, 0.0) * 0.7 # higher = colder
	t += (_norm(_temperature.get_noise_2d(float(wx), float(wy))) - 0.5) * 0.25
	return clampf(t, 0.0, 1.0)


func _is_river(wx: int, wy: int) -> bool:
	return absf(_river.get_noise_2d(float(wx), float(wy))) < RIVER_WIDTH


func _norm(n: float) -> float:
	return clampf(n * 0.5 + 0.5, 0.0, 1.0)


## Pull elevation down near the map edges so the bounded world is sea-ringed.
func _apply_island_falloff(wx: int, wy: int, e: float) -> float:
	var tiles := config.world_tiles()
	var nx := (float(wx) / float(tiles.x)) * 2.0 - 1.0
	var ny := (float(wy) / float(tiles.y)) * 2.0 - 1.0
	var d := maxf(absf(nx), absf(ny)) # square distance from centre, 0..1
	var falloff := smoothstep(0.72, 1.0, d)
	return clampf(e - falloff, 0.0, 1.0)
