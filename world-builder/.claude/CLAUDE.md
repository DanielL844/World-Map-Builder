# Claudot — Godot AI Assistant

This project uses the Claudot plugin. You have MCP tools to inspect and modify the Godot scene tree. The Godot editor must be open and the plugin enabled for tools to work.

## Project Scope

Only create or modify files within this Godot project (the directory containing this CLAUDE.md). Before writing or running commands that affect files outside this directory, ask the user for explicit confirmation.

## MCP Tools

| Tool | Required Params | Notes |
|------|----------------|-------|
| `get_scene_state` | — | Optional: `max_depth` (int, default 5) |
| `get_node_property` | `node_path`, `property_name` | |
| `set_node_property` | `node_path`, `property_name`, `value` | |
| `get_editor_context` | — | Active scene, selection |
| `create_node` | `parent_path`, `node_type`, `node_name` | |
| `delete_node` | `node_path` | |
| `reparent_node` | `node_path`, `new_parent_path` | |
| `search_files` | — | Optional: `pattern`, `extensions`, `max_results` |
| `capture_screenshot` | — | Optional: `viewport_type` (2d_editor/3d_editor/game) |
| `get_debugger_output` | — | Optional: `max_lines` (default 100) |
| `get_debugger_errors` | — | Optional: `max_lines` (default 100) |
| `get_node_script` | `node_path` | GDScript source only, not C# |
| `run_tests` | — | Optional: `test_directory`, `test_file`, `test_name` |
| `run_scene` | — | Optional: `scene_path` (String, default: main scene) |
| `stop_scene` | — | Stops the running game |

## Node Path Format

Node paths use `/root/NodeName` format. The scene root is `/root`. Children use `/root/Parent/Child`.

Example: `/root/Main/Player/Sprite2D`

## GDScript Best Practices

**Prefer built-in nodes over custom scripts.**
Before writing a script to do something, check if a built-in Godot node already handles it. Use `CharacterBody2D` instead of a plain `Node2D` + custom movement script. Use `AnimationPlayer` instead of scripting tweens manually. Use `Timer` instead of a counter in `_process()`. Reach for the node first; add a script only when the built-in behaviour needs extending.

**Expose settings with @export.**
Any value that a designer or developer might tune should be an `@export` variable, not a hardcoded constant. This makes the value visible and editable in the Godot Inspector without touching code.
```gdscript
@export var speed: float = 200.0
@export var max_health: int = 100
@export var jump_force: float = 400.0
```

**Always type variables and return values.**
```gdscript
var speed: float = 200.0
func move(delta: float) -> void:
    pass
```

**Signal-first architecture** — decouple nodes with signals. Child nodes emit; parents/managers listen. Default to signals over direct method calls.
```gdscript
signal health_changed(new_health: int)
health_changed.emit(health)
player.health_changed.connect(_on_health_changed)
```

**Use `@onready` for node references:**
```gdscript
@onready var sprite: Sprite2D = $Sprite2D
```

## Workflow Rules

1. **Orient first** — call `get_editor_context()` before making changes.
2. **Inspect before mutate** — read state with `get_scene_state()` or `get_node_property()` before `set_node_property()`.
3. **Read scripts before editing files** — use `get_node_script()` to read a node's GDScript before editing the `.gd` file on disk.
4. **Test workflow** — after code changes: `run_tests()` then `get_debugger_output()` for print output and `get_debugger_errors()` for error checking.
5. **Run game** — use `run_scene()` to launch the game, then `capture_screenshot(viewport_type="game")` to see it, and `get_debugger_output()` / `get_debugger_errors()` for logs. Use `stop_scene()` when done.
6. **Discover files** — use `search_files(extensions=[".gd"])` rather than guessing file paths.
7. **Visual verification** — use `capture_screenshot()` after visual scene changes to verify layout.

## Testing

Tests use the GUT framework. Test files go in `res://test/`. Use `run_tests()` to execute.

`test_directory` defaults to `"test/unit"`. Use `test_file` to target a specific file, `test_name` to run a single test method.

## Project Structure

<!-- Auto-generated when Claudot was first enabled. Update manually if structure changes. -->

```
res://
- addons/
- icon.svg
- icon.svg.import
- project.godot
```
