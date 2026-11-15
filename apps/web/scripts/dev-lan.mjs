/**
 * 启动 web 开发服务器，并打印手机可用的局域网地址。
 *
 * Next 默认监听 0.0.0.0，手机能连通的前提只剩两件事：
 * 1. 电脑防火墙放行 3000
 * 2. 告诉用户该输哪个 IP（本机有多张网卡时容易猜错）
 */

import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = process.env.PORT ?? "3000";

const addresses = [];
for (const [name, list] of Object.entries(networkInterfaces())) {
  for (const net of list ?? []) {
    if (net.family !== "IPv4" || net.internal) continue;
    // 虚拟网卡（Hyper-V / WSL / VPN）也算，标注出来让用户自己判断
    addresses.push({ name, address: net.address });
  }
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--port", PORT, "--hostname", "0.0.0.0"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

const banner = [
  "",
  "  本机访问   http://localhost:" + PORT,
  ...addresses.map((a) => "  手机访问   http://" + a.address + ":" + PORT + "   (" + a.name + ")"),
  "",
  "  手机连不上：确认同一 Wi-Fi，并在 Windows 防火墙放行 Node.js（端口 " + PORT + "）。",
  "",
].join("\n");

// 等服务真正起来再打印，避免和 Next 的输出抢行
setTimeout(() => process.stdout.write(banner + "\n"), 1500);

child.on("exit", (code) => process.exit(code ?? 0));
