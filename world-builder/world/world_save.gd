class_name WorldSave
extends RefCounted
## Versioned binary save/load for worlds.
##
## Uses FileAccess.store_var / get_var, which serialises Dictionaries and
## PackedByteArrays natively. FORMAT_VERSION is written into every file; bump it
## whenever the layout changes and handle older versions on load.

const FORMAT_VERSION := 1
const SAVE_DIR := "user://worlds"


static func save_path(world_name: String) -> String:
	return "%s/%s.wb" % [SAVE_DIR, world_name.to_lower().replace(" ", "_")]


static func save(world: World) -> Error:
	DirAccess.make_dir_recursive_absolute(SAVE_DIR)
	var path := save_path(world.config.world_name)
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return FileAccess.get_open_error()

	var chunk_dict := {}
	var chunks := world.all_chunks()
	for coord in chunks.keys():
		var chunk: Chunk = chunks[coord]
		chunk_dict[_key(coord)] = chunk.tiles

	var data := {
		"format_version": FORMAT_VERSION,
		"world_name": world.config.world_name,
		"seed": world.config.world_seed,
		"tile_size": world.config.tile_size,
		"chunk_size": world.config.chunk_size,
		"world_chunks_x": world.config.world_chunks.x,
		"world_chunks_y": world.config.world_chunks.y,
		"sea_level": world.config.sea_level,
		"chunks": chunk_dict,
	}
	f.store_var(data)
	f.close()
	return OK


static func load_world(world_name: String) -> World:
	var path := save_path(world_name)
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var data = f.get_var()
	f.close()
	if typeof(data) != TYPE_DICTIONARY:
		return null

	var version := int(data.get("format_version", 0))
	if version > FORMAT_VERSION:
		push_warning("World save is newer (v%d) than supported (v%d)." % [version, FORMAT_VERSION])

	var config := WorldConfig.new()
	config.world_name = data.get("world_name", "New World")
	config.world_seed = int(data.get("seed", 0))
	config.tile_size = int(data.get("tile_size", 16))
	config.chunk_size = int(data.get("chunk_size", 32))
	config.world_chunks = Vector2i(int(data.get("world_chunks_x", 16)), int(data.get("world_chunks_y", 16)))
	config.sea_level = float(data.get("sea_level", 0.42))

	var world := World.new(config)
	var chunks: Dictionary = data.get("chunks", {})
	for key in chunks.keys():
		var coord := _unkey(key)
		var chunk := Chunk.new(coord, config.chunk_size)
		chunk.tiles = chunks[key]
		world.set_chunk(coord, chunk)
	return world


static func _key(coord: Vector2i) -> String:
	return "%d,%d" % [coord.x, coord.y]


static func _unkey(key: String) -> Vector2i:
	var parts := key.split(",")
	return Vector2i(int(parts[0]), int(parts[1]))
