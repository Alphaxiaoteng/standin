/**
 * 测试隔离：所有落盘路径指向 os.tmpdir() 下的唯一临时目录，
 * 确保测试绝不触碰真实 .data/（ledger / bounties / notices）。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "standin-test-"));

process.env.STANDIN_LEDGER_PATH = join(dir, "ledger.json");
process.env.STANDIN_BOUNTIES_PATH = join(dir, "bounties.json");
process.env.STANDIN_NOTICES_PATH = join(dir, "notices.json");
