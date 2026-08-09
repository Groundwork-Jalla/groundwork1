import { useState } from "react";

const G = {
  near: "#0A0A0A", dark: "#1A1A1A", charcoal: "#2A2A2A",
  mid: "#888", soft: "#BBB", muted: "#DDD",
  border: "#E0E0E0", light: "#F2F2F2", off: "#F8F8F8", white: "#FFF",
};

function Card({ children, style = {}, dark = false, glow = false }) {
  return <div style={{ background: dark ? G.near : G.white, border: `1px solid ${dark ? "#333" : G.border}`, borderRadius: 16, padding: 24, boxShadow: glow ? "0 0 0 1px rgba(0,0,0,0.03), 0 8px 32px rgba(0,0,0,0.06)" : "none", color: dark ? G.white : G.near, ...style }}>{children}</div>;
}

function Btn({ children, primary, outline, full, small, onClick }) {
  return <button onClick={onClick} style={{ background: primary ? G.near : outline ? "transparent" : G.light, color: primary ? G.white : G.near, border: outline ? `1.5px solid ${G.near}` : primary ? "none" : `1px solid ${G.border}`, borderRadius: 10, padding: small ? "7px 14px" : "11px 22px", fontSize: small ? 11 : 13, fontWeight: 600, cursor: "pointer", width: full ? "100%" : "auto", fontFamily: "Inter, system-ui, sans-serif" }}>{children}</button>;
}

function Badge({ children, color = "default" }) {
  const map = { default: { bg: G.light, fg: G.mid }, green: { bg: "#E8F5E9", fg: "#2E7D32" }, amber: { bg: "#FFF8E1", fg: "#E65100" }, blue: { bg: "#E3F2FD", fg: "#1565C0" }, dark: { bg: G.near, fg: G.white } };
  const c = map[color] || map.default;
  return <span style={{ background: c.bg, color: c.fg, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 16, letterSpacing: "0.03em" }}>{children}</span>;
}

function ProgressBar({ pct, color = G.near, height = 6 }) {
  return <div style={{ background: G.light, borderRadius: height, height, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: height, transition: "width 0.5s" }} /></div>;
}

/* ══════════════════════════════════════════════════════════
   1A — DASHBOARD: DATA-RICH COMMAND CENTER
   ══════════════════════════════════════════════════════════ */
function Dashboard_A() {
  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      {/* Greeting Hero */}
      <Card dark style={{ marginBottom: 20, padding: "28px 32px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(255,255,255,0.5) 19px, rgba(255,255,255,0.5) 20px), repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.5) 19px, rgba(255,255,255,0.5) 20px)" }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 13, opacity: 0.4 }}>Good afternoon</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "4px 0 12px" }}>Welcome back, Favour</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn primary>New Project</Btn>
            <Btn outline small>View All Projects →</Btn>
          </div>
        </div>
      </Card>

      {/* Profile Completion */}
      <Card style={{ marginBottom: 16, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Profile 75% complete</span>
            <span style={{ fontSize: 11, color: G.mid }}>Upload ID to finish</span>
          </div>
          <ProgressBar pct={75} />
        </div>
        <Btn small outline>Complete →</Btn>
      </Card>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Projects", value: "2", sub: "1 active", accent: true },
          { label: "Total Budget", value: "$85,000", sub: "across all builds" },
          { label: "Stages Done", value: "5 / 20", sub: "25% complete" },
          { label: "Active Builds", value: "1", sub: "Cameroon" },
        ].map(s => (
          <Card key={s.label} style={{ padding: 16, ...(s.accent ? { background: G.near, color: G.white, border: "none" } : {}) }}>
            <div style={{ fontSize: 10, fontWeight: 600, opacity: s.accent ? 0.45 : 1, color: s.accent ? undefined : G.mid, letterSpacing: "0.04em", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{s.value}</div>
            <div style={{ fontSize: 10, opacity: s.accent ? 0.35 : 1, color: s.accent ? undefined : G.soft, marginTop: 2 }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* Two Column: Stage Progress + Donut */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginBottom: 20 }}>
        <Card glow>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <div><div style={{ fontSize: 14, fontWeight: 700 }}>Stage Progress</div><div style={{ fontSize: 11, color: G.mid }}>My Lagos Home</div></div>
            <Badge color="green">On Track</Badge>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[["Spent", "$8,250", "green"], ["Active", "$5,500", "blue"], ["Remaining", "$28,750", "default"]].map(([l, v, c]) => (
              <div key={l} style={{ background: G.off, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 9, color: G.mid, fontWeight: 600 }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
          {[
            { n: 1, name: "Land Acquisition", pct: 5, status: "done" },
            { n: 2, name: "Foundation", pct: 10, status: "done" },
            { n: 3, name: "Block Work", pct: 15, status: "active" },
            { n: 4, name: "Decking", pct: 10, status: "locked" },
            { n: 5, name: "Roofing", pct: 12.5, status: "locked" },
          ].map(s => (
            <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: s.status === "done" ? "#2E7D32" : s.status === "active" ? G.near : G.light, color: s.status === "locked" ? G.mid : G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                {s.status === "done" ? "✓" : s.n}
              </div>
              <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: s.status === "locked" ? G.soft : G.near, textDecoration: s.status === "done" ? "line-through" : "none" }}>{s.name}</div>
              <div style={{ fontSize: 11, color: G.mid, fontWeight: 600 }}>${(42500 * s.pct / 100).toLocaleString()}</div>
              <div style={{ width: 50 }}><ProgressBar pct={s.status === "done" ? 100 : s.status === "active" ? 40 : 0} color={s.status === "done" ? "#2E7D32" : G.near} height={4} /></div>
            </div>
          ))}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card glow style={{ textAlign: "center", padding: 20 }}>
            <svg viewBox="0 0 120 120" width="120" height="120" style={{ margin: "0 auto" }}>
              <circle cx="60" cy="60" r="50" fill="none" stroke={G.light} strokeWidth="10" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="#2E7D32" strokeWidth="10" strokeDasharray={`${2 * Math.PI * 50 * 0.194} ${2 * Math.PI * 50}`} strokeLinecap="round" transform="rotate(-90 60 60)" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="#1565C0" strokeWidth="10" strokeDasharray={`${2 * Math.PI * 50 * 0.13} ${2 * Math.PI * 50}`} strokeLinecap="round" transform={`rotate(${-90 + 360 * 0.194} 60 60)`} />
              <text x="60" y="56" textAnchor="middle" fontSize="16" fontWeight="900" fill={G.near}>25%</text>
              <text x="60" y="70" textAnchor="middle" fontSize="8" fill={G.mid}>complete</text>
            </svg>
            <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 12, fontSize: 10 }}>
              {[["Spent", "#2E7D32"], ["Active", "#1565C0"], ["Remaining", G.border]].map(([l, c]) => (
                <span key={l} style={{ display: "flex", alignItems: "center", gap: 4, color: G.mid }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />{l}
                </span>
              ))}
            </div>
          </Card>
          <Card style={{ padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, marginBottom: 8, letterSpacing: "0.06em" }}>PLATFORM UPDATES</div>
            {["Budget engine v2 — calibrated from real Cameroonian BQ", "Stage certificates now generate on approval", "24 African markets supported"].map(n => (
              <div key={n} style={{ fontSize: 11, color: G.charcoal, padding: "6px 0", borderBottom: `1px solid ${G.light}` }}>{n}</div>
            ))}
          </Card>
        </div>
      </div>

      {/* Project Cards */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>Recent Projects</h3>
        <span style={{ fontSize: 12, color: G.mid, cursor: "pointer" }}>View all →</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {[
          { name: "My Lagos Home", location: "Douala, Cameroon", type: "Residential · Duplex", budget: "$42,500", stage: "3 / 10", pct: 30, status: "Active", tier: "Self Verify" },
          { name: "Accra Office", location: "Accra, Ghana", type: "Commercial · Office", budget: "$85,000", stage: "1 / 10", pct: 10, status: "Active", tier: "Jalla Verify" },
        ].map(p => (
          <Card key={p.name} glow style={{ padding: 18, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <Badge color={p.tier === "Jalla Verify" ? "dark" : "default"}>{p.tier}</Badge>
              <Badge color="green">{p.status}</Badge>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: G.mid, marginBottom: 2 }}>{p.type}</div>
            <div style={{ fontSize: 11, color: G.soft, marginBottom: 12 }}>{p.location}</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
              <span style={{ color: G.mid }}>Stage {p.stage}</span>
              <span style={{ fontWeight: 600 }}>{p.budget}</span>
            </div>
            <ProgressBar pct={p.pct} />
          </Card>
        ))}
        <div style={{ border: `2px dashed ${G.border}`, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, cursor: "pointer", minHeight: 180 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: G.light, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: G.mid }}>+</div>
          <span style={{ fontSize: 12, fontWeight: 600, color: G.mid }}>New Project</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   1B — DASHBOARD: MINIMAL / FOCUS-FORWARD
   ══════════════════════════════════════════════════════════ */
function Dashboard_B() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: G.mid }}>Good afternoon</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 0" }}>Favour</h1>
      </div>

      {/* Active Project Card — Hero Focus */}
      <Card dark style={{ marginBottom: 16, padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <Badge color="green">Active</Badge>
          <span style={{ fontSize: 10, opacity: 0.4 }}>Stage 3 of 10</span>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>My Lagos Home</h2>
        <p style={{ fontSize: 12, opacity: 0.45, marginBottom: 16 }}>Duplex · Douala, Cameroon · $42,500</p>
        <ProgressBar pct={30} color="#fff" height={4} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, opacity: 0.4 }}>
          <span>30% complete</span>
          <span>Stage 3: Block Work</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 20 }}>
          {[["Released", "$8,250"], ["Held", "$5,500"], ["Remaining", "$28,750"]].map(([l, v]) => (
            <div key={l} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, opacity: 0.4, fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}><Btn primary full>Open Project →</Btn></div>
      </Card>

      {/* Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[
          { icon: "📋", label: "Upload Evidence", sub: "Stage 3 needs 4 more files" },
          { icon: "💬", label: "Messages", sub: "2 unread from Adebayo" },
          { icon: "📄", label: "Documents", sub: "8 files across 2 projects" },
          { icon: "👷", label: "Contractors", sub: "1 active, 8 in directory" },
        ].map(a => (
          <Card key={a.label} glow style={{ padding: 14, cursor: "pointer", display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 20 }}>{a.icon}</div>
            <div><div style={{ fontSize: 12, fontWeight: 700 }}>{a.label}</div><div style={{ fontSize: 10, color: G.mid }}>{a.sub}</div></div>
          </Card>
        ))}
      </div>

      {/* Other Projects */}
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: G.mid }}>OTHER PROJECTS</div>
      <Card style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Accra Office</div>
          <div style={{ fontSize: 11, color: G.mid }}>Commercial · Ghana · Stage 1 / 10</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>$85,000</div>
          <Badge>Jalla Verify</Badge>
        </div>
      </Card>

      <div style={{ border: `2px dashed ${G.border}`, borderRadius: 12, padding: 16, textAlign: "center", cursor: "pointer" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: G.mid }}>+ New Project</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   2A — MY PROJECTS: GRID WITH FILTERS
   ══════════════════════════════════════════════════════════ */
function Projects_A() {
  const [filter, setFilter] = useState("all");
  const projects = [
    { name: "My Lagos Home", location: "Douala, Cameroon", type: "Duplex", budget: "$42,500", stage: 3, pct: 30, status: "active", tier: "Self Verify" },
    { name: "Accra Office", location: "Accra, Ghana", type: "Office", budget: "$85,000", stage: 1, pct: 10, status: "active", tier: "Jalla Verify" },
    { name: "Abuja Residence", location: "Abuja, Nigeria", type: "Bungalow", budget: "$28,000", stage: 10, pct: 100, status: "complete", tier: "Self Verify" },
  ];
  const filtered = filter === "all" ? projects : projects.filter(p => p.status === filter);
  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div><h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>My Builds</h2><p style={{ fontSize: 12, color: G.mid }}>3 projects</p></div>
        <Btn primary small>New Build</Btn>
      </div>
      <Card style={{ padding: "8px 12px", marginBottom: 16, display: "flex", alignItems: "center", gap: 4, background: G.off, border: "none" }}>
        <span style={{ fontSize: 10, color: G.soft, marginRight: 4 }}>2 / 3 Self Verify projects used</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#E65100", cursor: "pointer" }}>Upgrade →</span>
      </Card>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["all", "All", 3], ["active", "Active", 2], ["complete", "Complete", 1]].map(([id, label, count]) => (
          <button key={id} onClick={() => setFilter(id)} style={{ background: filter === id ? G.near : G.white, color: filter === id ? G.white : G.mid, border: `1px solid ${filter === id ? G.near : G.border}`, borderRadius: 8, padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{label} <span style={{ opacity: 0.5 }}>({count})</span></button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {filtered.map(p => (
          <Card key={p.name} glow style={{ padding: 18, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <Badge color={p.tier === "Jalla Verify" ? "dark" : "default"}>{p.tier}</Badge>
              <Badge color={p.status === "complete" ? "green" : "blue"}>{p.status === "complete" ? "Complete" : "Active"}</Badge>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: G.mid, marginBottom: 12 }}>{p.type} · {p.location}</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
              <span style={{ color: G.mid }}>Stage {p.stage} / 10</span><span style={{ fontWeight: 700 }}>{p.budget}</span>
            </div>
            <ProgressBar pct={p.pct} color={p.status === "complete" ? "#2E7D32" : G.near} />
          </Card>
        ))}
        <div style={{ border: `2px dashed ${G.border}`, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6, minHeight: 160, cursor: "pointer" }}>
          <div style={{ fontSize: 24, color: G.mid }}>+</div>
          <span style={{ fontSize: 11, fontWeight: 600, color: G.mid }}>New Build</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   2B — MY PROJECTS: LIST VIEW
   ══════════════════════════════════════════════════════════ */
function Projects_B() {
  const projects = [
    { name: "My Lagos Home", location: "Douala, Cameroon", type: "Duplex", budget: "$42,500", stage: 3, pct: 30, status: "Active", tier: "Self Verify" },
    { name: "Accra Office", location: "Accra, Ghana", type: "Office", budget: "$85,000", stage: 1, pct: 10, status: "Active", tier: "Jalla Verify" },
    { name: "Abuja Residence", location: "Abuja, Nigeria", type: "Bungalow", budget: "$28,000", stage: 10, pct: 100, status: "Complete", tier: "Self Verify" },
  ];
  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800 }}>My Builds</h2>
        <Btn primary small>+ New Build</Btn>
      </div>
      {projects.map((p, i) => (
        <Card key={p.name} glow style={{ padding: 16, marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: p.status === "Complete" ? "#E8F5E9" : G.light, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
            {p.status === "Complete" ? "✓" : "🏗"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</span>
              <Badge color={p.tier === "Jalla Verify" ? "dark" : "default"}>{p.tier}</Badge>
            </div>
            <div style={{ fontSize: 11, color: G.mid, marginBottom: 6 }}>{p.type} · {p.location}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, maxWidth: 160 }}><ProgressBar pct={p.pct} color={p.status === "Complete" ? "#2E7D32" : G.near} height={4} /></div>
              <span style={{ fontSize: 10, color: G.mid }}>Stage {p.stage}/10</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{p.budget}</div>
            <Badge color={p.status === "Complete" ? "green" : "blue"}>{p.status}</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   3A — PROJECT OVERVIEW: FULL ANALYTICS
   ══════════════════════════════════════════════════════════ */
function Overview_A() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: G.mid }}>Duplex · Cameroon</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>My Lagos Home</h2>
          <Badge color="green">Live</Badge>
          <Badge>Self Verify</Badge>
        </div>
        <div style={{ fontSize: 12, color: G.soft, marginTop: 4 }}>3 bed · 2 floors · Long span aluminum</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Days Active", value: "21", sub: "since Jul 1" },
          { label: "Complete", value: "30%", sub: "3 of 10 stages" },
          { label: "Current Stage", value: "Block Work", sub: "Stage 3" },
          { label: "Next Milestone", value: "$8,250", sub: "Stage 4: Decking" },
        ].map(s => (
          <Card key={s.label} style={{ padding: 14 }}>
            <div style={{ fontSize: 10, color: G.mid, fontWeight: 600, marginBottom: 4, letterSpacing: "0.04em" }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: G.soft }}>{s.sub}</div>
          </Card>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
        <div>
          <Card glow style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Budget Allocation</div>
            <div style={{ display: "flex", gap: 2, borderRadius: 6, overflow: "hidden", marginBottom: 12, height: 8 }}>
              {[["Materials", 41, "#333"], ["Labour", 23, "#555"], ["Engineering", 16, "#777"], ["Permits", 2, "#999"], ["Contingency", 8, "#BBB"], ["PM", 10, "#DDD"]].map(([l, w, c]) => (
                <div key={l} style={{ flex: w, background: c, height: "100%" }} title={`${l}: ${w}%`} />
              ))}
            </div>
            {[["Materials", "41%", "$17,425"], ["Labour", "23%", "$9,775"], ["Engineering", "16%", "$6,800"], ["Permits", "2%", "$850"], ["Contingency", "8%", "$3,400"], ["Project Management", "10%", "$4,250"]].map(([l, p, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12 }}>
                <span style={{ color: G.mid }}>{l}</span><span><span style={{ color: G.soft, marginRight: 8 }}>{p}</span><span style={{ fontWeight: 600 }}>{v}</span></span>
              </div>
            ))}
          </Card>
          <Card glow>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Payment Status</div>
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 24, marginBottom: 8 }}>
              <div style={{ width: "19.4%", background: "#2E7D32", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "white", fontWeight: 700 }}>$8,250</div>
              <div style={{ width: "12.9%", background: "#1565C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "white", fontWeight: 700 }}>$5,500</div>
              <div style={{ flex: 1, background: G.light }} />
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 10, color: G.mid }}><span>Paid $8,250</span><span>Active $5,500</span><span>Remaining $28,750</span></div>
          </Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, marginBottom: 8 }}>STAGE TRACKER</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {Array.from({ length: 10 }, (_, i) => {
                const done = i < 2; const active = i === 2;
                return <div key={i} style={{ width: 28, height: 28, borderRadius: "50%", background: done ? "#2E7D32" : active ? G.near : G.light, color: done || active ? G.white : G.mid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, margin: "0 auto", boxShadow: active ? "0 0 0 3px rgba(0,0,0,0.15)" : "none" }}>{done ? "✓" : i + 1}</div>;
              })}
            </div>
          </Card>
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, marginBottom: 6 }}>TIMELINE</div>
            {[["Started", "Jul 1, 2026"], ["Projected end", "Jan 2027"], ["Days remaining", "175"], ["Duration", "~196 days"]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11 }}><span style={{ color: G.mid }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span></div>
            ))}
          </Card>
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: G.mid, marginBottom: 6 }}>LOCATION</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Douala, Cameroon 🇨🇲</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   3B — PROJECT OVERVIEW: CLEAN / COMPACT
   ══════════════════════════════════════════════════════════ */
function Overview_B() {
  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <Card dark style={{ padding: "24px 28px", marginBottom: 20, textAlign: "center" }}>
        <Badge color="green">Active — Stage 3</Badge>
        <h2 style={{ fontSize: 26, fontWeight: 800, margin: "12px 0 4px" }}>My Lagos Home</h2>
        <p style={{ fontSize: 12, opacity: 0.45 }}>Duplex · Douala, Cameroon · 3 bed · 2 floors</p>
        <div style={{ fontSize: 36, fontWeight: 900, margin: "16px 0 4px" }}>$42,500</div>
        <div style={{ fontSize: 11, opacity: 0.35 }}>total estimated budget</div>
        <div style={{ margin: "16px auto 0", maxWidth: 300 }}><ProgressBar pct={30} color="#fff" height={6} /></div>
        <div style={{ fontSize: 10, opacity: 0.35, marginTop: 6 }}>30% complete · 21 days active</div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[["Released", "$8,250", "green"], ["In Progress", "$5,500", "blue"], ["Locked", "$28,750", "default"]].map(([l, v, c]) => (
          <Card key={l} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: G.mid, fontWeight: 600, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div>
          </Card>
        ))}
      </div>
      <Card glow style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Construction Pipeline</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 16 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const done = i < 2; const active = i === 2;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: done ? "#2E7D32" : active ? G.near : G.light, color: done || active ? G.white : G.mid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{done ? "✓" : i + 1}</div>
                {i < 9 && <div style={{ flex: 1, height: 2, background: done ? "#2E7D32" : G.light, margin: "0 2px" }} />}
              </div>
            );
          })}
        </div>
        <div style={{ background: G.off, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Stage 3: Block Work & Walls</div>
          <div style={{ fontSize: 11, color: G.mid }}>$6,375 milestone · 4 substages · 2 evidence files uploaded</div>
        </div>
      </Card>
      <Card glow>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Budget Breakdown</div>
        {[["Materials", 41], ["Labour", 23], ["Engineering", 16], ["PM", 10], ["Contingency", 8], ["Permits", 2]].map(([l, p]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
            <span style={{ fontSize: 11, color: G.mid, width: 90 }}>{l}</span>
            <div style={{ flex: 1 }}><ProgressBar pct={p} color={G.near} height={6} /></div>
            <span style={{ fontSize: 11, fontWeight: 600, width: 60, textAlign: "right" }}>${(42500 * p / 100).toLocaleString()}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   4A — STAGES: HORIZONTAL PIPELINE WITH EXPANDED DETAIL
   ══════════════════════════════════════════════════════════ */
function Stages_A() {
  const [selected, setSelected] = useState(2);
  const stages = ["Land", "Foundation", "Block Work", "Decking", "Roofing", "Plaster", "MEP", "Finishing", "External", "Handover"];
  const substages = ["Cement block delivery confirmed", "Block laying — ground floor walls", "Block laying — first floor walls", "Lintel casting and placement", "Quality check — wall alignment"];
  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div><h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Construction Pipeline</h3><p style={{ fontSize: 11, color: G.mid }}>3 / 10 complete</p></div>
        <Btn outline small>Invite Contractor</Btn>
      </div>
      <div style={{ overflowX: "auto", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 0, alignItems: "center", minWidth: 700 }}>
          {stages.map((s, i) => {
            const done = i < 2; const active = i === selected;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                <div onClick={() => i <= 2 && setSelected(i)} style={{ textAlign: "center", cursor: i <= 2 ? "pointer" : "default", flex: "0 0 auto" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: done ? "#2E7D32" : i === 2 ? G.near : G.light, color: done || i === 2 ? G.white : G.mid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, margin: "0 auto 4px", boxShadow: active ? "0 0 0 3px rgba(0,0,0,0.12)" : "none", transition: "all 0.2s" }}>{done ? "✓" : i + 1}</div>
                  <div style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: i > 2 ? G.soft : G.near, maxWidth: 60, margin: "0 auto", lineHeight: 1.2 }}>{s}</div>
                </div>
                {i < 9 && <div style={{ flex: 1, height: 2, background: done ? "#2E7D32" : G.light, margin: "0 2px", marginBottom: 16 }} />}
              </div>
            );
          })}
        </div>
      </div>
      <Card glow>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <Badge color={selected < 2 ? "green" : "blue"}>{selected < 2 ? "Complete" : "In Progress"}</Badge>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginTop: 8, marginBottom: 2 }}>Stage {selected + 1}: {stages[selected]}</h3>
            <div style={{ fontSize: 12, color: G.mid }}>${(42500 * [5, 10, 15, 10, 12.5, 8, 12, 15, 7.5, 5][selected] / 100).toLocaleString()} milestone · {[5, 10, 15, 10, 12.5, 8, 12, 15, 7.5, 5][selected]}% of budget</div>
          </div>
          {selected < 2 && <Btn small outline>Certificate ↓</Btn>}
        </div>
        {substages.map((ss, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i > 0 ? `1px solid ${G.light}` : "none" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: i < 2 ? "#2E7D32" : i === 2 ? "#E3F2FD" : G.light, color: i < 2 ? G.white : i === 2 ? "#1565C0" : G.mid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i < 2 ? "✓" : i + 1}</div>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{ss}</div>
            {i < 3 && <Btn small outline>Evidence</Btn>}
            {i < 2 && <Badge color="green">Done</Badge>}
            {i === 2 && <Badge color="blue">In Progress</Badge>}
          </div>
        ))}
        {selected === 2 && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${G.border}` }}>
            <Btn primary full>Approve Stage 3</Btn>
            <p style={{ fontSize: 10, color: G.soft, textAlign: "center", marginTop: 8 }}>This will release the $6,375 milestone and unlock Stage 4.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   4B — STAGES: COMPACT PIPELINE WITH INLINE SUBSTAGES
   ══════════════════════════════════════════════════════════ */
function Stages_B() {
  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>Stages</h3>
        <span style={{ fontSize: 12, color: G.mid }}>3 / 10</span>
      </div>
      {[
        { n: 1, name: "Land Acquisition", status: "done", sub: 3 },
        { n: 2, name: "Foundation", status: "done", sub: 5 },
        { n: 3, name: "Block Work & Walls", status: "active", sub: 5, detail: true },
        { n: 4, name: "Decking", status: "locked", sub: 4 },
        { n: 5, name: "Roofing", status: "locked", sub: 3 },
      ].map(s => (
        <Card key={s.n} style={{ padding: s.detail ? 18 : 14, marginBottom: 8, opacity: s.status === "locked" ? 0.5 : 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: s.status === "done" ? "#2E7D32" : s.status === "active" ? G.near : G.light, color: s.status === "locked" ? G.mid : G.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{s.status === "done" ? "✓" : s.n}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 10, color: G.mid }}>{s.sub} substages · ${(42500 * [5,10,15,10,12.5][s.n-1] / 100).toLocaleString()}</div>
            </div>
            <Badge color={s.status === "done" ? "green" : s.status === "active" ? "blue" : "default"}>{s.status === "done" ? "Done" : s.status === "active" ? "Active" : "Locked"}</Badge>
          </div>
          {s.detail && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${G.light}` }}>
              {["Cement block delivery", "Ground floor walls", "First floor walls", "Lintel casting", "Wall alignment check"].map((ss, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", paddingLeft: 44 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${i < 2 ? "#2E7D32" : G.border}`, background: i < 2 ? "#2E7D32" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {i < 2 && <span style={{ color: "white", fontSize: 9 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 11, flex: 1, color: i < 2 ? G.soft : G.near, textDecoration: i < 2 ? "line-through" : "none" }}>{ss}</span>
                  {i >= 2 && <span style={{ fontSize: 10, color: G.mid, cursor: "pointer" }}>Upload</span>}
                </div>
              ))}
              <div style={{ marginTop: 12, paddingLeft: 44 }}><Btn primary full small>Approve Stage 3</Btn></div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   5A — BUDGET: DETAILED BREAKDOWN
   ══════════════════════════════════════════════════════════ */
function Budget_A() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div><h3 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>$42,500</h3><p style={{ fontSize: 12, color: G.mid }}>USD · Indicative estimate</p></div>
        <Btn outline small>Export PDF</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
        {[["Total Budget", "$42,500"], ["Released", "$8,250", "#2E7D32"], ["Held", "$5,500", "#1565C0"], ["Remaining", "$28,750"]].map(([l, v, c]) => (
          <Card key={l} style={{ padding: 14, borderLeft: c ? `3px solid ${c}` : undefined }}>
            <div style={{ fontSize: 10, color: G.mid, fontWeight: 600, marginBottom: 2 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c || G.near }}>{v}</div>
          </Card>
        ))}
      </div>
      <Card glow style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Trade Breakdown</div>
        {[["Materials", 41, "$17,425"], ["Labour", 23, "$9,775"], ["Engineering", 16, "$6,800"], ["Project Management", 10, "$4,250"], ["Contingency", 8, "$3,400"], ["Permits", 2, "$850"]].map(([l, p, v]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
            <span style={{ fontSize: 11, color: G.mid, width: 120 }}>{l}</span>
            <div style={{ flex: 1 }}><ProgressBar pct={p} color={G.near} height={8} /></div>
            <span style={{ fontSize: 11, fontWeight: 600, width: 55, textAlign: "right" }}>{p}%</span>
            <span style={{ fontSize: 11, fontWeight: 700, width: 65, textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </Card>
      <Card glow>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Payment Timeline</div>
        <div style={{ paddingLeft: 14, borderLeft: `2px solid ${G.border}` }}>
          {[
            { stage: "Stage 1: Land", amount: "$2,125", date: "Jul 5", status: "released" },
            { stage: "Stage 2: Foundation", amount: "$4,250", date: "Jul 12", status: "released" },
            { stage: "Stage 3: Block Work", amount: "$6,375", date: "—", status: "active" },
            { stage: "Stage 4: Decking", amount: "$4,250", date: "—", status: "locked" },
          ].map((p, i) => (
            <div key={i} style={{ position: "relative", paddingLeft: 18, paddingBottom: 16 }}>
              <div style={{ position: "absolute", left: -9, top: 4, width: 12, height: 12, borderRadius: "50%", background: p.status === "released" ? "#2E7D32" : p.status === "active" ? "#1565C0" : G.border, border: "2px solid white" }} />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 12, fontWeight: 600 }}>{p.stage}</div><div style={{ fontSize: 10, color: G.soft }}>{p.date}</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 700 }}>{p.amount}</div><Badge color={p.status === "released" ? "green" : p.status === "active" ? "blue" : "default"}>{p.status === "released" ? "Released" : p.status === "active" ? "In Progress" : "Locked"}</Badge></div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   5B — BUDGET: VISUAL-FORWARD
   ══════════════════════════════════════════════════════════ */
function Budget_B() {
  return (
    <div style={{ maxWidth: 580, margin: "0 auto" }}>
      <Card dark style={{ textAlign: "center", padding: "28px", marginBottom: 20 }}>
        <div style={{ fontSize: 10, opacity: 0.4, letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>PROJECT BUDGET</div>
        <div style={{ fontSize: 42, fontWeight: 900 }}>$42,500</div>
        <div style={{ fontSize: 12, opacity: 0.35, marginBottom: 16 }}>USD · based on Cameroon construction rates</div>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", height: 28 }}>
          <div style={{ width: "19.4%", background: "#2E7D32", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>19%</div>
          <div style={{ width: "12.9%", background: "#1565C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>13%</div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, opacity: 0.5 }}>
          <span>Released $8,250</span><span>Held $5,500</span><span>Remaining $28,750</span>
        </div>
      </Card>
      <Card glow>
        {[["Materials", 41], ["Labour", 23], ["Engineering", 16], ["PM", 10], ["Contingency", 8], ["Permits", 2]].map(([l, p]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${G.light}` }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: G.off, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: G.mid, flexShrink: 0 }}>{p}%</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{l}</div>
              <ProgressBar pct={p} height={4} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>${(42500 * p / 100).toLocaleString()}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN NAV
   ══════════════════════════════════════════════════════════ */
export default function ClientScreens() {
  const [screen, setScreen] = useState("dashboard");
  const [variant, setVariant] = useState("A");
  const screens = [{id:"dashboard",label:"Dashboard"},{id:"projects",label:"My Projects"},{id:"overview",label:"Project Overview"},{id:"stages",label:"Stages"},{id:"budget",label:"Budget"}];
  const components = {dashboard:{A:Dashboard_A,B:Dashboard_B},projects:{A:Projects_A,B:Projects_B},overview:{A:Overview_A,B:Overview_B},stages:{A:Stages_A,B:Stages_B},budget:{A:Budget_A,B:Budget_B}};
  const Comp = components[screen][variant];
  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: G.off, minHeight: "100vh", color: G.near }}>
      <div style={{ background: G.near, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ color: G.white, fontWeight: 800, fontSize: 15 }}>Groundwork</span><span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>by Jalla</span></div>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 600 }}>Client Screens — For Philip's Review</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 3, padding: "12px 16px", borderBottom: `1px solid ${G.border}`, background: G.white, flexWrap: "wrap" }}>
        {screens.map(s => (<button key={s.id} onClick={() => {setScreen(s.id);setVariant("A");}} style={{ background: screen===s.id?G.near:"transparent", color: screen===s.id?G.white:G.mid, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{s.label}</button>))}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "10px 16px", background: G.white, borderBottom: `1px solid ${G.border}` }}>
        {["A","B"].map(v => (<button key={v} onClick={() => setVariant(v)} style={{ background: variant===v?G.near:G.light, color: variant===v?G.white:G.mid, border: "none", borderRadius: 6, padding: "6px 20px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Design {v}</button>))}
        <span style={{ fontSize: 10, color: G.soft, alignSelf: "center", marginLeft: 8 }}>{variant==="A"?"Data-rich / analytics-forward":"Minimal / focus-forward"}</span>
      </div>
      <div style={{ padding: "32px 20px", maxWidth: 960, margin: "0 auto" }}><Comp /></div>
    </div>
  );
}
