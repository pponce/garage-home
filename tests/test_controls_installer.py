import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('garage_installer', Path(__file__).resolve().parents[1] / 'tools/install-vetro-controls.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def record():
    return {'revision': module.REVISION, 'submitted': True, 'complete': False,
            'target': '/home/owner/share/tmp/sdk_tools/garage-controls-1234567890abcdef/app.wgt',
            'hashCommand': 'sha256sum',
            'hashes': {name: hashlib.sha256(name.encode()).hexdigest() for name in module.FILES}}


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name)
        args = SimpleNamespace(tv='192.0.2.19', project_root=str(self.project), report_host='tester@192.0.2.2')
        self.installer = module.Installer(args, lambda *args: Mock())
        self.installer.say = Mock()
        self.installer.api = Mock(return_value={'connected': True})

    def tearDown(self):
        self.installer.lock.close()
        self.temp.cleanup()

    def test_unverified_saved_attempt_never_resubmits_install(self):
        self.installer.save(record())
        self.installer.verify = Mock(return_value=False)
        self.installer.prepare = Mock(side_effect=AssertionError('must not sign again'))
        with self.assertRaisesRegex(RuntimeError, 'still unverified'):
            self.installer.install()
        self.installer.prepare.assert_not_called()
        self.assertEqual([call.args[0] for call in self.installer.api.call_args_list], ['/exec'])

    def test_verified_saved_attempt_reopens_without_signing_or_installing(self):
        self.installer.save(record())
        self.installer.verify = Mock(return_value=True)
        self.installer.finish = Mock()
        self.installer.install()
        self.installer.finish.assert_called_once()
        self.assertEqual([call.args[0] for call in self.installer.api.call_args_list], ['/exec'])

    def prepare_install(self, transfer_ok=True):
        signed = self.project / 'app.wgt'
        signed.write_bytes(b'a signed package fixture')
        state = record()
        state['submitted'] = False
        self.installer.find_root = Mock(return_value=module.ROOTS[0])
        self.installer.tv_hash = Mock(side_effect=[hashlib.sha256(b'').hexdigest(),
            hashlib.sha256(signed.read_bytes()).hexdigest() if transfer_ok else '0' * 64])
        self.installer.prepare = Mock(return_value=(signed, state))
        self.installer.remote = Mock(return_value='')
        return state

    def test_install_timeout_verifies_without_repeating_mutation(self):
        state = self.prepare_install()
        def api(route, *args, **kwargs):
            if route == '/exec':
                return {'connected': True}
            self.assertTrue(json.loads(self.installer.ledger.read_text())['submitted'])
            raise TimeoutError('ambiguous install response')
        self.installer.api = Mock(side_effect=api)
        self.installer.verify = Mock(return_value=True)
        self.installer.finish = Mock()
        with patch.object(module.shutil, 'which', return_value='/bin/tool'):
            self.installer.install()
        self.assertEqual([call.args[0] for call in self.installer.api.call_args_list].count('/install'), 1)
        self.installer.verify.assert_called_once_with(state)
        self.installer.finish.assert_called_once_with(state)

    def test_transfer_mismatch_prevents_submission(self):
        self.prepare_install(transfer_ok=False)
        with patch.object(module.shutil, 'which', return_value='/bin/tool'):
            with self.assertRaisesRegex(RuntimeError, 'checksum does not match'):
                self.installer.install()
        self.assertFalse(self.installer.ledger.exists())
        self.assertNotIn('/install', [call.args[0] for call in self.installer.api.call_args_list])

    def test_incomplete_or_unsafe_saved_record_is_rejected(self):
        for change in ('revision', 'hashes', 'target', 'hashCommand'):
            state = record()
            state[change] = {} if change == 'hashes' else 'unexpected'
            with self.assertRaises(RuntimeError):
                module.validate_saved(state)

    def test_installed_files_must_all_match(self):
        state = record()
        self.installer.find_root = Mock(return_value=module.ROOTS[0])
        hashes = [state['hashes'][name] + '  ' + name for name in sorted(state['hashes'])]
        self.installer.script = Mock(return_value='\n'.join(hashes))
        self.assertTrue(self.installer.verify(state, attempts=1))
        self.installer.script.return_value = '\n'.join(hashes[:-1])
        self.assertFalse(self.installer.verify(state, attempts=1))
        self.installer.script.return_value = '\n'.join(hashes) + '\nMISSING'
        self.assertFalse(self.installer.verify(state, attempts=1))

    def test_author_certificate_comparison_uses_certificate_bytes(self):
        def signature(value):
            return ('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><KeyInfo><X509Data>'
                    '<X509Certificate>' + value + '</X509Certificate></X509Data></KeyInfo></Signature>').encode()
        self.assertEqual(module.author_certificate(signature('YQ==')), module.author_certificate(signature('YQ==\n')))
        self.assertNotEqual(module.author_certificate(signature('YQ==')), module.author_certificate(signature('Yg==')))
        with self.assertRaises(Exception):
            module.author_certificate(b'<Signature/>')


if __name__ == '__main__':
    unittest.main()
