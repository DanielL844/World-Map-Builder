class_name WorldSave
extends RefCounted
## Versioned binary save/load for worlds.
##
## Uses FileAccess.store_var / get_var, which serialises Dictionaries and
## PackedByteArrays natively. FORMAT_VERSION is written into every file; bump it
## whenever the layout changes and handle older versions on load.
##
## Save files are meant to be shareable (Steam Workshop), so load treats every
## file as untrusted: objects are never decoded, numeric fields are clamped to
## sane ranges, and malformed chunks are skipped rather than crashing later.

const FORMAT_VERSION := 1
const SAVE_DIR := "user://worlds"

## Guard rails applied to values read from a save file.
const MAX_TILE_SIZE := 256
const MAX_CHUNK_SIZE := 256
const MAX_WORLD_CHUNKS := 1024


static func save_path(world_name: String) -> String:
	return "%s/%s.wb" % [SAVE_DIR, sanitize_name(world_name)]


## Turn an arbitrary world name into a safe, stable file stem. Without this a
## name containing "/", ":" or a trailing "." produces an invalid path and the
## save silently fails on Windows.
static func sanitize_name(world_name: String) -> String:
	var lower := world_name.strip_edges().to_lower()
	var out := ""
	for i in lower.length():
		var c := lower[i]
		if (c >= "a" and c <= "z") or (c >= "0" and c <= "9") or c == "-":
			out += c
		else:
			out += "_"
	while out.contains("__"):
		out = out.replace("__", "_")
	out = out.lstrip("_").rstrip("_")
	if out.is_empty():
		out = "world"
	return out.substr(0, 64)


static func save(world: World) -> Error:
	if world == null or world.config == null:
		return ERR_INVALID_PARAMETER
	var dir_err := DirAccess.make_dir_recursive_absolute(SAVE_DIR)
	if dir_err != OK and dir_err != ERR_ALREADY_EXISTS:
		return dir_err

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
	var err := f.get_error()
	f.close()
	return err


static func load_world(world_name: String) -> World:
	var path := save_path(world_name)
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	# allow_objects stays false: never instantiate scripts from a shared file.
	var data: Variant = f.get_var(false)
	f.close()
	if typeof(data) != TYPE_DICTIONARY:
		push_error("[WorldSave] %s is not a valid world file." % path)
		return null

	var version := int(data.get("format_version", 0))
	if version > FORMAT_VERSION:
		push_warning("World save is newer (v%d) than supported (v%d)." % [version, FORMAT_VERSION])

	var config := WorldConfig.new()
	config.world_name = str(data.get("world_name", "New World"))
	config.world_seed = int(data.get("seed", 0))
	config.tile_size = clampi(int(data.get("tile_size", 16)), 1, MAX_TILE_SIZE)
	config.chunk_size = clampi(int(data.get("chunk_size", 32)), 1, MAX_CHUNK_SIZE)
	config.world_chunks = Vector2i(
		clampi(int(data.get("world_chunks_x", 16)), 1, MAX_WORLD_CHUNKS),
		clampi(int(data.get("world_chunks_y", 16)), 1, MAX_WORLD_CHUNKS))
	config.sea_level = clampf(float(data.get("sea_level", 0.42)), 0.0, 1.0)

	var world := World.new(config)

	var raw: Variant = data.get("chunks", {})
	if typeof(raw) != TYPE_DICTIONARY:
		push_warning("[WorldSave] chunk table missing or malformed; world regenerated from seed.")
		return world

	var expected := config.chunk_size * config.chunk_size
	var skipped := 0
	var repaired := 0
	for key in (raw as Dictionary).keys():
		if typeof(key) != TYPE_STRING:
			skipped += 1
			continue
		var coord := _unkey(key)
		if not config.is_valid_chunk(coord):
			skipped += 1
			continue
		var tiles: Variant = raw[key]
		if typeof(tiles) != TYPE_PACKED_BYTE_ARRAY or (tiles as PackedByteArray).size() != expected:
			skipped += 1
			continue
		var bytes: PackedByteArray = tiles
		for i in bytes.size():
			if bytes[i] >= TileTypes.COUNT:
				bytes[i] = TileTypes.Type.DEEP_WATER
				repaired += 1
		var chunk := Chunk.new(coord, config.chunk_size)
		chunk.tiles = bytes
		world.set_chunk(coord, chunk)

	if skipped > 0:
		push_warning("[WorldSave] Skipped %d malformed chunk(s) in %s." % [skipped, path])
	if repaired > 0:
		push_warning("[WorldSave] Repaired %d out-of-range tile(s) in %s." % [repaired, path])
	return world


static func _key(coord: Vector2i) -> String:
	return "%d,%d" % [coord.x, coord.y]


## Parse a "x,y" chunk key. Returns (-1,-1) for anything unparseable, which every
## caller rejects via WorldConfig.is_valid_chunk().
static func _unkey(key: String) -> Vector2i:
	var parts := key.split(",")
	if parts.size() != 2:
		return Vector2i(-1, -1)
	if not parts[0].is_valid_int() or not parts[1].is_valid_int():
		return Vector2i(-1, -1)
	return Vector2i(int(parts[0]), int(parts[1]))
