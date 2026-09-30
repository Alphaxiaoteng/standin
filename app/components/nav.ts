import {
  IconActivity,
  IconBan,
  IconCode,
  IconCompare,
  IconFlag,
  IconList,
  IconScale,
  IconShield,
  IconWallet,
} from "./icons";

export interface NavEntry {
  href: string;
  label: string;
  /** 顶栏副标题 */
  subtitle: string;
  icon: typeof IconShield;
  group: string;
}

export const NAV: NavEntry[] = [
  {
    href: "/",
    label: "今日账本",
    subtitle: "AI 员工今天赚了多少、花了多少",
    icon: IconActivity,
    group: "运行",
  },
  {
    href: "/opportunities",
    label: "机会与决策",
    subtitle: "候选、选中与放弃理由",
    icon: IconScale,
    group: "运行",
  },
  {
    href: "/bounties",
    label: "悬赏市场",
    subtitle: "发布与浏览悬赏任务",
    icon: IconFlag,
    group: "运行",
  },
  {
    href: "/wallet",
    label: "经营设置",
    subtitle: "本金、每日亏损上限与可做的生意",
    icon: IconWallet,
    group: "资产",
  },
  {
    href: "/transactions",
    label: "任务账本",
    subtitle: "每笔成本、收入与净利",
    icon: IconList,
    group: "资产",
  },
  {
    href: "/intercepts",
    label: "本金保护",
    subtitle: "门禁帮你避免的损失",
    icon: IconBan,
    group: "审计",
  },
  {
    href: "/rehearsal",
    label: "彩排报告",
    subtitle: "声明意图 vs 实际 calldata",
    icon: IconCompare,
    group: "审计",
  },
  {
    href: "/developer",
    label: "开发者接入",
    subtitle: "API 与集成方式",
    icon: IconCode,
    group: "集成",
  },
];

export const CHAIN_LABEL = "Monad Testnet · 10143";

/** 全局角标（PRD §五）：正常为「测试网 · 演示市场 · 数据实时」，回放时替换 */
export const BADGE_DEFAULT = "测试网 · 演示市场 · 数据实时";
export const BADGE_REPLAY = "REPLAY · 测试网 · 回放模式";
