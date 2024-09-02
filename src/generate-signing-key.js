const webcrypto = require('node:crypto');

async function main() {
    const key = await webcrypto.subtle.generateKey({
        name: 'HMAC',
        hash: 'SHA-512',
    }, true, ['sign', 'verify']);
    console.log(JSON.stringify(await webcrypto.subtle.exportKey('jwk', key), undefined, 4));
}

main().then(() => process.exit(0)).catch(err => { throw err });
