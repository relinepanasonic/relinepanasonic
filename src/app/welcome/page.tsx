import { WORKSPACES } from "@/lib/workspace";

// Landing page — the front door. Every new session must pick a workspace
// here before anything else (see proxy.ts). Public: no login needed yet.
export const metadata = { title: "Reline Project — Choose your workspace" };

const COPY: Record<string, { badge: string; badgeTone: "live" | "new"; lines: string[]; note: string }> = {
  gobel: {
    badge: "LIVE",
    badgeTone: "live",
    lines: ["Dealer network dashboard", "Sales · Ads · Baseline · Etalase", "Upload, Core List, Calculator, BOD report"],
    note: "Existing data",
  },
  light: {
    badge: "NEW",
    badgeTone: "new",
    lines: ["Same dashboard, same tools", "Its own separate database", "Ready for the first upload"],
    note: "No data yet",
  },
};

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const deniedName = WORKSPACES.find((w) => w.id === denied)?.name;

  return (
    <div className="ws-wrap">
      <style>{CSS}</style>
      <div className="ws-rings" aria-hidden>
        <span style={{ top: "-20%", right: "-10%", width: 620, height: 620 }} />
        <span style={{ top: "-8%", right: "-4%", width: 400, height: 400 }} />
        <span style={{ bottom: "-22%", left: "-10%", width: 520, height: 520 }} />
      </div>

      <main className="ws-main">
        <img src="/logo-transparent.png" alt="Reline" className="ws-logo" />
        <h1>Reline Project</h1>
        <p className="ws-sub">Choose your workspace to continue</p>

        {deniedName && (
          <div className="ws-denied">
            Your account does not have access to <b>{deniedName}</b>. Pick another workspace, or ask a Super Admin to add you.
          </div>
        )}

        <div className="ws-cards">
          {WORKSPACES.map((w) => {
            const c = COPY[w.id];
            return (
              <a key={w.id} href={`/api/workspace?ws=${w.id}`} className="ws-card">
                <div className="ws-card-top">
                  <span className={`ws-badge ${c.badgeTone}`}>{c.badge}</span>
                  <span className="ws-note">{c.note}</span>
                </div>
                <h2>{w.name}</h2>
                <ul>
                  {c.lines.map((l) => <li key={l}>{l}</li>)}
                </ul>
                <div className="ws-go">Enter workspace <span>→</span></div>
              </a>
            );
          })}
        </div>

        <p className="ws-foot">You can switch workspace any time from the sidebar.</p>
      </main>
    </div>
  );
}

const CSS = `
.ws-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 20px;position:relative;overflow:hidden;
  background:linear-gradient(135deg,#0a1628 0%,#0f2040 50%,#1a3461 100%);color:#e8edf8;font-family:inherit}
.ws-rings span{position:absolute;border-radius:50%;border:1px solid rgba(201,162,39,.1);pointer-events:none}
.ws-main{position:relative;width:100%;max-width:880px;text-align:center}
.ws-logo{width:96px;height:96px;object-fit:contain;margin:0 auto 6px;display:block}
.ws-main h1{font-size:30px;font-weight:800;letter-spacing:.03em;margin:0}
.ws-sub{color:#7b8db0;font-size:15px;margin:6px 0 30px}
.ws-denied{max-width:560px;margin:0 auto 22px;padding:11px 16px;border-radius:10px;font-size:13px;line-height:1.5;
  background:rgba(214,69,69,.12);border:1px solid rgba(214,69,69,.35);color:#f3c4c4}
.ws-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;text-align:left}
.ws-card{display:flex;flex-direction:column;gap:12px;padding:26px 26px 22px;border-radius:18px;text-decoration:none;color:inherit;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);box-shadow:0 20px 50px rgba(0,0,0,.35);
  transition:transform .18s ease,border-color .18s ease,background .18s ease}
.ws-card:hover,.ws-card:focus-visible{transform:translateY(-4px);border-color:rgba(201,162,39,.65);background:rgba(201,162,39,.07);outline:none}
.ws-card-top{display:flex;align-items:center;justify-content:space-between}
.ws-badge{font-size:10.5px;font-weight:800;letter-spacing:.14em;padding:4px 10px;border-radius:999px}
.ws-badge.live{background:rgba(46,158,107,.18);color:#6fe0ad;border:1px solid rgba(46,158,107,.4)}
.ws-badge.new{background:rgba(201,162,39,.16);color:#e8c84a;border:1px solid rgba(201,162,39,.45)}
.ws-note{font-size:12px;color:#7b8db0}
.ws-card h2{font-size:23px;font-weight:800;margin:4px 0 0;color:#fff}
.ws-card ul{list-style:none;padding:0;margin:0;display:grid;gap:7px;color:#b8c4dd;font-size:13.5px}
.ws-card li::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#c9a227;margin-right:10px;vertical-align:middle}
.ws-go{margin-top:8px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);font-weight:700;font-size:14px;color:#c9a227;display:flex;justify-content:space-between}
.ws-card:hover .ws-go span{transform:translateX(4px)}
.ws-go span{transition:transform .18s ease}
.ws-foot{margin-top:26px;font-size:12px;color:#5f7196}
@media (max-width:720px){.ws-cards{grid-template-columns:1fr}.ws-main h1{font-size:25px}}
`;
