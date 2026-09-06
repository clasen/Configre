import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import lemonlog from "lemonlog";
import { merge } from "./merge.js";
import loadSecrets from "./secrets/index.js";

const requireConfig = createRequire(import.meta.url);
const log = lemonlog("Configre");

class ConfigreClass {
    constructor(pathOrDir, options = {}) {
        if (typeof pathOrDir !== "string" || pathOrDir.length === 0) {
            throw new TypeError("Configre path must be a non-empty string");
        }
        if (options === null || typeof options !== "object" || Array.isArray(options) ||
            (options.secrets !== undefined && typeof options.secrets !== "boolean")) {
            throw new TypeError("Configre options must be an object with an optional boolean secrets property");
        }

        const dir = path.join(pathOrDir);
        const isNested = (ConfigreClass._nesting || 0) > 0;
        ConfigreClass._nesting = (ConfigreClass._nesting || 0) + 1;

        try {
            this.defaultSettings = this.tryRequire([
                dir,
                path.join(dir, "index.cjs"),
                pathOrDir + ".cjs"
            ]);

            this.dirname = dir;
            this._isNested = isNested;
            const configArg = process.argv.find(arg => arg.startsWith('--config='));
            this.profile = configArg ? configArg.slice('--config='.length) : os.hostname();
            this.profileSettings = this.loadProfileSettings();
            this.secretSettings = options.secrets === true
                ? loadSecrets(pathOrDir, this.configFile, this.profile)
                : [];
        } finally {
            ConfigreClass._nesting -= 1;
        }
    }

    // Helper method to try requiring files with different extensions or paths
    tryRequire(paths) {
        for (const p of paths) {
            try {
                const settings = requireConfig(p);
                this.configFile = requireConfig.resolve(p);
                return settings;
            } catch (e) {
                continue;
            }
        }
        throw new Error(`Could not load config from any of: ${paths.join(', ')}`);
    }

    // Helper method to try loading a file with .cjs extension only
    tryRequireWithExtensions(basePath) {
        const ext = '.cjs';
        const fullPath = path.join(basePath + ext);
        if (fs.existsSync(fullPath)) {
            return { path: fullPath, module: requireConfig(fullPath) };
        }
        return null;
    }

    loadProfileSettings() {
        const basePaths = [
            { base: path.join(this.dirname, `${this.profile}.dev`), type: "DEV CONFIG" },
            { base: path.join(this.dirname, this.profile), type: "PRO CONFIG" }
        ];

        for (const { base, type } of basePaths) {
            const result = this.tryRequireWithExtensions(base);
            if (result) {
                if (!this._isNested) log.warn(result.path, type);
                return result.module;
            }
        }

        if (!this._isNested) {
            log.warn(path.join(this.dirname, `${this.profile}.cjs`), "NOT FOUND, USING DEFAULTS");
        }
        return {};
    }

    get() {
        return merge({}, this.defaultSettings, this.profileSettings, ...this.secretSettings);
    }
}

// Wrapper function to support both constructor and function usage
function Configre(path, options) {
    if (this instanceof Configre) {
        return new ConfigreClass(path, options);
    } else {
        return new ConfigreClass(path, options).get();
    }
}

export { Configre as default, Configre as "module.exports" };
