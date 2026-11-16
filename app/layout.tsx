import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./private-ledger.css";

const ledgerSerif = localFont({
  src: "./fonts/Baskervville-Variable.ttf",
  weight: "400 700",
  variable: "--font-ledger-serif",
  display: "optional",
  preload: false,
});

const ledgerText = localFont({
  src: "./fonts/Manrope-Variable.ttf",
  weight: "200 800",
  variable: "--font-ledger-text",
  display: "optional",
  preload: false,
});

const ledgerUtility = localFont({
  src: [
    { path: "./fonts/BarlowCondensed-Regular.ttf", weight: "400" },
    { path: "./fonts/BarlowCondensed-Medium.ttf", weight: "500" },
    { path: "./fonts/BarlowCondensed-SemiBold.ttf", weight: "600" },
  ],
  variable: "--font-ledger-utility",
  display: "optional",
  preload: false,
});

export const metadata: Metadata = {
  title: "Little Black Book",
  description: "Private relationship operating system.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${ledgerSerif.variable} ${ledgerText.variable} ${ledgerUtility.variable}`}
      lang="en"
    >
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
