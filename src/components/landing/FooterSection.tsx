export default function FooterSection() {
  return (
    <footer className="border-t border-brand-border-grey py-7 text-center">
      <div className="flex items-baseline justify-center gap-2">
        <span className="font-['Playfair_Display'] text-[15px] font-semibold text-brand-near-black">Jalla</span>
        <span className="text-[8px] text-brand-mid-grey tracking-[0.12em]">THE FIRM</span>
      </div>
      <p className="text-[11px] text-[#888888] mt-2">© {new Date().getFullYear()} Jalla. All rights reserved.</p>
    </footer>
  );
}
