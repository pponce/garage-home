#!/usr/bin/env python3
"""Sign and install the pinned Garage Home widget through an owner-paired Vetro."""
import argparse
import base64
import datetime
import fcntl
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

REVISION = '86bcdeb45f2cd45105e34ee834cc10de5b75502f'
APP = 'GarageHome.launcher'
ROOTS = ('/opt/usr/apps/GarageHome/res/wgt', '/usr/apps/GarageHome/res/wgt')
FILES = (
    'config.xml', 'index.html', 'style.css', 'app.js', 'qrcode.js', 'app-icon.png', 'logo.png',
    'garage-config.js', 'local-key.js', 'vetro-access-client.js', 'vetro-transport.js',
    'vetro-controls.js', 'sleep-timer.js', 'vendor/sha256.js', 'vendor/sha256.LICENSE.txt',
    'vendor/VETRO-LICENSE.txt', 'vendor/GLASS-LICENSE.txt', 'service/index.js',
    'service/server.js', 'service/vetro-replies.js', 'service/local-addresses.js'
)


def author_certificate(signature):
    root = ET.fromstring(signature)
    node = root.find('.//{http://www.w3.org/2000/09/xmldsig#}X509Certificate')
    if node is None or not node.text:
        raise RuntimeError('The author signature has no certificate.')
    return hashlib.sha256(base64.b64decode(''.join(node.text.split()), validate=True)).hexdigest()


def validate_saved(record):
    if record.get('revision') != REVISION:
        raise RuntimeError('An earlier Garage Home installation is unresolved. Keep its report before starting another revision.')
    hashes = record.get('hashes')
    if not isinstance(hashes, dict) or set(hashes) != set(FILES) or not all(
            isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) for value in hashes.values()):
        raise RuntimeError('The saved installation record is incomplete. No installation was repeated.')
    if record.get('hashCommand') not in ('sha256sum', 'openssl dgst -sha256'):
        raise RuntimeError('Invalid saved checksum command.')
    if not re.fullmatch(r'/home/owner/share/tmp/sdk_tools/garage-controls-[a-f0-9]{16}/app.wgt', record.get('target', '')):
        raise RuntimeError('Invalid saved package location.')
    return record


class Installer:
    def __init__(self, args, owner_factory):
        self.args = args
        self.project = Path(args.project_root).expanduser().resolve()
        if not self.project.is_dir():
            raise RuntimeError('The existing samsung-tv-tools project folder was not found.')
        self.base = self.project / 'launcher-playground'
        for folder in ('sources', 'packages', 'signed', 'logs', 'tmp'):
            (self.base / folder).mkdir(parents=True, exist_ok=True)
        self.stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        self.report = self.base / 'logs' / ('garage-home-controls-' + self.stamp + '.txt')
        self.env = dict(os.environ, TMPDIR=str(self.base / 'tmp'), GIT_TERMINAL_PROMPT='0')
        self.ledger = self.base / 'logs' / ('garage-controls-state-' + hashlib.sha256(args.tv.encode()).hexdigest()[:12] + '.json')
        self.lock = self.ledger.with_suffix('.lock').open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another Garage Home installer is already running.') from None
        self.owner = owner_factory('http://' + args.tv + ':8099', self.project / 'vetro-install/combined-updates', self.say)

    def say(self, message):
        print(message, flush=True)
        with self.report.open('a') as stream:
            stream.write(str(message) + '\n')

    def run(self, args, cwd=None, timeout=180, sensitive=False):
        result = subprocess.run(args, cwd=cwd or self.base, env=self.env, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            detail = 'output withheld for the certificate operation' if sensitive else (result.stderr or result.stdout)[-1000:]
            raise RuntimeError(Path(args[0]).name + ' failed: ' + detail)
        return result.stdout.strip()

    def api(self, route, data=None, timeout=45):
        result = self.owner.request(route, data, timeout)
        if not isinstance(result, dict) or result.get('ok') is False:
            raise RuntimeError('Vetro refused ' + route + ': ' + str(result.get('error', 'no details') if isinstance(result, dict) else 'invalid reply')[:400])
        return result

    def remote(self, command):
        result = self.api('/exec', {'cmd': command})
        if result.get('exit_code') != 0 or result.get('timed_out'):
            raise RuntimeError('TV command failed: ' + str(result.get('stderr') or 'no details')[:400])
        return result.get('output', '').strip().replace('\\n', '\n').replace('\\r', '\r')

    def script(self, source):
        return self.remote('printf %s ' + base64.b64encode(source.encode()).decode() + ' | base64 -d | sh')

    def read_tv(self, file, optional=False):
        cmd = 'base64 ' + shlex.quote(file)
        if optional:
            cmd = 'if [ -f ' + shlex.quote(file) + ' ]; then ' + cmd + '; fi'
        encoded = ''.join(self.remote(cmd).split())
        return base64.b64decode(encoded, validate=True) if encoded else None

    def find_root(self):
        result = self.remote('for d in ' + ' '.join(ROOTS) + '; do if [ -f "$d/config.xml" ]; then printf "%s" "$d"; break; fi; done')
        if result and result not in ROOTS:
            raise RuntimeError('Unexpected Garage Home package path.')
        return result or None

    def tv_hash(self, file, command):
        hashes = re.findall(r'\b[0-9a-fA-F]{64}\b', self.remote(command + ' ' + shlex.quote(file)))
        if len(hashes) != 1:
            raise RuntimeError('The TV did not return one package checksum.')
        return hashes[0].lower()

    def save(self, record):
        temporary = self.ledger.with_suffix('.tmp')
        with temporary.open('w') as stream:
            json.dump(record, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(self.ledger)

    def verify(self, record, attempts=20):
        validate_saved(record)
        names = sorted(record['hashes'])
        for attempt in range(attempts):
            try:
                root = self.find_root()
                if root:
                    commands = [record['hashCommand'] + ' ' + shlex.quote(root + '/' + name) + ' 2>/dev/null || printf MISSING' for name in names]
                    output = self.script('\n'.join(commands) + '\n:')
                    hashes = re.findall(r'\b[0-9a-fA-F]{64}\b', output)
                    if 'MISSING' not in output and [h.lower() for h in hashes] == [record['hashes'][name] for name in names]:
                        return True
            except Exception:
                pass
            if attempt + 1 < attempts:
                if attempt in (0, 7, 14):
                    self.say('Waiting for the installed Garage Home files to match the signed update...')
                time.sleep(2)
        return False

    def finish(self, record):
        record['complete'] = True
        self.save(record)
        self.say('INSTALLED: all 21 Garage Home files match the signed update.')
        try:
            target = record['target']
            self.remote('rm -f ' + shlex.quote(target) + ' && rmdir ' + shlex.quote(str(Path(target).parent)))
        except Exception:
            self.say('The temporary TV package could not be removed.')
        self.say('Opening Garage Home...')
        self.script('/usr/bin/app_launcher -k GarageHome.launcher >/dev/null 2>&1\n'
                    '/usr/bin/app_launcher -k GarageHome.Controls >/dev/null 2>&1\n'
                    '/usr/bin/app_launcher -s GarageHome.launcher')
        self.say('In Garage Home: Vetro controls > Connect / request access.')
        self.say('Approve Garage Home in Vetro App permissions, then choose Refresh access in Garage Home.')
        self.say('Brightness controls remain off unless you explicitly enable them.')

    def profile(self):
        executables = [p for p in (self.project / 'vetro-install/bin/v3.1.0').rglob('apps2samsung-cli*')
                       if p.is_file() and os.access(p, os.X_OK) and p.suffix not in ('.zip', '.gz')]
        if len(executables) != 1:
            raise RuntimeError('The existing Apps2Samsung v3.1.0 certificate inspector was not found.')
        explicit = os.environ.get('SAMSUNG_PLAYGROUND_DATA_DIR') or os.environ.get('APPS2SAMSUNG_DATA_DIR')
        stores = [Path(explicit).expanduser()] if explicit else [Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'Apps2Samsung']
        if not explicit:
            for root, directories, files in os.walk(self.project / 'vetro-install'):
                directories[:] = [d for d in directories if d not in ('.git', 'node_modules', 'cache', 'backup', 'backups')]
                if 'Certificate' in directories:
                    stores.append(Path(root))
                    directories.remove('Certificate')
        found = set()
        for store in dict.fromkeys(p.resolve() for p in stores if (p / 'Certificate').is_dir()):
            result = self.run([str(executables[0]), 'cert', '--partner', '--data-dir', str(store), '--json'], timeout=60, sensitive=True)
            for item in json.loads(result).get('profiles', []):
                if item.get('level', '').lower() == 'partner' and item.get('exists') and item.get('usable') and item.get('path'):
                    directory = Path(item['path'])
                    if all((directory / name).is_file() for name in ('author.p12', 'distributor.p12', 'password.txt')):
                        found.add(directory.resolve())
        if len(found) != 1:
            raise RuntimeError('Expected one usable saved Partner certificate. No certificate was created or changed.')
        return found.pop()

    def prepare(self, root, hash_command):
        helper = self.base / 'tools/sign-widget.cjs'
        dependencies = self.base / 'sources/garage-home-manual-125f15373a78/tools/signing'
        if not helper.is_file() or not (dependencies / 'node_modules/tizen').is_dir():
            raise RuntimeError('The existing Garage Home signing helper or dependencies were not found.')
        cert = self.profile()
        self.say('Reusing the saved Partner certificate and existing signing helper.')
        source = self.base / 'sources' / ('garage-home-controls-' + REVISION[:12])
        if not source.exists():
            self.say('Downloading the tested Garage Home source...')
            self.run(['git', 'clone', '--no-checkout', '--single-branch', '--branch', 'feat/vetro-controls',
                      'https://github.com/pponce/garage-home.git', str(source)], timeout=240)
            self.run(['git', 'checkout', '--detach', REVISION], source)
        origin = self.run(['git', 'remote', 'get-url', 'origin'], source)
        if origin not in ('https://github.com/pponce/garage-home.git', 'git@github.com:pponce/garage-home.git') or \
                self.run(['git', 'rev-parse', 'HEAD'], source) != REVISION or self.run(['git', 'status', '--porcelain'], source):
            raise RuntimeError('The pinned source checkout has changed; it was left untouched.')
        self.say('Building tested revision ' + REVISION)
        spec = importlib.util.spec_from_file_location('garage_builder', source / 'tools/build-manual.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        package_dir = self.base / 'packages' / ('garage-controls-' + self.stamp)
        unsigned = builder.build(package_dir, self.args.tv)
        with zipfile.ZipFile(unsigned) as bundle:
            contents = {name: bundle.read(name) for name in bundle.namelist()}
        if set(contents) != set(FILES):
            raise RuntimeError('Unexpected files in the unsigned widget.')
        old_signature = None
        if root:
            config = self.read_tv(root + '/garage-config.js', optional=True)
            if config:
                if len(config) > 65536 or not re.match(rb'\s*window\.GARAGE_CONFIG\s*=', config):
                    raise RuntimeError('The installed Garage Home configuration could not be verified.')
                contents['garage-config.js'] = config
                self.say('Preserving the installed Garage Home configuration.')
            old_signature = self.read_tv(root + '/author-signature.xml', optional=True)
        with zipfile.ZipFile(unsigned, 'w', zipfile.ZIP_DEFLATED) as bundle:
            for name, data in contents.items():
                bundle.writestr(name, data)
        (package_dir / 'SHA256SUMS').write_text(hashlib.sha256(unsigned.read_bytes()).hexdigest() + '  ' + unsigned.name + '\n')
        signed = self.base / 'signed' / ('GarageHome-controls-' + self.stamp + '.wgt')
        self.run(['node', str(helper), str(dependencies), str(cert), str(unsigned), str(signed)], sensitive=True)
        with zipfile.ZipFile(signed) as bundle:
            if len(bundle.namelist()) != len(set(bundle.namelist())) or set(bundle.namelist()) != set(FILES) | {'author-signature.xml', 'signature1.xml'}:
                raise RuntimeError('Unexpected contents or missing signatures in the signed widget.')
            if any(bundle.read(name) != contents[name] for name in FILES):
                raise RuntimeError('The signing helper changed the app contents.')
            if old_signature and author_certificate(old_signature) != author_certificate(bundle.read('author-signature.xml')):
                raise RuntimeError('The saved author certificate does not match the installed Garage Home. No install was requested.')
        if signed.stat().st_size > 32 * 1024 * 1024:
            raise RuntimeError('The widget exceeds the Vetro installation size limit.')
        target = '/home/owner/share/tmp/sdk_tools/garage-controls-' + secrets.token_hex(8) + '/app.wgt'
        record = {'revision': REVISION, 'submitted': False, 'complete': False, 'target': target,
                  'hashCommand': hash_command, 'hashes': {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}}
        return signed, record

    def install(self):
        self.say('Project: ' + str(self.base))
        self.say('Keep the TV on, Vetro running, Developer Mode ON and Host PC IP at 127.0.0.1.')
        if not self.api('/exec').get('connected'):
            raise RuntimeError('Vetro root is not ready. Open Vetro and let its checks finish, then rerun this block.')
        if self.ledger.exists():
            previous = json.loads(self.ledger.read_text())
            if previous.get('submitted') and (not previous.get('complete') or previous.get('revision') == REVISION):
                validate_saved(previous)
                self.say('Checking the saved installation. No new install will be submitted.')
                if not self.verify(previous):
                    raise RuntimeError('The saved installation is still unverified. Return this report; no install was repeated.')
                self.finish(previous)
                return
        if any(shutil.which(name) is None for name in ('git', 'node')):
            raise RuntimeError('Git and Node.js are required on this Mint account.')
        root = self.find_root()
        self.say('Updating the existing Garage Home in place.' if root else 'Installing Garage Home with the existing signing certificate.')
        hash_command = None
        for command in ('sha256sum', 'openssl dgst -sha256'):
            try:
                if self.tv_hash('/dev/null', command) == hashlib.sha256(b'').hexdigest():
                    hash_command = command
                    break
            except Exception:
                pass
        if not hash_command:
            raise RuntimeError('The TV has no working SHA-256 checksum command.')
        signed, record = self.prepare(root, hash_command)
        target = record['target']
        directory = str(Path(target).parent)
        self.remote('mkdir -p ' + shlex.quote(directory) + ' && chmod 755 ' + shlex.quote(directory) + ' && : > ' + shlex.quote(target))
        try:
            self.say('Transferring the signed Garage Home widget through Vetro...')
            with signed.open('rb') as stream:
                while True:
                    chunk = stream.read(24 * 1024)
                    if not chunk:
                        break
                    self.remote('printf %s ' + base64.b64encode(chunk).decode() + ' | base64 -d >> ' + shlex.quote(target))
            self.remote('chmod 644 ' + shlex.quote(target))
            if self.tv_hash(target, hash_command) != hashlib.sha256(signed.read_bytes()).hexdigest():
                raise RuntimeError('The transferred widget checksum does not match. No installation was requested.')
            self.say('Transfer checksum verified. Submitting one Garage Home installation...')
            record['submitted'] = True
            self.save(record)
            try:
                result = self.api('/install', {'path': target}, timeout=150)
                if result.get('submitted') is not True:
                    self.say('The installation reply was inconclusive; checking the installed files.')
            except Exception as error:
                self.say('Installation reply not confirmed (' + type(error).__name__ + '); checking files without retrying.')
            if not self.verify(record):
                raise RuntimeError('Installation is not yet verified. Return this report. Rerunning this block verifies only; it will not reinstall.')
            self.finish(record)
        finally:
            if not record['submitted']:
                try:
                    self.remote('rm -f ' + shlex.quote(target) + ' && rmdir ' + shlex.quote(directory))
                except Exception:
                    self.say('Temporary TV package retained at: ' + target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tv', required=True, type=lambda value: str(ipaddress.IPv4Address(value)))
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--report-host', required=True, help='SSH user and host used to copy the report')
    args = parser.parse_args()
    os.umask(0o077)
    installer = None
    result = 0
    try:
        from vetro_owner import OwnerClient
        installer = Installer(args, OwnerClient)
        installer.install()
    except (Exception, KeyboardInterrupt) as error:
        result = 1
        message = 'STOPPED: ' + (str(error) or 'Interrupted; rerun to verify any saved installation.')
        if installer:
            installer.say(message)
        else:
            print(message, flush=True)
    finally:
        if installer:
            installer.say('Developer Mode Host PC IP remains 127.0.0.1. No uninstall or TV picture change was requested.')
            print('\nReport: ' + str(installer.report))
            print('Copy the report from a terminal on your Mac:')
            print('rsync -P ' + shlex.quote(args.report_host + ':' + str(installer.report)) + ' ~/Downloads/')
            installer.lock.close()
    return result


if __name__ == '__main__':
    raise SystemExit(main())
