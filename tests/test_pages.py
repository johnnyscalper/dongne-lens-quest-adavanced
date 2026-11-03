"""Static Pages contract: self-contained assets and repository-subpath navigation."""
from html.parser import HTMLParser
import unittest
from urllib.parse import urljoin, urlsplit
from build_static import render_standalone


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "href" in values:
            self.links.append(values["href"])
        if "src" in values:
            self.scripts.append(values["src"])


class PagesTests(unittest.TestCase):
    def test_self_contained_subpath_document(self):
        html = render_standalone()
        parser = Links()
        parser.feed(html)
        base = "https://johnnyscalper.github.io/dongne-lens-quest-adavanced/"
        self.assertIn("<title>동네렌즈 퀘스트</title>", html)
        self.assertIn("globalThis.DONGNE_RUNTIME = 'local'", html)
        self.assertIn("가상", html)
        self.assertEqual(parser.scripts, [])
        for link in parser.links:
            self.assertFalse(link.startswith("/"), link)
            if link.startswith("#"):
                self.assertEqual(urlsplit(urljoin(base, link)).path,
                                 "/dongne-lens-quest-adavanced/")
