class_name CameraController
extends Camera2D
## Top-down builder camera: drag to pan, WASD/arrows to pan, wheel to zoom toward
## the cursor. Optional edge-scroll (off by default; annoying while windowed).

@export var pan_speed: float = 900.0    ## Keyboard pan, screen px/sec at zoom 1.
@export var zoom_step: float = 1.12      ## Multiplier per wheel notch.
@export var min_zoom: float = 0.15       ## Furthest out.
@export var max_zoom: float = 6.0        ## Closest in.

@export var edge_scroll_enabled: bool = false
@export var edge_scroll_margin: float = 24.0
@export var edge_scroll_speed: float = 700.0

var _dragging: bool = false


func _ready() -> void:
	make_current()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		match event.button_index:
			MOUSE_BUTTON_MIDDLE, MOUSE_BUTTON_RIGHT:
				_dragging = event.pressed
			MOUSE_BUTTON_WHEEL_UP:
				if event.pressed:
					_zoom_at(get_global_mouse_position(), zoom_step)
			MOUSE_BUTTON_WHEEL_DOWN:
				if event.pressed:
					_zoom_at(get_global_mouse_position(), 1.0 / zoom_step)
	elif event is InputEventMouseMotion and _dragging:
		# relative is in screen px; divide by zoom to move the right world distance.
		position -= event.relative / zoom


func _process(delta: float) -> void:
	var dir := Vector2.ZERO
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		dir.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		dir.x += 1.0
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		dir.y -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		dir.y += 1.0

	if edge_scroll_enabled:
		dir += _edge_scroll_dir()

	if dir != Vector2.ZERO:
		position += dir.normalized() * (pan_speed / zoom.x) * delta


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


## Zoom by `factor` while keeping `world_point` anchored under the cursor.
func _zoom_at(world_point: Vector2, factor: float) -> void:
	var new_scalar := clampf(zoom.x * factor, min_zoom, max_zoom)
	zoom = Vector2(new_scalar, new_scalar)
	var after := get_global_mouse_position()
	position += world_point - after


## World-space rectangle currently visible through this camera.
func world_view_rect() -> Rect2:
	var view_size := get_viewport().get_visible_rect().size / zoom
	return Rect2(get_screen_center_position() - view_size * 0.5, view_size)
