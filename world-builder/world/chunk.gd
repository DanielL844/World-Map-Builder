class_name Chunk
extends RefCounted
## Tile data for a single chunk.
##
## Tiles are stored as a flat PackedByteArray in row-major order (y * size + x),
## one byte per tile holding a TileTypes.Type id. Compact and trivial to save.

var coord: Vector2i           ## Chunk coordinate in chunk-space.
var size: int                 ## Tiles per side (mirrors WorldConfig.chunk_size).
var tiles: PackedByteArray    ## Length == size * size.


func _init(chunk_coord: Vector2i, chunk_size: int) -> void:
	coord = chunk_coord
	size = chunk_size
	tiles = PackedByteArray()
	tiles.resize(chunk_size * chunk_size)


func get_tile(local_x: int, local_y: int) -> int:
	return tiles[local_y * size + local_x]


func set_tile(local_x: int, local_y: int, type_id: int) -> void:
	tiles[local_y * size + local_x] = type_id
