/**
 * 状态存储（由 lib/ledger.ts 提供持久化支持并保持 100% 兼容代理）
 *
 * 历史接口已全部迁移至 lib/ledger.ts，本文件作为稳定门面导出，
 * 避免破坏任何既有调用方与测试。
 */

export * from "./ledger";
