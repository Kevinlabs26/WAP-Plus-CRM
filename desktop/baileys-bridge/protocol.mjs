/**
 * Baileys sidecar 协议版本常量。
 * SSOT: shared/baileys-versions.json（由 shared/baileysProtocol.ts 同步导出）。
 * 修改版本时请先改 JSON 与 baileysProtocol.ts，再更新本文件或跑协议测试。
 *
 * 实现注意：必须使用编译期内联的静态 JSON 导入，禁止运行时 readFileSync 按相对
 * 路径回读仓库文件 —— bun build --compile 的单文件产物里 import.meta.url 指向
 * 虚拟文件系统（$bunfs），磁盘上不存在 ../../shared/，运行时读取会直接崩溃。
 */
import baileysVersions from "../../shared/baileys-versions.json" with { type: "json" };

export const BAILEYS_BRIDGE_PROTOCOL_VERSION =
  baileysVersions.BAILEYS_BRIDGE_PROTOCOL_VERSION;
export const BAILEYS_LIBRARY_VERSION = baileysVersions.BAILEYS_LIBRARY_VERSION;
