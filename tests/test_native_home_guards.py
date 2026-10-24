"""Static safety regression for the two documented native firmware guards."""
import unittest
from pathlib import Path

REFERENCE = 'T-PTMDEUC-1720.7'
ADDITIONAL = 'T-NKLBUABC-1720.7'


class NativeHomeGuardTests(unittest.TestCase):
    def test_both_helpers_require_supported_firmware_and_uid(self):
        for name in ('Query.cs', 'Control.cs'):
            with self.subTest(name=name):
                source = (Path(__file__).resolve().parents[1] / 'native' / name).read_text()
                self.assertIn('IntPtr.Size != 4', source)
                self.assertIn('901', source)
                self.assertIn(REFERENCE, source)
                self.assertIn('Version=' + ADDITIONAL + ';', source)
                self.assertIn('StringComparison.Ordinal) < 0 &&', source)
                self.assertIn('Firmware guard', source)


if __name__ == '__main__':
    unittest.main()
