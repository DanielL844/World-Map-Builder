class_name World
extends RefCounted
## All chunk data for a finite, bounded world. Chunks are generated on demand and
## cached. This is the authoritative model; renderers and tools read/write it.

signal chunk_generated(coord: Vector2i)

var config: WorldConfig
var _generator: TerrainGenerator
var _chunks: Dictionary = {} # Vector2i -> Chunk


func _init(world_config: WorldConfig) -> void:
	config = world_config
	_generator = TerrainGenerator.new(config)


func has_chunk(coord: Vector2i) -> bool:
	return _chunks.has(coord)


## Return the chunk at coord, generating it on first access. Null if out of bounds.
func get_chunk(coord: Vector2i) -> Chunk:
	if not config.is_valid_chunk(coord):
		return null
	if not _chunks.has(coord):
		var c := _generator.generate_chunk(coord)
		_chunks[coord] = c
		chunk_generated.emit(coord)
	return _chunks[coord]


## Insert or replace a chunk (used by the loader).
func set_chunk(coord: Vector2i, chunk: Chunk) -> void:
	_chunks[coord] = chunk


func all_chunks() -> Dictionary:
	return _chunks


## --- Tile access by world-tile coordinate --------------------------------

func get_tile_world(wx: int, wy: int) -> int:
	var cs := config.chunk_size
	var cc := Vector2i(floori(float(wx) / cs), floori(float(wy) / cs))
	var chunk := get_chunk(cc)
	if chunk == null:
		return -1
	return chunk.get_tile(wx - cc.x * cs, wy - cc.y * cs)


## Set a tile by world coordinate. Returns the affected chunk coord, or (-1,-1)
## if the coordinate is outside the bounded world.
func set_tile_world(wx: int, wy: int, type_id: int) -> Vector2i:
	var cs := config.chunk_size
	var cc := Vector2i(floori(float(wx) / cs), floori(float(wy) / cs))
	var chunk := get_chunk(cc)
	if chunk == null:
		return Vector2i(-1, -1)
	chunk.set_tile(wx - cc.x * cs, wy - cc.y * cs, type_id)
	return cc
