extends Node
## Autoloaded singleton "Game": app-wide references and state.
## Registered in project.godot as autoload name "Game" (do not add a class_name).

var world: World
var camera: CameraController


func _ready() -> void:
	print("[WorldBuilder] Game singleton ready.")
