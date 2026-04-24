import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  motion, useInView, AnimatePresence, useSpring, useMotionValue,
} from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import {
  ArrowRight, X, Check, ChevronDown, Wand2, ScanSearch, RefreshCw,
  Code2, Bug, PieChart, Terminal, Star, Minus, Plus, Lock, Shield, Globe, Play,
  Zap, Brain, Activity, CreditCard, Bell,
} from "lucide-react";
import { insertWaitlistSchema } from "@shared/schema";
import { useAuth } from "@/context/AuthContext";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const G  = "#0DFF82";
const R  = "#FF2947";
const D0 = "#000000";
const D1 = "#080808";
const D2 = "#0E0E0E";

// ─── PARTICLES ────────────────────────────────────────────────────────────────
function ParticleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!; if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf: number;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener("resize", resize);
    type P = { x:number;y:number;sz:number;vx:number;vy:number;o:number;g:boolean };
    const ps: P[] = Array.from({ length: 80 }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      sz: Math.random() * 1.5 + 0.3, vx: (Math.random() - 0.5) * 0.15,
      vy: -(Math.random() * 0.28 + 0.05), o: Math.random() * 0.5 + 0.1,
      g: Math.random() > 0.62,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ps.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -2) { p.y = c.height + 2; p.x = Math.random() * c.width; }
        if (p.x < 0) p.x = c.width; if (p.x > c.width) p.x = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2);
        ctx.fillStyle = p.g ? G : "#fff"; ctx.globalAlpha = p.o; ctx.fill();
      });
      ctx.globalAlpha = 1; raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.4 }} />;
}

// ─── SCRAMBLE ─────────────────────────────────────────────────────────────────
const CHARS = "!<>-_\\/[]{}—=+*^?#ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function useScramble(target: string, triggered: boolean, delay = 0, speed = 38) {
  const [d, setD] = useState(() => target.replace(/./g, " "));
  const tr = useRef<ReturnType<typeof setTimeout>>();
  const iv = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    if (!triggered) return;
    tr.current = setTimeout(() => {
      let f = 0, tot = Math.ceil(target.length * 1.4);
      iv.current = setInterval(() => {
        f++;
        setD(target.split("").map((ch, i) => {
          if (ch === " ") return " ";
          return i < (f / tot) * target.length ? ch : CHARS[Math.floor(Math.random() * CHARS.length)];
        }).join(""));
        if (f >= tot) { clearInterval(iv.current!); setD(target); }
      }, speed);
    }, delay * 1000);
    return () => { clearTimeout(tr.current!); clearInterval(iv.current!); };
  }, [triggered, target, delay, speed]);
  return d;
}

// ─── MORPHING COUNTER ─────────────────────────────────────────────────────────
function MorphNum({ to, suffix = "", prefix = "" }: { to: number|string; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref as any, { once: true });
  const [d, setD] = useState("0");
  useEffect(() => {
    if (!inView) return;
    const num = typeof to === "number" ? to : parseFloat(String(to)) || 0;
    const t0 = Date.now(), dur = 1800; let raf: number;
    const run = () => {
      const p = Math.min((Date.now() - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 4);
      const cur = Math.round(e * num);
      if (p < 1) {
        setD(String(cur).split("").map((d, i, a) =>
          p > 0.75 && i < a.length - 1 ? d : Math.random() > 0.35 ? d : String(Math.floor(Math.random() * 10))
        ).join(""));
        raf = requestAnimationFrame(run);
      } else setD(typeof to === "string" ? to : String(to));
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);
  return <span ref={ref}>{prefix}{d}{suffix}</span>;
}

// ─── 3D TILT ──────────────────────────────────────────────────────────────────
function Tilt3D({ children, className, style, intensity = 14, glowColor = G }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties; intensity?: number; glowColor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current!; const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * intensity;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -intensity;
    el.style.transform = `perspective(700px) rotateY(${x}deg) rotateX(${y}deg) scale3d(1.04,1.04,1.04)`;
    el.style.boxShadow = `${-x}px ${-y}px 40px ${glowColor}14`;
  };
  const onLeave = () => { if (ref.current) { ref.current.style.transform = ""; ref.current.style.boxShadow = ""; } };
  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className={className}
      style={{ ...style, transition: "transform 0.18s ease-out, box-shadow 0.18s ease-out", transformStyle: "preserve-3d", willChange: "transform" }}>
      {children}
    </div>
  );
}

// ─── OVERLAYS ─────────────────────────────────────────────────────────────────
function GrainOverlay() { return <div className="grain-overlay" aria-hidden="true" />; }

// ─── CURSOR + TRAIL ───────────────────────────────────────────────────────────
const TRAIL = 10;
function CustomCursor() {
  const els = useRef<(HTMLDivElement|null)[]>(Array(TRAIL).fill(null));
  const pos = useRef(Array(TRAIL).fill(null).map(() => ({ x: -200, y: -200 })));
  const mouse = useRef({ x: -200, y: -200 });
  const rafRef = useRef<number>();
  const [hover, setHover] = useState(false);
  const [vis, setVis] = useState(false);
  const mx = useMotionValue(-200), my = useMotionValue(-200);
  const dotX = useSpring(mx, { damping: 55, stiffness: 600, mass: 0.1 });
  const dotY = useSpring(my, { damping: 55, stiffness: 600, mass: 0.1 });
  const ringX = useSpring(mx, { damping: 22, stiffness: 250, mass: 0.6 });
  const ringY = useSpring(my, { damping: 22, stiffness: 250, mass: 0.6 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; mx.set(e.clientX); my.set(e.clientY); if (!vis) setVis(true); };
    const onOver = (e: MouseEvent) => setHover(!!(e.target as HTMLElement)?.closest("a,button,[role=button],input,textarea"));
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseover", onOver);
    const loop = () => {
      pos.current = pos.current.map((p, i) => {
        const tgt = i === 0 ? mouse.current : pos.current[i - 1];
        const lag = Math.max(0.08, 0.32 - i * 0.024);
        return { x: p.x + (tgt.x - p.x) * lag, y: p.y + (tgt.y - p.y) * lag };
      });
      els.current.forEach((el, i) => {
        if (!el) return;
        const sz = Math.max(2, 8 - i * 0.7);
        el.style.transform = `translate(${pos.current[i].x - sz / 2}px,${pos.current[i].y - sz / 2}px)`;
        el.style.opacity = String((1 - i / TRAIL) * 0.3);
        el.style.width = `${sz}px`; el.style.height = `${sz}px`;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseover", onOver); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);
  return (
    <>
      {Array.from({ length: TRAIL }).map((_, i) => (
        <div key={i} ref={el => { els.current[i] = el; }}
          className="fixed top-0 left-0 pointer-events-none z-[9996] rounded-full"
          style={{ background: G, willChange: "transform,opacity" }} />
      ))}
      <motion.div className="cursor-dot" style={{ x: dotX, y: dotY, translateX: "-50%", translateY: "-50%" }}
        animate={{ scale: hover ? 0 : 1, opacity: vis ? 1 : 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: G }} />
      </motion.div>
      <motion.div className="cursor-ring" style={{ x: ringX, y: ringY, translateX: "-50%", translateY: "-50%" }}
        animate={{ scale: hover ? 2.6 : 1, opacity: vis ? 0.5 : 0 }} transition={{ duration: 0.2 }}>
        <div style={{ width: 38, height: 38, borderRadius: "50%", border: `1px solid ${hover ? G : "rgba(255,255,255,0.28)"}`, transition: "border-color 0.2s" }} />
      </motion.div>
    </>
  );
}

// ─── TICKER ───────────────────────────────────────────────────────────────────
function Ticker({ reverse = false }: { reverse?: boolean }) {
  const items = ["AI GENERATED","SELF-HEALING","MULTI-AGENT","PLAYWRIGHT READY","CYPRESS READY","PROJECT MEMORY","KAIROS MONITORING","LIVE STREAMING","TESTS THAT THINK"];
  const doubled = [...items, ...items];
  return (
    <div className="overflow-hidden py-3.5" style={{ background: "rgba(255,255,255,0.018)", borderTop: "1px solid rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div className={reverse ? "ticker-track-reverse" : "ticker-track"}>
        {doubled.map((item, i) => (
          <span key={i} className="flex items-center gap-8 px-4 text-xs font-bold tracking-[0.22em] uppercase whitespace-nowrap"
            style={{ color: "rgba(255,255,255,0.14)" }}>
            {item} <span style={{ color: G, fontSize: 16 }}>·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── ORBS ─────────────────────────────────────────────────────────────────────
function Orbs({ red = false, subtle = false }: { red?: boolean; subtle?: boolean }) {
  const alpha = subtle ? "04" : "07";
  const c1 = red ? `rgba(255,41,71,0.0${subtle ? 4 : 7})` : `rgba(13,255,130,0.0${subtle ? 4 : 7})`;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="orb-1 absolute top-1/4 left-1/3 w-[500px] h-[500px] rounded-full"
        style={{ background: `radial-gradient(circle, ${c1} 0%, transparent 70%)`, filter: "blur(80px)" }} />
      <div className="orb-2 absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full"
        style={{ background: `radial-gradient(circle, rgba(13,255,130,0.03) 0%, transparent 70%)`, filter: "blur(90px)" }} />
    </div>
  );
}

// ─── NAVBAR ───────────────────────────────────────────────────────────────────
function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn); return () => window.removeEventListener("scroll", fn);
  }, []);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <motion.nav initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={{ background: scrolled ? "rgba(0,0,0,0.9)" : "transparent", backdropFilter: scrolled ? "blur(24px)" : "none", borderBottom: scrolled ? "1px solid rgba(255,255,255,0.04)" : "1px solid transparent" }}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: G }}>
            <Terminal className="w-3.5 h-3.5 text-black" />
          </div>
          <span className="font-black text-sm tracking-tight">
            <span className="text-white">Auto</span><span style={{ color: G }}>Test</span><span className="text-white">AI</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          {[["Problem","problem"],["Solution","solution"],["Features","features"],["Pricing","pricing"]].map(([l, id]) => (
            <button key={id} onClick={() => go(id)} className="text-xs tracking-widest uppercase font-medium transition-colors"
              style={{ color: "rgba(255,255,255,0.32)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.32)")}>{l}</button>
          ))}
        </div>
        {user ? (
          <Link href="/dashboard" data-testid="link-dashboard"
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold text-black"
            style={{ background: G }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = `0 0 30px ${G}55`; }}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
            Go to Dashboard <ArrowRight className="w-3 h-3" />
          </Link>
        ) : (
          <Link href="/login" data-testid="link-login"
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold text-black"
            style={{ background: G }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = `0 0 30px ${G}55`; }}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
            Login <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </motion.nav>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────
function WordReveal({ word, triggered, color, onDone }: { word: string; triggered: boolean; color: string; onDone?: () => void }) {
  const display = useScramble(word, triggered, 0, 38);
  useEffect(() => { if (display === word) onDone?.(); }, [display, word]);
  return (
    <span style={{ color, fontWeight: 900, letterSpacing: "-0.04em", fontSize: "clamp(80px,18vw,240px)", fontFamily: "monospace", lineHeight: 1 }}>
      {display}
    </span>
  );
}

function HeroSection() {
  const { data: countData } = useQuery({ queryKey: ["/api/waitlist/count"] });
  const count = (countData as any)?.count ?? 0;
  const [phase, setPhase] = useState(0);
  const [errDone, setErrDone] = useState(false);
  const [fixDone, setFixDone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setPhase(1), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (errDone) { const t = setTimeout(() => setPhase(2), 480); return () => clearTimeout(t); } }, [errDone]);
  useEffect(() => { if (fixDone) { const t = setTimeout(() => setPhase(3), 550); return () => clearTimeout(t); } }, [fixDone]);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden" style={{ background: D0 }}>
      <ParticleCanvas />
      <Orbs />
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)",
        backgroundSize: "80px 80px",
      }} />
      {/* ERROR → FIXED */}
      <AnimatePresence>
        {(phase === 1 || phase === 2) && (
          <motion.div initial={{ opacity: 0, scale: 0.78 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.06, filter: "blur(14px)" }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none gap-4">
            <div className="text-xs tracking-[0.4em] font-mono" style={{ color: phase === 1 ? `${R}66` : `${G}66` }}>
              {phase === 1 ? "DETECTED" : "RESOLVED"}
            </div>
            {phase === 1 && <WordReveal word="ERROR" triggered color={R} onDone={() => setErrDone(true)} />}
            {phase === 2 && (
              <>
                <WordReveal word="FIXED" triggered color={G} onDone={() => setFixDone(true)} />
                <motion.div initial={{ width: 0 }} animate={{ width: "40vw" }} transition={{ duration: 0.6, delay: 0.3 }}
                  style={{ height: 1, background: `linear-gradient(90deg,transparent,${G},transparent)` }} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Full hero */}
      <AnimatePresence>
        {phase >= 3 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9 }}
            className="flex-1 flex flex-col justify-center pt-24 pb-16 px-6 md:px-16 lg:px-24 relative z-10 max-w-[1700px] mx-auto w-full">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="flex items-center gap-3 mb-14">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full border"
                style={{ borderColor: `${G}28`, background: `${G}0D` }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: G, boxShadow: `0 0 8px ${G}` }} />
                <span className="text-xs font-semibold" style={{ color: G }}>Open Beta · {count.toLocaleString()} engineers waiting</span>
              </div>
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="font-black leading-[0.88] mb-10"
              style={{ fontSize: "clamp(58px,11vw,152px)", letterSpacing: "-0.035em" }}>
              <span className="text-white block">Your tests.</span>
              <span className="block">
                <span className="text-white">Write </span>
                <span className="glitch-wrap" data-text="themselves." style={{ color: G, fontStyle: "italic" }}>themselves.</span>
              </span>
            </motion.h1>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-5 mb-14">
              <p className="text-lg max-w-xs" style={{ color: "rgba(255,255,255,0.36)", lineHeight: 1.5 }}>
                AI that generates, runs, and self-heals your entire test suite.
              </p>
              <div className="flex items-center gap-4 flex-shrink-0">
                <button onClick={() => go("waitlist")} data-testid="btn-hero-waitlist"
                  className="group flex items-center gap-2.5 px-8 py-4 rounded-full text-sm font-bold text-black"
                  style={{ background: G }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = `0 0 50px ${G}44`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
                  Get Early Access <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </button>
                <button onClick={() => go("features")} className="flex items-center gap-2 text-sm group"
                  style={{ color: "rgba(255,255,255,0.25)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                  onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}>
                  <div className="w-9 h-9 rounded-full border flex items-center justify-center"
                    style={{ borderColor: "rgba(255,255,255,0.1)" }}>
                    <Play className="w-3.5 h-3.5 ml-0.5" />
                  </div>
                  See how
                </button>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="flex flex-wrap gap-10">
              {[["Claude","Sonnet 3.5"],["Playwright","& Cypress"],["Free","to start"]].map(([stat,label]) => (
                <div key={label}>
                  <div className="text-2xl font-black" style={{ color: G }}>{stat}</div>
                  <div className="text-xs" style={{ color: "rgba(255,255,255,0.26)" }}>{label}</div>
                </div>
              ))}
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-16">
              <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                className="flex flex-col items-start gap-2">
                <div className="w-px h-12" style={{ background: "linear-gradient(to bottom,transparent,rgba(255,255,255,0.1))" }} />
                <ChevronDown className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.15)" }} />
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ─── STATS STRIP ─────────────────────────────────────────────────────────────
function StatsStrip() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <div ref={ref} className="border-y" style={{ borderColor: "rgba(255,255,255,0.04)", background: D1 }}>
      <div className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { label: "AI model", value: "Claude", sub: "Sonnet 3.5 powering every generation and heal" },
            { label: "Frameworks", value: "2", sub: "Playwright and Cypress — both fully supported" },
            { label: "Output", value: "Live", sub: "Tests stream token-by-token in real time as Claude writes" },
            { label: "Start for", value: "Free", sub: "1 project, 20 test runs/mo — no card required" },
          ].map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.1, duration: 0.7 }}>
              <div className="font-black leading-none mb-1" style={{ fontSize: "clamp(36px,5vw,64px)", letterSpacing: "-0.04em", color: G }}>
                {s.value}
              </div>
              <div className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "rgba(255,255,255,0.2)" }}>{s.label}</div>
              <div className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.28)" }}>{s.sub}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PROBLEM SECTION ──────────────────────────────────────────────────────────
function ProblemSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section ref={ref} id="problem" className="relative py-32 overflow-hidden" style={{ background: D0 }}>
      <Orbs red />
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <span className="ghost-num absolute" style={{ right: "-4vw", top: "50%", transform: "translateY(-50%)", WebkitTextStroke: `1px rgba(255,41,71,0.05)` }}>BUG</span>
      </div>
      <div className="max-w-7xl mx-auto px-6 sm:px-12 relative z-10">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
          className="flex items-center gap-3 mb-16">
          <div className="w-8 h-px" style={{ background: R }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: R }}>The Problem</span>
        </motion.div>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <motion.h2 initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="font-black leading-[0.88] mb-6"
              style={{ fontSize: "clamp(40px,7vw,96px)", letterSpacing: "-0.035em" }}>
              <span className="text-white">Testing is</span><br />
              <span style={{ color: R }}>broken.</span>
            </motion.h2>
            <motion.p initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.25 }}
              className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.35)", maxWidth: 420 }}>
              Engineering teams spend 30–40% of every sprint maintaining tests instead of building. Bugs still ship. The old tools were built before AI existed.
            </motion.p>
          </div>
          <div className="space-y-4">
            {[
              { num: "$2.41T", label: "Lost annually to software failures" },
              { num: "85%", label: "Of bugs still reach production" },
              { num: "40%", label: "Of sprint time wasted on test maintenance" },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: 30 }} animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.15 + i * 0.1, duration: 0.7 }}
                className="flex items-center gap-6 p-5 rounded-2xl border"
                style={{ borderColor: "rgba(255,41,71,0.1)", background: "rgba(255,41,71,0.03)" }}>
                <div className="font-black flex-shrink-0" style={{ fontSize: "clamp(26px,4vw,48px)", letterSpacing: "-0.04em", color: R }}>{item.num}</div>
                <div className="text-base font-medium" style={{ color: "rgba(255,255,255,0.48)" }}>{item.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── SOLUTION SECTION ─────────────────────────────────────────────────────────
function SolutionSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const differentiators = [
    { num: "01", icon: <Wand2 className="w-3.5 h-3.5" />, name: "Generate", vs: "vs. manual test writing" },
    { num: "02", icon: <ScanSearch className="w-3.5 h-3.5" />, name: "Detect", vs: "vs. missing edge cases" },
    { num: "03", icon: <RefreshCw className="w-3.5 h-3.5" />, name: "Self-Heal", vs: "vs. broken test suites" },
    { num: "04", icon: <Code2 className="w-3.5 h-3.5" />, name: "Code", vs: "vs. hours of scripting" },
    { num: "05", icon: <Bug className="w-3.5 h-3.5" />, name: "Diagnose", vs: "vs. 3-hour debugging" },
    { num: "06", icon: <PieChart className="w-3.5 h-3.5" />, name: "Predict", vs: "vs. shipping blind" },
  ];

  return (
    <section ref={ref} id="solution" className="relative py-32 overflow-hidden" style={{ background: D1 }}>
      <Orbs />
      <div className="max-w-7xl mx-auto px-6 sm:px-12 relative z-10">

        {/* Eyebrow */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
          className="flex items-center gap-3 mb-12">
          <div className="w-8 h-px" style={{ background: G }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: G }}>The Solution</span>
        </motion.div>

        {/* Giant AutoTestAI wordmark — THE answer */}
        <motion.div initial={{ opacity: 0, y: 40 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6">
          <div className="font-black leading-[0.85]" style={{ fontSize: "clamp(64px,13vw,200px)", letterSpacing: "-0.04em" }}>
            <span className="text-white">Auto</span><span style={{ color: G }}>Test</span><span className="text-white">AI</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.2 }}
          className="grid lg:grid-cols-2 gap-16 items-start">

          {/* Left — positioning + 6 feature chips */}
          <div>
            <p className="text-lg font-medium mb-2" style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
              The only platform that covers the entire testing lifecycle with AI.
            </p>
            <p className="text-sm mb-10" style={{ color: "rgba(255,255,255,0.32)", lineHeight: 1.6 }}>
              Traditional tools do one thing. AutoTestAI replaces the entire workflow with 6 capabilities no competitor combines in a single platform.
            </p>

            {/* 6 differentiators grid */}
            <div className="grid grid-cols-2 gap-3 mb-8">
              {differentiators.map((d, i) => (
                <motion.button key={i} onClick={() => go("features")}
                  initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.3 + i * 0.07 }}
                  className="text-left p-4 rounded-xl border group transition-all duration-300"
                  style={{ borderColor: `${G}16`, background: `${G}05` }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = `${G}45`; e.currentTarget.style.background = `${G}0C`; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = `${G}16`; e.currentTarget.style.background = `${G}05`; }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center text-black flex-shrink-0" style={{ background: G }}>
                      {d.icon}
                    </div>
                    <span className="text-xs font-bold text-white tracking-wide">{d.name}</span>
                  </div>
                  <div className="text-xs" style={{ color: "rgba(255,255,255,0.28)" }}>{d.vs}</div>
                </motion.button>
              ))}
            </div>

            <motion.button initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.8 }}
              onClick={() => go("features")}
              className="flex items-center gap-2 text-sm font-semibold"
              style={{ color: G }}
              onMouseEnter={e => (e.currentTarget.style.gap = "12px")}
              onMouseLeave={e => (e.currentTarget.style.gap = "8px")}>
              See all 6 in action <ArrowRight className="w-4 h-4" />
            </motion.button>
          </div>

          {/* Right — Before / After */}
          <motion.div initial={{ opacity: 0, x: 30 }} animate={inView ? { opacity: 1, x: 0 } : {}} transition={{ delay: 0.25, duration: 0.8 }}>
            <div className="text-xs font-bold tracking-widest uppercase mb-5" style={{ color: "rgba(255,255,255,0.2)" }}>
              Before <span style={{ color: R }}>vs.</span> After AutoTestAI
            </div>
            <div className="space-y-3">
              {[
                {
                  label: "Writing tests",
                  before: "Manual — hours per feature",
                  after: "Describe your app, Claude generates the suite",
                },
                {
                  label: "Edge case coverage",
                  before: "Depends on developer recall",
                  after: "BV, injection, race conditions — baked in",
                },
                {
                  label: "When selectors break",
                  before: "Manual locator hunting",
                  after: "Heal agent patches the selector automatically",
                },
                {
                  label: "Ongoing monitoring",
                  before: "Ad-hoc — someone remembers to run tests",
                  after: "KAIROS runs on your schedule, alerts on failure",
                },
              ].map((row, i) => (
                <div key={i} className="p-4 rounded-2xl border" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                  <div className="text-xs font-bold mb-2.5" style={{ color: "rgba(255,255,255,0.38)" }}>{row.label}</div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl" style={{ background: `${R}08`, border: `1px solid ${R}18` }}>
                      <div className="font-bold mb-0.5" style={{ color: R }}>Before</div>
                      <div style={{ color: "rgba(255,255,255,0.4)" }}>{row.before}</div>
                    </div>
                    <div className="p-2.5 rounded-xl" style={{ background: `${G}08`, border: `1px solid ${G}18` }}>
                      <div className="font-bold mb-0.5" style={{ color: G }}>With AutoTestAI</div>
                      <div style={{ color: "rgba(255,255,255,0.4)" }}>{row.after}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── HORIZONTAL SCROLL FEATURES ───────────────────────────────────────────────
// Native scroll listener → MotionValue — avoids all Framer Motion useScroll issues
const PANELS = 6;
function FeaturesSection() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setActive(p => (p + 1) % PANELS), 4000);
    return () => clearInterval(t);
  }, [paused]);

  const panels = [
    {
      num: "01", title: "Generate", sub: "from requirements",
      metric: "Claude", metricLabel: "multi-agent loop", color: G,
      body: "Give Claude your URL or describe a flow. A pipeline of AI agents inspects the page, identifies user flows, writes each test step, and asserts the outcome.",
      visual: (
        <div className="rounded-xl border overflow-hidden font-mono text-xs" style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", maxWidth: 380 }}>
          <div className="flex gap-1.5 px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            {[R,"#FFBE00",G].map((c,i) => <div key={i} className="w-2 h-2 rounded-full" style={{ background: c }} />)}
            <span className="ml-2" style={{ color: "rgba(255,255,255,0.2)" }}>3.8s · 47 tests generated</span>
          </div>
          <div className="p-3 space-y-1" style={{ lineHeight: 1.9 }}>
            {["test_valid_login","test_invalid_password","test_lockout_5x","test_sql_injection","test_xss_attempt","test_empty_fields"].map((t,i) => (
              <div key={i} style={{ color: G }}>✓ {t}</div>
            ))}
            <div style={{ color: "rgba(255,255,255,0.2)" }}>+ 41 more…</div>
          </div>
        </div>
      ),
    },
    {
      num: "02", title: "Detect", sub: "every edge case",
      metric: "Systematic", metricLabel: "by design", color: G,
      body: "The generation agent applies boundary value analysis, injection testing, and race condition patterns — written into the AI's instructions, not left to chance.",
      visual: (
        <div className="space-y-2" style={{ maxWidth: 360 }}>
          {[
            ["Boundary Values", "min, max, zero, empty, overflow"],
            ["Security", "SQL injection, XSS, path traversal"],
            ["Race Conditions", "concurrent state, double-submit"],
            ["Data Extremes", "unicode, long strings, null bytes"],
          ].map(([cat, examples], i) => (
            <div key={i} className="p-3.5 rounded-xl border" style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
              <div className="text-xs font-bold mb-0.5" style={{ color: G }}>{cat}</div>
              <div className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{examples}</div>
            </div>
          ))}
          <div className="text-xs pt-1" style={{ color: "rgba(255,255,255,0.22)" }}>Baked into Claude's generation prompt — applied to every test suite.</div>
        </div>
      ),
    },
    {
      num: "03", title: "Self-Heal", sub: "broken selectors",
      metric: "Auto", metricLabel: "patch on failure", color: G,
      body: "When a test fails due to a changed selector, the heal agent navigates to your URL, finds the updated element, patches the test code, and records the fix in project memory.",
      visual: (
        <div className="space-y-2.5" style={{ maxWidth: 420 }}>
          {[["#loginBtn","[data-testid='login-submit']"],["#payBtn","[data-testid='pay-cta']"],["div.menu","[aria-label='User menu']"]].map(([f,t],i) => (
            <div key={i} className="p-3 rounded-xl border flex items-center gap-2 text-xs font-mono"
              style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
              <Check className="w-3 h-3 flex-shrink-0" style={{ color: G }} />
              <span className="line-through" style={{ color: R }}>{f}</span>
              <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.18)" }} />
              <span style={{ color: G }}>{t}</span>
            </div>
          ))}
          <div className="text-center py-2 text-xs font-bold rounded-xl"
            style={{ color: G, background: `${G}0D`, border: `1px solid ${G}18` }}>
            Each heal is logged in project memory with confidence score
          </div>
        </div>
      ),
    },
    {
      num: "04", title: "Code", sub: "from plain English",
      metric: "English", metricLabel: "→ Playwright / Cypress", color: G,
      body: "Describe what you want to test in plain language. Claude generates a complete Playwright or Cypress test file — properly structured, with selectors verified against your live page.",
      visual: (
        <div className="rounded-xl border overflow-hidden font-mono text-xs" style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", maxWidth: 420 }}>
          <div className="flex gap-1.5 px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            {[R,"#FFBE00",G].map((c,i) => <div key={i} className="w-2 h-2 rounded-full" style={{ background: c }} />)}
            <span className="ml-2" style={{ color: "rgba(255,255,255,0.2)" }}>login.spec.ts</span>
          </div>
          <div className="p-4 space-y-0.5" style={{ lineHeight: 1.9 }}>
            {[
              { c:"rgba(255,255,255,0.22)", t:"import { test, expect } from '@playwright/test';" },
              { c:G, t:"test('user login', async ({ page }) => {" },
              { c:"rgba(255,255,255,0.5)", t:"  await page.goto('/login');" },
              { c:"rgba(255,255,255,0.5)", t:"  await page.fill('[data-testid=\"email\"]', user);" },
              { c:"rgba(255,255,255,0.5)", t:"  await page.click('[data-testid=\"submit\"]');" },
              { c:G, t:"  await expect(page).toHaveURL('/dashboard');" },
              { c:"rgba(255,255,255,0.22)", t:"});" },
            ].map((l,i) => <div key={i} style={{ color: l.c }}>{l.t}</div>)}
          </div>
        </div>
      ),
    },
    {
      num: "05", title: "Diagnose", sub: "root cause instantly",
      metric: "AI", metricLabel: "error analysis", color: G,
      body: "When a test fails, Claude reads the full error output and test code, traces the failure, and writes a plain-English root cause explanation with a suggested fix.",
      visual: (
        <div className="space-y-3" style={{ maxWidth: 380 }}>
          <div className="p-4 rounded-xl border" style={{ borderColor: "rgba(255,41,71,0.18)", background: "rgba(255,41,71,0.04)" }}>
            <div className="text-xs font-mono" style={{ color: R }}>✗ checkout.spec.ts:47 — 422 Error</div>
          </div>
          <div className="p-4 rounded-xl border" style={{ borderColor: `${G}28`, background: `${G}06` }}>
            <div className="text-xs font-bold mb-2" style={{ color: G }}>AI DIAGNOSIS</div>
            <div className="text-xs space-y-1 font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>
              <div>→ Missing 'currency' field in PaymentService</div>
              <div>→ Introduced commit 4f8e2a1 · 2h ago</div>
              <div style={{ color: G }}>→ Fix: add currency: 'USD' on line 234</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      num: "06", title: "Monitor", sub: "around the clock",
      metric: "KAIROS", metricLabel: "autonomous monitoring", color: G,
      body: "KAIROS runs on a cron schedule — hourly, daily, or weekly. It ranks tests by regression risk using Claude Haiku, runs them in parallel, and fires alerts on failures.",
      visual: (
        <div className="rounded-xl border overflow-hidden font-mono text-xs" style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", maxWidth: 380 }}>
          <div className="flex gap-1.5 px-3 py-2 border-b items-center" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            {[R,"#FFBE00",G].map((c,i) => <div key={i} className="w-2 h-2 rounded-full" style={{ background: c }} />)}
            <span className="ml-2" style={{ color: "rgba(255,255,255,0.2)" }}>KAIROS · hourly schedule</span>
          </div>
          <div className="p-3 space-y-1" style={{ lineHeight: 1.9 }}>
            {[
              { c: "rgba(255,255,255,0.3)", t: "[kairos] heartbeat triggered at 14:00" },
              { c: G, t: "[kairos] risk-ranked 7 tests via Claude Haiku" },
              { c: "rgba(255,255,255,0.3)", t: "[kairos] running 7 tests in 3 parallel chunks" },
              { c: G, t: "  ✓ auth.spec.ts" },
              { c: G, t: "  ✓ checkout.spec.ts" },
              { c: R, t: "  ✗ payment.spec.ts — 1 failed" },
              { c: "rgba(255,255,255,0.3)", t: "[kairos] regression detected → alert sent" },
            ].map((l,i) => <div key={i} style={{ color: l.c }}>{l.t}</div>)}
          </div>
        </div>
      ),
    },
  ];

  const panel = panels[active];

  return (
    <section id="features" style={{ background: D2 }}>
      {/* Header row */}
      <div className="max-w-7xl mx-auto px-8 md:px-12 pt-20 pb-10">
        <div className="flex items-center gap-3 mb-10">
          <div style={{ width: 28, height: 1, background: G }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: G }}>Features</span>
        </div>
        {/* Tab chips */}
        <div className="flex gap-2 flex-wrap"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}>
          {panels.map((p, i) => {
            const isActive = active === i;
            return (
              <button key={i}
                data-testid={`panel-chip-${i}`}
                data-active={isActive ? "true" : "false"}
                onClick={() => { setActive(i); setPaused(true); }}
                className="relative flex items-center gap-1.5 rounded-full overflow-hidden"
                style={{
                  padding: "6px 14px",
                  border: `1px solid ${isActive ? G : "rgba(255,255,255,0.09)"}`,
                  background: isActive ? `${G}14` : "rgba(0,0,0,0.3)",
                  color: isActive ? G : "rgba(255,255,255,0.22)",
                  fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
                  textTransform: "uppercase", whiteSpace: "nowrap",
                  transition: "all 0.3s ease",
                  boxShadow: isActive ? `0 0 16px ${G}22` : "none",
                  cursor: "pointer",
                }}>
                {/* Progress bar on active chip */}
                {isActive && !paused && (
                  <motion.div
                    key={active}
                    initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                    transition={{ duration: 4, ease: "linear" }}
                    style={{ position: "absolute", inset: 0, background: `${G}18`, transformOrigin: "left", zIndex: 0 }}
                  />
                )}
                <span style={{ opacity: 0.5, marginRight: 2, position: "relative", zIndex: 1 }}>{p.num}</span>
                <span style={{ position: "relative", zIndex: 1 }}>{p.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active panel */}
      <div className="max-w-7xl mx-auto px-8 md:px-12 pb-24 relative overflow-hidden" style={{ minHeight: 480 }}>
        <Orbs subtle />
        {/* Ghost number */}
        <div className="absolute pointer-events-none select-none" style={{
          right: 0, top: "50%", transform: "translateY(-50%)",
          fontSize: "clamp(140px,18vw,260px)", fontWeight: 900, lineHeight: 0.85,
          letterSpacing: "-0.04em", color: "transparent",
          WebkitTextStroke: `1px ${G}06`,
        }}>{panel.num}</div>

        <AnimatePresence mode="wait">
          <motion.div key={active}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
            className="relative z-10 grid lg:grid-cols-2 gap-12 lg:gap-24 items-center">
            <div>
              <div className="mb-6">
                <span className="text-xs font-bold tracking-[0.25em] uppercase px-3 py-1 rounded-full border"
                  style={{ color: G, borderColor: `${G}33`, background: `${G}0D` }}>{panel.num}</span>
              </div>
              <h2 className="font-black text-white leading-[0.9] mb-1"
                style={{ fontSize: "clamp(36px,5vw,68px)", letterSpacing: "-0.03em" }}>{panel.title}</h2>
              <h2 className="font-black leading-[0.9] mb-6"
                style={{ fontSize: "clamp(36px,5vw,68px)", letterSpacing: "-0.03em", color: G }}>{panel.sub}</h2>
              <p className="text-base leading-relaxed mb-10" style={{ color: "rgba(255,255,255,0.38)", maxWidth: 400 }}>{panel.body}</p>
              <div className="flex items-baseline gap-3">
                <span className="font-black" style={{ fontSize: "clamp(52px,7vw,88px)", letterSpacing: "-0.04em", color: G, textShadow: `0 0 60px ${G}40` }}>
                  {panel.metric}
                </span>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>{panel.metricLabel}</span>
              </div>
            </div>
            <div className="hidden lg:flex items-center justify-center">{panel.visual}</div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

// ─── METRIC MODAL ─────────────────────────────────────────────────────────────
type MetricDetail = {
  stat: string; desc: string; icon: React.ReactNode;
  featureName: string; featureNum: string; explanation: string;
  beforeAfter: { label: string; before: { val: string; pct: number }; after: { val: string; pct: number } }[];
};

function MetricModal({ d, onClose }: { d: MetricDetail; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div data-testid="modal-backdrop" onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.94)", backdropFilter: "blur(20px)" }}>
      <motion.div initial={{ opacity: 0, scale: 0.85, y: 28 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="relative w-full max-w-md rounded-2xl border max-h-[90vh] overflow-y-auto"
        style={{ background: "#080808", borderColor: "rgba(255,255,255,0.08)" }}
        onClick={e => e.stopPropagation()}>
        <div className="h-0.5" style={{ background: G }} />
        <div className="p-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-black" style={{ background: G }}>{d.icon}</div>
            <div>
              <div className="text-xs" style={{ color: "rgba(255,255,255,0.28)" }}>{d.featureNum}</div>
              <div className="text-white font-bold text-sm">{d.featureName}</div>
            </div>
          </div>
          <button data-testid="modal-close-btn" onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6">
          <div className="flex items-baseline gap-3 mb-6">
            <span className="text-6xl font-black" style={{ color: G, letterSpacing: "-0.04em" }}>{d.stat}</span>
            <span className="text-base" style={{ color: "rgba(255,255,255,0.36)" }}>{d.desc}</span>
          </div>
          <div className="space-y-5 mb-6">
            {d.beforeAfter.map((row, i) => (
              <div key={i}>
                <div className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.26)" }}>{row.label}</div>
                <div className="space-y-2">
                  {[{ label: "Without", data: row.before, col: R }, { label: "With AutoTestAI", data: row.after, col: G }].map((side, j) => (
                    <div key={j}>
                      <div className="flex justify-between text-xs mb-1">
                        <span style={{ color: "rgba(255,255,255,0.22)" }}>{side.label}</span>
                        <span className="font-bold" style={{ color: side.col }}>{side.data.val}</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${side.data.pct}%` }}
                          transition={{ duration: 0.9, delay: 0.3 + i * 0.1 }}
                          className="h-full rounded-full" style={{ background: side.col }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 rounded-xl border mb-6" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.04)" }}>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.46)" }}>{d.explanation}</p>
          </div>
          <button onClick={onClose} className="w-full py-3 rounded-xl text-sm font-bold text-black mb-6" style={{ background: G }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
            Explore this feature →
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── PRODUCT DEMO ─────────────────────────────────────────────────────────────
function ProductDemoSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [activeTab, setActiveTab] = useState(0);

  const demos = [
    {
      label: "AI Generation",
      icon: <Wand2 className="w-4 h-4" />,
      title: "Multi-agent test generation",
      desc: "Claude runs 4 typed tools in a while-loop — inspect_page → identify_flows → write_test_step → assert. A Reviewer agent scores quality before saving. Streams output live to your browser.",
      header: "generating · authentication-flow.spec.ts",
      lines: [
        { c: G, t: "[agent] inspect_page('https://app.io/login')" },
        { c: "rgba(255,255,255,0.38)", t: "  → 14 interactive elements found" },
        { c: G, t: "[agent] identify_flows(elements)" },
        { c: "rgba(255,255,255,0.38)", t: "  → 6 user flows identified" },
        { c: G, t: "[agent] write_test_step('valid login')" },
        { c: "rgba(255,255,255,0.38)", t: "  await page.fill('[data-testid=\"email\"]', user)" },
        { c: G, t: "[agent] write_test_step('SQL injection')" },
        { c: "rgba(255,255,255,0.38)", t: "  await page.fill('[data-testid=\"email\"]', `' OR 1=1--`)" },
        { c: G, t: "[agent] assert('dashboard visible')" },
        { c: "rgba(255,255,255,0.38)", t: "  await expect(page).toHaveURL('/dashboard')" },
        { c: G, t: "[reviewer] Quality score: 91/100 · PASS" },
        { c: G, t: "✓ 47 tests generated · 4.2s" },
      ],
      stats: [{ label: "Tests", value: "47" }, { label: "Quality", value: "91/100" }, { label: "Time", value: "4.2s" }],
    },
    {
      label: "Self-Healing",
      icon: <RefreshCw className="w-4 h-4" />,
      title: "Selectors that fix themselves",
      desc: "When your UI changes and a selector breaks, a while-loop heal agent semantically identifies the updated element and patches the test — no manual edits, no failed CI runs.",
      header: "self-heal · checkout.spec.ts:47",
      lines: [
        { c: R, t: "✗ FAIL · #checkout-btn not found (timeout: 30s)" },
        { c: "rgba(255,255,255,0.38)", t: "[heal] Launching pre-flight check (Haiku)…" },
        { c: "rgba(255,255,255,0.38)", t: "[heal] Analyzing DOM — 3 candidate elements" },
        { c: "rgba(255,255,255,0.38)", t: "[heal] Semantic match: aria-label='Proceed to checkout'" },
        { c: G, t: "[heal] Patch: #checkout-btn → [data-testid='checkout-submit']" },
        { c: "rgba(255,255,255,0.38)", t: "[heal] Re-running test with patched selector…" },
        { c: G, t: "✓ PASS · checkout.spec.ts:47 · 1.3s" },
        { c: G, t: "✓ Selector saved to project memory (conf: 1.0)" },
      ],
      stats: [{ label: "Attempts", value: "1" }, { label: "Time to fix", value: "6.1s" }, { label: "Manual edits", value: "0" }],
    },
    {
      label: "Monitoring",
      icon: <Activity className="w-4 h-4" />,
      title: "KAIROS autonomous monitoring",
      desc: "A cron heartbeat checks all projects on hourly or daily schedules. Failures trigger instant notifications via email, Slack, Discord, Telegram, Teams, or webhooks — through OpenClaw multi-channel alerts.",
      header: "scheduler · KAIROS · 11:00 PM heartbeat",
      lines: [
        { c: G, t: "[KAIROS] ♡ heartbeat · 3 projects due" },
        { c: "rgba(255,255,255,0.38)", t: "[KAIROS] Running 7 tests on dashboard.io…" },
        { c: G, t: "[KAIROS] ✓ 6 passed" },
        { c: R, t: "[KAIROS] ✗ 1 failed — checkout.spec.ts:47" },
        { c: "#FFB800", t: "[alert] Critical failure · dashboard.io/checkout" },
        { c: G, t: "[openclaw] Slack → #qa-alerts ✓" },
        { c: G, t: "[openclaw] Email → team@dashboard.io ✓" },
        { c: G, t: "[KAIROS] ✓ Alerts sent · next check in 60 min" },
      ],
      stats: [{ label: "Frequency", value: "Hourly" }, { label: "Channels", value: "5+" }, { label: "Alert time", value: "< 1 min" }],
    },
    {
      label: "Memory",
      icon: <Brain className="w-4 h-4" />,
      title: "Project memory & learning",
      desc: "Every test run teaches the system — selectors, anti-patterns, and flows are stored with confidence scores and injected into future AI generations. 85% token reduction. Auto-compacts at 100 entries.",
      header: "memory · project-47 · 23 entries",
      lines: [
        { c: G, t: "[memory] Injecting context for generate…" },
        { c: "rgba(255,255,255,0.38)", t: "  ✓ [data-testid='login-submit'] (conf: 1.00)" },
        { c: "rgba(255,255,255,0.38)", t: "  ✓ [data-testid='email-input'] (conf: 0.97)" },
        { c: "rgba(255,255,255,0.38)", t: "  ✓ anti-pattern: avoid #dynamic-id selectors" },
        { c: "rgba(255,255,255,0.38)", t: "  ✓ flow: checkout requires login first" },
        { c: G, t: "[memory] 23 items injected · 85% token reduction" },
        { c: "rgba(255,255,255,0.38)", t: "[memory] Post-run: 3 new selectors learned" },
        { c: G, t: "✓ Memory updated · compaction not needed" },
      ],
      stats: [{ label: "Entries", value: "23" }, { label: "Token reduction", value: "85%" }, { label: "Avg confidence", value: "0.96" }],
    },
  ];

  const chips = [
    "Multi-agent Claude generator",
    "Self-healing while-loop agent",
    "KAIROS autonomous monitoring",
    "4-level project memory",
    "OpenClaw multi-channel alerts",
    "Stripe billing (Free / Pro / Team)",
    "In-browser Playwright runner",
    "Live streaming test output",
    "Weekly autoDream summaries",
    "Webhook & CI/CD triggers",
  ];

  return (
    <section ref={ref} className="py-32 relative overflow-hidden" style={{ background: D1 }}>
      <Orbs subtle />
      <div className="max-w-7xl mx-auto px-6 sm:px-12 relative z-10">

        <motion.div initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
          className="flex items-center gap-3 mb-12">
          <div className="w-8 h-px" style={{ background: G }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: G }}>The Product</span>
        </motion.div>

        <motion.h2 initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.1, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-white leading-[0.88] mb-5"
          style={{ fontSize: "clamp(40px,7vw,96px)", letterSpacing: "-0.035em" }}>
          Built. Shipped.<br /><span style={{ color: G }}>Running now.</span>
        </motion.h2>

        <motion.p initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2 }}
          className="text-lg mb-12" style={{ color: "rgba(255,255,255,0.4)", maxWidth: 540 }}>
          Every feature below is live in the product today — not a roadmap.
          Real output from the running system.
        </motion.p>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap mb-10">
          {demos.map((d, i) => (
            <motion.button key={i}
              initial={{ opacity: 0, y: 12 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.25 + i * 0.07 }}
              onClick={() => setActiveTab(i)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
              data-testid={`demo-tab-${i}`}
              style={{
                background: activeTab === i ? `${G}14` : "rgba(255,255,255,0.03)",
                border: `1px solid ${activeTab === i ? `${G}40` : "rgba(255,255,255,0.07)"}`,
                color: activeTab === i ? G : "rgba(255,255,255,0.4)",
                boxShadow: activeTab === i ? `0 0 20px ${G}18` : "none",
              }}>
              <span style={{ color: activeTab === i ? G : "rgba(255,255,255,0.28)" }}>{d.icon}</span>
              {d.label}
            </motion.button>
          ))}
        </div>

        {/* Demo panel */}
        <AnimatePresence mode="wait">
          <motion.div key={activeTab}
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28 }}
            className="grid lg:grid-cols-2 gap-8 items-start">

            {/* Left: description + stats */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${G}14`, border: `1px solid ${G}25` }}>
                  <span style={{ color: G }}>{demos[activeTab].icon}</span>
                </div>
                <h3 className="text-xl font-black text-white">{demos[activeTab].title}</h3>
              </div>
              <p className="text-sm leading-relaxed mb-8" style={{ color: "rgba(255,255,255,0.48)", lineHeight: 1.85 }}>
                {demos[activeTab].desc}
              </p>
              <div className="grid grid-cols-3 gap-3">
                {demos[activeTab].stats.map((s, i) => (
                  <div key={i} className="p-4 rounded-xl border text-center"
                    style={{ borderColor: `${G}20`, background: `${G}07` }}>
                    <div className="text-2xl font-black mb-1" style={{ color: G }}>{s.value}</div>
                    <div className="text-xs" style={{ color: "rgba(255,255,255,0.32)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: terminal */}
            <div className="rounded-2xl border overflow-hidden"
              style={{ borderColor: "rgba(255,255,255,0.07)", background: "#030303" }}>
              <div className="flex items-center gap-1.5 px-4 py-3 border-b"
                style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)" }}>
                {[R, "#FFBE00", G].map((c, i) => (
                  <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                ))}
                <span className="ml-3 text-xs font-mono" style={{ color: "rgba(255,255,255,0.22)" }}>
                  {demos[activeTab].header}
                </span>
              </div>
              <div className="p-5 font-mono text-xs space-y-1" style={{ lineHeight: 1.85 }}>
                {demos[activeTab].lines.map((line, i) => (
                  <motion.div key={`${activeTab}-${i}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.055 }}
                    style={{ color: line.c }}>
                    {line.t}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Shipped features strip */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.5 }}
          className="mt-16">
          <p className="text-xs uppercase tracking-widest font-bold mb-5" style={{ color: "rgba(255,255,255,0.2)" }}>
            Everything shipped ↓
          </p>
          <div className="flex flex-wrap gap-2.5">
            {chips.map((chip, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, scale: 0.95 }} animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ delay: 0.55 + i * 0.04 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium"
                style={{ borderColor: `${G}22`, background: `${G}07`, color: "rgba(255,255,255,0.55)" }}>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: G }} />
                {chip}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── WHY WE WIN ───────────────────────────────────────────────────────────────
function WhyWeWinSection({ onCardClick: _onCardClick }: { onCardClick: (d: MetricDetail) => void }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const capabilities = [
    {
      icon: <Wand2 className="w-4 h-4" />, num: "01",
      name: "Multi-agent generation",
      what: "Claude runs a tool-use loop: inspect_page → identify_flows → write_test_step → assert. A reviewer agent scores every test before saving.",
    },
    {
      icon: <ScanSearch className="w-4 h-4" />, num: "02",
      name: "Systematic edge case coverage",
      what: "Boundary values, SQL/XSS injection, empty fields, and concurrent states are baked into the generation prompt — not left to chance.",
    },
    {
      icon: <RefreshCw className="w-4 h-4" />, num: "03",
      name: "Selector self-healing",
      what: "On failure, the heal agent visits your URL, reads the live DOM, finds the element semantically, and patches the test code. The fix is written to project memory so it doesn't break again.",
    },
    {
      icon: <Code2 className="w-4 h-4" />, num: "04",
      name: "Natural language → test code",
      what: "Describe a scenario in plain English. Claude writes a structured Playwright or Cypress file with proper assertions, data-testid selectors, and error handling.",
    },
    {
      icon: <Bug className="w-4 h-4" />, num: "05",
      name: "AI failure diagnosis",
      what: "When a test fails, Claude reads the full error output, traces the stack, and writes a plain-English root cause explanation with a suggested code fix.",
    },
    {
      icon: <Activity className="w-4 h-4" />, num: "06",
      name: "KAIROS autonomous monitoring",
      what: "A cron scheduler ranks tests by regression risk (using Claude Haiku on recent pass rates), runs them in parallel, and fires email or webhook alerts on regressions.",
    },
  ];

  return (
    <section ref={ref} id="why-us" className="relative py-28 overflow-hidden" style={{ background: D1 }}>
      <Orbs />
      <div className="max-w-7xl mx-auto px-6 sm:px-12 relative z-10">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
          className="flex items-center gap-3 mb-12">
          <div className="w-8 h-px" style={{ background: G }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: G }}>How it works</span>
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.1, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-white leading-[0.88] mb-4"
          style={{ fontSize: "clamp(40px,7vw,96px)", letterSpacing: "-0.035em" }}>
          Real mechanics.<br /><span style={{ color: G }}>No invented numbers.</span>
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.2 }}
          className="text-sm mb-14" style={{ color: "rgba(255,255,255,0.36)", maxWidth: 540 }}>
          Everything below describes what the code actually does — not marketing claims. Every test run, heal event, and monitoring cycle is recorded in your activity log.
        </motion.p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {capabilities.map((c, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 28 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 + i * 0.09 }}>
              <Tilt3D className="h-full">
                <div data-testid={`capability-card-${i}`}
                  className="h-full text-left p-6 rounded-2xl border"
                  style={{ borderColor: `${G}10`, background: `${G}04` }}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-black flex-shrink-0" style={{ background: G }}>{c.icon}</div>
                    <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.25)" }}>{c.num}</span>
                  </div>
                  <div className="text-sm font-bold text-white mb-2">{c.name}</div>
                  <div className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>{c.what}</div>
                </div>
              </Tilt3D>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── PRICING ──────────────────────────────────────────────────────────────────
function PricingSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [annual, setAnnual] = useState(false);
  const plans = [
    { name: "Free", mo: null, yr: null, highlight: false, cta: "Get Started Free",
      features: ["1 project","20 test runs / month","AI test generation","In-browser Playwright runner","Test history"] },
    { name: "Pro", mo: 49, yr: 39, highlight: true, badge: "Most Popular", cta: "Join Waitlist",
      features: ["5 projects","Unlimited test runs","Self-healing tests","Hourly & daily monitoring","Email + Slack + Discord alerts","Project memory & learning","Priority support"] },
    { name: "Team", mo: 149, yr: 119, highlight: false, cta: "Join Waitlist",
      features: ["Unlimited projects","Unlimited test runs","Everything in Pro","Webhook & CI/CD triggers","Weekly autoDream summaries","OpenClaw multi-channel alerts","Teams / Telegram / WhatsApp"] },
  ];
  return (
    <section ref={ref} id="pricing" className="py-28 relative overflow-hidden" style={{ background: D0 }}>
      <Orbs />
      <div className="max-w-7xl mx-auto px-6 sm:px-12 relative z-10">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
          className="flex items-center gap-3 mb-12">
          <div className="w-8 h-px" style={{ background: G }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: G }}>Pricing</span>
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.1, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-white leading-[0.88] mb-10"
          style={{ fontSize: "clamp(40px,7vw,96px)", letterSpacing: "-0.035em" }}>
          Start free.<br /><span style={{ color: G }}>Scale when ready.</span>
        </motion.h2>
        <div className="inline-flex items-center gap-1 p-1 rounded-full border mb-12"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
          {[["Monthly",false],["Annual",true]].map(([l,v]) => (
            <button key={String(v)} onClick={() => setAnnual(v as boolean)}
              className="px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2"
              style={{ background: annual === v ? "rgba(255,255,255,0.08)" : "transparent", color: annual === v ? "#fff" : "rgba(255,255,255,0.32)" }}>
              {l}
              {v && <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: `${G}20`, color: G }}>Save 20%</span>}
            </button>
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-5">
          {plans.map((plan, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 40 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.7, delay: 0.2 + i * 0.1 }} whileHover={{ y: -8 }}
              className="relative p-8 rounded-2xl border"
              style={{ borderColor: plan.highlight ? `${G}40` : "rgba(255,255,255,0.06)", background: plan.highlight ? `${G}06` : "rgba(255,255,255,0.02)" }}>
              {(plan as any).badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-bold text-black" style={{ background: G }}>
                  {(plan as any).badge}
                </div>
              )}
              <div className="text-white font-bold text-xl mb-3">{plan.name}</div>
              <div className="mb-6">
                {plan.mo === null
                  ? <span className="text-4xl font-black text-white">{plan.name === "Free" ? "Free" : "Custom"}</span>
                  : <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black text-white">${annual ? plan.yr : plan.mo}</span>
                    <span className="text-sm" style={{ color: "rgba(255,255,255,0.28)" }}>/mo</span>
                  </div>}
              </div>
              <button className="w-full py-3 rounded-xl text-sm font-bold mb-6 transition-all"
                style={{ background: plan.highlight ? G : "rgba(255,255,255,0.05)", color: plan.highlight ? "#000" : "rgba(255,255,255,0.55)", border: plan.highlight ? "none" : "1px solid rgba(255,255,255,0.06)" }}
                onMouseEnter={e => { if (!plan.highlight) e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { if (!plan.highlight) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}>
                {plan.cta}
              </button>
              <div className="space-y-2.5">
                {plan.features.map((f, j) => (
                  <div key={j} className="flex items-center gap-2.5 text-sm">
                    <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: G }} />
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>{f}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── PROOF SECTION ────────────────────────────────────────────────────────────
function ProofSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const { user } = useAuth();
  const records = [
    {
      icon: <Wand2 className="w-4 h-4" />, label: "Test Generation",
      description: "Every test Claude writes is stored in your project — the full Playwright/Cypress code, the reviewer score, the agent steps used.",
      table: "generated_tests", field: "code, review (score + flags), prompt, framework, created_at",
    },
    {
      icon: <Play className="w-4 h-4" />, label: "Test Runs",
      description: "Each time you run a test (manually or via KAIROS), a run record is written: pass count, fail count, full terminal output, duration.",
      table: "test_runs", field: "status, passed_count, failed_count, output, started_at, completed_at",
    },
    {
      icon: <RefreshCw className="w-4 h-4" />, label: "Self-Heal Events",
      description: "Successful heals are flagged on the test run record with the heal log — what was broken, what was patched, and which method was used.",
      table: "test_runs", field: "healed, heal_log, heal_attempts, healed_via",
    },
    {
      icon: <Activity className="w-4 h-4" />, label: "KAIROS Monitoring Runs",
      description: "Every scheduled monitoring cycle is logged — which tests ran, how many passed/failed, whether an alert was sent, and the weekly AI dream summary.",
      table: "scheduled_run_log", field: "trigger, tests_run, passed, failed, notification_sent, dream_summary",
    },
    {
      icon: <Brain className="w-4 h-4" />, label: "Project Memory",
      description: "Every selector the heal agent fixes is recorded with a confidence score. The generate agent reads this memory before writing new tests.",
      table: "project_memory", field: "type, pattern, selector, confidence, tags, updated_at",
    },
  ];
  return (
    <section ref={ref} className="py-28 relative overflow-hidden border-t" style={{ borderColor: "rgba(255,255,255,0.04)", background: D2 }}>
      <Orbs subtle />
      <div className="max-w-7xl mx-auto px-6 sm:px-12 relative z-10">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
          className="flex items-center gap-3 mb-12">
          <div className="w-8 h-px" style={{ background: G }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: G }}>Proof of work</span>
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.1, duration: 0.9 }}
          className="font-black text-white leading-[0.88] mb-4"
          style={{ fontSize: "clamp(36px,5vw,72px)", letterSpacing: "-0.035em" }}>
          Every event is<br /><span style={{ color: G }}>permanently logged.</span>
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.2 }}
          className="text-sm mb-14" style={{ color: "rgba(255,255,255,0.38)", maxWidth: 540 }}>
          No claims without receipts. Every test generation, run, heal, and monitoring cycle writes a real database record you can query, export, or inspect in your Activity feed.
        </motion.p>
        <div className="space-y-3">
          {records.map((r, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: 0.1 + i * 0.08 }}
              className="flex gap-5 p-5 rounded-2xl border items-start"
              style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-black mt-0.5" style={{ background: G }}>
                {r.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white mb-1">{r.label}</div>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>{r.description}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-xs font-mono" style={{ color: `${G}60` }}>table: {r.table}</span>
                  <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{r.field}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
        {user ? (
          <motion.div initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.6 }}
            className="mt-10">
            <Link href="/dashboard/activity">
              <button className="flex items-center gap-2.5 px-6 py-3 rounded-xl text-sm font-bold text-black" style={{ background: G }}
                onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
                View your Activity Feed <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </motion.div>
        ) : (
          <motion.p initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.6 }}
            className="mt-10 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
            Sign up free → your records start the moment you generate your first test.
          </motion.p>
        )}
      </div>
    </section>
  );
}

// ─── WAITLIST ─────────────────────────────────────────────────────────────────
const waitlistSchema = insertWaitlistSchema.extend({ email: z.string().email("Valid email required") });

function WaitlistSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const form = useForm<z.infer<typeof waitlistSchema>>({
    resolver: zodResolver(waitlistSchema),
    defaultValues: { email: "", name: "" },
  });
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof waitlistSchema>) => apiRequest("POST", "/api/waitlist", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/waitlist/count"] }); navigate("/thank-you"); },
    onError: (err: any) => {
      if (err.message?.includes("already")) toast({ title: "Already on the list!" });
      else toast({ title: "Something went wrong", variant: "destructive" });
    },
  });
  return (
    <section ref={ref} id="waitlist" className="py-36 relative overflow-hidden" style={{ background: D0 }}>
      <Orbs />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
        <span className="ghost-num" style={{ WebkitTextStroke: `1px ${G}05`, fontSize: "clamp(200px,28vw,400px)", color: "transparent" }}>GO.</span>
      </div>
      <div className="max-w-2xl mx-auto px-6 text-center relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border mb-10"
          style={{ borderColor: `${G}25`, background: `${G}0D` }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: G, boxShadow: `0 0 8px ${G}` }} />
          <span className="text-xs font-semibold" style={{ color: G }}>Open Beta · Limited spots</span>
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.1, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-white leading-[0.88] mb-10"
          style={{ fontSize: "clamp(52px,10vw,120px)", letterSpacing: "-0.04em" }}>
          Join the<br /><span style={{ color: G }}>revolution.</span>
        </motion.h2>
        <motion.form initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.3 }}
          onSubmit={form.handleSubmit(d => mutation.mutate(d))}
          className="flex flex-col sm:flex-row gap-3 mb-5">
          {[
            { ...form.register("name"), id: "input-name", placeholder: "Your name", type: "text" },
            { ...form.register("email"), id: "input-email", placeholder: "work@email.com", type: "email" },
          ].map(({ id, placeholder, type, ...rest }) => (
            <input key={id} {...rest} type={type} placeholder={placeholder} data-testid={id}
              className="flex-1 px-5 py-4 rounded-xl text-sm text-white placeholder:text-white/20 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
              onFocus={e => (e.currentTarget.style.borderColor = `${G}50`)}
              onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")} />
          ))}
          <button type="submit" disabled={mutation.isPending} data-testid="btn-submit-waitlist"
            className="px-8 py-4 rounded-xl text-sm font-bold text-black whitespace-nowrap transition-all disabled:opacity-60"
            style={{ background: G }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.04)"; e.currentTarget.style.boxShadow = `0 0 40px ${G}44`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
            {mutation.isPending ? "Joining…" : "Get Access →"}
          </button>
        </motion.form>
        {form.formState.errors.email && <p className="text-sm mb-4" style={{ color: R }}>{form.formState.errors.email.message}</p>}
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>No credit card. Unsubscribe anytime.</p>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [open, setOpen] = useState<number | null>(null);
  const faqs = [
    { q: "How does AI test generation actually work?", a: "A multi-agent Claude pipeline runs 4 typed tools in a while-loop: inspect_page (reads the DOM), identify_flows (maps user journeys), write_test_step (writes individual steps), and assert (adds verification). A Reviewer agent then scores quality before the test is saved. Output streams live to your browser." },
    { q: "What frameworks do you support?", a: "The in-browser runner uses Playwright with Chromium. Generated tests are in Playwright/TypeScript format — CI/CD ready for GitHub Actions, GitLab CI, Jenkins, and CircleCI." },
    { q: "How does self-healing actually work?", a: "When a selector fails, a heal agent (Claude Haiku for pre-flight, Sonnet for deep heal) analyzes the live page DOM, finds the updated element semantically, patches the selector, and re-runs the test automatically. Learned selectors are stored in project memory so the fix persists." },
    { q: "What is KAIROS monitoring?", a: "KAIROS is our autonomous monitoring system — a cron heartbeat that runs your tests on hourly or daily schedules while you sleep. Failures immediately trigger multi-channel notifications via email, Slack, Discord, Telegram, Microsoft Teams, or webhooks." },
    { q: "Is my code private?", a: "Yes. Your test code and results are stored securely in your account. We analyze test outputs, not your source code. We're working toward SOC 2 certification." },
    { q: "When can I start using it?", a: "You can sign up and start using the platform right now — the Free plan is live with 1 project and 20 test runs per month. Join the waitlist for Pro early access and locked-in pricing." },
  ];
  return (
    <section ref={ref} className="py-28 relative overflow-hidden border-t" style={{ borderColor: "rgba(255,255,255,0.04)", background: D1 }}>
      <div className="max-w-3xl mx-auto px-6 sm:px-12 relative z-10">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={inView ? { opacity: 1, x: 0 } : {}}
          className="flex items-center gap-3 mb-12">
          <div className="w-8 h-px" style={{ background: G }} />
          <span className="text-xs tracking-[0.3em] uppercase font-bold" style={{ color: G }}>FAQ</span>
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 30 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.1, duration: 0.9 }}
          className="font-black text-white leading-[0.88] mb-14"
          style={{ fontSize: "clamp(44px,6vw,80px)", letterSpacing: "-0.035em" }}>
          Questions?<br /><span style={{ color: G }}>Answered.</span>
        </motion.h2>
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 + i * 0.07 }}
              className="rounded-2xl border overflow-hidden"
              style={{ borderColor: open === i ? `${G}28` : "rgba(255,255,255,0.05)", background: open === i ? `${G}05` : "rgba(255,255,255,0.02)" }}>
              <button onClick={() => setOpen(open === i ? null : i)} data-testid={`faq-toggle-${i}`}
                className="w-full flex items-center justify-between p-6 text-left">
                <span className="font-semibold text-sm text-white pr-4">{faq.q}</span>
                <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: open === i ? `${G}20` : "rgba(255,255,255,0.05)" }}>
                  {open === i ? <Minus className="w-3 h-3" style={{ color: G }} /> : <Plus className="w-3 h-3" style={{ color: "rgba(255,255,255,0.4)" }} />}
                </div>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
                    <div className="px-6 pb-6 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.44)" }}>{faq.a}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FINAL CTA ────────────────────────────────────────────────────────────────
function FinalCTA() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section ref={ref} className="relative py-44 overflow-hidden" style={{ background: D0 }}>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[700px] h-[700px] rounded-full" style={{ background: `radial-gradient(circle, ${G}09 0%, transparent 70%)`, filter: "blur(80px)" }} />
      </div>
      <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
        <motion.h2 initial={{ opacity: 0, y: 40 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="font-black text-white mb-8 leading-[0.88]"
          style={{ fontSize: "clamp(52px,9vw,130px)", letterSpacing: "-0.04em" }}>
          Stop writing tests.<br /><span style={{ color: G }}>Start shipping.</span>
        </motion.h2>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.3 }}>
          <button onClick={() => document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" })}
            className="inline-flex items-center gap-3 px-12 py-5 rounded-full text-base font-bold text-black"
            style={{ background: G }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.06)"; e.currentTarget.style.boxShadow = `0 0 70px ${G}44`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
            Get Early Access <ArrowRight className="w-5 h-5" />
          </button>
        </motion.div>
      </div>
    </section>
  );
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function Footer() {
  const go = (id: string) => id && document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <footer className="py-14 border-t" style={{ borderColor: "rgba(255,255,255,0.04)", background: D1 }}>
      <div className="max-w-7xl mx-auto px-6 sm:px-12">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-10">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: G }}>
              <Terminal className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-black text-sm">
              <span className="text-white">Auto</span><span style={{ color: G }}>Test</span><span className="text-white">AI</span>
            </span>
            <div className="ml-4 flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: G }} /> All systems operational
            </div>
          </div>
          <div className="flex items-center gap-8">
            {[["Features","features"],["Why Us","why-us"],["Pricing","pricing"],["Waitlist","waitlist"]].map(([l,id]) => (
              <button key={id} onClick={() => go(id)} className="text-xs font-medium transition-colors"
                style={{ color: "rgba(255,255,255,0.3)" }}
                onMouseEnter={e => (e.currentTarget.style.color = G)}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-8" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>© 2026 AutoTestAI. All rights reserved.</span>
          <div className="flex items-center gap-6 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
            {[<><Lock className="w-3 h-3" /> Bcrypt passwords</>, <><Shield className="w-3 h-3" /> Stripe billing</>, <><Globe className="w-3 h-3" /> Hosted on Replit</>].map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">{item}</span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function Landing() {
  const [activeDetail, setActiveDetail] = useState<MetricDetail | null>(null);
  const modal = createPortal(
    <AnimatePresence>
      {activeDetail && <MetricModal key="metric-modal" d={activeDetail} onClose={() => setActiveDetail(null)} />}
    </AnimatePresence>,
    document.body
  );
  return (
    <>
      <div className="atai-root min-h-screen overflow-x-hidden" style={{ background: D0 }}>
        <GrainOverlay />
        <CustomCursor />
        <NavBar />
        <HeroSection />
        <StatsStrip />
        <Ticker />
        <ProblemSection />
        <SolutionSection />
        <Ticker reverse />
        <FeaturesSection />
        <ProductDemoSection />
        <WhyWeWinSection onCardClick={setActiveDetail} />
        <PricingSection />
        <ProofSection />
        <WaitlistSection />
        <FAQSection />
        <FinalCTA />
        <Footer />
      </div>
      {modal}
    </>
  );
}
