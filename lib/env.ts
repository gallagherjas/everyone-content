// 极简 .env 加载(零依赖):KEY=VALUE 行,已存在的环境变量不覆盖
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

try {
  const text = readFileSync(fileURLToPath(new URL("../.env", import.meta.url)), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  // 无 .env 时全部走默认值
}
