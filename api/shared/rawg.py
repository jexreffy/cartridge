"""RAWG API client — enriches game titles with metadata."""
import os
import time
from typing import Optional

import requests

RAWG_BASE = "https://api.rawg.io/api"
NINTENDO_PLATFORM_IDS = {
    7,   # Nintendo Switch
    83,  # Nintendo Switch 2 (id may vary, fallback by name)
}
NINTENDO_PLATFORM_NAMES = {"nintendo switch", "nintendo switch 2"}


def get_api_key() -> str:
    key = os.environ.get("RAWG_API_KEY", "")
    if not key:
        raise RuntimeError("RAWG_API_KEY environment variable not set")
    return key


def search_game(title: str, api_key: str) -> Optional[dict]:
    """Search RAWG for a game by title, return the best match or None."""
    # Handle merged titles like "Pokemon Red/Blue" — search the first part
    search_term = title.split("/")[0].strip()
    resp = requests.get(
        f"{RAWG_BASE}/games",
        params={"key": api_key, "search": search_term, "page_size": 5},
        timeout=10,
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results:
        return None
    # Return the highest-rated result (RAWG sorts by relevance by default)
    return results[0]


def get_game_detail(game_id: int, api_key: str) -> dict:
    """Fetch full game detail by RAWG game ID."""
    resp = requests.get(
        f"{RAWG_BASE}/games/{game_id}",
        params={"key": api_key},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def is_on_nintendo(game: dict) -> bool:
    """Return True if the game is available on Switch or Switch 2."""
    platforms = game.get("platforms") or []
    for p in platforms:
        name = (p.get("platform") or {}).get("name", "").lower()
        pid = (p.get("platform") or {}).get("id", 0)
        if pid in NINTENDO_PLATFORM_IDS or any(n in name for n in NINTENDO_PLATFORM_NAMES):
            return True
    return False


def extract_metadata(detail: dict) -> dict:
    """Pull the fields we care about from a RAWG game detail response."""
    genres = [g["name"] for g in (detail.get("genres") or [])]
    tags = [t["name"] for t in (detail.get("tags") or []) if t.get("language") == "eng"][:30]
    developers = [d["name"] for d in (detail.get("developers") or [])]
    publishers = [p["name"] for p in (detail.get("publishers") or [])]
    platforms = [(p.get("platform") or {}).get("name", "") for p in (detail.get("platforms") or [])]

    return {
        "rawg_id": detail.get("id"),
        "rawg_slug": detail.get("slug", ""),
        "rawg_name": detail.get("name", ""),
        "genres": genres,
        "tags": tags,
        "developers": developers,
        "publishers": publishers,
        "platforms": platforms,
        "release_year": int(detail["released"][:4]) if detail.get("released") else None,
        "metacritic_score": detail.get("metacritic"),
        "background_image": detail.get("background_image", ""),
        "is_on_nintendo": is_on_nintendo(detail),
    }


def get_new_releases(days: int, api_key: str, nintendo_only: bool = True) -> list[dict]:
    """Return games released in the last `days` days, optionally filtered to Nintendo platforms."""
    from datetime import datetime, timedelta, timezone
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    params = {
        "key": api_key,
        "dates": f"{start},{end}",
        "ordering": "-added",
        "page_size": 40,
    }
    if nintendo_only:
        params["platforms"] = "7"  # Switch platform ID
    resp = requests.get(f"{RAWG_BASE}/games", params=params, timeout=10)
    resp.raise_for_status()
    results = resp.json().get("results", [])
    time.sleep(0.25)  # gentle rate limiting
    return results
