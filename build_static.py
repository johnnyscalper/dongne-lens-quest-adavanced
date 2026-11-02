"""Build a self-contained fictional-data edition; optionally serve only dist/."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DIST = ROOT / "dist"
STYLES = ("styles.css", "journey.css", "labs.css", "mobile.css")
SCRIPTS = ("local-analytics.js", "local-insights.js", "local-api.js", "journey.js", "labs.js", "mobile.js", "app.js")


def escape_raw_text(text: str, tag: str) -> str:
    """Prevent HTML's raw-text parser from ending an embedded style/script."""
    return re.sub(r"</" + re.escape(tag), lambda match: "<\\/" + match.group()[2:], text, flags=re.I)


def render_standalone() -> str:
    html = (PUBLIC / "index.html").read_text(encoding="utf-8")
    for name in STYLES:
        pattern = r'<link\s+rel="stylesheet"\s+href="/' + re.escape(name) + r'"\s*>'
        css = escape_raw_text((PUBLIC / name).read_text(encoding="utf-8"), "style")
        html, count = re.subn(pattern, lambda _: f"<style>\n/* {name} */\n{css}\n</style>", html)
        if count != 1:
            raise ValueError(f"Expected exactly one stylesheet reference: {name}")
    for name in ("journey.js", "labs.js", "mobile.js", "app.js"):
        pattern = r'\s*<script\s+src="/' + re.escape(name) + r'"\s+defer></script>'
        html, count = re.subn(pattern, "", html)
        if count != 1:
            raise ValueError(f"Expected exactly one deferred script reference: {name}")
    if re.search(r'<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["\']stylesheet["\']', html, flags=re.I):
        raise ValueError("Standalone template contains an unbundled script or stylesheet")
    regions = json.loads((ROOT / "data" / "regions.json").read_text(encoding="utf-8"))
    payload = json.dumps(regions, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    boot = "globalThis.DONGNE_RUNTIME = 'local';\nglobalThis.DONGNE_REGIONS = " + payload + ";\n"
    scripts = ["<script>\n" + escape_raw_text(boot, "script") + "</script>"]
    for name in SCRIPTS:
        source = escape_raw_text((PUBLIC / name).read_text(encoding="utf-8"), "script")
        scripts.append(f"<script>\n/* {name} */\n{source}\n</script>")
    if html.count("</body>") != 1:
        raise ValueError("Template must have one closing body tag")
    # Inline defer has no effect: mounts must exist before labs.js runs.
    html = html.replace("</body>", "\n".join(scripts) + "\n</body>")
    html = html.replace('class="brand" href="/"', 'class="brand" href="#top"')
    return html


def build() -> tuple[Path, Path]:
    content = render_standalone()
    DIST.mkdir(exist_ok=True)
    targets = (ROOT / "play.html", DIST / "index.html")
    for path in targets:
        path.write_text(content, encoding="utf-8", newline="\n")
    return targets


class StaticHandler(SimpleHTTPRequestHandler):
    """Static preview: no repository source exposure or directory listing."""
    def translate_path(self, path: str) -> str:
        candidate = Path(super().translate_path(path)).resolve()
        if not candidate.is_relative_to(DIST.resolve()):
            return str(DIST / ".blocked-path")
        return str(candidate)

    def list_directory(self, path: str):
        self.send_error(404, "Directory listing is disabled")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true", help="Build then serve the standalone edition")
    parser.add_argument("--check", action="store_true", help="Verify generated files match current sources without writing")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--strictPort", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.check and args.serve:
        parser.error("--check and --serve cannot be combined")
    if args.check:
        expected = render_standalone().encode("utf-8")
        for path in (ROOT / "play.html", DIST / "index.html"):
            if not path.is_file() or path.read_bytes() != expected:
                parser.exit(1, f"Outdated generated file: {path.name}; run python3 build_static.py\n")
        print("Standalone files match their sources.")
        return
    build()
    print("Built play.html and dist/index.html (fictional-data edition).", flush=True)
    if not args.serve:
        return
    port = args.port
    if port is None:
        try:
            port = int(os.environ.get("PORT", "3000"))
        except ValueError:
            parser.error("PORT must be an integer or use an explicit --port")
    if not 1 <= port <= 65535:
        parser.error("port must be between 1 and 65535")
    handler = partial(StaticHandler, directory=str(DIST))
    try:
        server = ThreadingHTTPServer((args.host, port), handler)
    except OSError as error:
        parser.exit(1, f"Cannot start preview: {error}\n")
    print(f"Standalone preview: http://{args.host}:{port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
