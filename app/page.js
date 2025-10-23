"use client";
import Image from "next/image";
import { Poppins } from "next/font/google";
import AssessmentFlow from "@/app/components/AssessmentFlow";

const poppins = Poppins({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

export default function Home() {
  return (
    <main className={`min-h-screen bg-gradient-to-b from-white to-blue-50 text-black ${poppins.className}`}>
      <section className="max-w-5xl mx-auto px-4 pt-10 pb-6">
<header className="hidden md:block rounded-2xl bg-white/70 backdrop-blur border border-gray-100 shadow p-6">
  <div className="flex items-center gap-3 md:gap-4">
    <Image
      src="/loogo.png"
      alt="I-Speak Logo"
      width={40}
      height={40}
      priority
      className="rounded-full shadow-sm"
    />
    <div className="flex flex-col">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">I-Speak</h1>
      <p className="text-sm md:text-base text-neutral-500">
        Automated Speech Assessment
      </p>
    </div>
  </div>
</header>

      </section>
      <section className="max-w-5xl mx-auto px-4 pb-10">
        <AssessmentFlow />
      </section>
    </main>
  );
}
