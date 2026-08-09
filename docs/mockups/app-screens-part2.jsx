import { useState } from "react";

const G = { near: "#0A0A0A", mid: "#888", soft: "#BBB", border: "#E0E0E0", light: "#F2F2F2", off: "#F8F8F8", white: "#FFF" };

function Card({ children, style = {}, dark = false, glow = false }) {
  return (<div style={{ background: dark ? G.near : G.white, border: "1px solid " + (dark ? "#333" : G.border), borderRadius: 14, padding: 22, boxShadow: glow ? "0 4px 20px rgba(0,0,0,0.05)" : "none", color: dark ? G.white : G.near, ...style }}>{children}</div>);
}
function Btn({ children, primary, outline, small, full, danger, onClick }) {
  return (<button onClick={onClick} style={{ background: primary ? G.near : danger ? "#C62828" : outline ? "transparent" : G.light, color: primary || danger ? G.white : G.near, border: outline ? "1.5px solid " + G.near : "none", borderRadius: 8, padding: small ? "6px 12px" : "10px 20px", fontSize: small ? 11 : 13, fontWeight: 600, cursor: "pointer", width: full ? "100%" : "auto", fontFamily: "Inter,system-ui,sans-serif" }}>{children}</button>);
}
function Badge({ children, color = "default" }) {
  const m = { default: [G.light, G.mid], green: ["#E8F5E9", "#2E7D32"], blue: ["#E3F2FD", "#1565C0"], amber: ["#FFF8E1", "#E65100"], dark: [G.near, G.white], purple: ["#F3E5F5", "#7B1FA2"] };
  const c = m[color] || m.default;
  return (<span style={{ background: c[0], color: c[1], fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 14 }}>{children}</span>);
}
function PBar({ pct, color = G.near, h = 5 }) {
  return (<div style={{ background: G.light, borderRadius: h, height: h, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: color, borderRadius: h }} /></div>);
}
function Toggle({ on, label }) {
  return (<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid " + G.light }}><span style={{ fontSize: 11 }}>{label}</span><div style={{ width: 34, height: 18, borderRadius: 9, background: on ? G.near : G.border, padding: 2, cursor: "pointer" }}><div style={{ width: 14, height: 14, borderRadius: "50%", background: G.white, transform: on ? "translateX(16px)" : "translateX(0)", transition: "0.2s" }} /></div></div>);
}

const NAV = ["Dashboard", "My Projects", "Documents", "Resources", "Contractors", "Payments", "Notifications", "Settings"];
const ICONS = ["\u229E", "\uD83C\uDFD7", "\uD83D\uDCC4", "\uD83D\uDCDA", "\uD83D\uDC77", "\uD83D\uDCB0", "\uD83D\uDD14", "\u2699"];

function Shell({ children, active = "Settings", title = "Page" }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter,system-ui,sans-serif", color: G.near, background: G.off }}>
      <div style={{ width: 210, background: G.white, borderRight: "1px solid " + G.border, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid " + G.border }}><div style={{ fontSize: 15, fontWeight: 800 }}>Groundwork</div><div style={{ fontSize: 9, color: G.soft }}>by Jalla</div></div>
        <div style={{ flex: 1, padding: "10px 8px" }}>
          {NAV.map((n, i) => (<div key={n} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 7, marginBottom: 1, background: active === n ? G.near : "transparent", color: active === n ? G.white : G.mid, fontSize: 12, fontWeight: active === n ? 600 : 500, cursor: "pointer" }}><span style={{ fontSize: 13 }}>{ICONS[i]}</span>{n}</div>))}
        </div>
        <div style={{ padding: "12px 14px", borderTop: "1px solid " + G.border, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: G.near, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>FN</div>
          <div><div style={{ fontSize: 10, fontWeight: 600 }}>Favour N.</div><div style={{ fontSize: 8, color: G.soft }}>Self Verify</div></div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 48, background: G.white, borderBottom: "1px solid " + G.border, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span>{"\u2600"}</span><span>{"\uD83D\uDD14"}</span><div style={{ width: 26, height: 26, borderRadius: "50%", background: G.near, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>FN</div></div>
        </div>
        <div style={{ flex: 1, padding: "22px 26px", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

function Settings_A() {
  const [tab, setTab] = useState("profile");
  return (
    <Shell active="Settings" title="Settings">
      <div style={{ maxWidth: 600 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: G.near, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700 }}>FN</div>
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>Favour Nwachukwu</div><div style={{ fontSize: 10, color: G.mid }}>favour@example.com</div></div>
        </div>
        <div style={{ display: "flex", gap: 1, marginBottom: 18, borderBottom: "1px solid " + G.border }}>
          {["Profile", "Account", "Notifications", "Subscription", "Danger"].map((t) => (<button key={t} onClick={() => setTab(t.toLowerCase())} style={{ background: "transparent", color: tab === t.toLowerCase() ? (t === "Danger" ? "#C62828" : G.near) : G.mid, border: "none", borderBottom: tab === t.toLowerCase() ? "2px solid " + (t === "Danger" ? "#C62828" : G.near) : "2px solid transparent", padding: "7px 12px", fontSize: 11, fontWeight: tab === t.toLowerCase() ? 700 : 500, cursor: "pointer" }}>{t}</button>))}
        </div>
        {tab === "profile" && (<div>
          <Card style={{ padding: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1 }}><div style={{ fontSize: 10, fontWeight: 600 }}>Profile 75% complete</div><PBar pct={75} /></div><span style={{ fontSize: 9, color: G.mid }}>Upload ID to finish</span></Card>
          {[["Display Name", "Favour Nwachukwu"], ["Phone", "+234 801 234 5678"], ["Country", "Nigeria"]].map(([l, v]) => (<div key={l} style={{ marginBottom: 12 }}><label style={{ fontSize: 10, fontWeight: 600, color: G.mid, display: "block", marginBottom: 3 }}>{l}</label><input defaultValue={v} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid " + G.border, fontSize: 12, fontFamily: "Inter,system-ui,sans-serif" }} /></div>))}
          <Card style={{ padding: 14, textAlign: "center", border: "1px dashed " + G.border, marginTop: 14 }}><div style={{ fontSize: 20, marginBottom: 4 }}>{"\uD83E\uDEAA"}</div><div style={{ fontSize: 11, fontWeight: 600 }}>Upload Government ID</div><div style={{ fontSize: 9, color: G.mid, marginTop: 2 }}>Passport, National ID, or Licence - Max 5MB</div><div style={{ marginTop: 8 }}><Btn outline small>Upload ID</Btn></div></Card>
          <div style={{ marginTop: 14 }}><Btn primary full>Save Changes</Btn></div>
        </div>)}
        {tab === "account" && (<div>
          <Card style={{ padding: 14, marginBottom: 10 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 12, fontWeight: 600 }}>Password</div><div style={{ fontSize: 9, color: G.mid }}>Reset via email</div></div><Btn outline small>Reset</Btn></div></Card>
          <Card style={{ padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 12, fontWeight: 600 }}>Two-Factor Auth</div><div style={{ fontSize: 9, color: G.mid }}>Extra security</div></div><Badge>Coming Soon</Badge></div></Card>
        </div>)}
        {tab === "notifications" && (<div>
          <Toggle on={true} label="Stage approvals and rejections" />
          <Toggle on={true} label="Evidence uploads" />
          <Toggle on={true} label="Project messages" />
          <Toggle on={false} label="Payment milestones" />
          <Toggle on={false} label="Product updates" />
        </div>)}
        {tab === "subscription" && (<div>
          <Card style={{ padding: 14, marginBottom: 14, borderLeft: "3px solid " + G.near }}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontSize: 13, fontWeight: 700 }}>Self Verify</div><div style={{ fontSize: 10, color: G.mid }}>Free - 10% fee</div></div><Badge>Current</Badge></div></Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Card glow style={{ padding: 14 }}><div style={{ fontSize: 13, fontWeight: 700 }}>Jalla Verify</div><div style={{ fontSize: 18, fontWeight: 900 }}>$199<span style={{ fontSize: 10, fontWeight: 400, color: G.mid }}>/mo</span></div><div style={{ marginTop: 8 }}><Btn primary full small>Upgrade</Btn></div></Card>
            <Card glow style={{ padding: 14 }}><div style={{ fontSize: 13, fontWeight: 700 }}>Management</div><div style={{ fontSize: 18, fontWeight: 900 }}>Custom</div><div style={{ marginTop: 8 }}><Btn outline full small>Contact</Btn></div></Card>
          </div>
        </div>)}
        {tab === "danger" && (<div>
          <Card style={{ padding: 14, marginBottom: 10, borderLeft: "3px solid #E65100" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 12, fontWeight: 600 }}>Export Data</div><div style={{ fontSize: 9, color: G.mid }}>Download everything</div></div><Btn outline small>Export</Btn></div></Card>
          <Card style={{ padding: 14, borderLeft: "3px solid #C62828" }}><div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>Delete Account</div><div style={{ fontSize: 9, color: G.mid, marginBottom: 8 }}>Permanent. Cannot be undone.</div><input placeholder='Type "DELETE" to confirm' style={{ width: "100%", padding: "7px 10px", borderRadius: 5, border: "1px solid #FFCDD2", fontSize: 11, marginBottom: 8 }} /><Btn danger small>Delete Account</Btn></Card>
        </div>)}
      </div>
    </Shell>
  );
}

function Settings_B() {
  return (
    <Shell active="Settings" title="Settings">
      <div style={{ maxWidth: 500, margin: "0 auto" }}>
        <Card dark style={{ padding: 22, marginBottom: 18, textAlign: "center" }}>
          <div style={{ width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.1)", color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, margin: "0 auto 8px" }}>FN</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Favour Nwachukwu</div>
          <div style={{ fontSize: 10, opacity: 0.45, marginTop: 2 }}>favour@example.com - Self Verify</div>
          <div style={{ marginTop: 8 }}><PBar pct={75} color="#fff" h={3} /></div>
          <div style={{ fontSize: 8, opacity: 0.3, marginTop: 3 }}>75% complete</div>
        </Card>
        {[{ ic: "\uD83D\uDC64", t: "Profile", s: "Name, phone, country, ID" }, { ic: "\uD83D\uDD10", t: "Security", s: "Password, email, 2FA" }, { ic: "\uD83D\uDD14", t: "Notifications", s: "Email and in-app prefs" }, { ic: "\uD83D\uDCB3", t: "Subscription", s: "Self Verify (Free)" }, { ic: "\u26A0", t: "Danger Zone", s: "Export or delete", d: true }].map((s) => (
          <Card key={s.t} glow style={{ padding: 12, marginBottom: 6, display: "flex", gap: 10, alignItems: "center", cursor: "pointer", borderLeft: s.d ? "3px solid #C62828" : undefined }}>
            <div style={{ fontSize: 18 }}>{s.ic}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: s.d ? "#C62828" : G.near }}>{s.t}</div><div style={{ fontSize: 9, color: G.mid }}>{s.s}</div></div>
            <span style={{ fontSize: 12, color: G.mid }}>{"\u2192"}</span>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

function Contractors_A() {
  const cs = [{ name: "Adebayo Ogunleye", trade: "General Contractor", loc: "Lagos, Nigeria", r: 4.8, exp: 12 }, { name: "Emmanuel Tchinda", trade: "Structural Engineer", loc: "Douala, Cameroon", r: 4.6, exp: 8 }, { name: "Grace Mensah", trade: "Land Surveyor", loc: "Accra, Ghana", r: 4.9, exp: 15 }, { name: "Fatima Bello", trade: "Architect", loc: "Abuja, Nigeria", r: 4.7, exp: 10 }];
  return (
    <Shell active="Contractors" title="Contractors">
      <div style={{ marginBottom: 14 }}><h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Contractor Directory</h2><p style={{ fontSize: 11, color: G.mid }}>Verified professionals</p></div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {["All", "Contractor", "Engineer", "Surveyor", "Architect"].map((l) => <button key={l} style={{ background: l === "All" ? G.near : G.white, color: l === "All" ? G.white : G.mid, border: "1px solid " + (l === "All" ? G.near : G.border), borderRadius: 5, padding: "4px 10px", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>{l}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {cs.map((c) => (
          <Card key={c.name} glow style={{ padding: 16, cursor: "pointer" }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: G.light, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.name.split(" ").map((w) => w[0]).join("")}</div>
              <div><div style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</span><Badge color="green">Verified</Badge></div><div style={{ fontSize: 10, color: G.mid }}>{c.trade} - {c.loc}</div></div>
            </div>
            <div style={{ fontSize: 10, color: G.mid, marginBottom: 8 }}>{"\u2B50"} {c.r} - {c.exp} yrs</div>
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ flex: 1, padding: 5, borderRadius: 5, background: G.light, textAlign: "center", fontSize: 9, color: G.mid, filter: "blur(3px)", pointerEvents: "none" }}>+234 801 ***</div>
              <div style={{ flex: 1, padding: 5, borderRadius: 5, background: G.light, textAlign: "center", fontSize: 9, color: G.mid, filter: "blur(3px)", pointerEvents: "none" }}>email@***</div>
            </div>
            <div style={{ marginTop: 5, textAlign: "center" }}><Badge color="dark">{"\uD83D\uDD12"} Unlock with Jalla Verify</Badge></div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

function Contractors_B() {
  const cs = [{ name: "Adebayo Ogunleye", trade: "General Contractor", loc: "Lagos, Nigeria", r: 4.8, exp: 12 }, { name: "Emmanuel Tchinda", trade: "Engineer", loc: "Douala, Cameroon", r: 4.6, exp: 8 }, { name: "Grace Mensah", trade: "Surveyor", loc: "Accra, Ghana", r: 4.9, exp: 15 }, { name: "Fatima Bello", trade: "Architect", loc: "Abuja, Nigeria", r: 4.7, exp: 10 }];
  return (
    <Shell active="Contractors" title="Contractors">
      <div style={{ maxWidth: 560 }}>
        <div style={{ marginBottom: 14 }}><h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Find a Professional</h2></div>
        <input placeholder="Search by name, trade, or location..." style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid " + G.border, fontSize: 11, marginBottom: 14, fontFamily: "Inter,system-ui,sans-serif" }} />
        {cs.map((c) => (
          <Card key={c.name} style={{ padding: 12, marginBottom: 6, display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: G.near, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{c.name.split(" ").map((w) => w[0]).join("")}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</span><Badge color="green">{"\u2713"}</Badge></div>
              <div style={{ fontSize: 10, color: G.mid }}>{c.trade} - {c.loc}</div>
              <div style={{ fontSize: 9, color: G.soft }}>{"\u2B50"} {c.r} - {c.exp} yrs</div>
            </div>
            <Btn outline small>View</Btn>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

function PreTracking_A() {
  return (
    <Shell active="My Projects" title="My Lagos Home \u203A Start Tracking">
      <div style={{ maxWidth: 500, margin: "0 auto" }}>
        <Card glow>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: G.light, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontSize: 20 }}>{"\uD83D\uDCCB"}</div>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 3px" }}>Before You Start Tracking</h2>
            <p style={{ fontSize: 11, color: G.mid }}>Confirm your final budget before activating stages.</p>
          </div>
          <div style={{ background: G.off, borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span style={{ color: G.mid }}>Wizard estimate</span><span style={{ fontWeight: 600 }}>$42,500</span></div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: G.mid, marginBottom: 3, display: "block" }}>Updated budget from contractor</label>
            <input placeholder="e.g. $45,000" style={{ width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid " + G.border, fontSize: 13, fontWeight: 700, fontFamily: "Inter,system-ui,sans-serif" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: G.mid, marginBottom: 3, display: "block" }}>Upload cost estimate (optional)</label>
            <div style={{ border: "1px dashed " + G.border, borderRadius: 6, padding: 14, textAlign: "center" }}><div style={{ fontSize: 10, color: G.mid }}>PDF, DOC, or image - Max 10MB</div><div style={{ marginTop: 5 }}><Btn outline small>Choose File</Btn></div></div>
          </div>
          <Btn primary full>Confirm Budget and Start Tracking</Btn>
          <p style={{ fontSize: 9, color: G.soft, textAlign: "center", marginTop: 8 }}>Stage 1 activates and your contractor can begin uploading evidence.</p>
        </Card>
      </div>
    </Shell>
  );
}

function PreTracking_B() {
  return (
    <Shell active="My Projects" title="My Lagos Home \u203A Start Tracking">
      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}><h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Verify Your Budget</h2><p style={{ fontSize: 11, color: G.mid }}>Compare your estimate with your contractor's quote</p></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <Card style={{ padding: 14, borderLeft: "3px solid " + G.border }}><div style={{ fontSize: 9, color: G.mid, fontWeight: 600, marginBottom: 3 }}>GROUNDWORK ESTIMATE</div><div style={{ fontSize: 22, fontWeight: 900 }}>$42,500</div><div style={{ fontSize: 9, color: G.soft }}>From wizard</div></Card>
          <Card style={{ padding: 14, borderLeft: "3px solid " + G.near }}><div style={{ fontSize: 9, color: G.mid, fontWeight: 600, marginBottom: 3 }}>CONTRACTOR QUOTE</div><input placeholder="Enter amount" style={{ fontSize: 22, fontWeight: 900, border: "none", width: "100%", outline: "none", fontFamily: "Inter,system-ui,sans-serif" }} /><div style={{ fontSize: 9, color: G.soft }}>From contractor</div></Card>
        </div>
        <Card glow style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Upload supporting document</div>
          <div style={{ border: "1px dashed " + G.border, borderRadius: 6, padding: 12, textAlign: "center" }}><div style={{ fontSize: 9, color: G.mid }}>Drop quote here</div><div style={{ marginTop: 4 }}><Btn outline small>Browse</Btn></div></div>
        </Card>
        <Card style={{ padding: 12, background: G.off, border: "none", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 6, fontSize: 10, color: G.mid }}><span>{"\u2139"}</span><span>Your contractor's quote becomes the official budget. Milestones are calculated from this number.</span></div>
        </Card>
        <Btn primary full>Confirm and Activate Tracking</Btn>
      </div>
    </Shell>
  );
}

function ContractorProfile_A() {
  return (
    <Shell active="Contractors" title="Contractor Profile">
      <div style={{ maxWidth: 600 }}>
        <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: G.near, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, flexShrink: 0 }}>AO</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Adebayo Ogunleye</h2><Badge color="green">Verified</Badge></div>
            <div style={{ fontSize: 11, color: G.mid, marginTop: 2 }}>General Contractor - Lagos, Nigeria</div>
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 10, color: G.mid }}><span>{"\u2B50"} 4.8 (23 reviews)</span><span>12 years</span><span>47 projects</span></div>
          </div>
        </div>
        <Card glow style={{ marginBottom: 10 }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>About</div><p style={{ fontSize: 11, color: "#2A2A2A", lineHeight: 1.5 }}>Experienced residential contractor specializing in bungalows and duplexes. CORBON certified. Focus on quality materials and transparent pricing.</p></Card>
        <Card glow style={{ marginBottom: 10 }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Specialties</div><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{["Residential", "Bungalow", "Duplex", "Foundation", "Roofing"].map((s) => <Badge key={s}>{s}</Badge>)}</div></Card>
        <Card glow style={{ marginBottom: 10 }}><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Contact</div><div style={{ filter: "blur(4px)", pointerEvents: "none" }}><div style={{ fontSize: 11, padding: "3px 0" }}>+234 801 234 5678</div><div style={{ fontSize: 11, padding: "3px 0" }}>adebayo@example.com</div></div><div style={{ marginTop: 6 }}><Badge color="dark">{"\uD83D\uDD12"} Upgrade to unlock</Badge></div></Card>
        <Card glow><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Request Introduction</div><input placeholder="Your name" style={{ width: "100%", padding: "7px 10px", borderRadius: 5, border: "1px solid " + G.border, fontSize: 11, marginBottom: 5 }} /><textarea placeholder="Describe your project..." rows={3} style={{ width: "100%", padding: "7px 10px", borderRadius: 5, border: "1px solid " + G.border, fontSize: 11, resize: "none", marginBottom: 8 }} /><Btn primary full>Send Inquiry</Btn></Card>
      </div>
    </Shell>
  );
}

function ContractorProfile_B() {
  return (
    <Shell active="Contractors" title="Contractor Profile">
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <Card dark style={{ textAlign: "center", padding: 24, marginBottom: 14 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.1)", color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, margin: "0 auto 8px" }}>AO</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 3px" }}>Adebayo Ogunleye</h2>
          <Badge color="green">Verified Professional</Badge>
          <div style={{ fontSize: 10, opacity: 0.45, marginTop: 5 }}>General Contractor - Lagos, Nigeria</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 10, fontSize: 10, opacity: 0.5 }}><span>{"\u2B50"} 4.8</span><span>12 yrs</span><span>47 projects</span></div>
        </Card>
        <Card glow style={{ padding: 14, marginBottom: 8 }}>
          <p style={{ fontSize: 11, lineHeight: 1.5, color: "#2A2A2A" }}>Experienced residential contractor. CORBON certified. Transparent pricing, quality materials.</p>
        </Card>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{["Residential", "Bungalow", "Duplex", "Foundation", "Roofing"].map((s) => <Badge key={s}>{s}</Badge>)}</div>
        <Card glow style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Get in Touch</div>
          <input placeholder="Your name" style={{ width: "100%", padding: "7px 10px", borderRadius: 5, border: "1px solid " + G.border, fontSize: 11, marginBottom: 5 }} />
          <textarea placeholder="Tell them about your project..." rows={3} style={{ width: "100%", padding: "7px 10px", borderRadius: 5, border: "1px solid " + G.border, fontSize: 11, resize: "none", marginBottom: 8 }} />
          <Btn primary full>Request Introduction</Btn>
        </Card>
      </div>
    </Shell>
  );
}

function Help_A() {
  const [open, setOpen] = useState(0);
  const faqs = [{ q: "How do I create a project?", a: "Go to Dashboard and click New Project. The 10-step wizard guides you." }, { q: "What countries are supported?", a: "24 African countries including Cameroon, Nigeria, Ghana, Kenya." }, { q: "What is Jalla Verified?", a: "An independent Jalla professional reviews your evidence and approves each stage." }, { q: "Can I use it on mobile?", a: "Yes, fully responsive on all devices." }, { q: "How do certificates work?", a: "When a stage is approved, a PDF certificate with a QR code is generated." }];
  return (
    <Shell active="Dashboard" title="Help and Support">
      <div style={{ maxWidth: 600 }}>
        <div style={{ marginBottom: 18 }}><h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Help and Support</h2><p style={{ fontSize: 11, color: G.mid }}>Everything you need to build with confidence</p></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
          {[["\u25B6", "Videos"], ["\uD83D\uDCC5", "Book a Call"], ["\uD83D\uDC65", "Community"], ["\u2709", "Contact"]].map(([ic, t]) => (
            <Card key={t} glow style={{ padding: 12, textAlign: "center", cursor: "pointer" }}><div style={{ fontSize: 18, marginBottom: 3 }}>{ic}</div><div style={{ fontSize: 10, fontWeight: 600 }}>{t}</div></Card>
          ))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>FAQ</div>
        {faqs.map((f, i) => (
          <div key={i} onClick={() => setOpen(open === i ? -1 : i)} style={{ borderBottom: "1px solid " + G.border, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 12, fontWeight: 600 }}><span>{f.q}</span><span style={{ color: G.mid }}>{open === i ? "\u2212" : "+"}</span></div>
            {open === i && <div style={{ fontSize: 11, color: G.mid, paddingBottom: 10, lineHeight: 1.4 }}>{f.a}</div>}
          </div>
        ))}
        <Card style={{ marginTop: 16, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Send us a message</div>
          <input placeholder="Subject" style={{ width: "100%", padding: "7px 10px", borderRadius: 5, border: "1px solid " + G.border, fontSize: 11, marginBottom: 5 }} />
          <textarea placeholder="Your message..." rows={3} style={{ width: "100%", padding: "7px 10px", borderRadius: 5, border: "1px solid " + G.border, fontSize: 11, resize: "none", marginBottom: 8 }} />
          <Btn primary>Send</Btn>
        </Card>
      </div>
    </Shell>
  );
}

function Help_B() {
  return (
    <Shell active="Dashboard" title="Help and Support">
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <Card dark style={{ textAlign: "center", padding: 24, marginBottom: 18 }}>
          <div style={{ fontSize: 9, opacity: 0.4, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 3 }}>SUPPORT</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>How can we help?</h2>
          <input placeholder="Search for answers..." style={{ width: "100%", maxWidth: 280, padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: G.white, fontSize: 11, outline: "none", display: "block", margin: "0 auto", fontFamily: "Inter,system-ui,sans-serif" }} />
        </Card>
        {[{ ic: "\uD83D\uDCD6", t: "Getting Started", items: ["Create a project", "Invite contractor", "Upload evidence", "Approve a stage"] }, { ic: "\uD83D\uDCB0", t: "Plans and Billing", items: ["Tier comparison", "Upgrade to Jalla Verify", "Payment fees"] }, { ic: "\u2713", t: "Verification", items: ["How it works", "What to upload", "Stage certificates"] }].map((s) => (
          <Card key={s.t} glow style={{ padding: 14, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}><span style={{ fontSize: 14 }}>{s.ic}</span><span style={{ fontSize: 13, fontWeight: 700 }}>{s.t}</span></div>
            {s.items.map((it) => (<div key={it} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid " + G.light, fontSize: 11, cursor: "pointer" }}><span>{it}</span><span style={{ color: G.mid }}>{"\u2192"}</span></div>))}
          </Card>
        ))}
        <div style={{ textAlign: "center", marginTop: 14 }}><div style={{ fontSize: 11, color: G.mid, marginBottom: 4 }}>Still need help?</div><Btn outline>Contact Support</Btn></div>
      </div>
    </Shell>
  );
}

export default function AppScreensPart2() {
  const [screen, setScreen] = useState("settings");
  const [variant, setVariant] = useState("A");
  const screens = [{ id: "settings", label: "Settings" }, { id: "contractors", label: "Contractors" }, { id: "pretracking", label: "Pre-Tracking" }, { id: "profile", label: "Contractor Profile" }, { id: "help", label: "Help Centre" }];
  const comps = { settings: { A: Settings_A, B: Settings_B }, contractors: { A: Contractors_A, B: Contractors_B }, pretracking: { A: PreTracking_A, B: PreTracking_B }, profile: { A: ContractorProfile_A, B: ContractorProfile_B }, help: { A: Help_A, B: Help_B } };
  const Comp = comps[screen][variant];
  return (
    <div style={{ fontFamily: "Inter,system-ui,sans-serif" }}>
      <div style={{ background: G.near, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}><span style={{ color: G.white, fontWeight: 800, fontSize: 13 }}>Groundwork</span><span style={{ color: "rgba(255,255,255,0.3)", fontSize: 8 }}>by Jalla</span></div>
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 8, fontWeight: 600 }}>App Screens Part 2</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 2, padding: "8px 10px", borderBottom: "1px solid " + G.border, background: G.white, flexWrap: "wrap" }}>
        {screens.map((s) => (<button key={s.id} onClick={() => { setScreen(s.id); setVariant("A"); }} style={{ background: screen === s.id ? G.near : "transparent", color: screen === s.id ? G.white : G.mid, border: "none", borderRadius: 5, padding: "5px 10px", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>{s.label}</button>))}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 3, padding: "6px 10px", background: G.white, borderBottom: "1px solid " + G.border }}>
        {["A", "B"].map((v) => (<button key={v} onClick={() => setVariant(v)} style={{ background: variant === v ? G.near : G.light, color: variant === v ? G.white : G.mid, border: "none", borderRadius: 4, padding: "4px 14px", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>Design {v}</button>))}
      </div>
      <Comp />
    </div>
  );
}
