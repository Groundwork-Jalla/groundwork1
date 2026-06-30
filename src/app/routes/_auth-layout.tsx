import { Outlet } from "react-router";
import { motion } from "framer-motion";

export default function AuthLayout() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="bg-brand-near-black text-white flex md:flex-col items-center justify-center md:justify-center px-6 py-5 md:py-0 md:w-[42%] md:min-h-screen">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex items-baseline gap-2 md:flex-col md:items-center md:gap-3 md:text-center"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-xl md:text-3xl font-semibold">Jalla</span>
            <span className="text-[9px] md:text-[10px] text-white/40 tracking-[0.12em]">THE FIRM</span>
          </div>
          <p className="hidden md:block text-sm text-white/50 italic mt-2 max-w-[260px]">
            Protect your build. From anywhere.
          </p>
        </motion.div>
      </div>

      <div className="flex-1 bg-white flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
          className="w-full max-w-[400px]"
        >
          <Outlet />
        </motion.div>
      </div>
    </div>
  );
}
