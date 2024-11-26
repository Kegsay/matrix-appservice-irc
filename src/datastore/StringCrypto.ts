/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as crypto from "crypto";
import * as fs from "fs";
import { getLogger } from "../logging";

const log = getLogger("CryptoStore");

export class StringCrypto {
    private secretKey!: crypto.KeyObject;
    private privateKey!: crypto.KeyObject;

    public load(pkeyPath: string) {
        try {
            const pk = fs.readFileSync(pkeyPath, "utf8").toString();

            try {
                this.privateKey = crypto.createPrivateKey(pk);
            }
            catch (err) {
                log.error(`Failed to validate private key: (${err.message})`);
                throw err;
            }
            // Derive AES key from private key hash
            const hash = crypto.createHash('sha256');
            // Re-export to have robustness against formatting/whitespace for same key
            hash.update(this.privateKey.export({
                type: 'pkcs1',
                format: 'der'
            }));
            this.secretKey = crypto.createSecretKey(hash.digest());

            log.info(`Private key loaded from ${pkeyPath} - IRC password encryption enabled.`);
        }
        catch (err) {
            log.error(`Could not load private key ${err.message}.`);
            throw err;
        }
    }

    public encrypt(plaintext: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            'aes-256-gcm',
            this.secretKey,
            iv,
            {authTagLength: 16}
        );
        const encrypted = Buffer.concat([
            cipher.update(plaintext),
            cipher.final()
        ]);
        return [
            cipher.getAuthTag(),
            iv,
            encrypted
        ].map(x => x.toString('base64')).join('|');
    }

    public decrypt(encryptedString: string): string {
        if (encryptedString.includes('|')) {
            const [cipherTag, iv, encrypted] = encryptedString.split('|').map(x => Buffer.from(x, 'base64'))
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                this.secretKey as any, // eslint-disable-line @typescript-eslint/no-explicit-any
                iv,
                {authTagLength: 16}
            );
            decipher.setAuthTag(cipherTag);
            return [decipher.update(encrypted), decipher.final()].join('')
        }
        log.debug('Could not decrypt string with derived secret key; falling back to asymmetric scheme');
        const decryptedPass = crypto.privateDecrypt(
            this.privateKey,
            Buffer.from(encryptedString, 'base64')
        ).toString();
        // Extract the password by removing the prefixed salt and separating space
        return decryptedPass.split(' ')[1];
    }
}
