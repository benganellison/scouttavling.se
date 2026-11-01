/** Prints a new ES256 (P-256) PKCS8 key for GRANT_SIGNING_KEY, escaped for a one-line env value. */
import { exportPKCS8, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const pem = await exportPKCS8(privateKey);
console.log(`GRANT_SIGNING_KEY="${pem.trim().replace(/\n/g, '\\n')}"`);
