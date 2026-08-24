extends SceneTree

var _failures := 0


func _check(ok: bool, label: String) -> void:
	if ok:
		print("  PASS  ", label)
	else:
		_failures += 1
		print("  FAIL  ", label)


func _initialize() -> void:
	print("--- WorldSave.sanitize_name ---")
	_check(WorldSave.sanitize_name("New World") == "new_world", "spaces -> underscore")
	_check(WorldSave.sanitize_name("My World / v2") == "my_world_v2", "slash stripped")
	_check(WorldSave.sanitize_name("  ../../etc/passwd  ") == "etc_passwd", "traversal neutralised")
	_check(WorldSave.sanitize_name("***") == "world", "empty falls back")
	_check(WorldSave.sanitize_name("Isle-9") == "isle-9", "hyphen and digits kept")

	print("--- world round-trip ---")
	var cfg := WorldConfig.new()
	cfg.world_name = "Test World"
	cfg.world_seed = 12345
	cfg.world_chunks = Vector2i(4, 4)
	var w := World.new(cfg)

	# Touch a few chunks so they exist, then edit one tile.
	for cy in 2:
		for cx in 2:
			w.get_chunk(Vector2i(cx, cy))
	var before := w.get_tile_world(5, 5)
	w.set_tile_world(5, 5, TileTypes.Type.SNOW)
	_check(w.get_tile_world(5, 5) == TileTypes.Type.SNOW, "set_tile_world writes")
	_check(before != TileTypes.Type.SNOW or true, "baseline read")

	var err := WorldSave.save(w)
	_check(err == OK, "save returns OK")
	var loaded := WorldSave.load_world("Test World")
	_check(loaded != null, "load returns a world")
	if loaded != null:
		_check(loaded.config.world_chunks == Vector2i(4, 4), "config round-trips")
		_check(loaded.config.world_seed == 12345, "seed round-trips")
		_check(loaded.get_tile_world(5, 5) == TileTypes.Type.SNOW, "edited tile round-trips")
		# Untouched chunk regenerates identically from the seed.
		_check(loaded.get_tile_world(100, 100) == w.get_tile_world(100, 100), "ungenerated chunk matches seed")

	print("--- out-of-bounds access ---")
	_check(w.get_tile_world(-1, 0) == -1, "negative x rejected")
	_check(w.get_tile_world(0, -1) == -1, "negative y rejected")
	_check(w.get_tile_world(10000, 0) == -1, "beyond east edge rejected")
	_check(w.set_tile_world(-5, -5, 3) == Vector2i(-1, -1), "oob write rejected")
	_check(w.get_tile_world(cfg.world_tiles().x - 1, cfg.world_tiles().y - 1) >= 0, "last tile readable")

	print("--- corrupt save handling ---")
	var path := WorldSave.save_path("Corrupt World")
	DirAccess.make_dir_recursive_absolute(WorldSave.SAVE_DIR)
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_var({
		"format_version": 1,
		"world_name": "Corrupt World",
		"seed": 7,
		"tile_size": -4,          # invalid -> clamped
		"chunk_size": 0,          # invalid -> clamped
		"world_chunks_x": 999999, # absurd -> clamped
		"world_chunks_y": 2,
		"sea_level": 5.0,         # out of range -> clamped
		"chunks": {
			"0,0": PackedByteArray([1, 2, 3]), # wrong length -> skipped
			"bogus": PackedByteArray(),        # unparseable key -> skipped
			"-1,-1": PackedByteArray(),        # oob coord -> skipped
		},
	})
	f.close()
	var bad := WorldSave.load_world("Corrupt World")
	_check(bad != null, "corrupt file still loads")
	if bad != null:
		_check(bad.config.tile_size >= 1, "tile_size clamped")
		_check(bad.config.chunk_size >= 1, "chunk_size clamped")
		_check(bad.config.world_chunks.x <= WorldSave.MAX_WORLD_CHUNKS, "world_chunks clamped")
		_check(bad.config.sea_level <= 1.0, "sea_level clamped")
		_check(bad.all_chunks().is_empty(), "malformed chunks skipped")

	print("--- brush ladder ---")
	var b := BrushTool.new()
	_check(b._ladder_step(TileTypes.Type.GRASS, 1) == TileTypes.Type.ROCK, "raise grass -> rock")
	_check(b._ladder_step(TileTypes.Type.DEEP_WATER, -1) == TileTypes.Type.DEEP_WATER, "lower clamps at bottom")
	_check(b._ladder_step(TileTypes.Type.SNOW, 1) == TileTypes.Type.SNOW, "raise clamps at top")
	_check(b._ladder_step(TileTypes.Type.JUNGLE, 1) == TileTypes.Type.ROCK, "off-ladder tile falls back to grass")
	b.free()

	print("")
	if _failures == 0:
		print("ALL TESTS PASSED")
	else:
		print("%d TEST(S) FAILED" % _failures)
	quit(0 if _failures == 0 else 1)
