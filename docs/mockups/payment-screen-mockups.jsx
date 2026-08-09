import { useState } from "react";

const G = {
  near: "#0A0A0A", dark: "#1A1A1A", charcoal: "#2A2A2A",
  mid: "#888", soft: "#BBB", muted: "#DDD",
  border: "#E0E0E0", light: "#F2F2F2", off: "#F8F8F8", white: "#FFF",
};

function Card({ children, style = {}, dark = false, glow = false }) {
  return (
    <div style={{
      background: dark ? G.near : G.white,
      border: `1px solid ${dark ? "#333" : G.border}`,
      borderRadius: 16, padding: 28,
      boxShadow: glow ? "0 0 0 1px rgba(0,0,0,0.03), 0 8px 32px rgba(0,0,0,0.06)" : "none",
      color: dark ? G.white : G.near,
      ...style
    }}>{children}</div>
  );
}

function Btn({ children, primary, outline, full, small, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: primary ? G.near : outline ? "transparent" : G.light,
      color: primary ? G.white : G.near,
      border: outline ? `1.5px solid ${G.near}` : primary ? "none" : `1px solid ${G.border}`,
      borderRadius: 10, padding: small ? "8px 16px" : "13px 26px",
      fontSize: small ? 12 : 14, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.35 : 1,
      width: full ? "100%" : "auto",
      fontFamily: "Inter, system-ui, sans-serif",
      transition: "all 0.15s",
    }}>{children}</button>
  );
}

function Badge({ children, color = "default" }) {
  const map = {
    default: { bg: G.light, fg: G.mid },
    green: { bg: "#E8F5E9", fg: "#2E7D32" },
    amber: { bg: "#FFF8E1", fg: "#E65100" },
    red: { bg: "#FFEBEE", fg: "#C62828" },
    blue: { bg: "#E3F2FD", fg: "#1565C0" },
    dark: { bg: G.near, fg: G.white },
  };
  const c = map[color] || map.default;
  return <span style={{ background: c.bg, color: c.fg, fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20, letterSpacing: "0.03em" }}>{children}</span>;
}

function Divider() { return <div style={{ height: 1, background: G.border, margin: "20px 0" }} />; }

function Metric({ label, value, sub, dark }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, color: dark ? "rgba(255,255,255,0.45)" : G.mid, fontWeight: 500, marginBottom: 4, letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: dark ? "rgba(255,255,255,0.35)" : G.soft, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Upgrade_A() {
  const [sel, setSel] = useState("jv");
  const plans = [
    { id: "sv", name: "Self Verify", price: "Free", tag: null, desc: "You manage and approve every stage yourself.", features: ["Up to 3 projects", "1 contractor per project", "Self-approve stages", "500MB storage per project", "10% payment processing fee", "Basic budget tracking", "Document vault", "Project chat", "Evidence upload"] },
    { id: "jv", name: "Jalla Verify", price: "$199", period: "/mo", tag: "MOST POPULAR", desc: "Jalla's professionals verify every stage of your build.", features: ["Unlimited projects", "Unlimited contractors", "Jalla-verified stages", "Unlimited storage", "3% payment processing fee", "Stage completion certificates", "Weekly project reports", "Priority support", "Groundwork Community access"] },
    { id: "jm", name: "Jalla Management", price: "Custom", tag: null, desc: "Jalla manages your entire project end to end.", features: ["Everything in Jalla Verify", "Dedicated project manager", "On-site representation", "Procurement oversight", "Custom reporting", "White-glove onboarding", "Daily + weekly updates", "Construction team management", "Full verification team"] },
  ];
  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.12em", marginBottom: 6 }}>CHOOSE YOUR PLAN</div>
        <h2 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.02em" }}>Unlock the full power of Groundwork</h2>
        <p style={{ fontSize: 14, color: G.mid, maxWidth: 440, margin: "0 auto" }}>Select a plan that fits how you want to manage your construction project.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "start" }}>
        {plans.map(p => {
          const active = sel === p.id;
          const hl = p.id === "jv";
          return (
            <div key={p.id} onClick={() => setSel(p.id)} style={{ border: active ? `2px solid ${G.near}` : `1px solid ${hl ? "#444" : G.border}`, borderRadius: 16, padding: 28, cursor: "pointer", background: hl ? G.near : G.white, color: hl ? G.white : G.near, transform: active ? "translateY(-4px)" : "none", boxShadow: active ? "0 12px 40px rgba(0,0,0,0.12)" : "none", transition: "all 0.25s ease", position: "relative" }}>
              {p.tag && <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: hl ? G.white : G.near, color: hl ? G.near : G.white, fontSize: 9, fontWeight: 800, padding: "4px 14px", borderRadius: 20, letterSpacing: "0.06em" }}>{p.tag}</div>}
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
              <div style={{ marginBottom: 10 }}><span style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-0.02em" }}>{p.price}</span>{p.period && <span style={{ fontSize: 14, opacity: 0.5 }}>{p.period}</span>}</div>
              <p style={{ fontSize: 12, opacity: 0.55, marginBottom: 20, lineHeight: 1.5 }}>{p.desc}</p>
              {p.features.map((f, i) => (<div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 12, opacity: 0.75 }}><span style={{ flexShrink: 0 }}>✓</span><span>{f}</span></div>))}
              <div style={{ marginTop: 20 }}><Btn primary={hl} outline={!hl} full>{p.id === "sv" ? "Continue Free" : p.id === "jv" ? "Subscribe — $199/mo" : "Contact Us"}</Btn></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Upgrade_B() {
  const [sel, setSel] = useState("jv");
  const details = { sv: { name: "Self Verify", price: "Free", desc: "Full control. You review every stage yourself.", features: ["3 projects max", "1 contractor", "Self-approve stages", "500MB storage", "10% fee"] }, jv: { name: "Jalla Verify", price: "$199/mo", desc: "Independent verification by Jalla professionals on every stage.", features: ["Unlimited projects", "Unlimited contractors", "Jalla verifies stages", "Stage certificates", "3% fee", "Weekly reports", "Community access"] }, jm: { name: "Jalla Management", price: "Custom", desc: "Full-service. Jalla manages your entire project from start to finish.", features: ["Dedicated PM", "On-site team", "Daily updates", "Procurement", "Custom reporting"] } };
  const d = details[sel];
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <Card dark style={{ textAlign: "center", marginBottom: 24, padding: "36px 28px 28px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.4, letterSpacing: "0.12em", marginBottom: 6 }}>SELECT YOUR PLAN</div>
        <h2 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 20px", letterSpacing: "-0.02em" }}>How do you want to build?</h2>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: 3, gap: 3 }}>
          {[["sv","Self Verify"],["jv","Jalla Verify"],["jm","Management"]].map(([id,label]) => (<button key={id} onClick={() => setSel(id)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, background: sel === id ? G.white : "transparent", color: sel === id ? G.near : "rgba(255,255,255,0.5)", cursor: "pointer", transition: "all 0.2s" }}>{label}</button>))}
        </div>
      </Card>
      <Card glow style={{ textAlign: "center" }}>
        <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 4 }}>{d.price}</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{d.name}</div>
        <p style={{ fontSize: 13, color: G.mid, marginBottom: 24, lineHeight: 1.5 }}>{d.desc}</p>
        <Divider />
        <div style={{ textAlign: "left", padding: "8px 0" }}>{d.features.map((f, i) => (<div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", fontSize: 13 }}><span style={{ color: "#2E7D32", fontWeight: 700 }}>✓</span><span>{f}</span></div>))}</div>
        <div style={{ marginTop: 20 }}><Btn primary full>{sel === "sv" ? "Start Free" : sel === "jv" ? "Subscribe Now — $199/mo" : "Contact Sales"}</Btn></div>
        {sel === "jv" && <p style={{ fontSize: 10, color: G.soft, marginTop: 10 }}>Cancel anytime. Downgrade at end of billing period.</p>}
      </Card>
    </div>
  );
}

function Milestone_A() {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <Card glow>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: G.light, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 22 }}>🔓</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.1em", marginBottom: 4 }}>STAGE PAYMENT</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>Release Stage 3 Funds</h2>
          <p style={{ fontSize: 12, color: G.mid }}>Block Work & Walls — My Lagos Home</p>
        </div>
        <div style={{ background: G.off, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          {[["Stage budget","$5,000.00"],["Platform fee (10%)","$500.00"]].map(([l,v]) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 13 }}><span style={{ color: G.mid }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span></div>))}
          <div style={{ borderTop: `1px solid ${G.border}`, marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 14, fontWeight: 700 }}>You pay</span><span style={{ fontSize: 22, fontWeight: 900 }}>$5,500.00</span></div>
        </div>
        <div style={{ background: G.off, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.08em", marginBottom: 10 }}>CONTRACTOR RECEIVES</div>
          {[["Amount","$5,000.00"],["Via","MTN Mobile Money"],["In local currency","≈ 3,050,000 XAF"]].map(([l,v]) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12 }}><span style={{ color: G.mid }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span></div>))}
        </div>
        <div style={{ border: `1px solid ${G.border}`, borderRadius: 10, padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><div style={{ width: 36, height: 22, background: G.near, borderRadius: 4 }} /><div><div style={{ fontSize: 12, fontWeight: 600 }}>•••• 4242</div><div style={{ fontSize: 10, color: G.soft }}>Visa</div></div></div>
          <span style={{ fontSize: 11, color: G.mid, fontWeight: 600, cursor: "pointer" }}>Change →</span>
        </div>
        <Btn primary full>Pay $5,500.00</Btn>
        <p style={{ fontSize: 10, color: G.soft, textAlign: "center", marginTop: 12 }}>Secured by Stripe · Funds held until stage verified</p>
      </Card>
    </div>
  );
}

function Milestone_B() {
  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card dark style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <Badge color="dark">STAGE 3 OF 10</Badge>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "16px 0 6px" }}>Block Work & Walls</h2>
            <p style={{ fontSize: 12, opacity: 0.5, marginBottom: 24 }}>My Lagos Home · Cameroon</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[{icon:"→",label:"You pay",value:"$5,500",sub:"inc. 10% fee"},{icon:"↓",label:"Platform holds",value:"$5,000",sub:"in escrow"},{icon:"↓",label:"Contractor gets",value:"3.05M XAF",sub:"via MTN MoMo"}].map((s,i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{s.icon}</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 11, opacity: 0.45 }}>{s.label}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{s.value}</div></div>
                  <div style={{ fontSize: 10, opacity: 0.35, textAlign: "right" }}>{s.sub}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 28, padding: "14px 16px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.4 }}><span>Adebayo Ogunleye</span><span>+237 677 123 456</span></div>
          </div>
        </Card>
        <Card glow>
          <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.1em", marginBottom: 16 }}>PAYMENT DETAILS</div>
          {[["Stage budget","$5,000.00"],["Platform fee (10%)","$500.00"],["Stripe processing","~$160.00"]].map(([l,v],i) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, borderBottom: i < 2 ? `1px solid ${G.light}` : "none" }}><span style={{ color: G.mid }}>{l}</span><span style={{ fontWeight: i===2?400:600, color: i===2?G.soft:G.near }}>{v}</span></div>))}
          <div style={{ background: G.near, borderRadius: 10, padding: "14px 16px", margin: "16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ color: G.white, fontSize: 13, fontWeight: 600 }}>Total charge</span><span style={{ color: G.white, fontSize: 24, fontWeight: 900 }}>$5,500</span></div>
          <div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, color: G.mid, marginBottom: 6 }}>Pay with</div><div style={{ border: `1px solid ${G.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><div style={{ width: 32, height: 20, background: G.near, borderRadius: 3 }} /><span style={{ fontSize: 12 }}>•••• 4242</span></div><span style={{ fontSize: 11, color: G.mid }}>Change</span></div></div>
          <Btn primary full>Confirm Payment</Btn>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 14 }}>{["Encrypted","Instant","Refundable"].map(t => (<span key={t} style={{ fontSize: 10, color: G.soft, display: "flex", gap: 4, alignItems: "center" }}>✓ {t}</span>))}</div>
        </Card>
      </div>
    </div>
  );
}

function History_A() {
  const payments = [{stage:"Stage 1: Land Acquisition",date:"Jul 5",amount:"$2,750",fee:"$275",to:"Adebayo O.",status:"paid"},{stage:"Stage 2: Foundation",date:"Jul 12",amount:"$5,500",fee:"$550",to:"Adebayo O.",status:"paid"},{stage:"Stage 3: Block Work",date:"Jul 19",amount:"$5,500",fee:"$500",to:"Adebayo O.",status:"processing"},{stage:"Stage 4: Decking",date:"—",amount:"$8,250",fee:"—",to:"—",status:"locked"},{stage:"Stage 5: Roofing",date:"—",amount:"$5,312",fee:"—",to:"—",status:"locked"}];
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}><div><h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>Payment History</h2><p style={{ fontSize: 13, color: G.mid }}>My Lagos Home · 5 stages</p></div><Btn outline small>Export CSV</Btn></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        {[{label:"Total Paid",value:"$13,750"},{label:"In Transit",value:"$5,500",hl:true},{label:"Fees Collected",value:"$1,325"},{label:"Remaining",value:"$23,450"}].map(m => (<Card key={m.label} style={{ padding: 16, ...(m.hl ? {background:"#E3F2FD",border:"1px solid #BBDEFB"} : {}) }}><div style={{ fontSize: 10, color: G.mid, fontWeight: 600, marginBottom: 4, letterSpacing: "0.04em" }}>{m.label}</div><div style={{ fontSize: 22, fontWeight: 800 }}>{m.value}</div></Card>))}
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ background: G.off }}>{["Stage","Date","Amount","Fee","Contractor","Status"].map(h => (<th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.04em" }}>{h}</th>))}</tr></thead>
        <tbody>{payments.map((p,i) => (<tr key={i} style={{ borderTop: `1px solid ${G.light}` }}><td style={{ padding: "12px 14px", fontWeight: 500 }}>{p.stage}</td><td style={{ padding: "12px 14px", color: G.mid }}>{p.date}</td><td style={{ padding: "12px 14px", fontWeight: 700 }}>{p.amount}</td><td style={{ padding: "12px 14px", color: G.soft }}>{p.fee}</td><td style={{ padding: "12px 14px" }}>{p.to}</td><td style={{ padding: "12px 14px" }}><Badge color={p.status==="paid"?"green":p.status==="processing"?"blue":"default"}>{p.status==="paid"?"Paid ✓":p.status==="processing"?"In Transit":"Locked"}</Badge></td></tr>))}</tbody></table>
      </Card>
    </div>
  );
}

function History_B() {
  const items = [{stage:3,name:"Block Work & Walls",date:"Jul 19, 2026",amount:"$5,500",fee:"$500",to:"Adebayo O.",method:"MTN MoMo",status:"processing"},{stage:2,name:"Foundation",date:"Jul 12, 2026",amount:"$5,500",fee:"$550",to:"Adebayo O.",method:"MTN MoMo",status:"paid"},{stage:1,name:"Land Acquisition",date:"Jul 5, 2026",amount:"$2,750",fee:"$275",to:"Adebayo O.",method:"MTN MoMo",status:"paid"}];
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}><h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>Payments</h2><p style={{ fontSize: 13, color: G.mid }}>My Lagos Home</p></div>
      <Card dark style={{ display: "flex", gap: 0, marginBottom: 24, padding: "20px 24px" }}><Metric label="TOTAL PAID" value="$13,750" sub="3 of 10 stages" dark /><div style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "0 20px" }} /><Metric label="REMAINING" value="$28,750" sub="7 stages locked" dark /></Card>
      <div style={{ position: "relative", paddingLeft: 24 }}>
        <div style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 2, background: G.border }} />
        {items.map((p,i) => (<div key={i} style={{ position: "relative", marginBottom: 16 }}><div style={{ position: "absolute", left: -20, top: 14, width: 16, height: 16, borderRadius: "50%", background: p.status==="paid"?"#2E7D32":"#1565C0", border: "3px solid white", boxShadow: "0 0 0 1px "+G.border }} /><Card glow style={{ padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}><div><Badge color={p.status==="paid"?"green":"blue"}>{p.status==="paid"?"Paid":"In Transit"}</Badge><div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>Stage {p.stage}: {p.name}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 800 }}>{p.amount}</div><div style={{ fontSize: 10, color: G.soft }}>fee: {p.fee}</div></div></div><div style={{ display: "flex", gap: 16, fontSize: 11, color: G.mid }}><span>{p.date}</span><span>→ {p.to}</span><span>{p.method}</span></div></Card></div>))}
      </div>
    </div>
  );
}

function Payout_A() {
  const steps = [{time:"2:14 PM",label:"Client payment received",detail:"$5,500.00 via Stripe (Visa •••• 4242)",done:true},{time:"2:14 PM",label:"Platform fee deducted",detail:"$500.00 (10% Self Verify fee)",done:true},{time:"2:15 PM",label:"Payout initiated",detail:"$5,000.00 → Adebayo Ogunleye via MTN MoMo",done:true},{time:"2:16 PM",label:"Converting to local currency",detail:"$5,000 → 3,050,000 XAF at 1 USD = 610 XAF",done:true},{time:"2:18 PM",label:"Funds delivered",detail:"3,050,000 XAF to +237 677 123 456",done:true}];
  return (
    <div style={{ maxWidth: 500, margin: "0 auto" }}>
      <Card glow>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}><div><div style={{ fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.1em", marginBottom: 4 }}>CONTRACTOR PAYOUT</div><h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>Stage 2: Foundation</h2><p style={{ fontSize: 12, color: G.mid }}>Adebayo Ogunleye · Jul 12, 2026</p></div><Badge color="green">Complete</Badge></div>
        <div style={{ paddingLeft: 16, borderLeft: `2px solid ${G.border}` }}>{steps.map((s,i) => (<div key={i} style={{ position: "relative", paddingBottom: i<steps.length-1?24:0, paddingLeft: 20 }}><div style={{ position: "absolute", left: -23, top: 3, width: 12, height: 12, borderRadius: "50%", background: s.done?G.near:G.border, border: "2px solid white" }} /><div style={{ fontSize: 10, color: G.soft }}>{s.time}</div><div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{s.label}</div><div style={{ fontSize: 11, color: G.mid, marginTop: 2 }}>{s.detail}</div></div>))}</div>
        <Divider /><Btn outline full>Download Receipt</Btn>
      </Card>
    </div>
  );
}

function Payout_B() {
  const nodes = [{label:"Received",sub:"$5,500",done:true},{label:"Fee Split",sub:"−$500",done:true},{label:"Payout Sent",sub:"$5,000",done:true},{label:"Converting",sub:"→ XAF",done:true},{label:"Delivered",sub:"3.05M XAF",done:true}];
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <Card dark style={{ marginBottom: 16, padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}><div><div style={{ fontSize: 10, opacity: 0.4, fontWeight: 700, letterSpacing: "0.1em" }}>PAYOUT TRACKER</div><h2 style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>Stage 2: Foundation</h2></div><Badge color="green">Delivered</Badge></div>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>{nodes.map((n,i) => (<div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}><div style={{ textAlign: "center", flex: "0 0 auto" }}><div style={{ width: 36, height: 36, borderRadius: "50%", background: n.done?G.white:"rgba(255,255,255,0.1)", color: n.done?G.near:"rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, margin: "0 auto 6px" }}>{n.done?"✓":i+1}</div><div style={{ fontSize: 10, fontWeight: 600, opacity: n.done?1:0.3 }}>{n.label}</div><div style={{ fontSize: 10, opacity: 0.4, marginTop: 2 }}>{n.sub}</div></div>{i<nodes.length-1 && <div style={{ flex: 1, height: 2, background: n.done?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.05)", margin: "0 4px", marginBottom: 24 }} />}</div>))}</div>
      </Card>
      <Card glow>
        <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.08em", marginBottom: 12 }}>DETAILS</div>
        {[["Contractor","Adebayo Ogunleye"],["Phone","+237 677 123 456"],["Method","MTN Mobile Money"],["Amount sent","$5,000.00 USD"],["Amount received","3,050,000 XAF"],["Exchange rate","1 USD = 610 XAF"],["Date","Jul 12, 2026, 2:18 PM"]].map(([l,v]) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 12, borderBottom: `1px solid ${G.light}` }}><span style={{ color: G.mid }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span></div>))}
        <div style={{ marginTop: 16 }}><Btn outline full small>Download Receipt</Btn></div>
      </Card>
    </div>
  );
}

function Wallet_A() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}><h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>Project Wallet</h2><p style={{ fontSize: 13, color: G.mid }}>My Lagos Home — funds held in escrow</p></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        <Card dark style={{ padding: 18 }}><div style={{ fontSize: 10, opacity: 0.4, fontWeight: 600, marginBottom: 4 }}>DEPOSITED</div><div style={{ fontSize: 24, fontWeight: 900 }}>$42,500</div></Card>
        <Card style={{ padding: 18, background: "#E8F5E9", border: "1px solid #C8E6C9" }}><div style={{ fontSize: 10, color: "#2E7D32", fontWeight: 600, marginBottom: 4 }}>RELEASED</div><div style={{ fontSize: 24, fontWeight: 900, color: "#2E7D32" }}>$13,750</div></Card>
        <Card style={{ padding: 18 }}><div style={{ fontSize: 10, color: G.mid, fontWeight: 600, marginBottom: 4 }}>IN ESCROW</div><div style={{ fontSize: 24, fontWeight: 900 }}>$28,750</div></Card>
      </div>
      <div style={{ background: G.off, borderRadius: 12, height: 8, marginBottom: 24, overflow: "hidden" }}><div style={{ height: "100%", width: "32.4%", background: "#2E7D32", borderRadius: 12 }} /></div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", background: G.off, borderBottom: `1px solid ${G.border}`, fontSize: 10, fontWeight: 700, color: G.mid, letterSpacing: "0.06em" }}>FUND MOVEMENTS</div>
        {[{label:"Initial deposit",amount:"+$42,500",date:"Jul 1",badge:"Deposit",color:"green"},{label:"Stage 1: Land Acquisition",amount:"−$2,750",date:"Jul 5",badge:"Released",color:"default"},{label:"Stage 2: Foundation",amount:"−$5,500",date:"Jul 12",badge:"Released",color:"default"},{label:"Stage 3: Block Work",amount:"−$5,500",date:"Jul 19",badge:"In Transit",color:"blue"},{label:"Stage 4: Decking",amount:"$8,250",date:"—",badge:"Held",color:"amber"}].map((m,i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${G.light}` }}><div><div style={{ fontSize: 13, fontWeight: 500 }}>{m.label}</div><div style={{ fontSize: 10, color: G.soft }}>{m.date}</div></div><div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 13, fontWeight: 700, color: m.amount.startsWith("+")?"#2E7D32":G.near }}>{m.amount}</span><Badge color={m.color}>{m.badge}</Badge></div></div>))}
      </Card>
    </div>
  );
}

function Wallet_B() {
  const stages = [{n:1,name:"Land",pct:5,status:"released"},{n:2,name:"Foundation",pct:10,status:"released"},{n:3,name:"Block Work",pct:15,status:"transit"},{n:4,name:"Decking",pct:10,status:"held"},{n:5,name:"Roofing",pct:12.5,status:"locked"},{n:6,name:"Plaster",pct:8,status:"locked"},{n:7,name:"MEP",pct:12,status:"locked"},{n:8,name:"Finishing",pct:15,status:"locked"},{n:9,name:"External",pct:7.5,status:"locked"},{n:10,name:"Handover",pct:5,status:"locked"}];
  const colors = {released:"#2E7D32",transit:"#1565C0",held:"#E65100",locked:G.border};
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <Card dark style={{ textAlign: "center", padding: "32px 28px", marginBottom: 20 }}>
        <div style={{ fontSize: 10, opacity: 0.4, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 4 }}>PROJECT ESCROW</div>
        <div style={{ fontSize: 40, fontWeight: 900, marginBottom: 4 }}>$28,750</div>
        <div style={{ fontSize: 13, opacity: 0.45 }}>held securely · 7 stages remaining</div>
        <div style={{ display: "flex", gap: 2, marginTop: 20, borderRadius: 6, overflow: "hidden" }}>{stages.map(s => (<div key={s.n} style={{ height: 6, flex: s.pct, background: colors[s.status], transition: "all 0.3s" }} title={`Stage ${s.n}: ${s.name}`} />))}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 12, fontSize: 10 }}>{[["Released","#2E7D32"],["In Transit","#1565C0"],["Held","#E65100"],["Locked","#666"]].map(([l,c]) => (<span key={l} style={{ display: "flex", alignItems: "center", gap: 4, opacity: 0.6 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: c, display: "inline-block" }} />{l}</span>))}</div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <Card style={{ padding: 16 }}><div style={{ fontSize: 10, color: G.mid, fontWeight: 600, marginBottom: 2 }}>TOTAL PROJECT</div><div style={{ fontSize: 22, fontWeight: 800 }}>$42,500</div></Card>
        <Card style={{ padding: 16, background: "#E8F5E9", border: "1px solid #C8E6C9" }}><div style={{ fontSize: 10, color: "#2E7D32", fontWeight: 600, marginBottom: 2 }}>RELEASED</div><div style={{ fontSize: 22, fontWeight: 800, color: "#2E7D32" }}>$13,750</div><div style={{ fontSize: 10, color: "#2E7D32", opacity: 0.6, marginTop: 2 }}>32.4% of total</div></Card>
      </div>
      <Card glow style={{ padding: 0, overflow: "hidden" }}>
        {stages.map((s,i) => (<div key={s.n} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: i<9?`1px solid ${G.light}`:"none" }}><div style={{ width: 28, height: 28, borderRadius: "50%", background: s.status==="released"?"#2E7D32":s.status==="transit"?"#1565C0":s.status==="held"?G.off:G.light, color: s.status==="released"||s.status==="transit"?G.white:G.mid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{s.status==="released"?"✓":s.n}</div><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 500, color: s.status==="locked"?G.mid:G.near }}>{s.name}</div></div><div style={{ fontSize: 12, fontWeight: 600, color: s.status==="locked"?G.soft:G.near }}>${(42500*s.pct/100).toLocaleString()}</div><div style={{ width: 60, textAlign: "right" }}><Badge color={s.status==="released"?"green":s.status==="transit"?"blue":s.status==="held"?"amber":"default"}>{s.status==="released"?"Released":s.status==="transit"?"Transit":s.status==="held"?"Held":"Locked"}</Badge></div></div>))}
      </Card>
      <p style={{ fontSize: 10, color: G.soft, textAlign: "center", marginTop: 14 }}>Funds held by SwyChr / pawaPay · Released only on verified stage completion</p>
    </div>
  );
}

export default function PaymentMockups() {
  const [screen, setScreen] = useState("upgrade");
  const [variant, setVariant] = useState("A");
  const screens = [{id:"upgrade",label:"Upgrade Plan"},{id:"milestone",label:"Milestone Pay"},{id:"history",label:"Payment History"},{id:"payout",label:"Payout Status"},{id:"wallet",label:"Escrow Wallet"}];
  const components = {upgrade:{A:Upgrade_A,B:Upgrade_B},milestone:{A:Milestone_A,B:Milestone_B},history:{A:History_A,B:History_B},payout:{A:Payout_A,B:Payout_B},wallet:{A:Wallet_A,B:Wallet_B}};
  const Comp = components[screen][variant];
  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: G.off, minHeight: "100vh", color: G.near }}>
      <div style={{ background: G.near, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ color: G.white, fontWeight: 800, fontSize: 15 }}>Groundwork</span><span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>by Jalla</span></div><span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 600 }}>Payment Screens — For Philip's Review</span></div>
      <div style={{ display: "flex", justifyContent: "center", gap: 3, padding: "12px 16px", borderBottom: `1px solid ${G.border}`, background: G.white, flexWrap: "wrap" }}>{screens.map(s => (<button key={s.id} onClick={() => {setScreen(s.id);setVariant("A");}} style={{ background: screen===s.id?G.near:"transparent", color: screen===s.id?G.white:G.mid, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}>{s.label}</button>))}</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "10px 16px", background: G.white, borderBottom: `1px solid ${G.border}` }}>{["A","B"].map(v => (<button key={v} onClick={() => setVariant(v)} style={{ background: variant===v?G.near:G.light, color: variant===v?G.white:G.mid, border: "none", borderRadius: 6, padding: "6px 20px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Design {v}</button>))}<span style={{ fontSize: 10, color: G.soft, alignSelf: "center", marginLeft: 8 }}>{variant==="A"?"Classic / structured":"Visual-forward / immersive"}</span></div>
      <div style={{ padding: "32px 20px", maxWidth: 960, margin: "0 auto" }}><Comp /></div>
    </div>
  );
}
