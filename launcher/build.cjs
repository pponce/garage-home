'use strict';
// Signs Garage Home into dist/GarageHome.wgt (signing deps in tools/signing).
// Needs AUTHOR_PW and DIST_PW; certificates from CERT_DIR (default ~/SamsungCertificate/garage).

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const signingRequire = require('module').createRequire(path.join(__dirname, '..', 'tools', 'signing', 'package.json'));

const CERTS = process.env.CERT_DIR || path.join(os.homedir(), 'SamsungCertificate', 'garage');
const OUT = path.join(__dirname, 'dist', 'GarageHome.wgt');

async function main() {
    const {AUTHOR_PW, DIST_PW} = process.env;
    if (!AUTHOR_PW || !DIST_PW) throw new Error('Set AUTHOR_PW and DIST_PW');
    const forge = signingRequire('node-forge');
    const JSZip = signingRequire('jszip');
    const {Signature} = signingRequire('tizen');
    const p12 = (name, pw) => forge.pkcs12.pkcs12FromAsn1(
        forge.asn1.fromDer(fs.readFileSync(path.join(CERTS, name)).toString('binary')), false, pw);

    // Use the same manifest checks, file list and generated local key as the portable builder.
    const built = spawnSync(process.env.PYTHON || 'python3',
        [path.join(__dirname, '..', 'tools', 'build-manual.py'), '--output', path.dirname(OUT)], {encoding:'utf8'});
    if (built.status !== 0) throw new Error('Unsigned widget build failed: ' + (built.stderr || 'Python 3 is required'));
    const unsigned = await JSZip.loadAsync(fs.readFileSync(built.stdout.trim().split('\n').pop()));
    const contents = [];
    for (const name of Object.keys(unsigned.files).sort()) {
        if (unsigned.files[name].dir) continue;
        const config = path.join(__dirname, 'garage-config.js');
        const data = name === 'garage-config.js' && fs.existsSync(config)
            ? fs.readFileSync(config) : await unsigned.files[name].async('nodebuffer');
        contents.push({uri:encodeURIComponent(name), data});
    }
    const authored = await new Signature('AuthorSignature', contents).sign(p12('author.p12', AUTHOR_PW));
    const signed = await new Signature('DistributorSignature', authored).sign(p12('distributor.p12', DIST_PW));

    const zip = new JSZip();
    for (const file of signed) zip.file(decodeURIComponent(file.uri), file.data);
    fs.mkdirSync(path.dirname(OUT), {recursive: true});
    fs.writeFileSync(OUT, await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
    console.log('wrote ' + OUT);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
