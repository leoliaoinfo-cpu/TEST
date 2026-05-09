import time
from typing import Any, Optional


class TTLCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str, ttl: int = 300) -> Optional[Any]:
        entry = self._store.get(key)
        if entry and time.monotonic() - entry[1] < ttl:
            return entry[0]
        return None

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (value, time.monotonic())

    def clean(self) -> None:
        cutoff = time.monotonic() - 3600
        self._store = {k: v for k, v in self._store.items() if v[1] > cutoff}


cache = TTLCache()
