import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AudioEx - Video zu Audio Konverter",
  description: "Extrahiere Audio aus deinen Videos lokal und sicher.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} bg-slate-950 text-slate-200 antialiased selection:bg-brand-500/30 selection:text-brand-100`}
      >
        {children}
      </body>
    </html>
  );
}
