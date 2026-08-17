"""Load Python tool modules that expose run(args, payload)."""

from __future__ import annotations

import concurrent.futures
import importlib.util
import io
import traceback
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

DEFAULT_SIGNAL = "::SCRIPT.NEXT"
ERROR_SIGNAL = "::SCRIPT.ERROR"
LOG_BYTE_LIMIT = 1024 * 1024
LOG_TRUNCATED = "LOG_TRUNCATED"

RunFn = Callable[[dict[str, str], Any], Any]


@dataclass
class ToolSpec:
    name: str
    language: str = "python"
    arg_schema: dict[str, Any] | None = None
    description: str = ""
    run: RunFn | None = None
    path: Path | None = None


@dataclass
class ToolResult:
    exit_code: int
    signal: str
    result: dict[str, Any]
    stderr: str
    logs: list[str] = field(default_factory=list)


def load_tools(tools_dir: Path) -> dict[str, ToolSpec]:
    registry: dict[str, ToolSpec] = {}
    if not tools_dir.is_dir():
        return registry
    for path in sorted(tools_dir.glob("*.py")):
        if path.name.startswith("_"):
            continue
        spec = _load_module(path)
        if spec is not None:
            registry[spec.name] = spec
    return registry


def _load_module(path: Path) -> ToolSpec | None:
    name = path.stem
    module_name = f"fsm_tool_{name}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    run = getattr(mod, "run", None)
    if not callable(run):
        return None
    arg_schema = getattr(mod, "ARG_SCHEMA", None)
    description = getattr(mod, "DESCRIPTION", None)
    if not description:
        description = (mod.__doc__ or "").strip().split("\n", 1)[0]
    return ToolSpec(
        name=name,
        arg_schema=arg_schema if isinstance(arg_schema, dict) else None,
        description=str(description or ""),
        run=run,
        path=path,
    )


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


def _split_lines(text: str) -> list[str]:
    if not text:
        return []
    return text.splitlines()


def _normalize_return(raw: Any) -> tuple[str, dict[str, Any]]:
    if raw is None:
        return DEFAULT_SIGNAL, {}
    if isinstance(raw, str):
        return raw, {}
    if isinstance(raw, dict):
        signal = raw.get("signal", DEFAULT_SIGNAL)
        if "result" in raw:
            result = raw["result"]
            if not isinstance(result, dict):
                result = {"value": result}
        else:
            result = {k: v for k, v in raw.items() if k != "signal"}
        return str(signal), result
    return DEFAULT_SIGNAL, {"value": raw}


def _execute_inner(spec: ToolSpec, args: dict[str, str], payload: Any) -> ToolResult:
    assert spec.run is not None
    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            raw = spec.run(args, payload)
        extra_err = stderr.getvalue()
        signal, result = _normalize_return(raw)
        return ToolResult(
            exit_code=0,
            signal=signal,
            result=result,
            stderr=extra_err,
            logs=_split_lines(stdout.getvalue()),
        )
    except Exception:
        extra_err = stderr.getvalue()
        tb = traceback.format_exc()
        stderr_text = f"{extra_err}{tb}" if extra_err else tb
        return ToolResult(
            exit_code=1,
            signal=ERROR_SIGNAL,
            result={},
            stderr=stderr_text,
            logs=_split_lines(stdout.getvalue()),
        )


def execute_tool(
    spec: ToolSpec,
    args: dict[str, str],
    payload: Any,
    timeout_ms: int = 0,
) -> ToolResult:
    if timeout_ms and timeout_ms > 0:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(_execute_inner, spec, args, payload)
            try:
                return fut.result(timeout=timeout_ms / 1000)
            except concurrent.futures.TimeoutError:
                return ToolResult(
                    exit_code=1,
                    signal=ERROR_SIGNAL,
                    result={},
                    stderr=f"tool exceeded timeout_ms={timeout_ms}\n",
                    logs=[],
                )
    return _execute_inner(spec, args, payload)
