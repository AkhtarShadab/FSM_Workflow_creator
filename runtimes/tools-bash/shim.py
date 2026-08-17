"""Bash tool shim (design plan D6).

`bash /tools/<name>.sh` — last stdout line is the signal; everything else is log.
Exit code is propagated. Non-UTF8 output is decoded lossily.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ERROR_SIGNAL = "::SCRIPT.ERROR"
LOG_BYTE_LIMIT = 1024 * 1024
LOG_TRUNCATED = "LOG_TRUNCATED"


@dataclass
class ToolSpec:
    name: str
    language: str = "bash"
    arg_schema: dict[str, Any] | None = None
    description: str = ""
    path: Path | None = None


@dataclass
class ShimResult:
    exit_code: int
    signal: str
    logs: list[str]
    stderr: str
    result: dict[str, Any] = field(default_factory=dict)


def decode_lossy(data: bytes | None) -> str:
    if not data:
        return ""
    return data.decode("utf-8", errors="replace")


def split_signal(stdout: str) -> tuple[list[str], str]:
    """Last stdout line is the signal (D6); earlier lines are logs."""
    if stdout == "":
        return [], ""
    lines = stdout.splitlines()
    if not lines:
        return [], ""
    return lines[:-1], lines[-1].strip()


def truncate_logs(lines: list[str], limit: int = LOG_BYTE_LIMIT) -> list[str]:
    out: list[str] = []
    n = 0
    for line in lines:
        b = len(line.encode("utf-8", errors="replace"))
        if n + b > limit:
            out.append(LOG_TRUNCATED)
            break
        out.append(line)
        n += b
    return out


def list_scripts(tools_dir: Path) -> dict[str, ToolSpec]:
    registry: dict[str, ToolSpec] = {}
    if not tools_dir.is_dir():
        return registry
    for path in sorted(tools_dir.glob("*.sh")):
        description = _first_comment(path)
        registry[path.stem] = ToolSpec(
            name=path.stem,
            description=description,
            path=path,
        )
    return registry


def _first_comment(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#!"):
            continue
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
        break
    return ""


def run_script(
    script: Path,
    *,
    args: dict[str, str] | None = None,
    payload: Any = None,
    timeout_ms: int = 0,
    extra_env: dict[str, str] | None = None,
) -> ShimResult:
    env = os.environ.copy()
    env["TOOL_ARGS"] = json.dumps(args or {})
    env["TOOL_PAYLOAD"] = json.dumps(payload if payload is not None else {})
    if extra_env:
        env.update(extra_env)

    timeout = (timeout_ms / 1000) if timeout_ms and timeout_ms > 0 else None
    try:
        proc = subprocess.run(
            ["bash", str(script)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        logs, _signal = split_signal(decode_lossy(exc.stdout))
        stderr = decode_lossy(exc.stderr)
        note = f"tool exceeded timeout_ms={timeout_ms}\n"
        return ShimResult(
            exit_code=1,
            signal=ERROR_SIGNAL,
            logs=logs,
            stderr=f"{stderr}{note}" if stderr else note,
        )

    logs, signal = split_signal(decode_lossy(proc.stdout))
    return ShimResult(
        exit_code=proc.returncode,
        signal=signal,
        logs=logs,
        stderr=decode_lossy(proc.stderr),
    )
