const fs = require("fs");
const path = require("path");
const os = require("os");
const obj = require("lodash/object");
const log = require("lemonlog")("Configre");

class ConfigreClass {
    constructor(pathOrDir = __dirname + "/../../config") {
        const dir = path.join(pathOrDir);
        const isNested = (ConfigreClass._nesting || 0) > 0;
        ConfigreClass._nesting = (ConfigreClass._nesting || 0) + 1;

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
        ConfigreClass._nesting -= 1;
    }

    // Helper method to try requiring files with different extensions or paths
    tryRequire(paths) {
        for (const p of paths) {
            try {
                return require(p);
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
            return { path: fullPath, module: require(fullPath) };
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
        return obj.merge({}, this.defaultSettings, this.profileSettings);
    }
}

// Wrapper function to support both constructor and function usage
function Configre(path) {
    if (this instanceof Configre) {
        return new ConfigreClass(path);
    } else {
        return new ConfigreClass(path).get();
    }
}

module.exports = Configre;
