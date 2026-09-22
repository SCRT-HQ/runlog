"""Tests for the loadout-phase data build-tarnishedtool.py prepares.

Run with: python -m unittest packs/profiles/test_build_tarnishedtool.py

The script under test runs its whole generation as soon as it is
imported, the same as running it from the command line, so importing it
here is the same act as `python packs/profiles/build-tarnishedtool.py`.
"""
import importlib.util
import io
import json
import os
import unittest

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE_PATH = os.path.join(HERE, "build-tarnishedtool.py")


def _load_module():
    spec = importlib.util.spec_from_file_location("build_tarnishedtool", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load_module()


class TierMapTest(unittest.TestCase):
    def test_covers_exactly_37_distinct_slugs(self):
        self.assertEqual(len(build.TIERS), 37)
        self.assertEqual(len(set(build.TIERS.keys())), 37)


class WarpTableTest(unittest.TestCase):
    def test_every_pair_is_a_real_grace(self):
        list_path = os.path.join(
            build.root, "apps", "web", "src", "control", "lists", "tarnishedtool.json"
        )
        with io.open(list_path, encoding="utf-8") as f:
            known = {(g["name"], g["area"]) for g in json.load(f)["graces"]}
        for tier, pairs in build.WARPS.items():
            for name, area in pairs:
                self.assertIn(
                    (name, area),
                    known,
                    "%s: %r in %r is not in the tool's grace list" % (tier, name, area),
                )


class TierBuildsTest(unittest.TestCase):
    def test_returns_four_nonempty_tiers_with_setup_ids(self):
        builds = build.tier_builds()
        self.assertEqual(set(builds.keys()), {"beginner", "midgame", "lategame", "endgame"})
        for tier, rows in builds.items():
            self.assertTrue(rows, "%s has no builds" % tier)
            for build_id, title, ops in rows:
                self.assertTrue(
                    build_id.startswith("com.scrthq.runlog.setups."),
                    "%s: unexpected id %r" % (tier, build_id),
                )

    def test_no_returned_op_carries_once(self):
        builds = build.tier_builds()
        for tier, rows in builds.items():
            for build_id, title, ops in rows:
                for op in ops:
                    self.assertNotIn("once", op, "%s carries once" % build_id)


class LoadoutAndWarpTablesTest(unittest.TestCase):
    """The generated pack and profile, held to the shape the loadout phase needs.

    The tables and rows this checks come out of the same generator run
    that writes the two files, so these read them back off disk rather
    than reaching into the module's own working variables.
    """

    def _pack(self):
        pack_path = os.path.join(build.root, "packs", "sketches", "elden-ring-tarnishedtool.yaml")
        with io.open(pack_path, encoding="utf-8") as f:
            return yaml.safe_load(f)

    def _profile(self):
        profile_path = os.path.join(build.here, "elden-ring-tarnishedtool.json")
        with io.open(profile_path, encoding="utf-8") as f:
            return json.load(f)

    def test_yaml_holds_all_eight_tables(self):
        pack = self._pack()
        for tier in build.TIER_ORDER:
            self.assertIn("loadout-" + tier, pack["tables"], tier)
            self.assertIn("warp-" + tier, pack["tables"], tier)

    def test_each_loadout_table_has_one_entry_per_build_tiling_1_to_100(self):
        pack = self._pack()
        builds = build.tier_builds()
        for tier in build.TIER_ORDER:
            entries = pack["tables"]["loadout-" + tier]["entries"]
            self.assertEqual(len(entries), len(builds[tier]), tier)
            spans = sorted((e["range"][0], e["range"][1]) for e in entries)
            at = 1
            for lo, hi in spans:
                self.assertEqual(lo, at, "%s: gap or overlap before %d" % (tier, lo))
                at = hi + 1
            self.assertEqual(at, 101, tier)

    def test_profile_has_one_loadout_row_per_entry_with_the_build_s_own_ops(self):
        profile = self._profile()
        builds = build.tier_builds()
        want = {}
        for tier, tier_rows in builds.items():
            for build_id, title, ops in tier_rows:
                want[build.loadout_entry_id(tier, build_id)] = ops

        loadout_rows = [r for r in profile["rows"] if r["table"].startswith("loadout-")]
        self.assertEqual({r["entry"] for r in loadout_rows}, set(want.keys()))
        for row in loadout_rows:
            self.assertEqual(row["ops"], want[row["entry"]], row["entry"])

    def test_no_loadout_row_carries_until(self):
        profile = self._profile()
        loadout_rows = [r for r in profile["rows"] if r["table"].startswith("loadout-")]
        self.assertTrue(loadout_rows)
        for row in loadout_rows:
            self.assertNotIn("until", row, row["entry"])


if __name__ == "__main__":
    unittest.main()
