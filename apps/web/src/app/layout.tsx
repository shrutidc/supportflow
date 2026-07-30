import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";

// Variable names are font-agnostic on purpose: globals.css maps them to
// Tailwind's --font-sans / --font-mono tokens, so swapping a typeface is a
// change here only.
const appSans = Plus_Jakarta_Sans({
  variable: "--font-app-sans",
  subsets: ["latin"],
});

const appMono = Geist_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "SupportFlow",
    template: "%s | SupportFlow",
  },
  description: "The AI-native customer operations platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes mutates <html> class before hydration
    <html
      lang="en"
      suppressHydrationWarning
      className={`${appSans.variable} ${appMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ClerkProvider>
          <Providers>
            <AppShell>{children}</AppShell>
            <Toaster richColors position="bottom-right" />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
