const fs = require("fs");
const os = require("os");
const obj = require("lodash/object");
const log = require("lemonlog")("Configre");

class ConfigreClass {
    constructor(path = __dirname + "/../../config") {
        this.defaultSettings = this.tryRequire([
            path,
            path + '/index.cjs',
            path + '.cjs'
        ]);
        
        this.dirname = path;
        this.profile = process.argv.length > 2 ? process.argv[2] : os.hostname();
        this.profileSettings = this.loadProfileSettings();
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

    // Helper method to try loading a file with .js or .cjs extension
    tryRequireWithExtensions(basePath) {
        const extensions = ['.js', '.cjs'];
        for (const ext of extensions) {
            const fullPath = basePath + ext;
            if (fs.existsSync(fullPath)) {
                return { path: fullPath, module: require(fullPath) };
            }
        }
        return null;
    }

    loadProfileSettings() {
        const basePaths = [
            { base: `${this.dirname}/${this.profile}.dev`, type: "DEV CONFIG" },
            { base: `${this.dirname}/${this.profile}`, type: "PRO CONFIG" }
        ];

        for (const { base, type } of basePaths) {
            const result = this.tryRequireWithExtensions(base);
            if (result) {
                log.warn(result.path, type);
                return result.module;
            }
        }

        log.warn(`${this.dirname}/${this.profile}.js`, "NOT FOUND, USING DEFAULTS");
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
