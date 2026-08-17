from __future__ import annotations

from concurrent import futures
from pathlib import Path

import grpc
import pytest
from google.protobuf import empty_pb2, json_format

from loader import execute_tool, load_tools
from proto_gen import ensure_python_stubs

ensure_python_stubs()

from harness.tools.v1 import tools_pb2, tools_pb2_grpc  # noqa: E402
from server import ToolServicer  # noqa: E402

RUNTIME = Path(__file__).resolve().parents[1]
BUNDLED_TOOLS = RUNTIME / "tools"


def test_describe_lists_modules_with_arg_schema(tmp_path: Path) -> None:
    (tmp_path / "echo.py").write_text(
        'ARG_SCHEMA = {"type": "object", "properties": {"text": {"type": "string"}}}\n'
        'DESCRIPTION = "Echo"\n'
        "def run(args, payload):\n"
        '    return "::SCRIPT.NEXT"\n'
    )
    (tmp_path / "other.py").write_text("def run(args, payload):\n    return None\n")
    (tmp_path / "skip.txt").write_text("not a module")
    (tmp_path / "_private.py").write_text("def run(args, payload):\n    return None\n")
    (tmp_path / "nrun.py").write_text("DESCRIPTION = 'no run'\n")

    tools = load_tools(tmp_path)
    assert set(tools) == {"echo", "other"}
    assert tools["echo"].arg_schema == {
        "type": "object",
        "properties": {"text": {"type": "string"}},
    }
    assert tools["echo"].description == "Echo"


def test_execute_runs_and_returns_declared_signal() -> None:
    spec = load_tools(BUNDLED_TOOLS)["echo"]
    result = execute_tool(spec, {"text": "hi"}, {"n": 1})
    assert result.exit_code == 0
    assert result.signal == '::SCRIPT.NEXT|message="ok"'
    assert result.result == {"args": {"text": "hi"}, "payload": {"n": 1}}
    assert result.logs == ["echo: start", "echo: tool=echo"]


def test_raising_tool_nonzero_exit_and_traceback() -> None:
    spec = load_tools(BUNDLED_TOOLS)["fail"]
    result = execute_tool(spec, {}, {})
    assert result.exit_code == 1
    assert result.signal == "::SCRIPT.ERROR"
    assert "RuntimeError: tool failed" in result.stderr
    assert "Traceback" in result.stderr
    assert result.logs == ["fail: raising"]


@pytest.fixture
def stub():
    registry = load_tools(BUNDLED_TOOLS)
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    tools_pb2_grpc.add_ToolServiceServicer_to_server(ToolServicer(registry), server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    channel = grpc.insecure_channel(f"127.0.0.1:{port}")
    try:
        yield tools_pb2_grpc.ToolServiceStub(channel)
    finally:
        channel.close()
        server.stop(grace=0)


def test_describe_rpc_lists_bundled_tools(stub) -> None:
    resp = stub.Describe(empty_pb2.Empty())
    by_name = {t.name: t for t in resp.tools}
    assert set(by_name) == {"echo", "fail"}
    assert by_name["echo"].language == "python"
    schema = json_format.MessageToDict(by_name["echo"].arg_schema)
    assert schema["properties"]["text"]["type"] == "string"
    health = stub.Health(empty_pb2.Empty())
    assert health.status == tools_pb2.HealthStatus.SERVING


def test_execute_rpc_echo(stub) -> None:
    req = tools_pb2.ToolRequest(
        tool_name="echo",
        run_id="run-1",
        state_id="s1",
        args={"text": "hi"},
        timeout_ms=5000,
    )
    json_format.ParseDict({"n": 1}, req.payload)
    resp = stub.Execute(req)
    assert resp.exit_code == 0
    assert resp.signal == '::SCRIPT.NEXT|message="ok"'
    assert json_format.MessageToDict(resp.result)["args"]["text"] == "hi"


def test_execute_rpc_raising_tool(stub) -> None:
    resp = stub.Execute(tools_pb2.ToolRequest(tool_name="fail"))
    assert resp.exit_code == 1
    assert resp.signal == "::SCRIPT.ERROR"
    assert "RuntimeError: tool failed" in resp.stderr


def test_execute_stream_logs_then_done(stub) -> None:
    events = list(stub.ExecuteStream(tools_pb2.ToolRequest(tool_name="echo")))
    logs = [e.log_line for e in events if e.HasField("log_line")]
    assert logs == ["echo: start", "echo: tool=echo"]
    assert events[-1].HasField("done")
    assert events[-1].done.signal == '::SCRIPT.NEXT|message="ok"'
