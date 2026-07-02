import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qwerty Learner Sync",
  description: "Mobile-friendly Qwerty Learner style practice page.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
