"""Tests for CLI path handling (globs are not expanded by PowerShell/cmd)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from verify_session import resolve_session_paths


class ResolveSessionPathsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.user = self.root / "user12"
        self.user.mkdir()
        self.files = []
        for name in ("session_a", "session_b", "session_c"):
            path = self.user / name
            path.write_text("record timestamp,client timestamp,button,state,x,y\n", encoding="utf-8")
            self.files.append(path.resolve())

    def tearDown(self):
        self._tmp.cleanup()

    def test_directory_expands_to_all_files(self):
        self.assertEqual(resolve_session_paths([str(self.user)]), sorted(self.files))

    def test_unexpanded_glob_is_handled(self):
        """PowerShell passes 'dir/*' through literally; Python must expand it."""
        self.assertEqual(resolve_session_paths([str(self.user / "*")]), sorted(self.files))

    def test_explicit_files_are_kept(self):
        picked = [str(self.files[0]), str(self.files[2])]
        self.assertEqual(resolve_session_paths(picked), sorted([self.files[0], self.files[2]]))

    def test_duplicates_are_removed(self):
        dupes = [str(self.user), str(self.files[0])]
        self.assertEqual(resolve_session_paths(dupes), sorted(self.files))

    def test_no_match_exits_with_message(self):
        with self.assertRaises(SystemExit):
            resolve_session_paths([str(self.root / "does_not_exist" / "*")])


if __name__ == "__main__":
    unittest.main()
