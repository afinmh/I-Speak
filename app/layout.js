import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { UiStateProvider } from "./components/UiStateProvider";
import PreloadWhisper from "@/app/components/PreloadWhisper";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "I‑Speak | Automated Speech Assessment",
  description: "Assess fluency, pronunciation, prosody, coherence, complexity, accuracy, and CEFR in the browser.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Cross-Origin-Opener-Policy" content="same-origin" />
        <meta httpEquiv="Cross-Origin-Embedder-Policy" content="require-corp" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Preload Whisper model globally when the app starts */}
        <PreloadWhisper />
        <UiStateProvider>
          {children}
        </UiStateProvider>
      </body>
    </html>
  );
}
