"""Real filesystem refusal cases for the optional, narrowly granted build CA."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('reviewed_build_ca', ROOT / 'deploy/build-images.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)
PEM = b'-----BEGIN CERTIFICATE-----\nfixture-public-certificate\n-----END CERTIFICATE-----\n'


class BuildCaTests(unittest.TestCase):
    def test_only_explicit_absolute_public_pem_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reviewed.pem'
            path.write_bytes(PEM)
            self.assertEqual(BUILD.reviewed_ca(str(path)), str(path))
            with self.assertRaisesRegex(ValueError, 'absolute regular'):
                BUILD.reviewed_ca('relative.pem')

    def test_leaf_and_ancestor_symlinks_cannot_extend_a_read_grant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = root / 'real'
            real.mkdir()
            (real / 'certificate.pem').write_bytes(PEM)
            (root / 'directory-link').symlink_to(real, target_is_directory=True)
            (root / 'file-link.pem').symlink_to(real / 'certificate.pem')
            for path in (root / 'file-link.pem', root / 'directory-link/certificate.pem'):
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    BUILD.reviewed_ca(str(path))

    def test_private_key_bundle_is_refused_without_revealing_key_material(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private.pem'
            marker = 'secret-material-must-never-appear-in-an-error'
            # Rejection input is deliberately not a private key. Construct its
            # marker at runtime so the source secret scanner remains strict.
            fake_header = '-----BEGIN ' + ' '.join(('PRIVATE', 'KEY')) + '-----\n'
            path.write_bytes(PEM + (fake_header + marker).encode())
            with self.assertRaisesRegex(ValueError, 'never a private key') as raised:
                BUILD.reviewed_ca(str(path))
            self.assertNotIn(marker, str(raised.exception))

    def test_large_empty_and_non_pem_files_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'certificate.pem'
            for contents in (b'', b'x' * (1024 * 1024 + 1), b'plain text'):
                path.write_bytes(contents)
                with self.assertRaises(ValueError):
                    BUILD.reviewed_ca(str(path))

    def test_fifo_is_refused_without_waiting_for_a_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'not-a-certificate'
            os.mkfifo(path)
            with self.assertRaisesRegex(ValueError, 'regular PEM'):
                BUILD.reviewed_ca(str(path))


if __name__ == '__main__':
    unittest.main()
