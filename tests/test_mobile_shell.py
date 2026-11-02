"""Regression checks for mobile screen wiring and device-local state boundaries.

These checks execute the production pure helpers without simulating a browser.
Touch, layout, focus restoration and native dialog behavior need browser QA.
Node is optional for running the Python app, as in the engine parity suite.
"""
from __future__ import annotations

from collections import Counter
from html.parser import HTMLParser
import copy
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import build_static

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
SCREENS = {"home", "market", "labs", "plan", "saved", "profile"}


class Document(HTMLParser):
    """Record markup ancestry, enough to catch broken cross-file DOM contracts."""
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
            "meta", "param", "source", "track", "wbr"}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.nodes = []
        self.stack = []
        self.text = []
        self.feed(source)

    def handle_starttag(self, tag, attributes):
        node = {"tag": tag, "attrs": dict(attributes), "parents": tuple(self.stack)}
        self.nodes.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attributes):
        self.handle_starttag(tag, attributes)
        if tag not in self.VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.text.append((data, tuple(self.stack)))

    def by_id(self, name):
        return next(node for node in self.nodes if node["attrs"].get("id") == name)

    @staticmethod
    def inside(node, ancestor):
        return any(parent["attrs"].get("id") == ancestor for parent in node["parents"])


class MobileMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = Document((ROOT / "public/index.html").read_text())

    def test_unique_screen_routes_keep_existing_forms_wired(self):
        doc = self.document
        ids = [node["attrs"]["id"] for node in doc.nodes if "id" in node["attrs"]]
        self.assertEqual([key for key, count in Counter(ids).items() if count > 1], [])
        self.assertEqual({node["attrs"]["data-screen"] for node in doc.nodes
                          if "data-screen" in node["attrs"]}, SCREENS)
        routes = {node["attrs"]["data-route"] for node in doc.nodes
                  if "data-route" in node["attrs"]}
        self.assertTrue(routes <= SCREENS, routes - SCREENS)
        self.assertTrue({"home", "market", "labs", "saved", "profile"} <= routes)
        for name in ("search-form", "scenario-form", "region-input", "mode-select",
                     "period-select", "area-select", "neighborhood-select", "apartment-list",
                     "mix-lab", "blind-lab", "budget-input", "equity-input", "rate-input"):
            with self.subTest(control=name):
                self.assertEqual(ids.count(name), 1)
        for screen in SCREENS:
            self.assertTrue(any("data-screen-title" in node["attrs"]
                                and node["attrs"].get("tabindex") == "-1"
                                and Document.inside(node, f"screen-{screen}")
                                for node in doc.nodes), screen)

    def test_native_dialogs_contain_their_working_controls(self):
        doc = self.document
        for dialog, controls in {
            "search-dialog": ("search-form", "region-input", "search-button", "search-error"),
            "apartment-dialog": ("apartment-detail-content", "detail-save", "detail-plan"),
        }.items():
            with self.subTest(dialog=dialog):
                self.assertEqual(doc.by_id(dialog)["tag"], "dialog")
                for control in controls:
                    self.assertTrue(Document.inside(doc.by_id(control), dialog), control)
                self.assertTrue(any("data-close-dialog" in node["attrs"]
                                    and Document.inside(node, dialog) for node in doc.nodes))

    def test_demo_entry_does_not_collect_authentication_credentials(self):
        doc = self.document
        self.assertNotIn("hidden", doc.by_id("welcome-screen")["attrs"])
        self.assertIn("hidden", doc.by_id("app-shell")["attrs"])
        self.assertEqual(doc.by_id("profile-name")["attrs"].get("maxlength"), "20")
        self.assertTrue(Document.inside(doc.by_id("profile-name"), "profile-form"))
        self.assertFalse(any(node["attrs"].get("type") == "password" for node in doc.nodes))
        profile = doc.by_id("profile-form")
        self.assertFalse(profile["attrs"].get("action", "").startswith(("https:", "http:")))
        entry_text = " ".join(text for text, parents in doc.text
                              if any(parent["attrs"].get("id") == "welcome-screen"
                                     for parent in parents))
        self.assertIn("체험", entry_text)
        self.assertEqual(doc.by_id("guest-start")["tag"], "button")

    def test_server_and_standalone_share_dom_and_listener_order(self):
        server = self.document
        source_scripts = [node["attrs"].get("src") for node in server.nodes if node["tag"] == "script"]
        self.assertLess(source_scripts.index("/mobile.js"), source_scripts.index("/app.js"))
        for node in server.nodes:
            if node["tag"] == "script":
                self.assertIn("defer", node["attrs"])
            self.assertFalse(any(name.startswith("on") for name in node["attrs"]), node["attrs"])
        rendered = build_static.render_standalone()
        standalone = Document(rendered)
        self.assertEqual(sorted(node["attrs"]["id"] for node in server.nodes if "id" in node["attrs"]),
                         sorted(node["attrs"]["id"] for node in standalone.nodes if "id" in node["attrs"]))
        self.assertFalse(any(node["tag"] == "script" and "src" in node["attrs"] for node in standalone.nodes))
        self.assertFalse(any(node["tag"] == "link" and node["attrs"].get("rel") == "stylesheet"
                             for node in standalone.nodes))
        self.assertLess(rendered.index("/* mobile.js */"), rendered.index("/* app.js */"))
        self.assertLess(rendered.index("/* local-api.js */"), rendered.index("/* app.js */"))


@unittest.skipUnless(NODE, "Node is needed only for mobile state development checks")
class MobileStateTests(unittest.TestCase):
    @staticmethod
    def favorite(name="가상 청담 산책", mode="demo"):
        return {
            "key": json.dumps([mode, "11680", "청담동", name, "medium"],
                              ensure_ascii=False, separators=(",", ":")),
            "region": {"code": "11680", "name": "서울특별시 강남구"},
            "apartment": {"name": name, "neighborhood": "청담동", "area_m2": 84.9,
                          "sale_krw": 1_500_000_000, "jeonse_krw": 850_000_000,
                          "monthly_deposit_krw": 100_000_000, "monthly_rent_krw": 2_000_000,
                          "sale_count": 6, "jeonse_count": 4, "monthly_count": 2,
                          "observed_at": "2026-11-02T03:00:00.000Z"},
            "mode": mode,
            "period": {"start": "2026-05-01", "end": "2026-11-02"},
            "filters": {"area_band": "medium", "neighborhood": "청담동"},
            "saved_at": "2026-11-02T03:00:00.000Z",
        }

    def run_helpers(self, cases):
        completed = subprocess.run([NODE, str(ROOT / "tests/mobile_shell_runner.cjs")],
                                   input=json.dumps(cases, ensure_ascii=False, allow_nan=False),
                                   text=True, capture_output=True, cwd=ROOT, timeout=10)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        values = json.loads(completed.stdout)
        self.assertEqual(len(values), len(cases))
        self.assertTrue(all(not result["inputChanged"] for result in values), values)
        return [result["value"] for result in values]

    def test_only_explicit_search_success_navigates_after_entering(self):
        cases = [{"action": "routeAfterEvent", "args": [event, route, entered]}
                 for entered in (False, True)
                 for route in sorted(SCREENS)
                 for event in ("lens:analysis", "lens:clear", "lens:ready", "lens:busy",
                               "lens:search-error", "lens:search-success")]
        for case, actual in zip(cases, self.run_helpers(cases)):
            event, route, entered = case["args"]
            self.assertEqual(actual, "market" if entered and event == "lens:search-success" else route,
                             case["args"])

    def test_foreign_hashes_cannot_create_unknown_routes(self):
        hashes = ["#" + route for route in sorted(SCREENS)]
        hashes += ["", "#password", "#javascript:alert(1)", "#../../server.py", "#%3Cscript%3E", "#MARKET"]
        values = self.run_helpers([{"action": "routeFromHash", "value": value} for value in hashes])
        self.assertEqual(values[:len(SCREENS)], sorted(SCREENS))
        self.assertEqual(values[len(SCREENS):], ["home"] * 6)

    def test_profile_and_recent_inputs_are_bounded_without_storing_private_extras(self):
        values = self.run_helpers([
            {"action": "normalizeProfile", "value": {"nickname": "　Ａ 홍길동\u0000\r\n ",
                                                        "password": "do-not-store", "equity_krw": 70}},
            {"action": "cleanName", "value": "가" * 100},
            {"action": "normalizeProfile", "value": {"nickname": " \r\n "}},
            {"action": "normalizeProfile", "value": None},
            {"action": "normalizeRecent", "value": [" 강남구 ", "강남구", "성동구", None, {}, "", "광진구",
                                                       "송파구", "서초구", "마포구", "은평구"]},
            {"action": "normalizeRecent", "value": {"0": "강남구"}},
        ])
        self.assertEqual(set(values[0]), {"nickname"})
        self.assertTrue(values[0]["nickname"].startswith("A 홍길동"))
        self.assertFalse(any(ord(char) < 32 for char in values[0]["nickname"]))
        self.assertLessEqual(len(values[1]), 20)
        self.assertIsNone(values[2])
        self.assertIsNone(values[3])
        self.assertEqual(values[4][0], "강남구")
        self.assertEqual(len(values[4]), len(set(values[4])))
        self.assertLessEqual(len(values[4]), 6)
        self.assertTrue(all(isinstance(value, str) and value for value in values[4]))
        self.assertEqual(values[5], [])

    def test_favorites_preserve_old_source_and_date_but_strip_financial_inputs(self):
        item = self.favorite()
        item.update(budget_krw=900_000_000, equity_krw=400_000_000,
                    password="not-a-credential", arbitrary_url="https://example.invalid")
        item["apartment"]["token"] = "not-a-token"
        item["region"]["email"] = "not-a-person@example.invalid"
        values = self.run_helpers([{"action": "normalizeSnapshot", "value": item},
                                   {"action": "normalizeSnapshot", "value": self.favorite(mode="live")}])
        normalized = values[0]
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["mode"], "demo")
        self.assertEqual(values[1]["mode"], "live")
        self.assertNotEqual(normalized["key"], values[1]["key"])
        self.assertEqual(normalized["period"], item["period"])
        self.assertEqual(normalized["saved_at"], item["saved_at"])
        self.assertEqual(normalized["apartment"]["sale_krw"], item["apartment"]["sale_krw"])
        stored = json.dumps(normalized)
        for forbidden in ("budget_krw", "equity_krw", "password", "arbitrary_url", "token", "email"):
            self.assertNotIn(forbidden, stored)

    def test_untrusted_snapshot_values_never_become_a_fabricated_price_or_source(self):
        invalid = []
        for value in (-1, 1e99, "1500000000", True):
            item = self.favorite()
            item["apartment"]["sale_krw"] = value
            invalid.append(item)
        unknown_mode = self.favorite(); unknown_mode["mode"] = "official-looking"
        wrong_region = self.favorite(); wrong_region["region"]["code"] = "../../server.py"
        invalid.extend([unknown_mode, wrong_region, None, {}, [self.favorite()]])
        values = self.run_helpers([{"action": "normalizeSnapshot", "value": item} for item in invalid])
        for actual in values[:4]:
            self.assertTrue(actual is None or actual["apartment"]["sale_krw"] is None, actual)
        self.assertTrue(all(value is None for value in values[4:]), values[4:])

    def test_corrupt_duplicate_and_oversized_favorites_cannot_grow_device_storage(self):
        favorites = [self.favorite(f"가상 집 {index}") for index in range(35)]
        cases = [None, {"0": favorites[0]}, [None, {}, "invalid"],
                 [favorites[0], copy.deepcopy(favorites[0]), favorites[1]], favorites]
        values = self.run_helpers([{"action": "normalizeFavorites", "value": item} for item in cases])
        self.assertEqual(values[:3], [[], [], []])
        self.assertEqual(len(values[3]), 2)
        self.assertEqual(len(values[4]), 24)
        self.assertEqual(len({item["key"] for item in values[4]}), 24)



@unittest.skipUnless(NODE, "Node is optional; needed for client interaction checks")
class MobileClientTests(unittest.TestCase):
    def test_search_intent_races_cards_and_finance_keep_their_contracts(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/mobile_client_runner.cjs")],
            cwd=ROOT, capture_output=True, text=True, timeout=25, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("cancel-reopen late response", result.stdout)


if __name__ == "__main__":
    unittest.main()
