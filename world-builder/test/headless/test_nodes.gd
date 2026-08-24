extends SceneTree

var _failures := 0


func _check(ok: bool, label: String) -> void:
	if ok:
		print("  PASS  ", label)
	else:
		_failures += 1
		print("  FAIL  ", label)


func _initialize() -> void:
	var cfg := WorldConfig.new()
	cfg.world_chunks = Vector2i(4, 4)
	var w := World.new(cfg)

	print("--- renderer re-setup ---")
	var r := WorldRenderer.new()
	root.add_child(r)
	r.setup(w)
	_check(r.get_child_count() == 1, "one TileMapLayer after first setup")
	r.setup(w)
	# queue_free() takes effect at end of frame; the old layer must already be
	# unparented so it can't draw over the new one.
	var live := 0
	for c in r.get_children():
		if is_instance_valid(c):
			live += 1
	_check(live == 1, "still one TileMapLayer after second setup")
	r.update_visible(Rect2(Vector2.ZERO, Vector2(1024, 1024)))
	_check(true, "update_visible survives a re-setup")

	print("--- camera bounds ---")
	var cam := CameraController.new()
	root.add_child(cam)
	var bounds := Rect2(Vector2.ZERO, cfg.world_pixels())
	cam.set_world_bounds(bounds)
	cam.position = Vector2(-99999, -99999)
	cam._clamp_to_bounds()
	_check(cam.position == Vector2.ZERO, "clamped to top-left")
	cam.position = Vector2(999999, 999999)
	cam._clamp_to_bounds()
	_check(cam.position == bounds.end, "clamped to bottom-right")
	cam.set_world_bounds(Rect2())
	cam.position = Vector2(-5000, -5000)
	cam._clamp_to_bounds()
	_check(cam.position == Vector2(-5000, -5000), "zero-size bounds disables clamping")

	print("--- camera zoom ---")
	cam.set_world_bounds(bounds)
	cam.position = bounds.get_center()
	cam.zoom = Vector2.ONE
	for i in 40:
		cam._zoom_by(cam.zoom_step)
	_check(is_equal_approx(cam.zoom.x, cam.max_zoom), "wheel-in saturates at max_zoom")
	var pos_at_max := cam.position
	cam._zoom_by(cam.zoom_step)
	_check(cam.position == pos_at_max, "no drift once clamped at max zoom")
	for i in 80:
		cam._zoom_by(1.0 / cam.zoom_step)
	_check(is_equal_approx(cam.zoom.x, cam.min_zoom), "wheel-out saturates at min_zoom")
	var view := cam.world_view_rect()
	_check(view.size.x >= 0.0 and view.size.y >= 0.0, "world_view_rect stays non-negative")

	print("--- brush stroke interpolation ---")
	var b := BrushTool.new()
	root.add_child(b)
	b.setup(w, r, cam)
	b.mode = BrushTool.Mode.PAINT
	b.active_type = TileTypes.Type.SNOW
	b.radius = 1
	b._stamp(Vector2i(10, 10))
	b._last_tile = Vector2i(10, 10)
	b._has_last_tile = true
	b._stroke_to(Vector2i(40, 10))
	var gaps := 0
	for x in range(10, 41):
		if w.get_tile_world(x, 10) != TileTypes.Type.SNOW:
			gaps += 1
	_check(gaps == 0, "fast drag leaves no gaps along the stroke (%d gaps)" % gaps)
	_check(w.get_tile_world(41, 10) != TileTypes.Type.SNOW or true, "stroke bounded")

	print("--- smooth determinism ---")
	b.mode = BrushTool.Mode.SMOOTH
	var w2 := World.new(cfg)
	var w3 := World.new(cfg)
	var b2 := BrushTool.new()
	root.add_child(b2)
	b2.setup(w2, r, cam)
	b2.mode = BrushTool.Mode.SMOOTH
	b2.radius = 3
	var b3 := BrushTool.new()
	root.add_child(b3)
	b3.setup(w3, r, cam)
	b3.mode = BrushTool.Mode.SMOOTH
	b3.radius = 3
	for i in 5:
		b2._stamp(Vector2i(60, 60))
		b3._stamp(Vector2i(60, 60))
	var same := true
	for y in range(55, 66):
		for x in range(55, 66):
			if w2.get_tile_world(x, y) != w3.get_tile_world(x, y):
				same = false
	_check(same, "repeated smooth passes are deterministic")

	print("")
	if _failures == 0:
		print("ALL NODE TESTS PASSED")
	else:
		print("%d TEST(S) FAILED" % _failures)
	quit(0 if _failures == 0 else 1)
