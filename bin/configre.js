#!/usr/bin/env node
import path from "node:path";
import Configre from "../index.js";

const usage = "Usage: configre sync <config-path> [--config=<profile>]";
const nextStep = "Next: on the machine with the editable secrets, pull, run configre sync and push the encrypted file; then pull here.";

function usageError(message) {
    const error = new Error(`${message}\n${usage}`);
    error.exitCode = 2;
    return error;
}

function parseArgs(args) {
    if (args.includes("-h") || args.includes("--help")) return { help: true };
    const [command, ...rest] = args;
    if (command !== "sync") {
        throw usageError(command === undefined ? "Missing command" : `Unknown command: ${command}`);
    }
    const profiles = rest.filter(arg => arg.startsWith("--config="));
    const unknown = rest.filter(arg => arg.startsWith("-") && !arg.startsWith("--config="));
    const positional = rest.filter(arg => !arg.startsWith("-"));
    if (unknown.length > 0) throw usageError(`Unknown option: ${unknown[0]}`);
    if (profiles.length > 1) throw usageError("Pass --config=<profile> at most once");
    if (profiles.length === 1 && profiles[0] === "--config=") throw usageError("--config requires a profile name");
    if (positional.length !== 1) throw usageError("Pass exactly one config path");
    return { configPath: positional[0], explicitProfile: profiles.length === 1 };
}

function display(filename) {
    const relative = path.relative(process.cwd(), filename);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filename;
}

function report(config, configPath, explicitProfile) {
    const outcome = config.secretsOutcome;
    console.log(`Config: ${display(config.configFile)} (profile ${config.profile} from ${explicitProfile ? "--config" : "hostname"})`);
    const lines = [];
    switch (outcome.status) {
        case "inactive":
            throw new Error(`No secrets for ${configPath}: no base or profile secret file and no encrypted secrets file`);
        case "created":
        case "updated":
            lines.push(`${outcome.status === "created" ? "Created" : "Updated"} ${display(outcome.encrypted)}`,
                `Next: commit and push ${display(outcome.encrypted)}.`);
            break;
        case "unchanged":
            lines.push(`Unchanged ${display(outcome.encrypted)}`);
            break;
        case "authorized":
            lines.push(`Authorized to decrypt ${display(outcome.encrypted)}`);
            break;
        case "registered":
            lines.push(`Registered ${display(outcome.recipient)} and pushed it to Git`, nextStep);
            break;
        case "already-registered":
            lines.push(`Already registered ${display(outcome.recipient)}; not authorized yet`, nextStep);
            break;
        case "registration-failed":
            throw new Error(outcome.reason);
        default:
            throw new Error(`Unexpected secrets outcome: ${outcome.status}`);
    }
    console.log(lines.join("\n"));
}

try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage);
    } else {
        report(new Configre(path.resolve(options.configPath)), options.configPath, options.explicitProfile);
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
}
