import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import loadIdentity from "./identity.js";
import registerRecipient from "./register.js";
import { parsePublicKey, validateSecrets, encrypt, decrypt } from "./crypto.js";
import { stat, readText, readJSON, withLock, writeEncrypted } from "./files.js";

const requireSecret = createRequire(import.meta.url);

function secretPaths(configPath, configFile) {
    const directory = fs.statSync(configPath, { throwIfNoEntry: false })?.isDirectory();
    const parent = directory ? path.resolve(configPath) : path.dirname(configFile);
    const prefix = directory ? "" : path.basename(configFile) + ".";
    if (/[\r\n]/.test(prefix)) {
        throw new Error("Configre secrets: config filenames cannot contain newlines");
    }
    return {
        parent, directory,
        local: path.join(parent, path.basename(configFile, path.extname(configFile)) + ".secret.cjs"),
        recipients: path.join(parent, prefix + "recipients"),
        encrypted: path.join(parent, prefix + "secrets.enc.json")
    };
}

function inGitRepository(directory) {
    for (let current = directory; ; current = path.dirname(current)) {
        if (stat(path.join(current, ".git"))) return true;
        if (current === path.dirname(current)) return false;
    }
}

function prepareIgnore(paths) {
    const localName = path.basename(paths.local);
    const recipientsName = path.basename(paths.recipients);
    if (inGitRepository(paths.parent)) {
        const result = spawnSync("git", ["-C", paths.parent, "ls-files", "-z"], {
            encoding: "utf8",
            env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1" }
        });
        if (result.error || result.status !== 0) {
            throw new Error("Configre secrets: could not check whether local secret files are tracked by Git");
        }
        const tracked = result.stdout.split("\0").some(name =>
            paths.directory ? !name.includes("/") && name.endsWith(".secret.cjs") : name === localName);
        if (tracked) {
            throw new Error("Configre secrets: local secrets are tracked by Git; untrack them before continuing (existing Git history is not removed)");
        }
    }
    const ignorePath = path.join(paths.parent, ".gitignore");
    const existing = stat(ignorePath) ? readText(ignorePath) : "";
    const escape = name => name.replace(/([\\*?\[\] !#])/g, "\\$1");
    const encryptedName = escape(path.basename(paths.encrypted));
    const rules = [
        paths.directory ? "/*.secret.cjs" : "/" + escape(localName),
        "!/" + escape(recipientsName) + "/",
        "!/" + escape(recipientsName) + "/*.pub",
        "/" + encryptedName + ".lock",
        "/" + encryptedName + ".*.tmp"
    ];
    const lines = existing.split(/\r?\n/).filter(line => line && !line.startsWith("#"));
    if (!isDeepStrictEqual(lines.slice(-rules.length), rules)) {
        fs.appendFileSync(ignorePath, (existing && !existing.endsWith("\n") ? "\n" : "") + rules.join("\n") + "\n");
    }
}

function loadRecipients(directory, identity) {
    if (!stat(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    if (!stat(directory).isDirectory()) {
        throw new Error("Configre secrets: recipients must be a directory, not a symlink");
    }
    const recipients = new Map([[identity.fingerprint, {
        fingerprint: identity.fingerprint, publicKey: identity.publicKey
    }]]);
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".pub")).sort()) {
        const recipient = parsePublicKey(readText(path.join(directory, name)));
        recipients.set(recipient.fingerprint, recipient);
    }
    return [...recipients.values()].sort((a, b) => a.fingerprint < b.fingerprint ? -1 : 1);
}

function localFiles(paths) {
    return paths.directory
        ? fs.readdirSync(paths.parent).filter(name => name.endsWith(".secret.cjs")).sort()
        : stat(paths.local) ? [path.basename(paths.local)] : [];
}

function readSecret(filename) {
    readText(filename);
    try {
        delete requireSecret.cache[requireSecret.resolve(filename)];
        return validateSecrets(requireSecret(filename));
    } catch {
        throw new Error("Configre secrets: invalid secret module; export a plain object containing only JSON values");
    }
}

function validateBundle(bundle) {
    if (Object.keys(bundle).length !== 1 || !Object.hasOwn(bundle, "files") ||
        !bundle.files || typeof bundle.files !== "object" || Array.isArray(bundle.files)) {
        throw new Error("Configre secrets: invalid encrypted secrets bundle");
    }
    for (const [name, settings] of Object.entries(bundle.files)) {
        if (path.basename(name) !== name || !name.endsWith(".secret.cjs")) {
            throw new Error("Configre secrets: invalid encrypted secret filename");
        }
        validateSecrets(settings);
    }
    return bundle;
}

function selectSecrets(bundle, paths, profile) {
    const files = bundle.files;
    const base = files[path.basename(paths.local)] || {};
    const selected = paths.directory
        ? files[profile + ".dev.secret.cjs"] || files[profile + ".secret.cjs"] || {}
        : {};
    return [base, selected];
}

function loadSecrets(configPath, configFile, profile) {
    const paths = secretPaths(configPath, configFile);
    const names = localFiles(paths);
    const hasEncrypted = !!stat(paths.encrypted);
    const hasLocal = names.includes(path.basename(paths.local)) || (paths.directory &&
        (names.includes(profile + ".dev.secret.cjs") || names.includes(profile + ".secret.cjs")));
    if (!hasLocal && !hasEncrypted) return [];

    const identity = loadIdentity();
    if (names.length === 0 && hasEncrypted) {
        try {
            return selectSecrets(validateBundle(decrypt(readJSON(paths.encrypted), identity)), paths, profile);
        } catch (error) {
            if (error.code !== "CONFIGRE_NOT_AUTHORIZED") throw error;
            registerRecipient(paths, identity, profile);
            throw new Error("Configre secrets: not authorized yet; public key is published in Git. The administrator must pull, reload Configre and publish secrets.enc.json; then pull the updated encrypted file and restart this machine");
        }
    }

    const bundle = withLock(paths.encrypted, () => {
        const names = localFiles(paths);
        const hasEncrypted = !!stat(paths.encrypted);
        const envelope = hasEncrypted ? readJSON(paths.encrypted) : null;
        const previous = hasEncrypted ? validateBundle(decrypt(envelope, identity)) : null;
        if (names.length === 0 && hasEncrypted) return previous;

        prepareIgnore(paths);
        const settings = { files: Object.fromEntries(names.map(name => [name, readSecret(path.join(paths.parent, name))])) };
        const recipients = loadRecipients(paths.recipients, identity);
        if (hasEncrypted) {
            const previousRecipients = envelope.recipients.map(({ fingerprint, publicKey }) => ({ fingerprint, publicKey }));
            if (isDeepStrictEqual(settings, previous) && isDeepStrictEqual(recipients, previousRecipients)) {
                return settings;
            }
        }
        writeEncrypted(paths.encrypted, encrypt(settings, recipients));
        return settings;
    });
    return selectSecrets(bundle, paths, profile);
}

export default loadSecrets;
