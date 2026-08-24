extends Node2D
## Phase 1 bootstrap. Builds a world, renderer, camera and HUD entirely in code so
## the scene tree stays trivial (main.tscn is just this script on a Node2D root).

var world: World
var renderer: WorldRenderer
var camera: CameraController
var brush: BrushTool
var hud: Hud


func _ready() -> void:
	var config := WorldConfig.new()
	config.world_name = "New World"
	config.world_seed = randi()
	world = World.new(config)

	renderer = WorldRenderer.new()
	add_child(renderer)
	renderer.setup(world)

	camera = CameraController.new()
	add_child(camera)
	# Start centred on the middle of the world.
	camera.position = world.config.world_pixels() * 0.5
	camera.set_world_bounds(_world_bounds())

	brush = BrushTool.new()
	add_child(brush)
	brush.setup(world, renderer, camera)

	hud = Hud.new()
	add_child(hud)
	hud.setup(camera, world, brush)

	Game.world = world
	Game.camera = camera


func _process(_delta: float) -> void:
	if renderer != null and camera != null:
		renderer.update_visible(camera.world_view_rect())


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_F5:
			_save()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_F9:
			_load()
			get_viewport().set_input_as_handled()


func _world_bounds() -> Rect2:
	return Rect2(Vector2.ZERO, world.config.world_pixels())


func _save() -> void:
	if world == null:
		return
	var err := WorldSave.save(world)
	if err == OK:
		print("[WorldBuilder] Saved to ", WorldSave.save_path(world.config.world_name))
	else:
		push_error("[WorldBuilder] Save failed (error %d)." % err)


func _load() -> void:
	if world == null:
		return
	var loaded := WorldSave.load_world(world.config.world_name)
	if loaded == null:
		print("[WorldBuilder] No saved world found.")
		return
	world = loaded

	renderer.queue_free()
	renderer = WorldRenderer.new()
	add_child(renderer)
	move_child(renderer, 0) # keep tiles below the brush cursor
	renderer.setup(world)

	brush.setup(world, renderer, camera)
	hud.setup(camera, world, brush)

	# The loaded world may be a different size than the one we booted with, so
	# re-apply the bounds before clamping the camera back inside them.
	camera.set_world_bounds(_world_bounds())

	Game.world = world
	print("[WorldBuilder] Loaded world.")
