"""Pure model regressions run against the same code used by the browser."""
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PriceChoiceTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node required")
    def test_price_model(self):
        subprocess.run(["node", str(ROOT / "tests/price_choice_runner.cjs")],
                       cwd=ROOT, check=True, capture_output=True, text=True)
