import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reline Dashboard",
  description: "Reline Panasonic sales analytics dashboard",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.jpg",
    apple: "/icon.jpg",
    shortcut: "/icon.jpg",
  },
};

// Grey pixel-sampled directly from icon.jpg's actual background (~#b7b8be
// at the corners) — used by mobile browsers for the "Add to Home Screen"
// splash/loading screen instead of the default white.
export const viewport = {
  themeColor: "#b8b9c0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
