import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "네이버 블로그 자동화",
  description: "AI로 글감을 찾고 글을 써서 네이버 블로그에 발행하는 로컬 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
