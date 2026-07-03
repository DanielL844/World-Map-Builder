class_name WorldRenderer
extends Node2D
## Streams the finite world into a single TileMapLayer around the camera.
##
## Phase 1 uses a placeholder TileSet built at runtime from flat colours (one tile
## per TileTypes.Type). Swapping in real art later means replacing the atlas
## texture and TileSet — the streaming logic stays the same.

var world: World

var _layer: TileMapLayer
var _source_id: int = -1
var _loaded: Dictionary = {} # Vector2i -> true

## Extra ring of chunks kept loaded around the visible area.
@export var load_margin_chunks: int = 1
## Chunks are unloaded once they fall outside this larger ring (hysteresis).
@export var unload_margin_chunks: int = 3


func setup(target_world: World) -> void:
	world = target_world
	_loaded.clear()
	_build_tilemap()


func _build_tilemap() -> void:
	var cfg := world.config

	var tileset := TileSet.new()
	tileset.tile_size = Vector2i(cfg.tile_size, cfg.tile_size)

	var source := TileSetAtlasSource.new()
	source.texture = _make_atlas_texture(cfg.tile_size)
	source.texture_region_size = Vector2i(cfg.tile_size, cfg.tile_size)
	for i in TileTypes.COUNT:
		source.create_tile(Vector2i(i, 0))
	_source_id = tileset.add_source(source)

	_layer = TileMapLayer.new()
	_layer.tile_set = tileset
	add_child(_layer)


## Build a 1-row atlas: one solid-colour tile per type, side by side.
func _make_atlas_texture(tile_size: int) -> ImageTexture:
	var img := Image.create(TileTypes.COUNT * tile_size, tile_size, false, Image.FORMAT_RGBA8)
	for i in TileTypes.COUNT:
		img.fill_rect(Rect2i(i * tile_size, 0, tile_size, tile_size), TileTypes.COLORS[i])
	return ImageTexture.create_from_image(img)


## Load chunks intersecting camera_world_rect (+margin); unload those far outside.
func update_visible(camera_world_rect: Rect2) -> void:
	if world == null or _layer == null:
		return
	var cfg := world.config
	var px := float(cfg.tile_size * cfg.chunk_size)

	var min_c := Vector2i(
		floori(camera_world_rect.position.x / px) - load_margin_chunks,
		floori(camera_world_rect.position.y / px) - load_margin_chunks)
	var max_c := Vector2i(
		floori((camera_world_rect.position.x + camera_world_rect.size.x) / px) + load_margin_chunks,
		floori((camera_world_rect.position.y + camera_world_rect.size.y) / px) + load_margin_chunks)

	for cy in range(min_c.y, max_c.y + 1):
		for cx in range(min_c.x, max_c.x + 1):
			var c := Vector2i(cx, cy)
			if _loaded.has(c) or not cfg.is_valid_chunk(c):
				continue
			_render_chunk(c)
			_loaded[c] = true

	var keep_min := min_c - Vector2i(unload_margin_chunks, unload_margin_chunks)
	var keep_max := max_c + Vector2i(unload_margin_chunks, unload_margin_chunks)
	for c in _loaded.keys():
		if c.x < keep_min.x or c.y < keep_min.y or c.x > keep_max.x or c.y > keep_max.y:
			_clear_chunk(c)
			_loaded.erase(c)


func _render_chunk(coord: Vector2i) -> void:
	var chunk := world.get_chunk(coord)
	if chunk == null:
		return
	var cs := world.config.chunk_size
	var base := coord * cs
	for ly in cs:
		for lx in cs:
			var id := chunk.get_tile(lx, ly)
			_layer.set_cell(Vector2i(base.x + lx, base.y + ly), _source_id, Vector2i(id, 0))


func _clear_chunk(coord: Vector2i) -> void:
	var cs := world.config.chunk_size
	var base := coord * cs
	for ly in cs:
		for lx in cs:
			_layer.erase_cell(Vector2i(base.x + lx, base.y + ly))


## Re-draw a chunk whose data changed (e.g. after a brush edit). No-op if the
## chunk isn't currently loaded; it will render with fresh data when streamed in.
func rerender_chunk(coord: Vector2i) -> void:
	if _loaded.has(coord):
		_render_chunk(coord)
