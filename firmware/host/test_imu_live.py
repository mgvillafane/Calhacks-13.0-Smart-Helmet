"""Run with: python -B -m unittest discover -s firmware/host -p test_imu_live.py"""
import csv
import importlib.util
import io
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

spec = importlib.util.spec_from_file_location("imu_live", Path(__file__).parents[1] / "imu_live.py")
imu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imu)

RAW = "imu,1000,0.1,-0.2,0.98,1,2,-3"
EXTENDED = RAW + ",0.12,0.10,0.2942,1,1,0"


class MonitorChecks(unittest.TestCase):
    def test_legacy_stream_keeps_raw_data_without_inventing_brake_metrics(self):
        sample = imu.parse_sample(RAW)
        self.assertEqual(sample["ay"], -0.2)
        self.assertFalse(sample["metrics"])
        self.assertNotIn("braking", sample)

    def test_new_stream_reports_the_actual_firmware_decision(self):
        sample = imu.parse_sample(EXTENDED)
        self.assertTrue(sample["metrics"])
        self.assertEqual(sample["braking"], 1)
        self.assertAlmostEqual(sample["delta_v_mps"], 0.2942)

    def test_bad_serial_records_cannot_poison_the_graph_or_json(self):
        for line in ("booting", RAW + ",0", RAW.replace("0.1", "nan"),
                     RAW.replace("0.1", "inf"), RAW.replace("1000", "-1"),
                     RAW.replace("1000", "4294967296"),
                     EXTENDED.replace("0.2942", "nan"),
                     EXTENDED[:-1] + "2", EXTENDED.replace("0.12", "-0.12")):
            with self.subTest(line=line):
                self.assertIsNone(imu.parse_sample(line))

    def test_device_reset_or_timestamp_wrap_starts_a_new_time_axis(self):
        feed = imu.Feed()
        feed.add(imu.parse_sample(RAW))
        feed.add(imu.parse_sample(RAW.replace("1000", "20")))
        self.assertEqual([row["t"] for row in feed.snapshot()["samples"]], [20])

    def test_feed_is_bounded_and_reports_freshness(self):
        feed = imu.Feed()
        self.assertIsNone(feed.snapshot()["last_sample_age_s"])
        for t in range(imu.KEEP + 25):
            feed.add(imu.parse_sample(RAW.replace("1000", str(t))))
        self.assertEqual(len(feed.snapshot()["samples"]), imu.KEEP)
        self.assertLess(feed.snapshot()["last_sample_age_s"], 1)

    def test_recorded_csv_preserves_units_and_leaves_legacy_metrics_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "imu.csv"
            feed = imu.Feed(path)
            try:
                feed.add(imu.parse_sample(RAW))
                feed.add(imu.parse_sample(EXTENDED))
            finally:
                feed.close()
            with path.open(newline="", encoding="utf-8") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(rows[0]["delta_v_mps"], "")
            self.assertEqual(rows[1]["braking"], "1")

    def test_http_graph_data_and_download_share_the_same_samples(self):
        feed = imu.Feed()
        feed.add(imu.parse_sample(EXTENDED))
        server = ThreadingHTTPServer(("127.0.0.1", 0), imu.handler_for(feed))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            with urlopen(base + "/data", timeout=2) as response:
                payload = json.load(response)
            self.assertEqual(payload["samples"][0]["braking"], 1)
            self.assertEqual(payload["settings"]["on_g"], 0.08)
            with urlopen(base + "/download.csv", timeout=2) as response:
                rows = list(csv.DictReader(io.StringIO(response.read().decode())))
            self.assertEqual(rows[0]["t"], "1000")
            with urlopen(base, timeout=2) as response:
                self.assertIn(b'Short-window velocity change', response.read())
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
