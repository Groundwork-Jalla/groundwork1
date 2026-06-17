export function CreateProjectSlide() {
  const dots = Array.from({ length: 8 }, (_, i) => i < 3);
  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey p-6 w-full max-w-[360px] shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="flex gap-1.5 mb-5">
        {dots.map((filled, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${filled ? "bg-brand-near-black" : "bg-brand-border-grey"}`}
          />
        ))}
      </div>
      <h4 className="text-sm font-semibold text-brand-near-black mb-4">What type of building?</h4>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {[
          { icon: "🏠", label: "House", selected: true },
          { icon: "🏘", label: "Duplex", selected: false },
          { icon: "🏢", label: "Apartment", selected: false },
        ].map((opt) => (
          <div
            key={opt.label}
            className={`rounded-lg border p-3 text-center ${
              opt.selected ? "border-brand-near-black bg-brand-near-black text-white" : "border-brand-border-grey text-brand-mid-grey"
            }`}
          >
            <div className="text-lg">{opt.icon}</div>
            <div className="text-[10px] mt-1">{opt.label}</div>
          </div>
        ))}
      </div>
      <div className="bg-brand-near-black text-white text-center text-xs font-semibold rounded-lg py-2.5">
        Continue
      </div>
    </div>
  );
}

export function UploadProofSlide() {
  return (
    <div className="relative w-[200px] mx-auto">
      <div className="rounded-[28px] border-[6px] border-brand-near-black bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.1)]">
        <div className="h-2 w-12 bg-brand-near-black rounded-full mx-auto mb-3" />
        <div className="bg-brand-pale rounded-lg h-24 flex items-center justify-center text-2xl mb-3">📷</div>
        <div className="flex items-center justify-between bg-brand-off-white rounded-md px-2 py-1.5 mb-2">
          <span className="text-[10px] text-brand-near-black">Excavation</span>
          <span className="text-[10px] text-brand-near-black">✓</span>
        </div>
        <div className="flex items-center justify-between bg-white border border-brand-border-grey rounded-md px-2 py-1.5">
          <span className="text-[10px] font-semibold text-brand-near-black">Blinding</span>
          <span className="text-[10px] text-brand-mid-grey">●</span>
        </div>
      </div>
      <div className="mt-4 text-center text-[11px] text-brand-mid-grey">👷 Contractor, On Site</div>
    </div>
  );
}

export function VerifySlide() {
  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey w-full max-w-[340px] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="bg-brand-near-black text-white text-center text-xs font-semibold py-3 tracking-widest">
        JALLA VERIFIED
      </div>
      <div className="p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-near-black text-white text-xl">
          ✓
        </div>
        <p className="text-sm font-semibold text-brand-near-black">Stage 3 — Foundation</p>
        <p className="text-[11px] text-brand-mid-grey mt-1">Verified on site, 14 Jun 2026</p>
        <div className="grid grid-cols-5 gap-0.5 w-20 mx-auto mt-4">
          {Array.from({ length: 25 }, (_, i) => (
            <span key={i} className={`h-3 w-3 ${(i * 7) % 5 < 2 ? "bg-brand-near-black" : "bg-white"}`} />
          ))}
        </div>
        <p className="text-[10px] text-brand-mid-grey mt-3 tracking-wider">TOKEN #JLA-48213</p>
      </div>
    </div>
  );
}

export function PaymentSlide() {
  const stages = [true, true, true, false, false];
  return (
    <div className="w-full max-w-[360px]">
      <div className="flex items-center justify-between mb-4">
        {stages.map((released, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm ${
                released ? "bg-brand-near-black text-white" : "bg-brand-light-grey text-brand-mid-grey border border-brand-border-grey"
              }`}
            >
              {released ? "✓" : "🔒"}
            </div>
            <span className="text-[9px] text-brand-mid-grey">{released ? "RELEASED" : "HELD"}</span>
          </div>
        ))}
      </div>
      <div className="bg-brand-near-black rounded-xl p-4 text-center">
        <p className="text-xs font-semibold text-white">No Proof = No Payment</p>
      </div>
    </div>
  );
}
