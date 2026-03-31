#!/usr/bin/env python3
"""Tiny reverse proxy: HTTP on 0.0.0.0:11480 -> HTTPS api.openai.com.

Solves rootless podman bridge containers not reaching external HTTPS.
"""
import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

TARGET = "https://api.openai.com"
# transport-level: don't auto-decompress so we pass raw bytes through
transport = httpx.AsyncHTTPTransport()
client = httpx.AsyncClient(base_url=TARGET, timeout=120, transport=transport)

STRIP_REQ = {"host", "transfer-encoding"}
STRIP_RESP = {"transfer-encoding", "content-encoding"}


async def proxy(request: Request) -> Response:
    path = request.url.path
    if request.url.query:
        path = f"{path}?{request.url.query}"
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in STRIP_REQ
    }
    # Don't ask for compressed responses — simpler passthrough
    headers["accept-encoding"] = "identity"
    body = await request.body()
    resp = await client.request(
        request.method, path, headers=headers, content=body,
    )
    resp_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in STRIP_RESP
    }
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=resp_headers,
    )


app = Starlette(routes=[Route("/{path:path}", proxy, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=11480, log_level="warning")
