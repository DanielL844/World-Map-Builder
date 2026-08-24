class_name BrushTool
extends Node2D
## Terrain editing brush.
##
## Left-click / drag to apply. Q cycles mode, [ and ] change size, number keys
## 1..9,0 pick a paint tile. Draws a circular cursor over the hovered tiles.
##
## Modes:
##   Paint  - set tiles to the selected type
##   Raise  - step tiles up an elevation ladder (water -> sand -> grass -> rock -> snow)
##   Lower  - step tiles down that ladder
##   Smooth - set each tile to the most common type among its neighbours

enum Mode { PAINT, RAISE, LOWER, SMOOTH }

const MODE_NAMES := ["Paint", "Raise", "Lower", "Smooth"]

## Ordered elevation ladder used by Raise / Lower.
const LADDER: Array[int] = [
	TileTypes.Type.DEEP_WATER,
	TileTypes.Type.SHALLOW_WATER,
	TileTypes.Type.SAND,
	TileTypes.Type.GRASS,
	TileTypes.Type.ROCK,
	TileTypes.Type.SNOW,
]

## Number-key palette (index 0..9 == keys 1..9,0).
const PALETTE: Array[int] = [
	TileTypes.Type.GRASS,
	TileTypes.Type.FOREST,
	TileTypes.Type.SAND,
	TileTypes.Type.SHALLOW_WATER,
	TileTypes.Type.DEEP_WATER,
	TileTypes.Type.DESERT,
	TileTypes.Type.SNOW,
	TileTypes.Type.ROCK,
	TileTypes.Type.JUNGLE,
	TileTypes.Type.SWAMP,
]

## Upper bound on dabs per mouse-motion event, so a huge cursor jump (alt-tab,
## a fling while zoomed out) can't stall the frame.
const MAX_STROKE_DABS := 64

var world: World
var renderer: WorldRenderer
var camera: CameraController

var mode: int = Mode.PAINT
var radius: int = 2
var active_type: int = TileTypes.Type.GRASS

var _painting := false
var _has_last_tile := false
var _last_tile := Vector2i.ZERO


func setup(target_world: World, world_renderer: WorldRenderer, cam: CameraController) -> void:
	world = target_world
	renderer = world_renderer
	camera = cam
	_painting = false
	_has_last_tile = false


func mode_name() -> String:
	return MODE_NAMES[mode]


func active_type_name() -> String:
	return TileTypes.NAMES[active_type]


func _process(_delta: float) -> void:
	if camera != null:
		queue_redraw() # keep the cursor under the mouse as the camera moves


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		_painting = event.pressed
		if _painting:
			var tile := _tile_under_mouse()
			_stamp(tile)
			_last_tile = tile
			_has_last_tile = true
		else:
			_has_last_tile = false
	elif event is InputEventMouseMotion and _painting:
		_stroke_to(_tile_under_mouse())
	elif event is InputEventKey and event.pressed and not event.echo:
		_handle_key(event.keycode)


func _tile_under_mouse() -> Vector2i:
	if world == null or camera == null:
		return Vector2i.ZERO
	var ts := world.config.tile_size
	var p := camera.get_global_mouse_position()
	return Vector2i(floori(p.x / ts), floori(p.y / ts))


## Paint every dab between the previous cursor tile and `target`.
##
## Mouse motion is sampled per frame, so a fast drag used to land single dabs
## metres apart and leave the stroke full of gaps. Dabs are spaced by the brush
## radius so they overlap without re-stamping the same tiles dozens of times.
func _stroke_to(target: Vector2i) -> void:
	if not _has_last_tile:
		_stamp(target)
		_last_tile = target
		_has_last_tile = true
		return

	var delta := target - _last_tile
	var span := maxi(absi(delta.x), absi(delta.y))
	if span <= 0:
		return

	var spacing := maxi(1, radius)
	var dabs := mini(ceili(float(span) / float(spacing)), MAX_STROKE_DABS)
	for i in range(1, dabs + 1):
		var t := float(i) / float(dabs)
		_stamp(Vector2i(
			_last_tile.x + roundi(float(delta.x) * t),
			_last_tile.y + roundi(float(delta.y) * t)))
	_last_tile = target


## Apply one circular dab centred on `ctile`.
func _stamp(ctile: Vector2i) -> void:
	if world == null or renderer == null:
		return
	var wt := world.config.world_tiles()

	# Resolve the whole dab against one stable world snapshot before writing it.
	# Smooth otherwise becomes scan-order dependent because later tiles see the
	# neighbors already changed earlier in the same dab.
	var changes := {} # Vector2i world tile -> new tile id
	for dy in range(-radius, radius + 1):
		for dx in range(-radius, radius + 1):
			if dx * dx + dy * dy > radius * radius:
				continue
			var tx := ctile.x + dx
			var ty := ctile.y + dy
			if tx < 0 or ty < 0 or tx >= wt.x or ty >= wt.y:
				continue
			var current_id := world.get_tile_world(tx, ty)
			var new_id := _new_tile_for(tx, ty)
			if new_id < 0 or new_id == current_id:
				continue
			changes[Vector2i(tx, ty)] = new_id

	if changes.is_empty():
		return

	var affected := {}
	for tile in changes:
		var cc := world.set_tile_world(tile.x, tile.y, changes[tile])
		if cc.x >= 0:
			affected[cc] = true
	for cc in affected.keys():
		renderer.rerender_chunk(cc)


func _new_tile_for(tx: int, ty: int) -> int:
	match mode:
		Mode.PAINT:
			return active_type
		Mode.RAISE:
			return _ladder_step(world.get_tile_world(tx, ty), 1)
		Mode.LOWER:
			return _ladder_step(world.get_tile_world(tx, ty), -1)
		Mode.SMOOTH:
			return _neighbor_mode(tx, ty)
	return -1


func _ladder_step(current: int, dir: int) -> int:
	var idx := LADDER.find(current)
	if idx == -1:
		idx = LADDER.find(TileTypes.Type.GRASS)
	idx = clampi(idx + dir, 0, LADDER.size() - 1)
	return LADDER[idx]


## Most common tile in the 3x3 neighbourhood. Ties keep the tile that's already
## there — otherwise the winner depends on Dictionary insertion order, so a
## smooth pass over flat terrain produced different results on every run.
func _neighbor_mode(tx: int, ty: int) -> int:
	var counts := {}
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			var id := world.get_tile_world(tx + dx, ty + dy)
			if id < 0:
				continue
			counts[id] = int(counts.get(id, 0)) + 1
	if counts.is_empty():
		return -1

	var best := world.get_tile_world(tx, ty)
	var best_n := int(counts.get(best, 0))
	for id in counts.keys():
		if counts[id] > best_n:
			best_n = counts[id]
			best = id
	return best


func _handle_key(keycode: int) -> void:
	match keycode:
		KEY_Q:
			mode = (mode + 1) % MODE_NAMES.size()
		KEY_BRACKETLEFT:
			radius = clampi(radius - 1, 0, 24)
		KEY_BRACKETRIGHT:
			radius = clampi(radius + 1, 0, 24)
		KEY_1: _pick(0)
		KEY_2: _pick(1)
		KEY_3: _pick(2)
		KEY_4: _pick(3)
		KEY_5: _pick(4)
		KEY_6: _pick(5)
		KEY_7: _pick(6)
		KEY_8: _pick(7)
		KEY_9: _pick(8)
		KEY_0: _pick(9)


func _pick(index: int) -> void:
	active_type = PALETTE[index]
	mode = Mode.PAINT


func _draw() -> void:
	if world == null or camera == null:
		return
	var ts := world.config.tile_size
	var ctile := _tile_under_mouse()
	var center_px := Vector2(float(ctile.x) + 0.5, float(ctile.y) + 0.5) * ts
	var r_px := (float(radius) + 0.5) * ts
	var width := 2.0 / maxf(camera.zoom.x, 0.001)
	draw_arc(center_px, r_px, 0.0, TAU, 48, Color(1, 1, 1, 0.85), width)
