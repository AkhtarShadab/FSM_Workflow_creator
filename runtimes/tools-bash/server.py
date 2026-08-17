"""grpcio ToolService server wrapping the D6 bash shim."""

from __future__ import annotations

import os
import sys
from concurrent import futures
from pathlib import Path

import grpc
from google.protobuf import json_format, struct_pb2

from proto_gen import RUNTIME_ROOT, ensure_python_stubs
from shim import ShimResult, ToolSpec, list_scripts, run_script, truncate_logs

ensure_python_stubs()

from harness.tools.v1 import tools_pb2, tools_pb2_grpc  # noqa: E402


def _struct_to_dict(message: struct_pb2.Struct) -> dict:
    if message is None:
        return {}
    return json_format.MessageToDict(message)


def _dict_to_struct(data) -> struct_pb2.Struct:
    out = struct_pb2.Struct()
    if not data:
        return out
    if not isinstance(data, dict):
        json_format.ParseDict({"value": data}, out)
        return out
    json_format.ParseDict(data, out)
    return out


def _to_response(result: ShimResult) -> tools_pb2.ToolResponse:
    return tools_pb2.ToolResponse(
        exit_code=result.exit_code,
        signal=result.signal,
        result=_dict_to_struct(result.result),
        stderr=result.stderr,
    )


def apply_resource_limits() -> None:
    if os.environ.get("TOOL_APPLY_LIMITS", "0") not in ("1", "true", "yes"):
        return
    import resource

    cpu_sec = int(os.environ.get("TOOL_RLIMIT_CPU_SEC", "30"))
    nproc = int(os.environ.get("TOOL_RLIMIT_NPROC", "64"))
    if cpu_sec > 0:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_sec, cpu_sec))
    if nproc > 0:
        resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


class ToolServicer(tools_pb2_grpc.ToolServiceServicer):
    def __init__(self, registry: dict[str, ToolSpec]):
        self.registry = registry

    def _lookup(self, request: tools_pb2.ToolRequest, context) -> ToolSpec:
        spec = self.registry.get(request.tool_name)
        if spec is None or spec.path is None:
            context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"unknown tool: {request.tool_name}",
            )
        return spec

    def _run(self, request: tools_pb2.ToolRequest, context) -> ShimResult:
        spec = self._lookup(request, context)
        return run_script(
            spec.path,
            args=dict(request.args),
            payload=_struct_to_dict(request.payload),
            timeout_ms=int(request.timeout_ms or 0),
            extra_env={
                "RUN_ID": request.run_id,
                "STATE_ID": request.state_id,
                "TOOL_NAME": request.tool_name,
            },
        )

    def Execute(self, request, context):
        return _to_response(self._run(request, context))

    def ExecuteStream(self, request, context):
        result = self._run(request, context)
        for line in truncate_logs(result.logs):
            yield tools_pb2.ToolEvent(log_line=line)
        yield tools_pb2.ToolEvent(done=_to_response(result))

    def Describe(self, request, context):
        tools = [
            tools_pb2.ToolDescriptor(
                name=spec.name,
                language=spec.language,
                description=spec.description,
            )
            for spec in self.registry.values()
        ]
        return tools_pb2.DescribeResponse(tools=tools)

    def Health(self, request, context):
        return tools_pb2.HealthStatus(status=tools_pb2.HealthStatus.SERVING)


def serve(bind: str, registry: dict[str, ToolSpec]) -> None:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    tools_pb2_grpc.add_ToolServiceServicer_to_server(ToolServicer(registry), server)
    server.add_insecure_port(bind)
    server.start()
    server.wait_for_termination()


def main() -> None:
    apply_resource_limits()
    tools_dir = Path(os.environ.get("TOOLS_DIR", RUNTIME_ROOT / "tools"))
    bind = os.environ.get("BIND_ADDR", "0.0.0.0:50051")
    registry = list_scripts(tools_dir)
    print(
        f"tools-bash listening on {bind}; {len(registry)} tool(s) in {tools_dir}",
        file=sys.stderr,
    )
    serve(bind, registry)


if __name__ == "__main__":
    main()
