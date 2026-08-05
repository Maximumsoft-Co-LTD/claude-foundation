#!/usr/bin/env python3
"""Preflight a release binary for hermetic 10k provider-stream PTY evidence."""

import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path


DELTAS = 10_000
ENDPOINT_VARIABLE = "CHANGELOOP_OPENAI_ENDPOINT"


class Fixture(http.server.BaseHTTPRequestHandler):
    requests = 0

    def do_POST(self) -> None:
        type(self).requests += 1
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(min(length, 1024 * 1024))
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        for _ in range(DELTAS):
            self.wfile.write(
                b'data: {"type":"response.output_text.delta","delta":"x"}\n\n'
            )
        self.wfile.write(
            b'data: {"type":"response.completed","response":{"id":"resp_loopback","usage":{"input_tokens":1,"output_tokens":10000}}}\n\n'
        )
        self.wfile.flush()

    def log_message(self, *_args) -> None:
        return


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    binary = Path(sys.argv[1] if len(sys.argv) > 1 else root / "target/release/cloop").resolve()
    source = (root / "crates/changeloop-app-server/src/executable.rs").read_text(encoding="utf-8")
    binary_bytes = binary.read_bytes()
    server = Server(("127.0.0.1", 0), Fixture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}/v1/responses"
    try:
        supported = ENDPOINT_VARIABLE in source and ENDPOINT_VARIABLE.encode() in binary_bytes
        if not supported:
            result = {
                "passed": False,
                "complete": True,
                "supported": False,
                "reason": (
                    "release ProviderBackend constructs the default OpenAI adapter and exposes no "
                    "trusted literal-loopback endpoint contract; launching an ask would contact the "
                    "real provider and is therefore prohibited"
                ),
                "requiredEndpointVariable": ENDPOINT_VARIABLE,
                "fixture": {
                    "boundHost": "127.0.0.1",
                    "endpoint": endpoint,
                    "deltaCount": DELTAS,
                    "contentType": "text/event-stream",
                    "requestsReceived": Fixture.requests,
                },
                "network": {
                    "allowedDestinations": [f"127.0.0.1:{server.server_port}"],
                    "attemptedDestinations": [],
                    "externalNetworkAttempted": False,
                },
                "credentials": {
                    "realCredentialLoaded": False,
                    "credentialSent": False,
                },
            }
            print(json.dumps(result, separators=(",", ":")))
            return 3
        print(
            json.dumps(
                {
                    "passed": False,
                    "complete": True,
                    "supported": True,
                    "reason": "endpoint contract detected but this probe version has not authorized an unreviewed runtime invocation path",
                    "fixture": {"endpoint": endpoint, "deltaCount": DELTAS},
                    "network": {"externalNetworkAttempted": False},
                    "credentials": {"realCredentialLoaded": False, "credentialSent": False},
                },
                separators=(",", ":"),
            )
        )
        return 4
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
