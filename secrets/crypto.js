import crypto from "node:crypto";

const version = 2;
const algorithm = "RSA-OAEP-SHA256+AES-256-GCM";

function publicIdentity(key) {
    if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength !== 3072 ||
        key.asymmetricKeyDetails.publicExponent !== 65537n) {
        throw new Error("Configre secrets: keys must be RSA-3072");
    }
    const publicKey = key.type === "private" ? crypto.createPublicKey(key) : key;
    return {
        fingerprint: crypto.createHash("sha256")
            .update(publicKey.export({ type: "spki", format: "der" })).digest("hex"),
        publicKey: publicKey.export({ type: "spki", format: "pem" })
    };
}

function parsePublicKey(pem) {
    try {
        if (typeof pem !== "string" || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----$/.test(pem.trim())) {
            throw new Error();
        }
        return publicIdentity(crypto.createPublicKey(pem));
    } catch {
        throw new Error("Configre secrets: invalid RSA-3072 public key");
    }
}

function parsePrivateKey(pem) {
    try {
        const privateKey = crypto.createPrivateKey(pem);
        return { ...publicIdentity(privateKey), privateKey };
    } catch {
        throw new Error("Configre secrets: invalid private identity; restore it instead of replacing it");
    }
}

function generatePrivateKey() {
    return crypto.generateKeyPairSync("rsa", {
        modulusLength: 3072,
        publicExponent: 65537,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
    }).privateKey;
}

function validateSecrets(value) {
    const ancestors = new Set();
    function visit(entry) {
        if (typeof entry === "number" && !Number.isFinite(entry)) {
            throw new Error("Configre secrets: secret numbers must be finite");
        }
        if (entry !== null && typeof entry === "object") {
            if (ancestors.has(entry) || (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype)) {
                throw new Error("Configre secrets: secrets must contain only JSON values without circular references");
            }
            ancestors.add(entry);
            const keys = Reflect.ownKeys(entry);
            if (Array.isArray(entry) && keys.length !== entry.length + 1) {
                throw new Error("Configre secrets: secret arrays must not contain holes or extra properties");
            }
            for (const key of keys) {
                if (Array.isArray(entry) && key === "length") continue;
                if (key === "__proto__" || key === "constructor" || key === "prototype") {
                    throw new Error("Configre secrets: unsafe property in secrets object");
                }
                const descriptor = Object.getOwnPropertyDescriptor(entry, key);
                if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") ||
                    (Array.isArray(entry) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= entry.length))) {
                    throw new Error("Configre secrets: secrets must contain only JSON data properties");
                }
                visit(descriptor.value);
            }
            ancestors.delete(entry);
        } else if (entry !== null && !["string", "number", "boolean"].includes(typeof entry)) {
            throw new Error("Configre secrets: secrets must contain only JSON values");
        }
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Configre secrets: secrets must be a JSON object");
    }
    visit(value);
    return value;
}

function exactFields(object, names) {
    if (!object || Array.isArray(object) || typeof object !== "object" ||
        Object.keys(object).length !== names.length ||
        !names.every(name => Object.hasOwn(object, name))) {
        throw new Error("Configre secrets: invalid encrypted file structure");
    }
}

function decode(value, length) {
    if (typeof value !== "string") {
        throw new Error("Configre secrets: invalid encrypted data");
    }
    const buffer = Buffer.from(value, "base64");
    if (buffer.length === 0 || buffer.toString("base64") !== value ||
        (length !== undefined && buffer.length !== length)) {
        throw new Error("Configre secrets: invalid encrypted data");
    }
    return buffer;
}

function authenticatedHeader(envelope) {
    return Buffer.from(JSON.stringify({
        version: envelope.version,
        algorithm: envelope.algorithm,
        recipients: envelope.recipients.map(({ fingerprint, publicKey, wrappedKey }) => ({
            fingerprint, publicKey, wrappedKey
        }))
    }));
}

function validateEnvelope(envelope) {
    exactFields(envelope, ["version", "algorithm", "recipients", "iv", "tag", "ciphertext"]);
    if (envelope.version !== version || envelope.algorithm !== algorithm) {
        throw new Error("Configre secrets: unsupported encrypted file version or algorithm");
    }
    if (!Array.isArray(envelope.recipients) || envelope.recipients.length === 0) {
        throw new Error("Configre secrets: encrypted file has no recipients");
    }
    let previous = "";
    for (const recipient of envelope.recipients) {
        exactFields(recipient, ["fingerprint", "publicKey", "wrappedKey"]);
        const parsed = parsePublicKey(recipient.publicKey);
        if (recipient.fingerprint !== parsed.fingerprint || recipient.publicKey !== parsed.publicKey ||
            recipient.fingerprint <= previous) {
            throw new Error("Configre secrets: invalid encrypted recipients");
        }
        previous = recipient.fingerprint;
        decode(recipient.wrappedKey, 384);
    }
    decode(envelope.iv, 12);
    decode(envelope.tag, 16);
    decode(envelope.ciphertext);
}

function encrypt(settings, recipients) {
    const contentKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    try {
        const envelope = {
            version,
            algorithm,
            recipients: recipients.map(recipient => ({
                ...recipient,
                wrappedKey: crypto.publicEncrypt({
                    key: recipient.publicKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: "sha256"
                }, contentKey).toString("base64")
            })),
            iv: iv.toString("base64")
        };
        const cipher = crypto.createCipheriv("aes-256-gcm", contentKey, iv, { authTagLength: 16 });
        cipher.setAAD(authenticatedHeader(envelope));
        envelope.ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(settings), "utf8"), cipher.final()
        ]).toString("base64");
        envelope.tag = cipher.getAuthTag().toString("base64");
        return envelope;
    } finally {
        contentKey.fill(0);
    }
}

function decrypt(envelope, identity) {
    validateEnvelope(envelope);
    const recipient = envelope.recipients.find(entry => entry.fingerprint === identity.fingerprint);
    if (!recipient) {
        const error = new Error("Configre secrets: this machine is not authorized by the current encrypted file");
        error.code = "CONFIGRE_NOT_AUTHORIZED";
        throw error;
    }
    let contentKey;
    let plaintext;
    let settings;
    try {
        contentKey = crypto.privateDecrypt({
            key: identity.privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256"
        }, decode(recipient.wrappedKey, 384));
        const decipher = crypto.createDecipheriv("aes-256-gcm", contentKey, decode(envelope.iv, 12), {
            authTagLength: 16
        });
        decipher.setAAD(authenticatedHeader(envelope));
        decipher.setAuthTag(decode(envelope.tag, 16));
        plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
        settings = JSON.parse(plaintext.toString("utf8"));
    } catch {
        throw new Error("Configre secrets: could not authenticate or decrypt secrets; encrypted file was not changed");
    } finally {
        if (contentKey) contentKey.fill(0);
        if (plaintext) plaintext.fill(0);
    }
    return validateSecrets(settings);
}

export { parsePublicKey, parsePrivateKey, generatePrivateKey, validateSecrets, encrypt, decrypt };
