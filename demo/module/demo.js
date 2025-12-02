import Configre from "../../index.js";
import lemonlog from "lemonlog";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const log = lemonlog("Configre");
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cfg = Configre(join(__dirname, "config"));
log.info(cfg.db);

