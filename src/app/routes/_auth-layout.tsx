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
          className="flex flex-col items-center text-center"
        >
          <div className="flex flex-col leading-none items-center">
            <span className="font-sans text-2xl md:text-3xl font-black text-white tracking-tight">Groundwork</span>
            <span className="text-[11px] text-white/40 font-normal mt-1">by Jalla</span>
          </div>
          <p className="hidden md:block text-sm text-white/50 italic mt-4 max-w-[260px]">
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
