"""Local preview server that never lets the browser cache files.
Run from anywhere:  python tools/serve.py   (then open http://localhost:8000/)"""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
site = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
print(f'Serving {site} at http://localhost:{port}/')
http.server.ThreadingHTTPServer(('', port), functools.partial(NoCache, directory=site)).serve_forever()
