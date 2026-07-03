class_name WorldConfig
extends Resource
## Static description of a world (a finite, bounded map).
##
## This is the authored "settings" half of a world; the mutable tile data lives in
## World / Chunk. Part of the save format, so keep fields serialisable.

@export var world_name: String = "New World"
@export var world_seed: int = 0

## Pixels per tile when rendered.
@export var tile_size: int = 16

## Tiles per chunk along one side (chunks are square).
@export var chunk_size: int = 32

## Number of chunks along each axis. Finite bounded world.
@export var world_chunks: Vector2i = Vector2i(16, 16)

## Elevation threshold (0..1) below which a tile is water.
@export_range(0.0, 1.0, 0.01) var sea_level: float = 0.42


## Total world dimensions in tiles.
func world_tiles() -> Vector2i:
	return world_chunks * chunk_size


## Total number of chunks in the world.
func chunk_count() -> int:
	return world_chunks.x * world_chunks.y


## True if the given chunk coordinate is inside the bounded world.
func is_valid_chunk(c: Vector2i) -> bool:
	return c.x >= 0 and c.y >= 0 and c.x < world_chunks.x and c.y < world_chunks.y
