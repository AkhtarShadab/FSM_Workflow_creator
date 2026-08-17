from __future__ import annotations

from concurrent import futures
from pathlib import Path

import grpc
import pytest
from google.protobuf import empty_pb2

from proto_gen import ensure_python_stubs
from shim import list_scripts, run_script, split_signal

ensure_python_stubs()

from harness.tools.v1 import tools_pb2, tools_pb2_grpc  # noqa: E402
from server import ToolServicer  # noqa: E402

RUNTIME = Path(__file__).resolve().parents[1]
BUNDLED_TOOLS = RUNTIME / "tools"


def test_split_signal_last_line() -> None:
    logs, signal = split_signal("line 1\nline 2\n::SCRIPT.NEXT\n")
    assert logs == ["line 1", "line 2"]
    assert signal == "::SCRIPT.NEXT"


def test_split_signal_empty() -> None:
    assert split_signal("") == ([], "")


def test_describe_lists_scripts(tmp_path: Path) -> None:
    (tmp_path / "echo.sh").write_text("#!/usr/bin/env bash\n# Hello\necho ok\n")
    (tmp_path / "other.sh").write_text("echo other\n")
    (tmp_path / "skip.txt").write_text("nope")
    tools = list_scripts(tmp_path)
    assert set(tools) == {"echo", "other"}
    assert tools["echo"].language == "bash"
    assert tools["echo"].description == "Hello"


def test_shim_last_line_is_signal_earlier_are_logs(tmp_path: Path) -> None:
    script = tmp_path / "ok.sh"
    script.write_text(
        "#!/usr/bin/env bash\n"
        "echo 'log a'\n"
        "echo 'log b'\n"
        "echo '::SCRIPT.NEXT|message=\"ok\"'\n"
        "exit 0\n"
    )
    result = run_script(script, args={"text": "hi"}, payload={"n": 1})
    assert result.exit_code == 0
    assert result.signal == '::SCRIPT.NEXT|message="ok"'
    assert result.logs == ["log a", "log b"]
    assert result.stderr == ""


def test_shim_propagates_exit_code(tmp_path: Path) -> None:
    script = tmp_path / "fail.sh"
    script.write_text(
        "#!/usr/bin/env bash\n"
        "echo 'going down' >&2\n"
        "echo 'log only'\n"
        "echo '::SCRIPT.ERROR'\n"
        "exit 7\n"
    )
    result = run_script(script)
    assert result.exit_code == 7
    assert result.signal == "::SCRIPT.ERROR"
    assert result.logs == ["log only"]
    assert "going down" in result.stderr


def test_shim_lossy_non_utf8(tmp_path: Path) -> None:
    script = tmp_path / "bin.sh"
    script.write_text("#!/usr/bin/env bash\nprintf '\\xff\\n::SCRIPT.NEXT\\n'\n")
    result = run_script(script)
    assert result.signal == "::SCRIPT.NEXT"
    assert result.logs == ["\ufffd"]


@pytest.fixture
def stub():
    registry = list_scripts(BUNDLED_TOOLS)
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


def test_describe_rpc(stub) -> None:
    resp = stub.Describe(empty_pb2.Empty())
    names = [t.name for t in resp.tools]
    assert names == ["echo"]
    assert resp.tools[0].language == "bash"
    health = stub.Health(empty_pb2.Empty())
    assert health.status == tools_pb2.HealthStatus.SERVING


def test_execute_stream_rpc(stub) -> None:
    events = list(stub.ExecuteStream(tools_pb2.ToolRequest(tool_name="echo")))
    logs = [e.log_line for e in events if e.HasField("log_line")]
    assert logs[0] == "echo: start"
    assert events[-1].HasField("done")
    assert events[-1].done.exit_code == 0
    assert events[-1].done.signal == '::SCRIPT.NEXT|message="ok"'
