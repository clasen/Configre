import Configre from "../index.js";
import lemonlog from "lemonlog";
import { join } from "node:path";

const cfg = Configre(join(import.meta.dirname, "config"));
const log = lemonlog("Configre");

log.info(cfg.db);
