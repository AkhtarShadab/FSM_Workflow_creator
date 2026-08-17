"""Bash tool runtime — Python gRPC shim (FeatureShipping 010 G2 / D6).

There is no native bash gRPC server. This shim `subprocess`s `bash <script>`
and maps stdout to the proto contract:

- **last stdout line** → `ToolResponse.signal`
- earlier stdout lines → `ExecuteStream` log events
- process exit code → `ToolResponse.exit_code`
- stderr → `ToolResponse.stderr`

Scripts live in `TOOLS_DIR` as `<name>.sh`. Args/payload arrive as env:

- `TOOL_ARGS` — JSON object of string args
- `TOOL_PAYLOAD` — JSON object
- `RUN_ID`, `STATE_ID`, `TOOL_NAME`

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
docker compose -f docker-compose.dev.yml up --build tools-bash
```

Host address: `127.0.0.1:50052` (container still listens on 50051). See
`docker-compose.dev.yml` for `TOOL_ENDPOINTS`.
