import { motion } from "framer-motion";
import { CheckCircle2, Rocket, Twitter, Linkedin, ArrowRight, Zap, Star, Users, Mail, Gift, Crown, MessageSquare } from "lucide-react";
import { useLocation } from "wouter";

export default function ThankYou() {
  const [, setLocation] = useLocation();

  const shareText = "I just joined the waitlist for AutoTestAI — the AI that generates test cases in seconds. The future of QA is here! 🚀";
  const shareUrl = typeof window !== "undefined" ? window.location.origin : "";

  const perks = [
    { icon: <Crown className="w-5 h-5" />, title: "Founder Pricing", desc: "Locked-in rate for life — up to 50% off launch price", color: "from-amber-500 to-orange-500" },
    { icon: <Rocket className="w-5 h-5" />, title: "First Access", desc: "You'll be in our first beta cohort before public launch", color: "from-violet-500 to-purple-500" },
    { icon: <MessageSquare className="w-5 h-5" />, title: "Shape the Product", desc: "Direct line to our team — your feedback drives what we build", color: "from-blue-500 to-cyan-500" },
    { icon: <Gift className="w-5 h-5" />, title: "Bonus Features", desc: "Early adopters unlock exclusive features not in standard tiers", color: "from-emerald-500 to-teal-500" },
  ];

  return (
    <div className="min-h-screen bg-[#060610] flex flex-col overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-15"
          style={{ backgroundImage: "linear-gradient(rgba(120,80,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(120,80,255,0.1) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
      </div>

      {/* Nav */}
      <div className="relative z-10 flex items-center justify-center pt-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-bold text-xl">Auto<span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-blue-400">TestAI</span></span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="max-w-2xl w-full text-center">
          {/* Success animation */}
          <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 150, damping: 12 }} className="flex justify-center mb-8">
            <div className="relative">
              <motion.div animate={{ boxShadow: ["0 0 30px rgba(139,92,246,0.3)", "0 0 80px rgba(139,92,246,0.6)", "0 0 30px rgba(139,92,246,0.3)"] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-28 h-28 rounded-3xl bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 flex items-center justify-center shadow-2xl">
                <CheckCircle2 className="w-14 h-14 text-white" strokeWidth={1.5} />
              </motion.div>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                className="absolute -inset-4 rounded-3xl border-2 border-dashed border-violet-500/20" />
              {/* Confetti dots */}
              {[...Array(8)].map((_, i) => (
                <motion.div key={i}
                  initial={{ scale: 0, x: 0, y: 0 }}
                  animate={{ scale: [0, 1, 0], x: Math.cos((i / 8) * Math.PI * 2) * 60, y: Math.sin((i / 8) * Math.PI * 2) * 60 }}
                  transition={{ duration: 1.5, delay: 0.3 + i * 0.05, repeat: Infinity, repeatDelay: 3 }}
                  className={`absolute top-1/2 left-1/2 w-3 h-3 rounded-full ${["bg-violet-400", "bg-blue-400", "bg-emerald-400", "bg-amber-400"][i % 4]}`} />
              ))}
            </div>
          </motion.div>

          {/* Headline */}
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.8 }}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/30 bg-emerald-500/8 text-emerald-400 text-sm mb-6">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              You're officially on the list!
            </div>
            <h1 className="text-5xl sm:text-6xl font-black text-white mb-5 leading-tight">
              Welcome to the
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-purple-400 to-blue-400">QA revolution</span>
            </h1>
            <p className="text-xl text-gray-400 max-w-lg mx-auto mb-10">
              You're among an elite group of QA engineers shaping the future of software testing.
              Check your inbox — confirmation on its way.
            </p>
          </motion.div>

          {/* Perks */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
            className="grid grid-cols-2 gap-4 mb-10">
            {perks.map((perk, i) => (
              <motion.div key={i} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.8 + i * 0.1 }} whileHover={{ y: -4, borderColor: "rgba(139,92,246,0.4)" }}
                className="rounded-2xl border border-white/8 bg-white/3 p-5 text-left transition-all">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${perk.color} flex items-center justify-center text-white mb-3 shadow-lg`}>
                  {perk.icon}
                </div>
                <div className="text-white font-semibold text-sm mb-1">{perk.title}</div>
                <div className="text-gray-500 text-xs leading-relaxed">{perk.desc}</div>
              </motion.div>
            ))}
          </motion.div>

          {/* Share section */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
            className="rounded-2xl border border-violet-500/20 bg-violet-950/10 p-7 mb-8">
            <div className="flex items-center justify-center gap-2 text-violet-300 font-semibold mb-3">
              <Rocket className="w-4 h-4" />
              Move up the waitlist — share AutoTestAI
            </div>
            <p className="text-gray-500 text-sm mb-5">Refer team members and colleagues to jump the queue and get access sooner.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <motion.a whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm transition-colors shadow-lg">
                <Twitter className="w-4 h-4" />
                Share on X
              </motion.a>
              <motion.a whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-700 hover:bg-blue-600 text-white font-semibold text-sm transition-colors shadow-lg">
                <Linkedin className="w-4 h-4" />
                Share on LinkedIn
              </motion.a>
              <motion.a whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                href={`mailto:?subject=Check out AutoTestAI&body=${encodeURIComponent(shareText + "\n\n" + shareUrl)}`}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/10 text-white font-semibold text-sm hover:border-violet-500/40 hover:bg-violet-500/5 transition-all">
                <Mail className="w-4 h-4" />
                Email a Colleague
              </motion.a>
            </div>
          </motion.div>

          {/* Stars */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}
            className="flex justify-center gap-1 mb-6">
            {[...Array(5)].map((_, i) => (
              <motion.div key={i} animate={{ scale: [1, 1.3, 1] }} transition={{ delay: 1.5 + i * 0.1, duration: 0.4 }}>
                <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
              </motion.div>
            ))}
          </motion.div>
          <p className="text-gray-600 text-sm mb-8">Joined by 2,400+ QA engineers & engineering leaders</p>

          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}
            onClick={() => setLocation("/")}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-violet-400 text-sm transition-colors group">
            <ArrowRight className="w-4 h-4 rotate-180 group-hover:-translate-x-1 transition-transform" />
            Back to landing page
          </motion.button>
        </div>
      </div>
    </div>
  );
}
