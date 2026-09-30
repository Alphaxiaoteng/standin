import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

export const metadata: Metadata = {
  title: "StandIn · Agent 支付护栏控制台",
  description:
    "为 AI Agent 提供带护栏的钱包：每笔支付先彩排，声明意图与实际 calldata 一致才允许金库放款。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="main-col">
            <Topbar />
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
