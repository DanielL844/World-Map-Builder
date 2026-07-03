class_name Hud
extends CanvasLayer
## Minimal debug overlay for Phase 1: zoom, camera position, world stats, controls.

var camera: CameraController
var world: World
var brush: BrushTool

var _label: Label


func setup(cam: CameraController, target_world: World, brush_tool: BrushTool) -> void:
	camera = cam
	world = target_world
	brush = brush_tool


func _ready() -> void:
	_label = Label.new()
	_label.position = Vector2(12, 10)
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_label.add_theme_color_override("font_color", Color.WHITE)
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 4)
	add_child(_label)


func _process(_delta: float) -> void:
	if camera == null or world == null:
		return
	var cfg := world.config
	var c := camera.get_screen_center_position()
	var tile := Vector2i(floori(c.x / cfg.tile_size), floori(c.y / cfg.tile_size))
	var brush_line := ""
	if brush != null:
		brush_line = "Tool: %s   Tile: %s   Brush size: %d\n" % [brush.mode_name(), brush.active_type_name(), brush.radius]
	_label.text = (
		"WorldBuilder — Phase 2\n"
		+ "Zoom: %.2fx   Center tile: %s\n" % [camera.zoom.x, tile]
		+ "World: %d x %d tiles  (%d chunks)\n" % [cfg.world_tiles().x, cfg.world_tiles().y, cfg.chunk_count()]
		+ brush_line
		+ "Paint: L-mouse   Q: cycle tool   [ ]: size   1-0: pick tile\n"
		+ "Pan: drag / WASD   Zoom: wheel   F5: save   F9: load"
	)
