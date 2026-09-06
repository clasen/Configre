import fs from "node:fs";
import crypto from "node:crypto";

function stat(filename) {
    try {
        return fs.lstatSync(filename);
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function readText(filename, privateFile = false) {
    const info = stat(filename);
    if (!info || !info.isFile()) {
        throw new Error(`Configre secrets: expected a regular file at ${filename}`);
    }
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
        if (privateFile && process.platform !== "win32" && (fs.fstatSync(fd).mode & 0o077) !== 0) {
            throw new Error(`Configre secrets: private identity must have owner-only permissions at ${filename}`);
        }
        return fs.readFileSync(fd, "utf8");
    } finally {
        fs.closeSync(fd);
    }
}

function readJSON(filename) {
    const text = readText(filename);
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Configre secrets: invalid JSON at ${filename}`);
    }
}

function withLock(filename, action) {
    const lockPath = filename + ".lock";
    let fd;
    try {
        fd = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
        throw new Error(`Configre secrets: another writer holds ${lockPath}; retry after it finishes, or remove the lock only if the writer has stopped`);
    }
    try {
        return action();
    } finally {
        fs.closeSync(fd);
        fs.unlinkSync(lockPath);
    }
}

function writeEncrypted(filename, envelope) {
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
        try {
            fs.writeFileSync(fd, JSON.stringify(envelope, null, 2) + "\n");
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, filename);
    } finally {
        if (stat(temporary)) fs.unlinkSync(temporary);
    }
}

export { stat, readText, readJSON, withLock, writeEncrypted };
