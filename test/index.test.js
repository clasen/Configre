import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Configre from "../index.js";

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
            import('configre').then(module => assert.equal(module.default, Configre));
        ` : `
            import assert from 'node:assert/strict';
            import { createRequire } from 'node:module';
            import Configre from 'configre';
            const require = createRequire(import.meta.url);
            assert.equal(require('configre'), Configre);
        `;
        const filename = path.join(directory, format === "commonjs" ? "consumer.cjs" : "consumer.mjs");
        fs.writeFileSync(filename, entry + `
            assert.equal(typeof Configre, 'function');
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
