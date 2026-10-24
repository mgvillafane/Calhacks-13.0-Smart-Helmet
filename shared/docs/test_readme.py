"""README install contract. No phone build and no board flash."""

import unittest
from pathlib import Path


README = Path(__file__).resolve().parents[2] / "README.md"


def _readme():
    return README.read_text(encoding="utf-8")


class NavigationReadmeTest(unittest.TestCase):
    def test_navigation_bullet_keeps_the_phone_in_charge(self):
        text = _readme().lower()
        self.assertIn("phone owns gps", text)
        self.assertIn("8-byte", text)
        self.assertIn("ble", text)
        self.assertIn("heading", text)


class InstallReadmeTest(unittest.TestCase):
    def test_expo_go_cannot_install_the_app(self):
        text = _readme().lower()
        self.assertIn("expo go", text)
        self.assertIn("react-native-ble-plx", text)
        self.assertIn("@rnmapbox/maps", text)

    def test_android_install_is_one_release_apk(self):
        text = _readme().lower()
        self.assertIn("apk", text)
        self.assertIn("unknown sources", text)
        self.assertIn("arm64", text)
        self.assertIn("nearby", text)

    def test_iphone_install_covers_xcode_and_testflight(self):
        text = _readme().lower()
        self.assertIn("xcode", text)
        self.assertIn("free apple id", text)
        self.assertIn("7 days", text)
        self.assertIn("testflight", text)

    def test_mapbox_token_lists_both_app_ids_and_stays_out_of_git(self):
        text = _readme().lower()
        self.assertIn("applicationid", text)
        self.assertIn("bundle", text)
        self.assertIn("not in git", text)
        self.assertIn("openrouteservice", text)

    def test_firmware_flash_command_is_documented(self):
        text = _readme()
        self.assertIn("pio run -t upload", text)
        self.assertIn("esp32-s3-devkitc-1", text)
        self.assertIn("SmartHelmet", text)

    def test_only_one_phone_connects_at_a_time(self):
        text = _readme().lower()
        self.assertIn("only one phone", text)


if __name__ == "__main__":
    unittest.main()
