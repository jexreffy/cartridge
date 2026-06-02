"""Structured JSON logger — consistent with Pulse project pattern."""

import json
import logging
import sys
from typing import Any


class StructuredLogger:
    def __init__(self, service: str = "cartridge"):
        self._logger = logging.getLogger(service)
        if not self._logger.handlers:
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(logging.Formatter("%(message)s"))
            self._logger.addHandler(handler)
        self._logger.setLevel(logging.INFO)
        self.service = service

    def _log(self, level: str, message: str, **kwargs: Any) -> None:
        record = {"level": level, "message": message, "service": self.service, **kwargs}
        self._logger.info(json.dumps(record))

    def info(self, message: str, **kwargs: Any) -> None:
        self._log("INFO", message, **kwargs)

    def error(self, message: str, **kwargs: Any) -> None:
        self._log("ERROR", message, **kwargs)

    def warning(self, message: str, **kwargs: Any) -> None:
        self._log("WARNING", message, **kwargs)


logger = StructuredLogger()
