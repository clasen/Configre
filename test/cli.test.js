import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generatePrivateKey, parsePrivateKey } from "../secrets/crypto.js";

const bin = fileURLToPath(new URL("../bin/configre.js", import.meta.url));
const sentinel = "synthetic-secret-for-configre-cli-tests";

function environment(home) {
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), GIT_CONFIG_NOSYSTEM: "1" };
    delete env.DEBUG;
    return env;
}

function fixture(t) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "configre-cli-")));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const app = path.join(root, "app");
    const config = path.join(app, "config");
    fs.mkdirSync(config, { recursive: true });
    fs.writeFileSync(path.join(config, "index.cjs"), 'module.exports = { api: { key: "", host: "default" } };');
    return {
        root, app, config,
        homes: { admin: path.join(root, "admin-home"), server: path.join(root, "server-home") },
        encrypted: path.join(config, "secrets.enc.json")
    };
}

function run(cwd, home, args) {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd, env: environment(home), encoding: "utf8" });
    const output = result.stdout + result.stderr;
    assert.equal(output.includes(sentinel), false);
    assert.equal(/BEGIN [A-Z ]*KEY/.test(output), false);
    return result;
}

function git(directory, home, args) {
    const result = spawnSync("git", ["-C", directory, ...args], { env: environment(home), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

function writeSecrets(f) {
    fs.writeFileSync(path.join(f.config, "index.secret.cjs"), `module.exports = { api: { key: ${JSON.stringify(sentinel)} } };\n`);
}

test("invalid invocations print usage and exit with code 2", t => {
    const f = fixture(t);
    for (const args of [
        [], ["register", "config"], ["sync"], ["sync", "config", "other"], ["sync", "config", "--config"],
        ["sync", "config", "--config="], ["sync", "config", "--config=a", "--config=b"], ["sync", "config", "--verbose"]
    ]) {
        const result = run(f.app, f.homes.admin, args);
        assert.equal(result.status, 2, args.join(" "));
        assert.match(result.stderr, /Usage: configre sync <config-path> \[--config=<profile>\]/);
    }
    const help = run(f.app, f.homes.admin, ["sync", "--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: configre sync/);
});

test("a config without secrets or an unknown path fails without creating an identity", t => {
    const f = fixture(t);
    const inactive = run(f.app, f.homes.admin, ["sync", "config"]);
    assert.equal(inactive.status, 1);
    assert.match(inactive.stdout, new RegExp(`^Config: config/index\\.cjs \\(profile ${os.hostname().replace(/[.]/g, "\\.")} from hostname\\)`));
    assert.match(inactive.stderr, /No secrets for config/);

    const missing = run(f.app, f.homes.admin, ["sync", "missing"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Could not load config/);
    assert.equal(fs.existsSync(f.homes.admin), false);
});

test("the editing machine reports created, unchanged and updated encrypted files", t => {
    const f = fixture(t);
    writeSecrets(f);

    const created = run(f.app, f.homes.admin, ["sync", "config", "--config=testhost"]);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stdout, [
        "Config: config/index.cjs (profile testhost from --config)",
        "Created config/secrets.enc.json",
        "Next: commit and push config/secrets.enc.json.",
        ""
    ].join("\n"));

    const unchanged = run(f.app, f.homes.admin, ["sync", "config", "--config=testhost"]);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.match(unchanged.stdout, /^Unchanged config\/secrets\.enc\.json$/m);

    fs.writeFileSync(path.join(f.config, "recipients", "extra.pub"), parsePrivateKey(generatePrivateKey()).publicKey);
    const updated = run(f.config, f.homes.admin, ["sync", ".", "--config=testhost"]);
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(updated.stdout, /^Updated secrets\.enc\.json$/m);
});

function publishedFixture(t) {
    const f = fixture(t);
    const { admin, server } = f.homes;
    writeSecrets(f);
    git(f.app, admin, ["init", "--quiet", "--initial-branch=main"]);
    git(f.app, admin, ["config", "user.name", "Configre Test"]);
    git(f.app, admin, ["config", "user.email", "configre-test@example.invalid"]);
    assert.equal(run(f.app, admin, ["sync", "config", "--config=testhost"]).status, 0);
    git(f.app, admin, ["add", "config/index.cjs", "config/.gitignore", "config/secrets.enc.json"]);
    git(f.app, admin, ["commit", "--quiet", "-m", "Initial configuration"]);
    const remote = path.join(f.root, "remote.git");
    git(f.root, admin, ["init", "--bare", "--quiet", "--initial-branch=main", remote]);
    git(f.app, admin, ["remote", "add", "origin", remote]);
    git(f.app, admin, ["push", "--quiet", "--set-upstream", "origin", "main"]);
    const checkout = path.join(f.root, "server");
    git(f.root, server, ["clone", "--quiet", remote, checkout]);
    return { ...f, remote, checkout };
}

test("a server registers through Git and becomes authorized after the editing machine syncs", t => {
    const f = publishedFixture(t);
    const { admin, server } = f.homes;
    const { remote, checkout } = f;

    const registered = run(checkout, server, ["sync", "config", "--config=web-01"]);
    assert.equal(registered.status, 0, registered.stderr);
    assert.match(registered.stdout, /^Registered config\/recipients\/web-01\.pub and pushed it to Git$/m);
    assert.match(registered.stdout, /^Next: on the machine with the editable secrets/m);
    assert.equal(git(remote, admin, ["diff-tree", "--no-commit-id", "--name-only", "-r", "main"]).trim(), "config/recipients/web-01.pub");

    const pending = run(checkout, server, ["sync", "config", "--config=web-01"]);
    assert.equal(pending.status, 0, pending.stderr);
    assert.match(pending.stdout, /^Already registered config\/recipients\/web-01\.pub; not authorized yet$/m);

    git(f.app, admin, ["pull", "--quiet", "--ff-only"]);
    const updated = run(f.app, admin, ["sync", "config"]);
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(updated.stdout, /^Updated config\/secrets\.enc\.json$/m);
    git(f.app, admin, ["commit", "--quiet", "-am", "Authorize web-01"]);
    git(f.app, admin, ["push", "--quiet"]);
    git(checkout, server, ["pull", "--quiet", "--ff-only"]);

    const authorized = run(checkout, server, ["sync", "config", "--config=web-01"]);
    assert.equal(authorized.status, 0, authorized.stderr);
    assert.match(authorized.stdout, /^Authorized to decrypt config\/secrets\.enc\.json$/m);
});

test("registration works with Git versions that echo unknown rev-parse options", { skip: process.platform === "win32" }, t => {
    const f = publishedFixture(t);
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const shim = path.join(f.root, "old-git");
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, "git"), [
        "#!/bin/sh",
        "for arg; do shift; if [ \"$arg\" = --path-format=absolute ]; then echo \"$arg\"; else set -- \"$@\" \"$arg\"; fi; done",
        `exec ${JSON.stringify(realGit)} "$@"`,
        ""
    ].join("\n"), { mode: 0o755 });

    const result = spawnSync(process.execPath, [bin, "sync", "config", "--config=web-01"], {
        cwd: f.checkout,
        env: { ...environment(f.homes.server), PATH: `${shim}${path.delimiter}${process.env.PATH}` },
        encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Registered config\/recipients\/web-01\.pub and pushed it to Git$/m);
});

test("unexpected registration failures report their cause", t => {
    const f = publishedFixture(t);
    fs.mkdirSync(path.join(f.checkout, "config", "recipients", "web-01.pub"), { recursive: true });

    const result = run(f.checkout, f.homes.server, ["sync", "config", "--config=web-01"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Automatic public-key registration failed: Configre secrets: expected a regular file at .*recipients\/web-01\.pub; check Git and file permissions, then reload Configre to retry\.$/m);
});

test("an unauthorized machine that cannot register exits with the failure reason", t => {
    const f = fixture(t);
    writeSecrets(f);
    assert.equal(run(f.app, f.homes.admin, ["sync", "config"]).status, 0);
    const copy = path.join(f.root, "copy", "config");
    fs.mkdirSync(copy, { recursive: true });
    for (const name of ["index.cjs", "secrets.enc.json"]) {
        fs.copyFileSync(path.join(f.config, name), path.join(copy, name));
    }

    const result = run(path.dirname(copy), f.homes.server, ["sync", "config", "--config=web-01"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not authorized; automatic registration failed while locating the Git repository/);
});
