"""Local HTTP integration checks; no external service or API key is required."""

import json
import http.client
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


class ServerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}"
        env = dict(os.environ, MOLIT_SERVICE_KEY="", PYTHONDONTWRITEBYTECODE="1")
        cls.process = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py"), "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if cls.process.poll() is not None:
                error = cls.process.stderr.read().decode("utf-8", "replace")
                raise RuntimeError(f"Local test server did not start: {error}")
            try:
                with urlopen(cls.base + "/health", timeout=0.2) as response:
                    if response.status == 200:
                        return
            except (URLError, TimeoutError):
                time.sleep(0.04)
        cls.process.terminate()
        cls.process.wait(timeout=3)
        raise RuntimeError("Local test server startup timed out")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=3)
        if cls.process.stderr:
            cls.process.stderr.close()

    def request(self, path, payload=None, raw=None):
        data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
        request = Request(self.base + path, data=data,
                          headers={"Content-Type": "application/json"} if data is not None else {})
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
            parsed = json.loads(body) if "application/json" in content_type else body.decode("utf-8", "replace")
            return response.status, parsed, response.headers

    def test_no_secret_is_reported_and_demo_is_available(self):
        status, config, _ = self.request("/api/config")
        self.assertEqual(status, 200)
        self.assertFalse(config["live_available"])
        status, market, _ = self.request("/api/market?region=11680&months=3&mode=demo")
        self.assertEqual(status, 200)
        self.assertEqual(market["mode"], "demo")
        self.assertEqual(market["region"]["code"], "11680")
        self.assertGreater(len(market["records"]), 0)
        self.assertTrue(market["source"]["label"])
        self.assertTrue(market["fetched_at"])

    def test_live_without_key_is_an_error_never_synthetic_fallback(self):
        status, body, _ = self.request("/api/market?region=11680&months=3&mode=live")
        self.assertGreaterEqual(status, 400)
        self.assertNotEqual(body.get("mode"), "demo")
        self.assertNotIn("records", body)

    def test_region_alias_search_returns_district(self):
        from urllib.parse import quote
        status, body, _ = self.request("/api/regions?q=" + quote("청담"))
        self.assertEqual(status, 200)
        self.assertTrue(any(region["code"] == "11680" for region in body["regions"]))

    def test_market_parameters_are_validated(self):
        for query in ("region=00000&months=3&mode=demo", "region=11680&months=2&mode=demo",
                      "region=11680&months=3&mode=madeup"):
            with self.subTest(query=query):
                status, _, _ = self.request("/api/market?" + query)
                self.assertEqual(status, 400)

    def test_demo_to_analysis_roundtrip(self):
        status, market, _ = self.request("/api/market?region=11680&months=6&mode=demo")
        self.assertEqual(status, 200)
        status, result, _ = self.request("/api/analyze", {
            "records": market["records"], "area_band": "all", "neighborhood": "",
            "assumptions": {"budget_krw": 1_500_000_000, "equity_krw": 700_000_000, "loan_rate_pct": 4.5},
        })
        self.assertEqual(status, 200)
        self.assertGreater(result["counts"]["sale"], 0)
        self.assertIn("scenario", result)
        self.assertIn("methodology", result)

    def test_invalid_json_and_nonfinite_input_return_client_errors(self):
        for raw in (b"{not json", b"[]", b'{"records":[],"assumptions":{"loan_rate_pct":NaN}}'):
            with self.subTest(raw=raw):
                status, _, _ = self.request("/api/analyze", raw=raw)
                self.assertEqual(status, 400)

    def test_insights_roundtrip_and_sparse_period(self):
        _, market, _ = self.request("/api/market?region=11680&months=6&mode=demo")
        payload = {"records": market["records"], "area_band": "all", "period": market["period"]}
        status, result, _ = self.request("/api/insights", payload)
        self.assertEqual(status, 200)
        self.assertEqual(result["mix"]["status"], "ready")
        self.assertEqual(result["blind"]["status"], "ready")
        status, result, _ = self.request("/api/insights", {"records": [], "period": market["period"]})
        self.assertEqual(status, 200)
        self.assertIsNone(result["mix"]["matched_change_pct"])
        self.assertEqual(result["blind"]["status"], "insufficient")

    def test_insights_invalid_period_and_json_are_client_errors(self):
        for payload in ({"records": [], "period": {"start": "nonsense", "end": "2026-01-01"}},
                        {"records": [], "period": {"start": "2026-06-01", "end": "2026-01-01"}},
                        {"records": [], "period": []}):
            with self.subTest(payload=payload):
                status, _, _ = self.request("/api/insights", payload)
                self.assertEqual(status, 400)
        status, _, _ = self.request("/api/insights", raw=b'{"records":NaN}')
        self.assertEqual(status, 400)

    def test_illustration_is_labeled_and_has_known_mix_shift(self):
        status, body, _ = self.request("/api/insights/example")
        self.assertEqual(status, 200)
        self.assertTrue(body["mix"]["is_example"])
        self.assertAlmostEqual(body["mix"]["matched_change_pct"], 0)
        self.assertGreater(body["mix"]["raw_change_pct"], 0)

    def test_new_assets_are_served_but_source_is_not(self):
        for path in ("/journey.js", "/journey.css", "/labs.js", "/labs.css"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 200)
        self.assertEqual(self.request("/insights.py")[0], 404)

    def test_oversize_body_is_rejected(self):
        connection = http.client.HTTPConnection(self.base.removeprefix("http://"), timeout=3)
        try:
            # The server must reject the declared size before reading the body.
            connection.request("POST", "/api/analyze", body=b"", headers={
                "Content-Type": "application/json", "Content-Length": str(5 * 1024 * 1024),
            })
            response = connection.getresponse()
            self.assertEqual(response.status, 413)
            response.read()
        finally:
            connection.close()

    def test_malformed_length_headers_are_client_errors(self):
        for declared, expected in (("9" * 5000, 413), ("²", 411), ("-2", 411)):
            with self.subTest(declared=declared[:12], expected=expected):
                connection = http.client.HTTPConnection(self.base.removeprefix("http://"), timeout=3)
                try:
                    connection.request("POST", "/api/analyze", body=b"", headers={
                        "Content-Type": "application/json", "Content-Length": declared,
                    })
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected)
                    body = json.loads(response.read())
                    self.assertNotEqual(body["error"]["code"], "INTERNAL_ERROR")
                finally:
                    connection.close()

    def test_empty_transfer_encoding_is_not_treated_as_fixed_length(self):
        connection = http.client.HTTPConnection(self.base.removeprefix("http://"), timeout=3)
        try:
            connection.request("POST", "/api/analyze", body=b'{"records":[]}', headers={
                "Content-Type": "application/json", "Transfer-Encoding": "",
            })
            response = connection.getresponse()
            self.assertEqual(response.status, 411)
            response.read()
        finally:
            connection.close()

    def test_malformed_post_target_is_a_client_error(self):
        host_port = self.base.removeprefix("http://")
        host, port = host_port.rsplit(":", 1)
        with socket.create_connection((host, int(port)), timeout=3) as sock:
            sock.sendall(b"POST http://[broken HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
            response = http.client.HTTPResponse(sock)
            response.begin()
            self.assertEqual(response.status, 400)
            self.assertEqual(json.loads(response.read())["error"]["code"], "INVALID_INPUT")

    def test_private_source_files_are_not_served(self):
        for path in ("/server.py", "/.env", "/%2e%2e/server.py", "/%2e%2e%2fserver.py"):
            with self.subTest(path=path):
                status, body, _ = self.request(path)
                self.assertIn(status, (400, 403, 404))
                self.assertNotIn("import http", str(body))

    def test_home_is_html_with_security_headers(self):
        status, body, headers = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers.get("Content-Type", ""))
        self.assertIn("동네렌즈", body)
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")


class ServerCommandLineTests(unittest.TestCase):
    def run_server(self, *args, port_value):
        return subprocess.run(
            [sys.executable, str(ROOT / "server.py"), *args], cwd=ROOT,
            env=dict(os.environ, PORT=port_value, PYTHONDONTWRITEBYTECODE="1"),
            capture_output=True, text=True, timeout=3,
        )

    def test_invalid_environment_port_has_a_friendly_error(self):
        result = self.run_server(port_value="not-a-port")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid int value", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_explicit_port_overrides_an_invalid_environment_port(self):
        # Port 0 exits before binding, so the selected value can be checked
        # without reserving another listener or relying on timing.
        result = self.run_server("--port", "0", port_value="not-a-port")
        self.assertEqual(result.returncode, 2)
        self.assertIn("port must be between 1 and 65535", result.stderr)
        self.assertNotIn("invalid int value", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
