import Configre from "../../index.js";
import { join } from "node:path";

const configPath = join(import.meta.dirname, "config");
const cfg = Configre(configPath);
cfg.print();
console.info("API key configured:", Boolean(cfg.api.key));
console.info(`Set api.key in ${join(configPath, "index.secret.cjs")} and run this demo again.`);
console.info(`New servers automatically publish their public key in ${join(configPath, "recipients")}. Pull and rerun here to authorize them.`);
console.info(`Share ${join(configPath, "secrets.enc.json")} through Git.`);
