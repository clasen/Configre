import Configre from "../../index.js";
import lemonlog from "lemonlog";
import { join } from "node:path";

const log = lemonlog("Configre");

const cfg = Configre(join(import.meta.dirname, "config"));
log.info(cfg.db);
