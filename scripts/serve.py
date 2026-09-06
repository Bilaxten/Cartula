#!/usr/bin/env python3
"""Yerel gelistirme sunucusu -- CACHE YOK.

NEDEN VAR: `python -m http.server` hicbir cache header'i gondermiyor, Chrome da
header yoksa kendi sezgisiyle agresif cache'liyor. Sonuc, bu projede defalarca
tekrarlanan bir tuzak: `index.html?cb=N` ile sayfayi tazeliyorsun ama
`src/main.js` ve `src/render/*.js` AYRI URL'ler ve onlar cache'te kaliyor.
Tarayicida eski kodu goruyor, "ozellik calismiyor" saniyorsun. 2026-09-02'de
saatler, 2026-09-06'da uc tur bu yuzden harcandi.

Query string cache-buster BU SORUNU COZMUYOR -- yalnizca query'yi tasiyan
dosyayi tazeliyor. Cozum sunucunun kendisinin "sakin bunu saklama" demesi.

Kullanim:
    python scripts/serve.py [port]        # varsayilan 8000

Depo koku dizininden servis eder, hangi dizinden calistirilirsa calistirilsin.
"""

import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # `no-store` en gucluu olan: `no-cache` tarayiciya "sakla ama her sefer
        # dogrula" der ve 304 yolunda yine eski icerik gorunebilir.
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Varsayilan log her istek icin bir satir basiyor ve arka planda
        # calisan bir sunucuda gurultuden baska bir sey degil.
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), handler) as httpd:
        print("StilizedMaps: http://localhost:%d/index.html (cache kapali)" % port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
