import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import Configre from "../index.js";
import log from "../secrets/log.js";
import { generatePrivateKey, parsePrivateKey, encrypt } from "../secrets/crypto.js";

const sentinel = "synthetic-secret-for-configre-tests";
let privateKeys;

test.before(() => {
    privateKeys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
});

function fixture(t, { seed = true } = {}) {
    const logs = { info: [], warn: [] };
    t.mock.method(log, "info", (...args) => logs.info.push(args));
    t.mock.method(log, "warn", (...args) => logs.warn.push(args));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "configre-secrets-"));
    const homes = [0, 1, 2].map(index => path.join(root, `home-${index}`));
    let home = homes[0];
    t.mock.method(os, "homedir", () => home);
    t.mock.method(os, "hostname", () => "testhost");
    const config = path.join(root, "config");
    fs.mkdirSync(config);
    fs.writeFileSync(path.join(config, "index.cjs"), 'module.exports = { api: { key: "", host: "default" }, list: [1, 2] };');
    fs.writeFileSync(path.join(config, "testhost.cjs"), 'module.exports = { api: { host: "profile" } };');
    if (seed) {
        homes.forEach((directory, index) => {
            const identityDir = path.join(directory, ".config", "configre");
            fs.mkdirSync(identityDir, { recursive: true, mode: 0o700 });
            fs.writeFileSync(path.join(identityDir, "identity.pem"), privateKeys[index], { mode: 0o600 });
            fs.writeFileSync(path.join(identityDir, "identity.pub"), parsePrivateKey(privateKeys[index]).publicKey);
        });
    }
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return {
        root, config, homes, logs,
        local: path.join(config, "index.secret.cjs"),
        encrypted: path.join(config, "secrets.enc.json"),
        recipients: path.join(config, "recipients"),
        useHome(index) { home = homes[index]; },
        publicPath(index) { return path.join(homes[index], ".config", "configre", "identity.pub"); },
        privatePath(index) { return path.join(homes[index], ".config", "configre", "identity.pem"); }
    };
}

function writeSettings(f, settings = { api: { key: sentinel } }) {
    fs.writeFileSync(f.local, `module.exports = ${JSON.stringify(settings)};\n`);
}

function load(f) {
    return Configre(f.config);
}

function assertPublicOnly(f, logs, warning) {
    const count = logs.warn.length;
    const config = load(f);
    assert.equal(config.api.key, "");
    assert.equal(logs.warn.length, count + 1);
    assert.match(logs.warn.at(-1).join(" "), warning);
    return config;
}

function envelope(f) {
    return JSON.parse(fs.readFileSync(f.encrypted, "utf8"));
}

function consumerCopy(f, name) {
    const config = path.join(f.root, name);
    fs.mkdirSync(config);
    for (const filename of ["index.cjs", "testhost.cjs", "secrets.enc.json"]) {
        fs.copyFileSync(path.join(f.config, filename), path.join(config, filename));
    }
    return { config };
}

test("print logs public configuration without creating secret artifacts", t => {
    const f = fixture(t, { seed: false });
    const calls = [];
    t.mock.method(Object.getPrototypeOf(log), "debug", (...args) => calls.push(args));
    const config = new Configre(f.config);

    assert.equal(calls.length, 0);
    config.print();
    assert.deepEqual(calls, [[config.get()]]);
    assert.equal(fs.existsSync(f.homes[0]), false);
});

test("function results expose print without changing enumerable data and log current settings", t => {
    const f = fixture(t, { seed: false });
    const calls = [];
    t.mock.method(Object.getPrototypeOf(log), "debug", (...args) => calls.push(args));
    const cfg = Configre(f.config);
    const expected = new Configre(f.config).get();

    assert.equal(typeof cfg.print, "function");
    assert.deepEqual(Object.keys(cfg), Object.keys(expected));
    assert.deepEqual({ ...cfg }, expected);
    assert.equal(JSON.stringify(cfg), JSON.stringify(expected));
    cfg.api.host = "updated";
    cfg.print();
    assert.deepEqual(calls, [[{ ...expected, api: { key: "", host: "updated" } }]]);
    assert.equal(cfg.api.host, "updated");
});

test("a public print field remains configuration data", t => {
    const f = fixture(t, { seed: false });
    fs.writeFileSync(path.join(f.config, "index.cjs"), 'module.exports = { print: false };');
    assert.equal(Configre(f.config).print, false);
    const calls = [];
    t.mock.method(Object.getPrototypeOf(log), "debug", (...args) => calls.push(args));
    new Configre(f.config).print();
    assert.equal(calls[0][0].print, false);
});

test("print omits local and encrypted secret fields without changing effective settings", t => {
    const f = fixture(t);
    const calls = [];
    t.mock.method(Object.getPrototypeOf(log), "debug", (...args) => calls.push(args));
    writeSettings(f, {
        api: { key: sentinel },
        list: [sentinel],
        privateGroup: { value: sentinel },
        optional: null,
        empty: "",
        enabled: false,
        count: 0
    });
    fs.writeFileSync(path.join(f.config, "testhost.secret.cjs"),
        `module.exports = { api: { other: ${JSON.stringify(sentinel)} }, privateGroup: "public-looking" };`);

    load(f);
    for (const source of [f, consumerCopy(f, "debug-consumer")]) {
        const config = new Configre(source.config);
        const before = config.get();
        const secretsBefore = structuredClone(config.secretSettings);
        config.print();

        assert.deepEqual(calls.at(-1), [{ api: { host: "profile" } }]);
        assert.equal(JSON.stringify(calls).includes(sentinel), false);
        assert.deepEqual(config.get(), before);
        assert.deepEqual(config.secretSettings, secretsBefore);
        assert.equal(before.api.key, sentinel);
        assert.equal(before.list[0], sentinel);
        assert.equal(before.list[1], 2);
        const cfg = Configre(source.config);
        cfg.api.key = sentinel + "-updated";
        cfg.api.host = "updated";
        cfg.print();
        assert.deepEqual(calls.at(-1), [{ api: { host: "updated" } }]);
        assert.equal(JSON.stringify(calls).includes(sentinel), false);
        assert.equal(cfg.api.key, sentinel + "-updated");
    }
    const result = spawnSync(process.execPath, ["-e", `
        const os = require('node:os');
        os.homedir = () => process.env.CONFIGRE_TEST_HOME;
        const Configre = require(process.env.CONFIGRE_TEST_MODULE);
        Configre(process.env.CONFIGRE_TEST_PATH).print();
    `, "--", "--config=testhost"], {
        encoding: "utf8",
        env: {
            ...process.env, DEBUG: "Configre:*",
            CONFIGRE_TEST_HOME: f.homes[0],
            CONFIGRE_TEST_MODULE: path.join(import.meta.dirname, "..", "index.js"),
            CONFIGRE_TEST_PATH: path.join(f.root, "debug-consumer")
        }
    });
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout + result.stderr;
    assert.match(output, /Configre:debug/);
    assert.match(output, /host: 'profile'/);
    assert.equal(output.includes(sentinel), false);
    assert.equal(output.includes("privateGroup"), false);
});

function git(directory, args) {
    const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

function gitFixture(t) {
    const f = fixture(t);
    git(f.root, ["init", "--quiet", "--initial-branch=main"]);
    git(f.root, ["config", "user.name", "Configre Test"]);
    git(f.root, ["config", "user.email", "configre-test@example.invalid"]);
    writeSettings(f);
    load(f);
    fs.writeFileSync(path.join(f.root, "tracked.txt"), "initial\n");
    git(f.root, ["add", "config/index.cjs", "config/testhost.cjs", "config/.gitignore", "config/secrets.enc.json", "tracked.txt"]);
    git(f.root, ["commit", "--quiet", "-m", "Initial configuration"]);
    const remote = path.join(f.root, "remote.git");
    git(f.root, ["init", "--bare", "--quiet", "--initial-branch=main", remote]);
    git(f.root, ["remote", "add", "origin", remote]);
    git(f.root, ["push", "--quiet", "--set-upstream", "origin", "main"]);
    const checkout = path.join(f.root, "consumer");
    git(f.root, ["clone", "--quiet", remote, checkout]);
    git(checkout, ["config", "user.name", "Configre Test"]);
    git(checkout, ["config", "user.email", "configre-test@example.invalid"]);
    return {
        ...f, remote, checkout,
        consumer: { config: path.join(checkout, "config") },
        registration: path.join(checkout, "config", "recipients", "testhost.pub")
    };
}

test("missing secret counterparts leave configuration and identity untouched", t => {
    const f = fixture(t, { seed: false });
    const publicFiles = fs.readdirSync(f.config);
    t.mock.method(os, "homedir", () => { throw new Error("must not access the identity"); });
    assert.equal(Configre(f.config).api.key, "");
    assert.deepEqual(fs.readdirSync(f.config), publicFiles);
    fs.writeFileSync(path.join(f.config, "other.secret.cjs"), "invalid-json");
    const files = fs.readdirSync(f.config);
    assert.equal(Configre(f.config).api.key, "");
    assert.equal(new Configre(f.config).get().api.key, "");
    assert.deepEqual(fs.readdirSync(f.config), files);
    assert.equal(fs.existsSync(f.homes[0]), false);
    assert.deepEqual(f.logs, { info: [], warn: [] });
});

test("an unauthorized machine keeps public settings and omits every encrypted field", t => {
    const f = fixture(t);
    writeSettings(f, { api: { key: sentinel }, encryptedOnly: { token: sentinel } });
    load(f);
    const consumer = consumerCopy(f, "unauthorized-consumer");
    f.useHome(1);
    const config = assertPublicOnly(consumer, f.logs, /not authorized.*public settings/i);
    assert.deepEqual(config, { api: { key: "", host: "profile" }, list: [1, 2] });
    assert.equal(Object.hasOwn(config, "encryptedOnly"), false);
    assert.deepEqual(new Configre(consumer.config).get(), config);
    assert.equal(JSON.stringify(f.logs).includes(sentinel), false);
    const result = spawnSync(process.execPath, ["-e", `
        const assert = require('node:assert/strict');
        const os = require('node:os');
        os.homedir = () => process.env.CONFIGRE_TEST_HOME;
        const Configre = require(process.env.CONFIGRE_TEST_MODULE);
        const cfg = Configre(process.env.CONFIGRE_TEST_PATH);
        assert.equal(cfg.api.key, '');
        assert.equal(Object.hasOwn(cfg, 'encryptedOnly'), false);
        console.info('Application started');
    `], {
        encoding: "utf8",
        env: {
            ...process.env, DEBUG: "Configre:*",
            CONFIGRE_TEST_HOME: f.homes[1],
            CONFIGRE_TEST_MODULE: path.join(import.meta.dirname, "..", "index.js"),
            CONFIGRE_TEST_PATH: consumer.config
        }
    });
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout + result.stderr;
    assert.match(output, /Secrets not authorized; continuing with public settings only/);
    assert.match(output, /Application started/);
    assert.equal(output.includes(sentinel), false);
    assert.equal(output.includes("BEGIN PRIVATE KEY"), false);
    assert.equal(output.includes("BEGIN PUBLIC KEY"), false);
});

for (const profile of ["testhost", "testhost.dev", "forced"]) {
    test(`a ${profile} secret activates secrets without a base secret module`, t => {
        const f = fixture(t);
        if (profile === "forced") {
            const previousArgs = process.argv;
            process.argv = [...previousArgs.filter(arg => !arg.startsWith("--config=")), "--config=forced"];
            t.after(() => { process.argv = previousArgs; });
        }
        const local = path.join(f.config, profile + ".secret.cjs");
        writeSettings({ local });
        assert.equal(load(f).api.key, sentinel);
        assert.equal(fs.existsSync(f.local), false);
        assert.deepEqual(fs.readdirSync(f.config).filter(name => name.endsWith(".secret.cjs")), [path.basename(local)]);
        assert.equal(load(consumerCopy(f, "profile-only-consumer")).api.key, sentinel);
    });
}

test("an existing empty secret module initializes secrets and reuses generated files", t => {
    const f = fixture(t, { seed: false });
    fs.writeFileSync(f.local, "module.exports = {};\n", { mode: 0o600 });
    const ignore = path.join(f.config, ".gitignore");
    fs.writeFileSync(ignore, "# existing rules\n*.log");
    const config = load(f);
    const initialLogs = f.logs.info.length;
    assert.deepEqual(config, Configre(f.config));
    assert.equal(f.logs.info.length, initialLogs);
    for (const filename of [path.dirname(f.privatePath(0)), f.privatePath(0), f.publicPath(0), ignore, f.recipients, f.encrypted]) {
        assert.ok(f.logs.info.some(([message, target]) => /Created|Wrote/.test(message) && target === filename));
    }
    const original = fs.readFileSync(f.privatePath(0));
    const published = fs.readFileSync(f.publicPath(0), "utf8");
    assert.equal(parsePrivateKey(original).publicKey, published);
    if (process.platform !== "win32") {
        assert.equal(fs.statSync(f.privatePath(0)).mode & 0o777, 0o600);
        assert.equal(fs.statSync(path.dirname(f.privatePath(0))).mode & 0o777, 0o700);
        assert.equal(fs.statSync(f.local).mode & 0o777, 0o600);
        assert.equal(fs.statSync(f.recipients).mode & 0o777, 0o700);
    }
    const rules = fs.readFileSync(ignore, "utf8");
    assert.ok(rules.startsWith("# existing rules\n*.log\n"));
    assert.equal(fs.readFileSync(f.local, "utf8"), "module.exports = {};\n");
    const encrypted = fs.readFileSync(f.encrypted);
    assert.deepEqual(load(f), config);
    assert.deepEqual(fs.readFileSync(f.privatePath(0)), original);
    assert.equal(fs.readFileSync(ignore, "utf8"), rules);
    assert.deepEqual(fs.readFileSync(f.encrypted), encrypted);
    assert.equal(fs.existsSync(f.encrypted + ".lock"), false);
    writeSettings(f);
    assert.equal(load(f).api.key, sentinel);
    assert.deepEqual(f.logs.info.at(-1), ["Updated encrypted secrets file", f.encrypted]);
    assert.equal(JSON.stringify(f.logs).includes(sentinel), false);
    assert.equal(JSON.stringify(f.logs).includes("BEGIN PRIVATE KEY"), false);
});

test("missing administrator files are recreated without losing values or authorized recipients", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    fs.copyFileSync(f.publicPath(1), path.join(f.recipients, "developer.pub"));
    load(f);
    const local = fs.readFileSync(f.local);
    const encrypted = fs.readFileSync(f.encrypted);
    const originalRecipients = envelope(f).recipients.map(entry => entry.fingerprint);
    const ignore = path.join(f.config, ".gitignore");
    fs.unlinkSync(ignore);
    assert.equal(load(f).api.key, sentinel);
    assert.equal(fs.existsSync(ignore), true);
    assert.equal(fs.readdirSync(f.recipients).length, 1);
    assert.deepEqual(fs.readFileSync(f.local), local);
    assert.deepEqual(fs.readFileSync(f.encrypted), encrypted);
    fs.unlinkSync(f.encrypted);
    assert.equal(load(f).api.key, sentinel);
    assert.deepEqual(envelope(f).recipients.map(entry => entry.fingerprint), originalRecipients);
    assert.deepEqual(fs.readFileSync(f.local), local);
    const consumer = consumerCopy(f, "consumer");
    f.useHome(1);
    assert.equal(load(consumer).api.key, sentinel);
});

test("removing every recipient revokes access without restoring keys from old ciphertext", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    fs.copyFileSync(f.publicPath(1), path.join(f.recipients, "developer.pub"));
    fs.copyFileSync(f.publicPath(2), path.join(f.recipients, "server.pub"));
    load(f);
    const encrypted = fs.readFileSync(f.encrypted);
    fs.rmSync(f.recipients, { recursive: true });
    assert.equal(load(f).api.key, sentinel);
    assert.deepEqual(fs.readdirSync(f.recipients), []);
    assert.equal(envelope(f).recipients.length, 1);
    assert.notDeepEqual(fs.readFileSync(f.encrypted), encrypted);
    const consumer = consumerCopy(f, "revoked-consumer");
    f.useHome(1);
    assertPublicOnly(consumer, f.logs, /not authorized/);
});

test("secrets merge last with profiles, arrays, JSON values and the constructor API", t => {
    const f = fixture(t);
    const settings = {
        api: { key: sentinel, host: "secret-host" },
        list: [9],
        json: { empty: "", multiline: "line 1\nline 2", unicode: "á🙂", enabled: false, port: 123, value: null }
    };
    writeSettings(f, settings);
    fs.writeFileSync(path.join(f.config, "testhost.dev.cjs"), 'module.exports = { dev: true, api: { host: "dev" } };');
    const config = load(f);
    assert.equal(config.dev, true);
    assert.deepEqual(config.api, settings.api);
    assert.deepEqual(config.list, [9, 2]);
    assert.deepEqual(config.json, settings.json);
    assert.deepEqual(new Configre(f.config).get(), config);
    assert.equal(fs.existsSync(f.recipients), true);
    assert.equal(fs.readFileSync(f.encrypted, "utf8").includes(sentinel), false);
    assert.equal(envelope(f).recipients.length, 1);
    const previousArgs = process.argv;
    process.argv = [...previousArgs.filter(arg => !arg.startsWith("--config=")), "--config=forced"];
    t.after(() => { process.argv = previousArgs; });
    fs.writeFileSync(path.join(f.config, "forced.cjs"), 'module.exports = { forced: true, api: { key: "profile-key" } };');
    assert.equal(load(f).forced, true);
    assert.equal(load(f).api.key, sentinel);
});

test("unchanged settings and duplicate public keys do not rewrite the encrypted file", t => {
    const f = fixture(t);
    writeSettings(f, { api: { key: sentinel }, other: true });
    load(f);
    const original = fs.readFileSync(f.encrypted);
    fs.utimesSync(f.encrypted, 100, 100);
    const originalTime = fs.statSync(f.encrypted).mtimeMs;
    writeSettings(f, { other: true, api: { key: sentinel } });
    fs.copyFileSync(f.publicPath(0), path.join(f.recipients, "self.pub"));
    fs.copyFileSync(f.publicPath(0), path.join(f.recipients, "self-copy.pub"));
    fs.writeFileSync(path.join(f.recipients, ".DS_Store"), "ignored");
    load(f);
    assert.deepEqual(fs.readFileSync(f.encrypted), original);
    assert.equal(fs.statSync(f.encrypted).mtimeMs, originalTime);
    fs.unlinkSync(path.join(f.recipients, "self.pub"));
    fs.unlinkSync(path.join(f.recipients, "self-copy.pub"));
    load(f);
    assert.deepEqual(fs.readFileSync(f.encrypted), original);
    writeSettings(f, { api: { key: sentinel + "-changed" }, other: true });
    assert.equal(load(f).api.key, sentinel + "-changed");
    const updated = envelope(f);
    const previous = JSON.parse(original);
    assert.notEqual(updated.iv, previous.iv);
    assert.notEqual(updated.ciphertext, previous.ciphertext);
    assert.notEqual(updated.recipients[0].wrappedKey, previous.recipients[0].wrappedKey);
});

test("base and host secrets select dev and forced profiles identically on consumers", t => {
    const f = fixture(t);
    writeSettings(f, { api: { key: "base-secret", shared: true } });
    const host = { local: path.join(f.config, "testhost.secret.cjs") };
    const dev = { local: path.join(f.config, "testhost.dev.secret.cjs") };
    const forced = { local: path.join(f.config, "forced.secret.cjs") };
    writeSettings(host, { api: { key: "host-secret" }, productionOnly: true });
    writeSettings(forced, { api: { key: "forced-secret" } });
    assert.deepEqual(load(f).api, { key: "host-secret", host: "profile", shared: true });
    writeSettings(dev, { api: { key: "dev-secret" } });
    const expected = load(f);
    assert.equal(expected.api.key, "dev-secret");
    assert.equal(expected.productionOnly, undefined);
    fs.copyFileSync(f.publicPath(1), path.join(f.recipients, "developer.pub"));
    load(f);
    const consumer = consumerCopy(f, "profile-consumer");
    const consumerFiles = fs.readdirSync(consumer.config);
    f.useHome(1);
    assert.deepEqual(load(consumer), expected);
    const previousArgs = process.argv;
    process.argv = [...previousArgs.filter(arg => !arg.startsWith("--config=")), "--config=forced"];
    t.after(() => { process.argv = previousArgs; });
    assert.equal(load(consumer).api.key, "forced-secret");
    f.useHome(0);
    assert.equal(load(f).api.key, "forced-secret");
    writeSettings(forced, { api: { key: "updated-forced-secret" } });
    load(f);
    fs.copyFileSync(f.encrypted, path.join(consumer.config, "secrets.enc.json"));
    f.useHome(1);
    assert.equal(load(consumer).api.key, "updated-forced-secret");
    process.argv = [...previousArgs.filter(arg => !arg.startsWith("--config=")), "--config=missing"];
    assert.equal(load(consumer).api.key, "base-secret");
    process.argv = previousArgs;
    f.useHome(0);
    fs.unlinkSync(dev.local);
    assert.equal(load(f).api.key, "host-secret");
    assert.equal(load(f).productionOnly, true);
    assert.deepEqual(fs.readdirSync(consumer.config), consumerFiles);
});

test("administrator leaves missing counterparts absent and preserves existing host secrets", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    const host = { local: path.join(f.config, "testhost.secret.cjs") };
    assert.equal(fs.existsSync(host.local), false);
    writeSettings(host, { api: { key: "host-secret" } });
    const original = fs.readFileSync(host.local);
    fs.writeFileSync(path.join(f.config, "newhost.cjs"), "module.exports = { public: true };\n");
    load(f);
    assert.deepEqual(fs.readFileSync(host.local), original);
    assert.equal(fs.existsSync(path.join(f.config, "newhost.secret.cjs")), false);
    const consumer = consumerCopy(f, "optional-profile-consumer");
    fs.writeFileSync(path.join(consumer.config, "newhost.cjs"), "module.exports = {};\n");
    assert.equal(load(consumer).api.key, "host-secret");
    assert.equal(fs.existsSync(path.join(consumer.config, "newhost.secret.cjs")), false);
});

test("secret layers preserve sequential merge behavior when a field changes type", t => {
    const f = fixture(t);
    writeSettings(f, { api: null, list: null });
    writeSettings({ local: path.join(f.config, "testhost.secret.cjs") }, {
        api: { key: sentinel }, list: [9]
    });
    const expected = { api: { key: sentinel }, list: [9] };
    assert.deepEqual(load(f), expected);
    assert.deepEqual(load(consumerCopy(f, "type-change-consumer")), expected);
});

test("grant and revoke work across isolated machines without consumer project writes", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    fs.copyFileSync(f.publicPath(1), path.join(f.recipients, "developer.pub"));
    load(f);
    const shared = envelope(f);
    const consumer = consumerCopy(f, "consumer");
    const before = fs.readdirSync(consumer.config).map(name => [name, fs.readFileSync(path.join(consumer.config, name))]);
    f.useHome(1);
    assert.equal(load(consumer).api.key, sentinel);
    const after = fs.readdirSync(consumer.config).map(name => [name, fs.readFileSync(path.join(consumer.config, name))]);
    assert.deepEqual(after, before);
    f.useHome(2);
    assertPublicOnly(consumer, f.logs, /not authorized/);
    f.useHome(0);
    fs.unlinkSync(path.join(f.recipients, "developer.pub"));
    load(f);
    const revoked = envelope(f);
    assert.equal(revoked.recipients.length, 1);
    assert.notEqual(revoked.iv, shared.iv);
    fs.copyFileSync(f.encrypted, path.join(consumer.config, "secrets.enc.json"));
    f.useHome(1);
    assertPublicOnly(consumer, f.logs, /not authorized/);
    writeSettings({ local: path.join(consumer.config, "index.secret.cjs") }, { api: { key: "replacement" } });
    assertPublicOnly(consumer, f.logs, /not authorized/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(consumer.config, "secrets.enc.json"))), revoked);
    fs.writeFileSync(path.join(consumer.config, "secrets.enc.json"), JSON.stringify(shared));
    fs.unlinkSync(path.join(consumer.config, "index.secret.cjs"));
    assert.equal(load(consumer).api.key, sentinel);
});

test("ciphertext, key wraps and recipient metadata are authenticated before returning settings", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    const original = envelope(f);
    const flip = value => {
        const bytes = Buffer.from(value, "base64");
        bytes[0] ^= 1;
        return bytes.toString("base64");
    };
    const modifications = [
        value => { value.iv = flip(value.iv); },
        value => { value.tag = flip(value.tag); },
        value => { value.ciphertext = flip(value.ciphertext); },
        value => { value.recipients[0].wrappedKey = flip(value.recipients[0].wrappedKey); },
        value => {
            const other = parsePrivateKey(privateKeys[1]);
            value.recipients.push({ fingerprint: other.fingerprint, publicKey: other.publicKey, wrappedKey: value.recipients[0].wrappedKey });
            value.recipients.sort((a, b) => a.fingerprint < b.fingerprint ? -1 : 1);
        },
        value => { value.version = 999; },
        value => { value.algorithm = "other"; },
        value => { value.tag = ""; },
        value => { value.ciphertext += "!"; },
        value => { value.recipients.push(value.recipients[0]); },
        value => { delete value.tag; },
        value => { value.extra = sentinel; }
    ];
    for (const modify of modifications) {
        const damaged = structuredClone(original);
        modify(damaged);
        const bytes = JSON.stringify(damaged);
        fs.writeFileSync(f.encrypted, bytes);
        assert.throws(() => load(f), error => {
            assert.match(error.message, /Configre secrets:/);
            assert.equal(error.message.includes(sentinel), false);
            return true;
        });
        assert.equal(fs.readFileSync(f.encrypted, "utf8"), bytes);
        assert.equal(fs.existsSync(f.encrypted + ".lock"), false);
    }
});

test("invalid local modules, unsafe keys and invalid public keys leave ciphertext untouched", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    const original = fs.readFileSync(f.encrypted);
    const invalid = [
        `{"api":"${sentinel}", bad}`, "null", "[]", "1",
        '{"nested":{"__proto__":{"polluted":true}}}',
        '{"list":[{"constructor":{}}]}', '{"prototype":{}}', '{"number":1e400}',
        '{ value: undefined }', '{ value: () => "secret" }', '{ value: 1n }',
        '{ value: new Date() }', '{ value: Symbol("secret") }', '{ value: [, 1] }',
        '(() => { const value = {}; value.self = value; return value; })()',
        `(() => { throw new Error("${sentinel}"); })()`,
        `({ get value() { throw new Error("${sentinel}"); } })`,
        '{ value: Object.assign(new Array(1), { 4294967295: true }) }'
    ];
    for (const input of invalid) {
        fs.writeFileSync(f.local, `module.exports = ${input};`);
        assert.throws(() => load(f), error => {
            assert.equal(error.message.includes(sentinel), false);
            return true;
        });
        assert.deepEqual(fs.readFileSync(f.encrypted), original);
    }
    assert.equal({}.polluted, undefined);
    writeSettings(f);
    const invalidExponent = crypto.createPublicKey(privateKeys[1]).export({ format: "jwk" });
    invalidExponent.e = "AQ";
    const invalidRSA = crypto.createPublicKey({ key: invalidExponent, format: "jwk" }).export({ type: "spki", format: "pem" });
    for (const key of [sentinel, privateKeys[1], parsePrivateKey(privateKeys[1]).publicKey + privateKeys[1], invalidRSA]) {
        fs.writeFileSync(path.join(f.recipients, "invalid.pub"), key);
        assert.throws(() => load(f), /invalid RSA-3072 public key/);
        assert.deepEqual(fs.readFileSync(f.encrypted), original);
    }
});

test("authenticated payloads still reject unsafe JSON before merging", t => {
    const f = fixture(t);
    const identity = parsePrivateKey(privateKeys[0]);
    const encrypted = encrypt(JSON.parse('{"nested":{"__proto__":{"polluted":true}}}'), [
        { fingerprint: identity.fingerprint, publicKey: identity.publicKey }
    ]);
    fs.writeFileSync(f.encrypted, JSON.stringify(encrypted));
    assert.throws(() => load(f), /unsafe property/);
    assert.equal({}.polluted, undefined);
});

test("a corrupt or missing private key is never silently replaced", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    const original = fs.readFileSync(f.encrypted);
    fs.writeFileSync(f.privatePath(0), "invalid-private-key");
    assert.throws(() => load(f), /invalid private identity/);
    assert.equal(fs.readFileSync(f.privatePath(0), "utf8"), "invalid-private-key");
    fs.unlinkSync(f.privatePath(0));
    assert.throws(() => load(f), /private identity is missing/);
    assert.equal(fs.existsSync(f.privatePath(0)), false);
    fs.writeFileSync(f.privatePath(0), privateKeys[0], { mode: 0o600 });
    fs.writeFileSync(f.publicPath(0), parsePrivateKey(privateKeys[1]).publicKey);
    assert.throws(() => load(f), /does not match/);
    assert.deepEqual(fs.readFileSync(f.encrypted), original);
    fs.unlinkSync(f.publicPath(0));
    assert.equal(load(f).api.key, sentinel);
    assert.equal(fs.readFileSync(f.publicPath(0), "utf8"), parsePrivateKey(privateKeys[0]).publicKey);
});

test("private permissions and symlinks are rejected", { skip: process.platform === "win32" }, t => {
    const f = fixture(t);
    writeSettings(f);
    fs.chmodSync(f.privatePath(0), 0o644);
    assert.throws(() => load(f), /owner-only permissions/);
    fs.chmodSync(f.privatePath(0), 0o600);
    load(f);
    const external = path.join(f.root, "external.json");
    fs.renameSync(f.local, external);
    fs.symlinkSync(external, f.local);
    assert.throws(() => load(f), /regular file/);
    fs.unlinkSync(f.local);
    fs.renameSync(external, f.local);
    const privateCopy = path.join(f.root, "private-copy.pem");
    fs.renameSync(f.privatePath(0), privateCopy);
    fs.symlinkSync(privateCopy, f.privatePath(0));
    assert.throws(() => load(f), /regular file/);
});

test("explicit config files without their own secret sidecar leave identities and files untouched", t => {
    const f = fixture(t, { seed: false });
    const filename = path.join(f.root, "settings.cjs");
    fs.writeFileSync(filename, 'module.exports = { public: true };');
    fs.writeFileSync(path.join(f.root, "other.secret.cjs"), "invalid-json");
    const files = fs.readdirSync(f.root);
    t.mock.method(os, "homedir", () => { throw new Error("must not access the identity"); });
    assert.deepEqual(Configre(filename), { public: true });
    assert.deepEqual(Configre(filename.slice(0, -4)), { public: true });
    assert.deepEqual(fs.readdirSync(f.root), files);
    assert.equal(fs.existsSync(f.homes[0]), false);
});

test("explicit config files and extensionless paths use sidecars beside the resolved file", t => {
    const f = fixture(t);
    const filename = path.join(f.root, "settings.cjs");
    fs.writeFileSync(filename, 'module.exports = { api: { key: "", host: "file" } };');
    const local = filename.slice(0, -4) + ".secret.cjs";
    writeSettings({ local });
    assert.equal(Configre(filename).api.key, sentinel);
    assert.equal(Configre(filename.slice(0, -4)).api.key, sentinel);
    assert.equal(fs.existsSync(filename + ".secrets.enc.json"), true);
    assert.equal(fs.existsSync(filename + ".recipients"), true);
    assert.equal(fs.existsSync(path.join(f.root, "secrets.enc.json")), false);
    const relative = path.relative(process.cwd(), f.config);
    writeSettings(f);
    assert.equal(Configre(relative).api.key, sentinel);
});

test("ESM callers can use the same synchronous API", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    const script = path.join(f.root, "check.mjs");
    const moduleURL = pathToFileURL(path.join(import.meta.dirname, "..", "index.js")).href;
    fs.writeFileSync(script, `
        import assert from 'node:assert/strict';
        import os from 'node:os';
        import Configre from ${JSON.stringify(moduleURL)};
        os.homedir = () => process.env.CONFIGRE_TEST_HOME;
        const cfg = Configre(process.env.CONFIGRE_TEST_PATH);
        assert.equal(typeof cfg.then, 'undefined');
        assert.equal(cfg.api.key, ${JSON.stringify(sentinel)});
    `);
    const result = spawnSync(process.execPath, [script], {
        encoding: "utf8",
        env: { ...process.env, CONFIGRE_TEST_HOME: f.homes[0], CONFIGRE_TEST_PATH: f.config }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout + result.stderr).includes(sentinel), false);
});

test("symlinked configuration directories keep directory sidecar names", { skip: process.platform === "win32" }, t => {
    const f = fixture(t);
    writeSettings(f);
    const linked = path.join(f.root, "linked-config");
    fs.symlinkSync(f.config, linked);
    assert.equal(Configre(linked).api.key, sentinel);
    assert.equal(fs.existsSync(f.encrypted), true);
    assert.equal(fs.existsSync(path.join(f.config, "index.cjs.secrets.enc.json")), false);
});

test("error output never includes local secret values or private key contents", t => {
    const f = fixture(t);
    fs.writeFileSync(f.local, `module.exports = {secret: "${sentinel}", bad`);
    assert.throws(() => load(f), /invalid secret module/);
    const script = `
        const os = require('node:os');
        os.homedir = () => process.env.CONFIGRE_TEST_HOME;
        const Configre = require(process.env.CONFIGRE_TEST_MODULE);
        try {
            Configre(process.env.CONFIGRE_TEST_PATH);
        } catch (error) {
            console.error(error.stack);
            process.exitCode = 1;
        }
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env: {
            ...process.env,
            CONFIGRE_TEST_HOME: f.homes[0],
            CONFIGRE_TEST_MODULE: path.join(import.meta.dirname, "..", "index.js"),
            CONFIGRE_TEST_PATH: f.config
        }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid secret module/);
    assert.equal((result.stdout + result.stderr).includes(sentinel), false);
    assert.equal((result.stdout + result.stderr).includes("BEGIN PRIVATE KEY"), false);
    writeSettings(f);
    assert.equal(new Configre(f.config)._isNested, false);
});

test("Git exclusions preserve existing rules and never hide already tracked local files", t => {
    const f = fixture(t);
    git(f.root, ["init", "--quiet"]);
    const ignore = path.join(f.config, ".gitignore");
    const existing = "# keep these rules\n/index.secret.cjs\n!/index.secret.cjs\n";
    fs.writeFileSync(ignore, existing);
    writeSettings(f);
    load(f);
    assert.ok(fs.readFileSync(ignore, "utf8").startsWith(existing));
    fs.copyFileSync(f.publicPath(1), path.join(f.recipients, "developer.pub"));
    const ignored = git(f.root, ["check-ignore", "config/index.secret.cjs", "config/recipients/developer.pub"]);
    assert.ok(ignored.includes("config/index.secret.cjs"));
    assert.equal(ignored.includes("config/recipients/developer.pub"), false);
    const original = fs.readFileSync(f.encrypted);
    const originalIgnore = fs.readFileSync(ignore);
    git(f.root, ["add", "-f", "config/index.secret.cjs"]);
    assert.throws(() => load(f), /tracked by Git/);
    assert.deepEqual(fs.readFileSync(ignore), originalIgnore);
    assert.deepEqual(fs.readFileSync(f.encrypted), original);
    assert.ok(git(f.root, ["ls-files"]).includes("config/index.secret.cjs"));
    git(f.root, ["rm", "--cached", "config/index.secret.cjs"]);
    writeSettings({ local: path.join(f.config, "testhost.secret.cjs") }, {});
    git(f.root, ["add", "-f", "config/testhost.secret.cjs"]);
    assert.throws(() => load(f), /tracked by Git/);
});

test("recipient files can be tracked and sidecar names are escaped literally in Git rules", t => {
    const f = fixture(t);
    git(f.root, ["init", "--quiet"]);
    const filename = path.join(f.root, "settings[one] #.cjs");
    fs.writeFileSync(filename, "module.exports = {};");
    const local = filename.slice(0, -4) + ".secret.cjs";
    writeSettings({ local });
    Configre(filename);
    assert.ok(git(f.root, ["check-ignore", path.basename(local)]).includes(path.basename(local)));
    const recipient = filename + ".recipients/developer.pub";
    fs.copyFileSync(f.publicPath(1), recipient);
    git(f.root, ["add", "-f", path.relative(f.root, recipient)]);
    const original = fs.readFileSync(filename + ".secrets.enc.json");
    assert.equal(Configre(filename).api.key, sentinel);
    assert.notDeepEqual(fs.readFileSync(filename + ".secrets.enc.json"), original);
});

test("a server publishes only its public key once and receives automatic authorization through Git", t => {
    const f = gitFixture(t);
    git(f.checkout, ["config", "push.followTags", "true"]);
    git(f.checkout, ["tag", "-a", "local-only", "-m", "Local tag"]);
    const tracked = path.join(f.checkout, "tracked.txt");
    const untracked = path.join(f.checkout, "untracked.txt");
    fs.writeFileSync(tracked, "staged change\n");
    git(f.checkout, ["add", "tracked.txt"]);
    fs.writeFileSync(tracked, "unstaged change\n");
    fs.writeFileSync(untracked, sentinel);
    const index = git(f.checkout, ["ls-files", "--stage", "-z"]);
    f.useHome(1);
    assertPublicOnly(f.consumer, f.logs, /public key is published in Git/i);
    const registeredPath = fs.realpathSync(f.registration);
    assert.ok(f.logs.info.some(([message, filename]) => message === "Created public-key registration file" && filename === registeredPath));
    assert.deepEqual(f.logs.info.at(-1), ["Published public key to Git", registeredPath]);
    const registrationLogs = f.logs.info.length;
    const published = git(f.remote, ["rev-parse", "main"]).trim();
    assert.equal(git(f.checkout, ["rev-parse", "HEAD"]).trim(), published);
    assert.equal(git(f.remote, ["diff-tree", "--no-commit-id", "--name-only", "-r", "main"]).trim(), "config/recipients/testhost.pub");
    assert.equal(fs.readFileSync(f.registration, "utf8"), fs.readFileSync(f.publicPath(1), "utf8"));
    const otherEntries = git(f.checkout, ["ls-files", "--stage", "-z"]).split("\0")
        .filter(entry => !entry.endsWith("\tconfig/recipients/testhost.pub")).join("\0");
    assert.equal(otherEntries, index);
    assert.equal(fs.readFileSync(tracked, "utf8"), "unstaged change\n");
    assert.equal(fs.readFileSync(untracked, "utf8"), sentinel);
    assert.equal(git(f.remote, ["show", "main:tracked.txt"]), "initial\n");
    assert.equal(git(f.remote, ["tag", "--list"]), "");
    assertPublicOnly(f.consumer, f.logs, /public key is published in Git/i);
    assert.equal(f.logs.info.length, registrationLogs);
    assert.equal(git(f.remote, ["rev-parse", "main"]).trim(), published);

    f.useHome(0);
    git(f.root, ["pull", "--quiet", "--ff-only"]);
    load(f);
    assert.equal(envelope(f).recipients.length, 2);
    git(f.root, ["add", "config/secrets.enc.json"]);
    git(f.root, ["commit", "--quiet", "-m", "Authorize registered server"]);
    git(f.root, ["push", "--quiet"]);
    git(f.checkout, ["pull", "--quiet", "--ff-only"]);
    f.useHome(1);
    const warnings = f.logs.warn.length;
    assert.equal(load(f.consumer).api.key, sentinel);
    assert.equal(f.logs.warn.length, warnings);
    f.useHome(0);
    writeSettings(f, { api: { key: sentinel + "-updated" } });
    load(f);
    git(f.root, ["add", "config/secrets.enc.json"]);
    git(f.root, ["commit", "--quiet", "-m", "Update secret values"]);
    git(f.root, ["push", "--quiet"]);
    git(f.checkout, ["pull", "--quiet", "--ff-only"]);
    f.useHome(1);
    assert.equal(load(f.consumer).api.key, sentinel + "-updated");
    assert.equal(git(f.remote, ["rev-list", "--count", "main", "--", "config/recipients/testhost.pub"]).trim(), "1");
});

test("a rejected registration push preserves the branch and staging area and can be retried", t => {
    const f = gitFixture(t);
    const hook = path.join(f.remote, "hooks", "pre-receive");
    fs.writeFileSync(hook, `#!/bin/sh\necho '${sentinel}' >&2\nexit 1\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(f.checkout, "tracked.txt"), "staged change\n");
    git(f.checkout, ["add", "tracked.txt"]);
    const head = git(f.checkout, ["rev-parse", "HEAD"]);
    const index = fs.readFileSync(path.join(f.checkout, ".git", "index"));
    f.useHome(1);
    assertPublicOnly(f.consumer, f.logs, /failed while pushing the public-key commit/);
    assert.equal(JSON.stringify(f.logs).includes(sentinel), false);
    assert.equal(f.logs.info.some(([message]) => message === "Published public key to Git"), false);
    assert.equal(git(f.checkout, ["rev-parse", "HEAD"]), head);
    assert.equal(git(f.remote, ["rev-parse", "main"]), head);
    assert.deepEqual(fs.readFileSync(path.join(f.checkout, ".git", "index")), index);
    assert.equal(fs.existsSync(path.join(f.checkout, ".git", "configre-registration.lock")), false);
    assert.equal(fs.readdirSync(path.join(f.checkout, ".git")).some(name => name.startsWith("configre-registration-")), false);
    fs.unlinkSync(hook);
    assertPublicOnly(f.consumer, f.logs, /public key is published in Git/i);
    assert.equal(git(f.remote, ["rev-list", "--count", "main"]).trim(), "2");
});

test("registration recovers when publication succeeded before the local branch and index were updated", t => {
    const f = gitFixture(t);
    const interrupted = path.join(f.root, "interrupted-consumer");
    git(f.root, ["clone", "--quiet", f.remote, interrupted]);
    const publicPath = path.join(interrupted, "config", "recipients", "testhost.pub");
    fs.mkdirSync(path.dirname(publicPath));
    fs.copyFileSync(f.publicPath(1), publicPath);
    const tracked = path.join(interrupted, "tracked.txt");
    fs.writeFileSync(tracked, "staged work\n");
    git(interrupted, ["add", "tracked.txt"]);
    fs.writeFileSync(tracked, "unstaged work\n");
    f.useHome(1);
    assertPublicOnly(f.consumer, f.logs, /public key is published in Git/i);
    const published = git(f.remote, ["rev-parse", "main"]);
    assertPublicOnly({ config: path.join(interrupted, "config") }, f.logs, /public key is published in Git/i);
    git(interrupted, ["pull", "--quiet", "--ff-only"]);
    assert.equal(git(interrupted, ["rev-parse", "HEAD"]), published);
    assert.equal(git(f.remote, ["rev-parse", "main"]), published);
    assert.equal(git(interrupted, ["show", ":tracked.txt"]), "staged work\n");
    assert.equal(fs.readFileSync(tracked, "utf8"), "unstaged work\n");
});

test("registration refuses to publish unrelated local commits or guess a branch", t => {
    const f = gitFixture(t);
    const remoteHead = git(f.remote, ["rev-parse", "main"]);
    git(f.checkout, ["checkout", "--quiet", "--detach"]);
    f.useHome(1);
    assertPublicOnly(f.consumer, f.logs, /detached HEAD/);
    git(f.checkout, ["checkout", "--quiet", "main"]);
    git(f.checkout, ["branch", "--unset-upstream"]);
    assertPublicOnly(f.consumer, f.logs, /upstream remote/);
    git(f.checkout, ["branch", "--set-upstream-to=origin/main"]);
    fs.writeFileSync(path.join(f.checkout, "tracked.txt"), "unpublished work\n");
    git(f.checkout, ["add", "tracked.txt"]);
    git(f.checkout, ["commit", "--quiet", "-m", "Unpublished work"]);
    const localHead = git(f.checkout, ["rev-parse", "HEAD"]);
    assertPublicOnly(f.consumer, f.logs, /local branch to match its upstream/);
    assert.equal(git(f.checkout, ["rev-parse", "HEAD"]), localHead);
    assert.equal(git(f.remote, ["rev-parse", "main"]), remoteHead);
    assert.equal(fs.existsSync(f.registration), false);
});

test("registration rejects profile collisions, unsafe names and damaged encrypted files", t => {
    const f = gitFixture(t);
    f.useHome(1);
    const previousArgs = process.argv;
    process.argv = [...previousArgs.filter(arg => !arg.startsWith("--config=")), "--config=../escape"];
    t.after(() => { process.argv = previousArgs; });
    assertPublicOnly(f.consumer, f.logs, /requires a profile/);
    process.argv = previousArgs;
    fs.mkdirSync(path.dirname(f.registration));
    fs.copyFileSync(f.publicPath(2), f.registration);
    assertPublicOnly(f.consumer, f.logs, /different key for this profile/);
    assert.equal(fs.readFileSync(f.registration, "utf8"), fs.readFileSync(f.publicPath(2), "utf8"));
    fs.unlinkSync(f.registration);
    fs.copyFileSync(f.publicPath(2), path.join(f.recipients, "testhost.pub"));
    git(f.root, ["add", "config/recipients/testhost.pub"]);
    git(f.root, ["commit", "--quiet", "-m", "Existing server identity"]);
    git(f.root, ["push", "--quiet"]);
    const remoteHead = git(f.remote, ["rev-parse", "main"]);
    assertPublicOnly(f.consumer, f.logs, /different published key/);
    const damaged = envelope(f);
    damaged.extra = sentinel;
    fs.writeFileSync(path.join(f.consumer.config, "secrets.enc.json"), JSON.stringify(damaged));
    assert.throws(() => load(f.consumer), /invalid encrypted file structure/);
    assert.equal(fs.existsSync(f.registration), false);
    assert.equal(git(f.remote, ["rev-parse", "main"]), remoteHead);
});

test("writer locks and failed atomic replacement preserve the last encrypted version", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    const original = fs.readFileSync(f.encrypted);
    writeSettings(f, { api: { key: sentinel + "-new" } });
    fs.writeFileSync(f.encrypted + ".lock", "");
    assert.throws(() => load(f), /another writer/);
    assert.equal(fs.existsSync(f.encrypted + ".lock"), true);
    assert.deepEqual(fs.readFileSync(f.encrypted), original);
    fs.unlinkSync(f.encrypted + ".lock");
    const rename = fs.renameSync;
    t.mock.method(fs, "renameSync", (from, to) => {
        if (to === f.encrypted) {
            const temporary = fs.readFileSync(from, "utf8");
            assert.equal(temporary.includes(sentinel), false);
            assert.ok(JSON.parse(temporary).ciphertext);
            throw new Error("simulated atomic rename failure");
        }
        return rename(from, to);
    });
    assert.throws(() => load(f), /simulated atomic rename failure/);
    assert.deepEqual(fs.readFileSync(f.encrypted), original);
    assert.equal(fs.existsSync(f.encrypted + ".lock"), false);
    assert.equal(fs.readdirSync(f.config).some(name => name.endsWith(".tmp")), false);
});

test("a second process cannot write while an encrypted replacement is pending", t => {
    const f = fixture(t);
    writeSettings(f);
    load(f);
    const original = fs.readFileSync(f.encrypted);
    writeSettings(f, { api: { key: sentinel + "-new" } });
    const rename = fs.renameSync;
    let contested = false;
    t.mock.method(fs, "renameSync", (from, to) => {
        if (to === f.encrypted) {
            const result = spawnSync(process.execPath, ["-e", `
                const assert = require('node:assert/strict');
                const os = require('node:os');
                os.homedir = () => process.env.CONFIGRE_TEST_HOME;
                const Configre = require(process.env.CONFIGRE_TEST_MODULE);
                assert.throws(() => Configre(process.env.CONFIGRE_TEST_PATH), /another writer/);
            `], {
                encoding: "utf8",
                env: {
                    ...process.env,
                    CONFIGRE_TEST_HOME: f.homes[0],
                    CONFIGRE_TEST_MODULE: path.join(import.meta.dirname, "..", "index.js"),
                    CONFIGRE_TEST_PATH: f.config
                }
            });
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(fs.readFileSync(f.encrypted), original);
            contested = true;
        }
        return rename(from, to);
    });
    assert.equal(load(f).api.key, sentinel + "-new");
    assert.equal(contested, true);
    fs.unlinkSync(f.local);
    assert.equal(load(f).api.key, sentinel + "-new");
});
