import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("manual", ROOT / "tools/build-manual.py")
manual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manual)


class ManualPackageTests(unittest.TestCase):
    def test_reproducible_selectable_widget_without_private_or_preview_files(self):
        (ROOT / "dist").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "dist") as tmp:
            first = manual.build(Path(tmp) / "first", local_key="a" * 64).read_bytes()
            second = manual.build(Path(tmp) / "second", local_key="a" * 64)
            self.assertEqual(first, second.read_bytes())
            with zipfile.ZipFile(second) as archive:
                config = manual.validate_manifest(archive.read("config.xml"))
                self.assertEqual(config.find("w:name", manual.NS).text, "Garage Home")
                for element in ("w:content", "w:icon"):
                    self.assertIn(config.find(element, manual.NS).get("src"), archive.namelist())
                self.assertNotIn(b"preview-apps.js", archive.read("index.html"))
                self.assertEqual(set(archive.namelist()), set(manual.FILES) | {"garage-config.js", "local-key.js"})
                self.assertIn(b"window.GARAGE_LOCAL_KEY", archive.read("local-key.js"))
                self.assertNotIn(b"picture.brightness", archive.read("garage-config.js"))

    def test_new_builds_have_independent_local_reply_keys(self):
        (ROOT / "dist").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "dist") as tmp:
            with zipfile.ZipFile(manual.build(Path(tmp) / "a")) as a:
                first = a.read("local-key.js")
            with zipfile.ZipFile(manual.build(Path(tmp) / "b")) as b:
                self.assertNotEqual(first, b.read("local-key.js"))

    def test_boot_registration_is_rejected_before_packaging(self):
        original = (ROOT / "launcher/config.xml").read_text()
        for registration in (
            '<tizen:metadata key="http://samsung.com/tv/metadata/appbootingsupport" value=""/>',
            '<tizen:service id="GarageHome.Service" on-boot="true"/>',
        ):
            with self.assertRaises(ValueError):
                manual.validate_manifest(original.replace("</widget>", registration + "</widget>"))


if __name__ == "__main__":
    unittest.main()
