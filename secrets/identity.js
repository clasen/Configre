import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, parsePrivateKey, parsePublicKey } from "./crypto.js";
import { stat, readText, withLock } from "./files.js";
import log from "./log.js";

function loadIdentity() {
    const directory = path.join(os.homedir(), ".config", "configre");
    const privatePath = path.join(directory, "identity.pem");
    const publicPath = path.join(directory, "identity.pub");
    if (fs.mkdirSync(directory, { recursive: true, mode: 0o700 })) {
        log.info("Created identity directory", directory);
    }
    const info = stat(directory);
    if (!info.isDirectory() || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) {
        throw new Error(`Configre secrets: identity directory must be private and not a symlink at ${directory}`);
    }

    function readIdentity() {
        const identity = parsePrivateKey(readText(privatePath, true));
        const published = parsePublicKey(readText(publicPath));
        if (published.fingerprint !== identity.fingerprint) {
            throw new Error("Configre secrets: public identity does not match the private key; restore the matching identity");
        }
        return { ...identity, publicPath };
    }

    if (stat(privatePath) && stat(publicPath) && !stat(privatePath + ".lock")) {
        return readIdentity();
    }
    return withLock(privatePath, () => {
        if (!stat(privatePath)) {
            if (stat(publicPath)) {
                throw new Error("Configre secrets: private identity is missing; restore it instead of replacing it");
            }
            fs.writeFileSync(privatePath, generatePrivateKey(), { flag: "wx", mode: 0o600 });
            log.info("Created private identity file", privatePath);
        }
        const identity = parsePrivateKey(readText(privatePath, true));
        if (!stat(publicPath)) {
            fs.writeFileSync(publicPath, identity.publicKey, { flag: "wx", mode: 0o644 });
            log.info("Created public identity file", publicPath);
        }
        return readIdentity();
    });
}

export default loadIdentity;
