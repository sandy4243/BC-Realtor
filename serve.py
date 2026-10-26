#!/usr/bin/env python3
"""Run the study site locally: python3 serve.py  →  http://127.0.0.1:8765

Sends no-cache headers so edits to lessons, quizzes and code show up on a normal refresh.
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".md": "text/markdown; charset=utf-8", ".json": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


handler = functools.partial(NoCacheHandler, directory=ROOT)
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"Study site running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)", flush=True)
    httpd.serve_forever()
