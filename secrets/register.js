import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import config from "./config.js";
import log from "./log.js";
import { parsePublicKey } from "./crypto.js";
import { stat, readText, withLock } from "./files.js";

function registrationError(message) {
    const error = new Error(`Configre secrets: not authorized; automatic registration ${message}`);
    error.code = "CONFIGRE_REGISTRATION_FAILED";
    return error;
}

function git(directory, args, operation, options = {}) {
    const result = spawnSync("git", ["-C", directory, ...args], {
        encoding: "utf8",
        timeout: config.git.timeoutMs,
        input: options.input,
        env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
            GIT_LITERAL_PATHSPECS: "1",
            ...options.env
        }
    });
    if (result.error || result.status !== 0) {
        throw registrationError(`failed while ${operation}; check Git configuration, credentials and repository state, then restart`);
    }
    return result.stdout;
}

function registerRecipient(paths, identity, profile) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(profile)) {
        throw registrationError("requires a profile containing only letters, digits, dots, underscores or hyphens");
    }
    const root = git(paths.parent, ["rev-parse", "--show-toplevel"], "locating the Git repository").trim();
    const lock = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "configre-registration"], "locating the Git lock").trim();
    return withLock(lock, () => {
        const branch = git(root, ["symbolic-ref", "--quiet", "HEAD"], "finding the current branch (detached HEAD is unsupported)").trim();
        const branchName = branch.slice("refs/heads/".length);
        const remote = git(root, ["config", "--get", `branch.${branchName}.remote`], "finding the branch's upstream remote").trim();
        const remoteBranch = git(root, ["config", "--get", `branch.${branchName}.merge`], "finding the branch's upstream ref").trim();
        if (!remoteBranch.startsWith("refs/heads/")) {
            throw registrationError("requires an upstream branch");
        }
        git(root, ["fetch", "--no-tags", "--no-recurse-submodules", "--", remote, remoteBranch], "fetching the upstream branch");
        const remoteHead = git(root, ["rev-parse", "FETCH_HEAD"], "reading the fetched commit").trim();
        const head = git(root, ["rev-parse", "HEAD"], "reading the local commit").trim();
        const directory = path.join(fs.realpathSync(paths.parent), path.basename(paths.recipients));
        const filename = path.join(directory, profile + ".pub");
        const relative = path.relative(root, filename).split(path.sep).join("/");
        if (relative.startsWith("../") || path.isAbsolute(relative)) {
            throw registrationError("requires the recipients directory to be inside the repository");
        }
        if (stat(directory) && !stat(directory).isDirectory()) {
            throw registrationError("requires a recipients directory that is not a symlink");
        }
        let publicKey = identity.publicKey;
        if (stat(filename)) {
            publicKey = readText(filename);
            if (parsePublicKey(publicKey).fingerprint !== identity.fingerprint) {
                throw registrationError("found a different key for this profile; use a distinct profile or resolve the key replacement explicitly");
            }
        }
        const entry = git(root, ["ls-tree", "-z", remoteHead, "--", relative], "checking the published public key");
        if (entry) {
            const match = /^100644 blob ([a-f0-9]+)\t[^\0]*\0$/.exec(entry);
            if (!match || parsePublicKey(git(root, ["cat-file", "blob", match[1]], "reading the published public key")).fingerprint !== identity.fingerprint) {
                throw registrationError("found a different published key for this profile; use a distinct profile or resolve the key replacement explicitly");
            }
            if (stat(filename)) {
                git(root, ["update-index", "--add", "--cacheinfo", "100644", match[1], relative], "reconciling the published public-key index entry");
            }
            return;
        }
        if (head !== remoteHead) {
            throw registrationError("requires the local branch to match its upstream before publishing; synchronize the checkout without discarding local work");
        }

        const temporary = fs.mkdtempSync(path.join(path.dirname(lock), "configre-registration-"));
        const env = { GIT_INDEX_FILE: path.join(temporary, "index") };
        try {
            git(root, ["read-tree", head], "preparing the isolated Git index", { env });
            const blob = git(root, ["hash-object", "-w", "--stdin"], "storing the public key", { input: publicKey }).trim();
            git(root, ["update-index", "--add", "--cacheinfo", "100644", blob, relative], "adding the public key to the isolated index", { env });
            const tree = git(root, ["write-tree"], "building the registration tree", { env }).trim();
            const commit = git(root, ["commit-tree", tree, "-p", head, "-m", `Configre: register ${profile}`], "creating the public-key commit (Git author identity must be configured)").trim();
            if (fs.mkdirSync(directory, { recursive: true })) {
                log.info("Created recipients directory", directory);
            }
            if (!stat(filename)) {
                fs.writeFileSync(filename, publicKey, { flag: "wx", mode: 0o644 });
                log.info("Created public-key registration file", filename);
            }
            git(root, ["push", "--no-verify", "--no-follow-tags", "--", remote, `${commit}:${remoteBranch}`], "pushing the public-key commit");
            log.info("Published public key to Git", filename);
            if (git(root, ["symbolic-ref", "--quiet", "HEAD"], "checking the current branch").trim() !== branch) {
                throw registrationError("published the public key, but the local branch changed concurrently; synchronize the checkout");
            }
            git(root, ["update-ref", branch, commit, head], "updating the local branch after publication");
            git(root, ["update-index", "--add", "--cacheinfo", "100644", blob, relative], "updating the public-key index entry after publication");
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    });
}

export default registerRecipient;
