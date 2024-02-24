const fs = require("fs");
const os = require("os");
const obj = require("lodash/object");
const LemonLog = require("lemonlog");
const log = new LemonLog("ConfigPath");

class ConfigPath {
    constructor(path) {
        this.defaultSettings = require("./config/default.js");
        this.dirname = path;
        this.profile = process.argv.length > 2 ? process.argv[2] : os.hostname();
        this.devFile = `${this.dirname}/${this.profile}.dev.js`;
        this.localFile = `${this.dirname}/${this.profile}.js`;
        this.profileSettings = this.loadProfileSettings();
    }

    loadProfileSettings() {
        if (fs.existsSync(this.devFile)) {
            log.warn(this.devFile, "DEV CONFIG");
            return require(this.devFile);
        } else if (fs.existsSync(this.localFile)) {
            log.warn(this.localFile, "PRO CONFIG");
            return require(this.localFile);
        } else {
            log.warn(this.localFile, "NOT FOUND, USING DEFAULTS");
            return {};
        }
    }

    get() {
        return obj.merge({}, this.defaultSettings, this.profileSettings);
    }
}

module.exports = ConfigPath;
