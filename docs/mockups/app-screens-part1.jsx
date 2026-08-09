import { useState } from "react";

const G = { near: "#0A0A0A", mid: "#888", soft: "#BBB", border: "#E0E0E0", light: "#F2F2F2", off: "#F8F8F8", white: "#FFF" };

function Card({ children, style = {}, dark = false, glow = false }) {
  return (<div style={{ background: dark ? G.near : G.white, border: "1px solid " + (dark ? "#333" : G.border), borderRadius: 14, padding: 22, boxShadow: glow ? "0 4px 20px rgba(0,0,0,0.05)" : "none", color: dark ? G.white : G.near, ...style }}>{children}</div>);
}
function Btn({ children, primary, outline, small, full, onClick }) {
  return (<button onClick={onClick} style={{ background: primary ? G.near : outline ? "transparent" : G.light, color: primary ? G.white : G.near, border: outline ? "1.5px solid " + G.near : "none", borderRadius: 8, padding: small ? "6px 12px" : "10px 20px", fontSize: small ? 11 : 13, fontWeight: 600, cursor: "pointer", width: full ? "100%" : "auto", fontFamily: "Inter,system-ui,sans-serif" }}>{children}</button>);
}
function Badge({ children, color = "default" }) {
  const m = { default: [G.light, G.mid], green: ["#E8F5E9", "#2E7D32"], blue: ["#E3F2FD", "#1565C0"], amber: ["#FFF8E1", "#E65100"], dark: [G.near, G.white], purple: ["#F3E5F5", "#7B1FA2"] };
  const c = m[color] || m.default;
  return (<span style={{ background: c[0], color: c[1], fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 14 }}>{children}</span>);
}
function PBar({ pct, color = G.near, h = 5 }) {
  return (<div style={{ background: G.light, borderRadius: h, height: h, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: color, borderRadius: h }} /></div>);
}

const NAV = ["Dashboard", "My Projects", "Documents", "Resources", "Contractors", "Payments", "Notifications", "Settings"];
const ICONS = ["\u229E", "\uD83C\uDFD7", "\uD83D\uDCC4", "\uD83D\uDCDA", "\uD83D\uDC77", "\uD83D\uDCB0", "\uD83D\uDD14", "\u2699"];

function Shell({ children, active = "Dashboard", title = "Page" }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter,system-ui,sans-serif", color: G.near, background: G.off }}>
      <div style={{ width: 210, background: G.white, borderRight: "1px solid " + G.border, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid " + G.border }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Groundwork</div>
          <div style={{ fontSize: 9, color: G.soft }}>by Jalla</div>
        </div>
        <div style={{ flex: 1, padding: "10px 8px" }}>
          {NAV.map((n, i) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 7, marginBottom: 1, background: active === n ? G.near : "transparent", color: active === n ? G.white : G.mid, fontSize: 12, fontWeight: active === n ? 600 : 500, cursor: "pointer" }}>
              <span style={{ fontSize: 13 }}>{ICONS[i]}</span>{n}
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 14px", borderTop: "1px solid " + G.border, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: G.near, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>FN</div>
          <div><div style={{ fontSize: 10, fontWeight: 600 }}>Favour N.</div><div style={{ fontSize: 8, color: G.soft }}>Self Verify</div></div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 48, background: G.white, borderBottom: "1px solid " + G.border, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ cursor: "pointer" }}>{"\u2600"}</span>
            <div style={{ position: "relative" }}><span>{"\uD83D\uDD14"}</span><div style={{ position: "absolute", top: -4, right: -6, width: 13, height: 13, borderRadius: "50%", background: "#C62828", color: "white", fontSize: 7, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>3</div></div>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: G.near, color: G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>FN</div>
          </div>
        </div>
        <div style={{ flex: 1, padding: "22px 26px", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

function Timeline_A() {
  const st = [{ n: 1, name: "Land Acquisition", dur: 14, s: "done" }, { n: 2, name: "Foundation", dur: 21, s: "done" }, { n: 3, name: "Block Work", dur: 70, s: "active" }, { n: 4, name: "Decking", dur: 14, s: "locked" }, { n: 5, name: "Roofing", dur: 14, s: "locked" }];
  return (
    <Shell active="My Projects" title="My Lagos Home \u203A Timeline">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Project Timeline</h2>
        <div style={{ display: "flex", gap: 5 }}><Btn small primary>List View</Btn><Btn small outline>Gantt View</Btn></div>
      </div>
      <div style={{ position: "relative", paddingLeft: 18 }}>
        <div style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 2, background: G.border }} />
        {st.map((s) => (
          <div key={s.n} style={{ position: "relative", marginBottom: 14 }}>
            <div style={{ position: "absolute", left: -14, top: 5, width: 13, height: 13, borderRadius: "50%", background: s.s === "done" ? "#2E7D32" : s.s === "active" ? G.near : G.border, border: "3px solid white", boxShadow: "0 0 0 1px " + G.border }} />
            <Card glow style={{ padding: 14, marginLeft: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 13, fontWeight: 700 }}>Stage {s.n}: {s.name}</div><div style={{ fontSize: 10, color: G.mid }}>{s.dur} days</div></div>
                <Badge color={s.s === "done" ? "green" : s.s === "active" ? "blue" : "default"}>{s.s === "done" ? "Complete" : s.s === "active" ? "In Progress" : "Locked"}</Badge>
              </div>
              {s.s !== "locked" && <div style={{ marginTop: 8 }}><PBar pct={s.s === "done" ? 100 : 40} color={s.s === "done" ? "#2E7D32" : G.near} /></div>}
            </Card>
          </div>
        ))}
      </div>
      <Card style={{ marginTop: 14, padding: 14, background: G.off, border: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: G.mid }}><span>Started: Jul 1, 2026</span><span>Projected: Jan 13, 2027</span><span>~196 days</span></div>
      </Card>
    </Shell>
  );
}

function Timeline_B() {
  const st = [{ n: 1, name: "Land", dur: 14, s: "done" }, { n: 2, name: "Foundation", dur: 21, s: "done" }, { n: 3, name: "Block Work", dur: 70, s: "active" }, { n: 4, name: "Decking", dur: 14, s: "locked" }, { n: 5, name: "Roofing", dur: 14, s: "locked" }, { n: 6, name: "Plaster", dur: 14, s: "locked" }, { n: 7, name: "MEP", dur: 14, s: "locked" }, { n: 8, name: "Finishing", dur: 21, s: "locked" }, { n: 9, name: "External", dur: 14, s: "locked" }, { n: 10, name: "Handover", dur: 7, s: "locked" }];
  return (
    <Shell active="My Projects" title="My Lagos Home \u203A Timeline">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Project Timeline</h2>
        <div style={{ display: "flex", gap: 5 }}><Btn small outline>List View</Btn><Btn small primary>Gantt View</Btn></div>
      </div>
      <Card glow style={{ padding: 18, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: G.soft, marginBottom: 10 }}>
          {["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan"].map((m) => <span key={m}>{m}</span>)}
        </div>
        {st.map((s, i) => {
          let off = 0; for (let j = 0; j < i; j++) off += st[j].dur;
          return (
            <div key={s.n} style={{ display: "flex", alignItems: "center", marginBottom: 5, height: 24 }}>
              <div style={{ width: 80, fontSize: 9, fontWeight: 600, color: s.s === "locked" ? G.soft : G.near, flexShrink: 0 }}>{s.n}. {s.name}</div>
              <div style={{ flex: 1, position: "relative", height: 18 }}>
                <div style={{ position: "absolute", left: (off / 196 * 100) + "%", width: (s.dur / 196 * 100) + "%", height: 18, borderRadius: 3, background: s.s === "done" ? "#2E7D32" : s.s === "active" ? G.near : G.light, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 600, color: s.s === "locked" ? G.mid : G.white }}>{s.dur}d</div>
              </div>
            </div>
          );
        })}
      </Card>
      <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 9, color: G.mid }}>
        {[["Complete", "#2E7D32"], ["Active", G.near], ["Locked", G.border]].map(([l, c]) => <span key={l} style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}</span>)}
      </div>
    </Shell>
  );
}

function Documents_A() {
  const docs = [{ name: "Land Title.pdf", cat: "Legal", size: "2.4 MB", date: "Jul 3" }, { name: "Foundation Report.pdf", cat: "Evidence", size: "1.1 MB", date: "Jul 12" }, { name: "Agreement.docx", cat: "Contracts", size: "340 KB", date: "Jul 1" }, { name: "Site Photos.zip", cat: "Evidence", size: "18 MB", date: "Jul 18" }, { name: "Building Permit.pdf", cat: "Permits", size: "890 KB", date: "Jun 28" }];
  return (
    <Shell active="Documents" title="Documents">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div><h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Documents</h2><p style={{ fontSize: 11, color: G.mid }}>Files across all builds</p></div>
        <Btn primary small>Upload</Btn>
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
        {["All (5)", "Legal (1)", "Evidence (2)", "Contracts (1)", "Permits (1)"].map((l) => <button key={l} style={{ background: l.startsWith("All") ? G.near : G.white, color: l.startsWith("All") ? G.white : G.mid, border: "1px solid " + (l.startsWith("All") ? G.near : G.border), borderRadius: 5, padding: "4px 10px", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>{l}</button>)}
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr 0.8fr 0.8fr 0.4fr", padding: "8px 12px", background: G.off, fontSize: 9, fontWeight: 700, color: G.mid }}>
          <span>Name</span><span>Category</span><span>Size</span><span>Date</span><span></span>
        </div>
        {docs.map((d, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr 0.8fr 0.8fr 0.4fr", padding: "10px 12px", borderTop: "1px solid " + G.light, alignItems: "center", fontSize: 11 }}>
            <span style={{ fontWeight: 500 }}>{d.name}</span>
            <span><Badge>{d.cat}</Badge></span>
            <span style={{ color: G.mid }}>{d.size}</span>
            <span style={{ color: G.mid }}>{d.date}</span>
            <span style={{ color: G.mid, cursor: "pointer" }}>{"\u2193"}</span>
          </div>
        ))}
      </Card>
    </Shell>
  );
}

function Documents_B() {
  return (
    <Shell active="Documents" title="Documents">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Document Vault</h2>
        <Btn primary small>+ Upload</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
        {[["Legal", 1, "\u2696"], ["Evidence", 2, "\uD83D\uDCF7"], ["Contracts", 1, "\uD83D\uDCDD"], ["Permits", 1, "\uD83C\uDFDB"]].map(([n, c, ic]) => (
          <Card key={n} glow style={{ padding: 14, textAlign: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{ic}</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{n}</div>
            <div style={{ fontSize: 9, color: G.mid }}>{c} file{c > 1 ? "s" : ""}</div>
          </Card>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: G.mid, marginBottom: 8 }}>RECENT</div>
      {["Land Title.pdf", "Foundation Photos.zip", "Agreement.docx"].map((n) => (
        <Card key={n} style={{ padding: 12, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: G.light, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{"\uD83D\uDCC4"}</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 600 }}>{n}</div></div>
          <span style={{ color: G.mid, fontSize: 11 }}>{"\u2193"}</span>
        </Card>
      ))}
    </Shell>
  );
}

function Messages_A() {
  const msgs = [{ f: "Adebayo", me: false, t: "Foundation work is complete. Uploading photos now.", tm: "2:14 PM" }, { f: "You", me: true, t: "Great work! Reviewing tonight.", tm: "2:18 PM" }, { f: "Adebayo", me: false, t: "Cement delivery arrives tomorrow morning.", tm: "2:20 PM" }, { f: "You", me: true, t: "Take photos of the delivery receipt too.", tm: "2:25 PM" }];
  return (
    <Shell active="My Projects" title="My Lagos Home \u203A Messages">
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)" }}>
        <div style={{ marginBottom: 10 }}><h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Project Chat</h3><p style={{ fontSize: 10, color: G.mid }}>You + Adebayo Ogunleye</p></div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "10px 0" }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "70%", padding: "9px 13px", borderRadius: m.me ? "13px 13px 3px 13px" : "13px 13px 13px 3px", background: m.me ? G.near : G.white, color: m.me ? G.white : G.near, border: m.me ? "none" : "1px solid " + G.border }}>
                {!m.me && <div style={{ fontSize: 9, fontWeight: 700, color: "#1565C0", marginBottom: 3 }}>{m.f}</div>}
                <div style={{ fontSize: 12 }}>{m.t}</div>
                <div style={{ fontSize: 8, marginTop: 3, opacity: 0.4, textAlign: "right" }}>{m.tm}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, paddingTop: 10, borderTop: "1px solid " + G.border }}>
          <input placeholder="Type a message..." style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid " + G.border, fontSize: 12, outline: "none", fontFamily: "Inter,system-ui,sans-serif" }} />
          <Btn primary>Send</Btn>
        </div>
      </div>
    </Shell>
  );
}

function Messages_B() {
  const msgs = [{ me: false, t: "Foundation work is complete.", tm: "2:14 PM" }, { me: true, t: "Great! Reviewing tonight.", tm: "2:18 PM" }, { me: false, t: "Cement delivery tomorrow.", tm: "2:20 PM" }, { me: true, t: "Take receipt photos.", tm: "2:25 PM" }];
  return (
    <Shell active="My Projects" title="My Lagos Home \u203A Messages">
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", height: "calc(100vh - 130px)", margin: "-22px -26px", overflow: "hidden" }}>
        <div style={{ borderRight: "1px solid " + G.border, background: G.white }}>
          <div style={{ padding: 12, borderBottom: "1px solid " + G.border, fontSize: 11, fontWeight: 700 }}>Chats</div>
          <div style={{ padding: 8, background: G.off, borderBottom: "1px solid " + G.border, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#E3F2FD", color: "#1565C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>AO</div>
            <div><div style={{ fontSize: 10, fontWeight: 700 }}>Adebayo O.</div><div style={{ fontSize: 8, color: G.mid }}>Cement delivery...</div></div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", background: G.off }}>
          <div style={{ padding: "10px 14px", background: G.white, borderBottom: "1px solid " + G.border, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#E3F2FD", color: "#1565C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>AO</div>
            <div><div style={{ fontSize: 11, fontWeight: 700 }}>Adebayo Ogunleye</div><div style={{ fontSize: 8, color: G.mid }}>Contractor</div></div>
            <div style={{ marginLeft: "auto" }}><Badge color="green">Online</Badge></div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "65%", padding: "8px 12px", borderRadius: 10, background: m.me ? G.near : G.white, color: m.me ? G.white : G.near, fontSize: 11 }}>
                  {m.t}<div style={{ fontSize: 8, opacity: 0.4, marginTop: 2, textAlign: "right" }}>{m.tm}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 14px", background: G.white, borderTop: "1px solid " + G.border, display: "flex", gap: 6 }}>
            <input placeholder="Message..." style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid " + G.border, fontSize: 11, outline: "none" }} />
            <Btn primary small>Send</Btn>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Notifications_A() {
  const ns = [{ ic: "\u2713", title: "Stage 2 Approved", body: "Foundation verified.", tm: "2h ago", r: false }, { ic: "\uD83D\uDCF7", title: "Evidence Uploaded", body: "3 photos on Stage 3.", tm: "4h ago", r: false }, { ic: "\uD83D\uDCAC", title: "New Message", body: "Adebayo: Cement delivery...", tm: "5h ago", r: false }, { ic: "\uD83C\uDFD7", title: "Project Created", body: "My Lagos Home.", tm: "2d ago", r: true }, { ic: "\uD83D\uDD14", title: "Welcome", body: "Account ready!", tm: "3d ago", r: true }];
  return (
    <Shell active="Notifications" title="Notifications">
      <div style={{ maxWidth: 600 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div><h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Notifications</h2><p style={{ fontSize: 11, color: G.mid }}>3 unread</p></div>
          <Btn outline small>Mark all read</Btn>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
          {["All", "Unread", "Projects", "System"].map((l) => <button key={l} style={{ background: l === "All" ? G.near : G.white, color: l === "All" ? G.white : G.mid, border: "1px solid " + (l === "All" ? G.near : G.border), borderRadius: 5, padding: "4px 10px", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>{l}</button>)}
        </div>
        {ns.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: "1px solid " + G.light, background: n.r ? "transparent" : "rgba(26,26,26,0.02)", borderRadius: 6, cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: n.r ? G.light : G.off, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{n.ic}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontSize: 12, fontWeight: n.r ? 500 : 700 }}>{n.title}</span>{!n.r && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#C62828" }} />}</div>
              <div style={{ fontSize: 10, color: G.mid, marginTop: 1 }}>{n.body}</div>
            </div>
            <div style={{ fontSize: 9, color: G.soft }}>{n.tm}</div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Notifications_B() {
  return (
    <Shell active="Notifications" title="Notifications">
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}><h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 3px" }}>Notifications</h2><p style={{ fontSize: 11, color: G.mid }}>3 unread</p></div>
        <div style={{ fontSize: 9, fontWeight: 700, color: G.mid, marginBottom: 6 }}>NEW</div>
        {[{ ic: "\u2713", t: "Stage 2 Approved", b: "Foundation verified.", tm: "2h", cl: "#2E7D32" }, { ic: "\uD83D\uDCF7", t: "Evidence Uploaded", b: "3 photos.", tm: "4h", cl: "#1565C0" }, { ic: "\uD83D\uDCAC", t: "New Message", b: "Adebayo: Cement...", tm: "5h", cl: "#7B1FA2" }].map((n) => (
          <Card key={n.t} glow style={{ padding: 12, marginBottom: 6, display: "flex", gap: 10, alignItems: "center", borderLeft: "3px solid " + n.cl }}>
            <div style={{ fontSize: 16 }}>{n.ic}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 700 }}>{n.t}</div><div style={{ fontSize: 9, color: G.mid }}>{n.b}</div></div>
            <span style={{ fontSize: 9, color: G.soft }}>{n.tm}</span>
          </Card>
        ))}
        <div style={{ fontSize: 9, fontWeight: 700, color: G.mid, marginBottom: 6, marginTop: 14 }}>EARLIER</div>
        {[{ ic: "\uD83C\uDFD7", t: "Project Created", b: "My Lagos Home.", tm: "2d" }, { ic: "\uD83D\uDD14", t: "Welcome", b: "Account ready!", tm: "3d" }].map((n) => (
          <div key={n.t} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid " + G.light, alignItems: "center", opacity: 0.6 }}>
            <span style={{ fontSize: 13 }}>{n.ic}</span>
            <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 500 }}>{n.t}</div><div style={{ fontSize: 9, color: G.mid }}>{n.b}</div></div>
            <span style={{ fontSize: 9, color: G.soft }}>{n.tm}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Resources_A() {
  const rs = [{ title: "How to Read a BQ", cat: "Guides", time: "8 min", tag: "Essential", tc: "dark" }, { title: "Hiring a Contractor", cat: "Guides", time: "6 min", tag: "Popular", tc: "blue" }, { title: "Builder's Checklist", cat: "Checklists", time: "4 min", tag: "Start here", tc: "purple" }, { title: "Site Visit Checklist", cat: "Checklists", time: "3 min", tag: null, tc: null }, { title: "Building Permits", cat: "Legal", time: "10 min", tag: "Important", tc: "amber" }, { title: "Roof Types", cat: "Guides", time: "5 min", tag: "New", tc: "green" }];
  return (
    <Shell active="Resources" title="Resources">
      <div style={{ marginBottom: 14 }}><h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Resource Library</h2><p style={{ fontSize: 11, color: G.mid }}>Guides, checklists, and tools</p></div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {["All", "Guides", "Checklists", "Legal"].map((l) => <button key={l} style={{ background: l === "All" ? G.near : G.white, color: l === "All" ? G.white : G.mid, border: "1px solid " + (l === "All" ? G.near : G.border), borderRadius: 5, padding: "4px 10px", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>{l}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {rs.map((r) => (
          <Card key={r.title} glow style={{ padding: 16, cursor: "pointer" }}>
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>{r.tag && <Badge color={r.tc}>{r.tag}</Badge>}<Badge>{r.cat}</Badge></div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{r.title}</div>
            <div style={{ fontSize: 9, color: G.mid }}>{r.time} read</div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

function Resources_B() {
  return (
    <Shell active="Resources" title="Resources">
      <div style={{ maxWidth: 560 }}>
        <Card dark style={{ padding: "22px 26px", marginBottom: 18 }}>
          <div style={{ fontSize: 9, opacity: 0.4, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 3 }}>LEARN</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 5px" }}>Build smarter, not harder</h2>
          <p style={{ fontSize: 11, opacity: 0.45 }}>14 guides, checklists, and videos for your build.</p>
        </Card>
        <div style={{ fontSize: 9, fontWeight: 700, color: G.mid, marginBottom: 6 }}>FEATURED</div>
        {[{ t: "How to Read a BQ", cat: "Guide", time: "8 min", tag: "Essential" }, { t: "Builder's Checklist", cat: "Checklist", time: "4 min", tag: "Start here" }].map((r) => (
          <Card key={r.t} glow style={{ padding: 14, marginBottom: 8, display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: G.near, display: "flex", alignItems: "center", justifyContent: "center", color: G.white, fontSize: 14, flexShrink: 0 }}>{"\uD83D\uDCD6"}</div>
            <div style={{ flex: 1 }}><Badge color="dark">{r.tag}</Badge><div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{r.t}</div><div style={{ fontSize: 9, color: G.mid }}>{r.cat} \u00B7 {r.time}</div></div>
          </Card>
        ))}
        <div style={{ fontSize: 9, fontWeight: 700, color: G.mid, marginBottom: 6, marginTop: 14 }}>ALL RESOURCES</div>
        {["Hiring a Contractor", "Site Visit Checklist", "Building Permits", "Roof Types", "Currency Tips", "Stage Approval"].map((t) => (
          <div key={t} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid " + G.light, cursor: "pointer" }}>
            <span style={{ fontSize: 11, fontWeight: 500 }}>{t}</span>
            <span style={{ fontSize: 11, color: G.mid }}>{"\u2192"}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

export default function AppScreensPart1() {
  const [screen, setScreen] = useState("timeline");
  const [variant, setVariant] = useState("A");
  const screens = [{ id: "timeline", label: "Timeline" }, { id: "documents", label: "Documents" }, { id: "messages", label: "Messages" }, { id: "notifications", label: "Notifications" }, { id: "resources", label: "Resources" }];
  const comps = { timeline: { A: Timeline_A, B: Timeline_B }, documents: { A: Documents_A, B: Documents_B }, messages: { A: Messages_A, B: Messages_B }, notifications: { A: Notifications_A, B: Notifications_B }, resources: { A: Resources_A, B: Resources_B } };
  const Comp = comps[screen][variant];
  return (
    <div style={{ fontFamily: "Inter,system-ui,sans-serif" }}>
      <div style={{ background: G.near, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}><span style={{ color: G.white, fontWeight: 800, fontSize: 13 }}>Groundwork</span><span style={{ color: "rgba(255,255,255,0.3)", fontSize: 8 }}>by Jalla</span></div>
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 8, fontWeight: 600 }}>App Screens Part 1</span>
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
