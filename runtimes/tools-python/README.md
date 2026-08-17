"""Python gRPC tool runtime (FeatureShipping 010 G2).

A tool is a module in `TOOLS_DIR` that exposes:

    def run(args: dict[str, str], payload) -> str | dict

Optional `ARG_SCHEMA` (JSON Schema dict) and `DESCRIPTION` are advertised by
`Describe`. `print()` goes to ExecuteStream log lines. A raised exception
becomes `exit_code=1`, `signal=::SCRIPT.ERROR`, and the traceback on `stderr`.

## Run locally (no Docker)

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
python proto_gen.py
python server.py          # BIND_ADDR=0.0.0.0:50051
pytest tests/
```

## Docker

From the repo root:

```bash
docker compose -f docker-compose.dev.yml up --build tools-python
```

Host address: `127.0.0.1:50051`. See `docker-compose.dev.yml` for `TOOL_ENDPOINTS`.

Containers run as non-root (`nobody`) with a read-only root filesystem, dropped
capabilities, and memory/CPU/PID limits. Set `TOOL_APPLY_LIMITS=1` to also apply
process rlimits (`TOOL_RLIMIT_CPU_SEC`, `TOOL_RLIMIT_NPROC`).
