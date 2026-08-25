const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const Configre = require("../index");

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
    const configPath = path.join(__dirname, "..", "demo", "config");
    const config = Configre(configPath);

    assert.equal(config.db.host, "localhost");
});
