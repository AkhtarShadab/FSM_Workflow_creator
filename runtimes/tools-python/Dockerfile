FROM python:3.12-slim AS proto

WORKDIR /build
COPY packages/proto /proto
COPY runtimes/tools-python/proto_gen.py /build/proto_gen.py
ENV PROTO_ROOT=/proto
ENV GEN_DIR=/out
RUN pip install --no-cache-dir "grpcio-tools>=1.62,<2" "protobuf>=5,<7" \
    && python proto_gen.py

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/gen \
    TOOLS_DIR=/app/tools \
    BIND_ADDR=0.0.0.0:50051 \
    TOOL_APPLY_LIMITS=1

WORKDIR /app
COPY runtimes/tools-python/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY --from=proto /out /app/gen
COPY runtimes/tools-python/loader.py runtimes/tools-python/proto_gen.py runtimes/tools-python/server.py /app/
COPY runtimes/tools-python/tools /app/tools

USER 65534:65534
EXPOSE 50051
CMD ["python", "server.py"]
