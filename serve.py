"""Local preview for the ECF Wallet landing page (no-cache static server).

    python3 serve.py          # http://127.0.0.1:4180/
    python3 serve.py 8080
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4180


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
        print(f"ECF Wallet landing on http://127.0.0.1:{PORT}/")
        server.serve_forever()
