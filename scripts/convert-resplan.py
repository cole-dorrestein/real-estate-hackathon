#!/usr/bin/env python3
"""One-off conversion of ResPlan.pkl into src/data/demo-plan.json.

Reads a local pickle (never committed) and writes a two-floor plan plus
seed matters whose pins sit inside the chosen rooms. Pass --fallback to
write a small hand-authored plan instead.

  python scripts/convert-resplan.py .tmp-resplan/ResPlan.pkl
  python scripts/convert-resplan.py --fallback
"""

from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "src" / "data" / "demo-plan.json"
SEED_PATH = ROOT / "src" / "data" / "seed-matters.json"
SOURCE = "ResPlan (CC BY 4.0) - https://github.com/m-agour/ResPlan"
# ResPlan's room taxonomy. Land, garden, and the wall/door layers are not rooms.
ROOM_KEYS = {"living", "bedroom", "bathroom", "kitchen", "balcony", "storage", "stair"}

FAUCET_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>"
    "<rect width='80' height='80' fill='#efe7da'/>"
    "<rect x='36' y='8' width='8' height='26' fill='#5c6b73'/>"
    "<rect x='16' y='30' width='48' height='8' fill='#5c6b73'/>"
    "<rect x='38' y='38' width='4' height='24' fill='#2f6fed'/>"
    "</svg>"
)


def title_case(key: str) -> str:
    if key.lower() == "kitchen":
        return "Kitchen"
    return key.replace("_", " ").title()


def dedupe(points: list[list[float]]) -> list[list[float]]:
    cleaned: list[list[float]] = []
    for point in points:
        if not cleaned or cleaned[-1] != point:
            cleaned.append(point)
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1]:
        cleaned.pop()
    return cleaned


def point_in_poly(x: float, z: float, points: list[list[float]]) -> bool:
    inside = False
    previous = len(points) - 1
    for index, (xi, zi) in enumerate(points):
        xj, zj = points[previous]
        if (zi > z) != (zj > z):
            denom = zj - zi
            if denom != 0 and x < (xj - xi) * (z - zi) / denom + xi:
                inside = not inside
        previous = index
    return inside


def rect(x0: float, z0: float, x1: float, z1: float) -> list[list[float]]:
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]


def walls_from(points: list[list[float]]) -> list[dict]:
    closed = points + [points[0]]
    walls = []
    for start, end in zip(closed, closed[1:]):
        if start == end:
            continue
        walls.append({"from": start, "to": end, "thickness": 0.15, "height": 2.7})
    return walls


def floor_from_rooms(floor_id: str, elevation: float, rooms: list[dict]) -> dict:
    walls: list[dict] = []
    for room in rooms:
        walls.extend(walls_from(room["points"]))
    return {"id": floor_id, "elevation": elevation, "rooms": rooms, "walls": walls}


def fallback_plan() -> tuple[dict, str]:
    l1_rooms = [
        {"id": "hallway_0", "name": "Hallway", "points": rect(0, 0, 2.4, 6)},
        {"id": "bedroom_0", "name": "Bedroom", "points": rect(2.4, 0, 6.4, 4)},
        {"id": "bathroom_0", "name": "Bathroom", "points": rect(2.4, 4, 4.8, 6)},
    ]
    l2_rooms = [
        {"id": "kitchen_0", "name": "Kitchen", "points": rect(0, 0, 4, 3.2)},
        {"id": "living_0", "name": "Living", "points": rect(4, 0, 8, 4.5)},
        {"id": "hallway_0", "name": "Hallway", "points": rect(0, 3.2, 4, 6)},
    ]
    plan = {
        "source": "Hand-written demo plan",
        "floors": [
            floor_from_rooms("L1", 0, l1_rooms),
            floor_from_rooms("L2", 3.0, l2_rooms),
        ],
    }
    return plan, "fallback"


def iter_polygons(geom):
    if geom is None or geom.is_empty:
        return
    kind = geom.geom_type
    if kind == "Polygon":
        yield geom
    elif kind == "MultiPolygon":
        yield from geom.geoms
    elif kind == "GeometryCollection":
        for child in geom.geoms:
            yield from iter_polygons(child)


def metre_scale(plan: dict) -> float:
    """The pickle is a ~256-unit canvas. `area` is square metres and `inner` is that footprint."""
    inner = plan.get("inner")
    stated = float(plan.get("area") or 0)
    if inner is not None and not getattr(inner, "is_empty", True) and inner.area > 0 and stated > 0:
        return (stated / float(inner.area)) ** 0.5
    wall_depth = float(plan.get("wall_depth") or 4)
    return 0.2 / wall_depth if wall_depth else 1.0


def resplan_plan(pkl_path: Path) -> tuple[dict, str]:
    from shapely import affinity
    from shapely.geometry.base import BaseGeometry

    print(f"loading {pkl_path}", flush=True)
    with pkl_path.open("rb") as handle:
        plans = pickle.load(handle)
    if isinstance(plans, dict):
        plans = list(plans.values())
    if not isinstance(plans, list):
        raise SystemExit(f"Expected a list of plans, got {type(plans).__name__}")
    print(f"plans={len(plans)}", flush=True)

    chosen: tuple[int, dict] | None = None
    for index, plan in enumerate(plans):
        if not isinstance(plan, dict):
            continue
        kitchen = None
        for key, value in plan.items():
            if str(key).lower() == "kitchen":
                kitchen = value
                break
        if isinstance(kitchen, BaseGeometry) and not kitchen.is_empty:
            chosen = (index, plan)
            break
    if chosen is None:
        raise SystemExit("No plan with a kitchen geometry was found")

    index, plan = chosen
    scale = metre_scale(plan)
    print(f"plan_index={index} id={plan.get('id')} scale={scale:.6f}", flush=True)
    print("keys=" + ",".join(str(key) for key in plan.keys()), flush=True)

    parts: list[tuple[str, object]] = []
    for key, value in plan.items():
        name = str(key).lower()
        if name == "balacony":
            name = "balcony"
        if name not in ROOM_KEYS or not isinstance(value, BaseGeometry):
            continue
        for poly in iter_polygons(value):
            if poly.area <= 0:
                continue
            parts.append((name, affinity.scale(poly, xfact=scale, yfact=scale, origin=(0, 0))))

    min_x = min(poly.bounds[0] for _, poly in parts)
    min_y = min(poly.bounds[1] for _, poly in parts)
    rooms = []
    counts: dict[str, int] = {}
    for name, poly in parts:
        moved = affinity.translate(poly, xoff=-min_x, yoff=-min_y)
        # Drop slivers left after scaling. 0.25 m² is below any real room.
        if moved.area < 0.25:
            continue
        raw = [[round(float(x), 3), round(float(y), 3)] for x, y in moved.exterior.coords]
        points = dedupe(raw)
        if len(points) < 3:
            continue
        part = counts.get(name, 0)
        counts[name] = part + 1
        rooms.append({"id": f"{name}_{part}", "name": title_case(name), "points": points})

    if not any(room["name"] == "Kitchen" for room in rooms):
        raise SystemExit(f"Plan {index} has a kitchen geometry but no exterior ring")

    l1 = floor_from_rooms("L1", 0, rooms)
    l2 = floor_from_rooms("L2", 3.0, json.loads(json.dumps(rooms)))
    return {"source": SOURCE, "floors": [l1, l2]}, f"resplan:{index}"


def inside_point(points: list[list[float]]) -> list[float]:
    from shapely.geometry import Point, Polygon

    poly = Polygon(points)
    if not poly.is_valid:
        poly = poly.buffer(0)
    point = poly.representative_point()
    for decimals in (3, 4, 5, 6):
        rounded = [round(float(point.x), decimals), round(float(point.y), decimals)]
        if poly.covers(Point(rounded)) or point_in_poly(rounded[0], rounded[1], points):
            return rounded
    return [float(point.x), float(point.y)]


def find_room(
    floors: list[dict],
    floor_id: str,
    preferred: set[str],
    used: set[tuple[str, str]],
    strict: bool = False,
) -> tuple[dict, dict]:
    floor = next(item for item in floors if item["id"] == floor_id)
    unused = [room for room in floor["rooms"] if (floor_id, room["id"]) not in used]
    for room in unused:
        if room["name"] in preferred:
            return floor, room
    if not strict and unused:
        return floor, unused[0]
    raise SystemExit(f"No {preferred} room left on {floor_id}")


def build_seed(plan: dict) -> list[dict]:
    floors = plan["floors"]
    used: set[tuple[str, str]] = set()
    kitchen_floor, kitchen = find_room(floors, "L2", {"Kitchen"}, used)
    if kitchen["name"] != "Kitchen":
        raise SystemExit("L2 has no room named Kitchen")
    used.add((kitchen_floor["id"], kitchen["id"]))
    hinge_floor, hinge_room = find_room(floors, "L1", {"Bedroom"}, used)
    used.add((hinge_floor["id"], hinge_room["id"]))
    # The ResPlan taxonomy has no hallway. Prefer a circulation room, then living.
    try:
        light_floor, light_room = find_room(
            floors, "L1", {"Hallway", "Hall", "Corridor", "Stair"}, used, strict=True
        )
    except SystemExit:
        light_floor, light_room = find_room(floors, "L1", {"Living"}, used)

    photo = "data:image/svg+xml," + quote(FAUCET_SVG)
    if len(photo.encode()) > 10_000:
        raise SystemExit("faucet photo data URL exceeds 10 KB")

    def pin(pin_id: str, floor: dict, room: dict, when: str) -> dict:
        x, z = inside_point(room["points"])
        if not point_in_poly(x, z, room["points"]):
            from shapely.geometry import Point, Polygon

            poly = Polygon(room["points"])
            if not poly.covers(Point(x, z)):
                raise SystemExit(f"{pin_id} is outside {floor['id']} {room['id']}")
        return {
            "id": pin_id,
            "floorId": floor["id"],
            "roomId": room["id"],
            "roomName": room["name"],
            "position": {"x": x, "y": floor["elevation"], "z": z},
            "createdAt": when,
        }

    def note(source_id: str, text: str, when: str) -> dict:
        return {"id": source_id, "kind": "note", "text": text, "createdAt": when}

    faucet_at = "2026-11-12T09:00:00.000Z"
    hinge_at = "2026-11-12T09:05:00.000Z"
    light_at = "2026-11-12T09:10:00.000Z"
    return [
        {
            "id": "matter-faucet",
            "title": "Broken faucet",
            "description": "Kitchen tap will not shut off and is dripping into the sink.",
            "pin": pin("pin-faucet", kitchen_floor, kitchen, faucet_at),
            "sources": [
                {
                    "id": "src-faucet-photo",
                    "kind": "photo",
                    "dataUrl": photo,
                    "mimeType": "image/svg+xml",
                    "createdAt": faucet_at,
                },
                note("src-faucet-note", "The kitchen tap is dripping steadily.", faucet_at),
            ],
            "status": "open",
            "createdAt": faucet_at,
            "updatedAt": faucet_at,
        },
        {
            "id": "matter-hinge",
            "title": "Loose cupboard hinge",
            "description": "A cupboard door hangs on one loose hinge.",
            "pin": pin("pin-hinge", hinge_floor, hinge_room, hinge_at),
            "sources": [note("src-hinge-note", "The cupboard door hinge is loose.", hinge_at)],
            "status": "open",
            "createdAt": hinge_at,
            "updatedAt": hinge_at,
        },
        {
            "id": "matter-light",
            "title": "Flickering hallway light",
            "description": "The hallway light flickers after it is switched on.",
            "pin": pin("pin-light", light_floor, light_room, light_at),
            "sources": [note("src-light-note", "The hallway light flickers when switched on.", light_at)],
            "status": "open",
            "createdAt": light_at,
            "updatedAt": light_at,
        },
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pkl", nargs="?", type=Path)
    parser.add_argument("--fallback", action="store_true")
    args = parser.parse_args()

    if args.fallback:
        plan, origin = fallback_plan()
    else:
        if args.pkl is None:
            raise SystemExit("Pass a path to ResPlan.pkl or --fallback")
        plan, origin = resplan_plan(args.pkl)

    seed = build_seed(plan)
    PLAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLAN_PATH.write_text(json.dumps(plan, indent=2) + "\n")
    SEED_PATH.write_text(json.dumps(seed, indent=2) + "\n")
    print(f"origin={origin}")
    print(f"wrote {PLAN_PATH} ({PLAN_PATH.stat().st_size} bytes)")
    print(f"wrote {SEED_PATH}")
    for matter in seed:
        placed = matter["pin"]
        print(
            f"{matter['id']} {placed['id']} {placed['floorId']} {placed['roomName']} "
            f"({placed['position']['x']}, {placed['position']['y']}, {placed['position']['z']})"
        )


if __name__ == "__main__":
    main()
