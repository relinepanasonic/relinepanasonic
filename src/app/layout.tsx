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
    icon: "/logo-transparent.png",
    apple: "/logo-transparent.png",
    shortcut: "/logo-transparent.png",
  },
};

// Grey pixel-sampled from the original icon.jpg background (~#b7b8be) —
// now that the icon itself (logo-transparent.png) has no background of its
// own, this color is what actually shows behind it on the "Add to Home
// Screen" splash/loading screen instead of the default white.
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
