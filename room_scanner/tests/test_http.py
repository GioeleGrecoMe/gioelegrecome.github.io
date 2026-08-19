import contextlib, http.server, socketserver, threading, urllib.request, pathlib
root=pathlib.Path(__file__).resolve().parent.parent
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
with contextlib.chdir(root):
    with socketserver.TCPServer(('127.0.0.1',0),Handler) as srv:
        port=srv.server_address[1];t=threading.Thread(target=srv.serve_forever,daemon=True);t.start()
        html=urllib.request.urlopen(f'http://127.0.0.1:{port}/room_scanner_v30.html',timeout=3).read().decode()
        wasm=urllib.request.urlopen(f'http://127.0.0.1:{port}/wasm/slam_core.wasm',timeout=3).read()
        assert 'V30.0.0' in html and wasm[:4]==b'\x00asm'
        srv.shutdown()
print('PASS http_smoke')
