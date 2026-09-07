import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Configre, { applyConfigEnv } from "../index.js";

test("applyConfigEnv fills missing variables without overwriting existing values", t => {
    const env = {
        CONFIGRE_TEST_ENV_TEXT: "value",
        CONFIGRE_TEST_ENV_NUMBER: 0,
        CONFIGRE_TEST_ENV_BOOLEAN: false,
        CONFIGRE_TEST_ENV_EMPTY: "",
        CONFIGRE_TEST_ENV_NULL: null,
        CONFIGRE_TEST_ENV_UNDEFINED: undefined,
        CONFIGRE_TEST_ENV_EXISTING: "replacement",
        CONFIGRE_TEST_ENV_EXISTING_EMPTY: "replacement"
    };
    const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    t.after(() => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
    for (const key of Object.keys(env)) delete process.env[key];
    process.env.CONFIGRE_TEST_ENV_EXISTING = "original";
    process.env.CONFIGRE_TEST_ENV_EXISTING_EMPTY = "";

    assert.equal(applyConfigEnv(env), undefined);
    assert.equal(process.env.CONFIGRE_TEST_ENV_TEXT, "value");
    assert.equal(process.env.CONFIGRE_TEST_ENV_NUMBER, "0");
    assert.equal(process.env.CONFIGRE_TEST_ENV_BOOLEAN, "false");
    assert.equal(process.env.CONFIGRE_TEST_ENV_EMPTY, "");
    assert.equal(process.env.CONFIGRE_TEST_ENV_NULL, undefined);
    assert.equal(process.env.CONFIGRE_TEST_ENV_UNDEFINED, undefined);
    assert.equal(process.env.CONFIGRE_TEST_ENV_EXISTING, "original");
    assert.equal(process.env.CONFIGRE_TEST_ENV_EXISTING_EMPTY, "");
    applyConfigEnv({ CONFIGRE_TEST_ENV_TEXT: "replacement" });
    assert.equal(process.env.CONFIGRE_TEST_ENV_TEXT, "value");
    assert.equal(env.CONFIGRE_TEST_ENV_NUMBER, 0);
    assert.equal(env.CONFIGRE_TEST_ENV_BOOLEAN, false);
});

test("applyConfigEnv accepts omitted configuration and rejects invalid inputs", () => {
    assert.equal(applyConfigEnv(), undefined);
    assert.equal(applyConfigEnv({}), undefined);
    for (const env of [null, [], "text", 1, true, () => {}]) {
        assert.throws(() => applyConfigEnv(env), {
            name: "TypeError",
            message: "config.env must be a plain object"
        });
    }
    assert.throws(() => applyConfigEnv({ "": null }), {
        name: "TypeError",
        message: "config.env keys must be non-empty strings"
    });
    for (const value of [{ nested: true }, [], new Date()]) {
        assert.throws(() => applyConfigEnv({ CONFIGRE_TEST_ENV_INVALID: value }), {
            name: "TypeError",
            message: "config.env.CONFIGRE_TEST_ENV_INVALID must be a scalar"
        });
    }
});

test("requires a config path", () => {
    assert.throws(
        () => Configre(),
        {
            name: "TypeError",
            message: "Configre path must be a non-empty string"
        }
    );
    assert.throws(
        () => new Configre(""),
        {
            name: "TypeError",
            message: "Configre path must be a non-empty string"
        }
    );
});

test("loads config from an explicit module-relative path", () => {
    const configPath = path.join(import.meta.dirname, "..", "demo", "config");
    const config = Configre(configPath);

    assert.equal(config.db.host, "localhost");
});

for (const format of ["commonjs", "module"]) {
    test(`package entrypoint supports ${format} consumers and shares the same function across loaders`, t => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "configre-interop-"));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        fs.mkdirSync(path.join(directory, "node_modules"));
        fs.symlinkSync(path.join(import.meta.dirname, ".."), path.join(directory, "node_modules", "configre"), "junction");
        const config = path.join(directory, "config");
        fs.mkdirSync(config);
        fs.writeFileSync(path.join(config, "index.cjs"), 'module.exports = { db: { host: "localhost", port: 123 } };');
        fs.writeFileSync(path.join(config, "interop.cjs"), 'module.exports = { db: { port: 456 } };');

        const entry = format === "commonjs" ? `
            const assert = require('node:assert/strict');
            const Configre = require('configre');
            const { applyConfigEnv } = Configre;
            import('configre').then(module => {
                assert.equal(module.default, Configre);
                assert.equal(module.applyConfigEnv, applyConfigEnv);
            });
        ` : `
            import assert from 'node:assert/strict';
            import { createRequire } from 'node:module';
            import Configre, { applyConfigEnv } from 'configre';
            const require = createRequire(import.meta.url);
            assert.equal(require('configre'), Configre);
            assert.equal(require('configre').applyConfigEnv, applyConfigEnv);
        `;
        const filename = path.join(directory, format === "commonjs" ? "consumer.cjs" : "consumer.mjs");
        fs.writeFileSync(filename, entry + `
            assert.equal(typeof Configre, 'function');
            delete process.env.CONFIGRE_TEST_ENV_INTEROP;
            applyConfigEnv({ CONFIGRE_TEST_ENV_INTEROP: 123 });
            assert.equal(process.env.CONFIGRE_TEST_ENV_INTEROP, '123');
            const configPath = ${JSON.stringify(config)};
            const expected = { db: { host: 'localhost', port: 456 } };
            assert.deepEqual(Configre(configPath), expected);
            assert.deepEqual(new Configre(configPath).get(), expected);
            assert.throws(() => Configre(), /path must be a non-empty string/);
        `);
        const result = spawnSync(process.execPath, [filename, "--config=interop"], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
    });
}
