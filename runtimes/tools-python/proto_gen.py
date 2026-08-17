"""Generate harness.tools.v1 Python stubs into ./gen (gitignored)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

RUNTIME_ROOT = Path(__file__).resolve().parent
GEN_DIR = Path(os.environ.get("GEN_DIR", RUNTIME_ROOT / "gen"))


def proto_root() -> Path:
    env = os.environ.get("PROTO_ROOT")
    if env:
        return Path(env)
    # runtimes/tools-* → repo root (parents[0]=runtimes, parents[1]=repo)
    return RUNTIME_ROOT.parents[1] / "packages" / "proto"


def _well_known_include() -> str:
    import grpc_tools

    return str(Path(grpc_tools.__file__).resolve().parent / "_proto")


def generate(out_dir: Path | None = None, proto_dir: Path | None = None) -> Path:
    out = Path(out_dir) if out_dir is not None else GEN_DIR
    proto = Path(proto_dir) if proto_dir is not None else proto_root()
    proto_file = proto / "harness" / "tools" / "v1" / "tools.proto"
    if not proto_file.is_file():
        raise FileNotFoundError(f"tools.proto not found at {proto_file}")

    from grpc_tools import protoc

    out.mkdir(parents=True, exist_ok=True)
    rc = protoc.main(
        [
            "protoc",
            f"-I{proto}",
            f"-I{_well_known_include()}",
            f"--python_out={out}",
            f"--grpc_python_out={out}",
            str(proto_file),
        ]
    )
    if rc not in (0, None):
        raise RuntimeError(f"protoc failed with code {rc}")

    for rel in ("harness", "harness/tools", "harness/tools/v1"):
        init = out / rel / "__init__.py"
        init.parent.mkdir(parents=True, exist_ok=True)
        if not init.exists():
            init.write_text("")
    return out


def ensure_python_stubs() -> Path:
    marker = GEN_DIR / "harness" / "tools" / "v1" / "tools_pb2_grpc.py"
    if not marker.is_file():
        generate()
    path = str(GEN_DIR)
    if path not in sys.path:
        sys.path.insert(0, path)
    return GEN_DIR


if __name__ == "__main__":
    print(generate())
