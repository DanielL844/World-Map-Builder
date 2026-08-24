class_name CameraController
extends Camera2D
## Top-down builder camera: drag to pan, WASD/arrows to pan, wheel to zoom toward
## the cursor. Optional edge-scroll (off by default; annoying while windowed).

@export var pan_speed: float = 900.0     ## Keyboard pan, screen px/sec at zoom 1.
@export var zoom_step: float = 1.12      ## Multiplier per wheel notch.
@export var min_zoom: float = 0.15       ## Furthest out.
@export var max_zoom: float = 6.0        ## Closest in.

@export var edge_scroll_enabled: bool = false
@export var edge_scroll_margin: float = 24.0
@export var edge_scroll_speed: float = 700.0

## World-space rectangle the camera centre is kept inside. A zero-size rect means
## unbounded (the default until main.gd hands us the world extents).
var world_bounds: Rect2 = Rect2()

var _dragging: bool = false


func _ready() -> void:
	make_current()


## Restrict the camera centre to `bounds` so the finite world can't be lost
## off-screen. Pass Rect2() to disable.
func set_world_bounds(bounds: Rect2) -> void:
	world_bounds = bounds
	_clamp_to_bounds()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		match event.button_index:
			MOUSE_BUTTON_MIDDLE, MOUSE_BUTTON_RIGHT:
				_dragging = event.pressed
			MOUSE_BUTTON_WHEEL_UP:
				if event.pressed:
					_zoom_by(zoom_step)
			MOUSE_BUTTON_WHEEL_DOWN:
				if event.pressed:
					_zoom_by(1.0 / zoom_step)
	elif event is InputEventMouseMotion and _dragging:
		# relative is in screen px; divide by zoom to move the right world distance.
		position -= event.relative / zoom
		_clamp_to_bounds()


func _process(delta: float) -> void:
	var moved := false

	var dir := Vector2.ZERO
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		dir.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		dir.x += 1.0
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		dir.y -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		dir.y += 1.0
	if dir != Vector2.ZERO:
		position += dir.normalized() * (pan_speed / zoom.x) * delta
		moved = true

	# Edge scroll has its own speed knob; it used to be folded into the keyboard
	# vector, which meant edge_scroll_speed was exported but never applied.
	if edge_scroll_enabled:
		var edge := _edge_scroll_dir()
		if edge != Vector2.ZERO:
			position += edge.normalized() * (edge_scroll_speed / zoom.x) * delta
			moved = true

	if moved:
		_clamp_to_bounds()


func _edge_scroll_dir() -> Vector2:
	var vp := get_viewport().get_visible_rect().size
	var m := get_viewport().get_mouse_position()
	var d := Vector2.ZERO
	if m.x < edge_scroll_margin:
		d.x -= 1.0
	elif m.x > vp.x - edge_scroll_margin:
		d.x += 1.0
	if m.y < edge_scroll_margin:
		d.y -= 1.0
	elif m.y > vp.y - edge_scroll_margin:
		d.y += 1.0
	return d


## Zoom by `factor`, keeping the world point under the cursor anchored.
##
## The centre shift is derived arithmetically rather than by sampling
## get_global_mouse_position() before and after writing `zoom`: that reads the
## canvas transform, which is only guaranteed to reflect the new zoom on the
## following frame, so the anchor silently degraded to "zoom to screen centre".
func _zoom_by(factor: float) -> void:
	var old_zoom := zoom.x
	var new_zoom := clampf(old_zoom * factor, min_zoom, max_zoom)
	if is_equal_approx(new_zoom, old_zoom):
		return
	var screen_offset := _cursor_offset_from_centre()
	zoom = Vector2(new_zoom, new_zoom)
	position += screen_offset * (1.0 / old_zoom - 1.0 / new_zoom)
	_clamp_to_bounds()


## Cursor position relative to the centre of the viewport, in screen pixels.
func _cursor_offset_from_centre() -> Vector2:
	var viewport := get_viewport()
	if viewport == null:
		return Vector2.ZERO
	return viewport.get_mouse_position() - viewport.get_visible_rect().size * 0.5


func _clamp_to_bounds() -> void:
	if world_bounds.size.x <= 0.0 or world_bounds.size.y <= 0.0:
		return
	position = position.clamp(world_bounds.position, world_bounds.end)


## World-space rectangle currently visible through this camera.
func world_view_rect() -> Rect2:
	var viewport := get_viewport()
	if viewport == null:
		return Rect2(get_screen_center_position(), Vector2.ZERO)
	var z := maxf(zoom.x, 0.0001)
	var view_size := viewport.get_visible_rect().size / z
	return Rect2(get_screen_center_position() - view_size * 0.5, view_size)
