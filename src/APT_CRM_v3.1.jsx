// ============================================================
//  APT CRM v3.1 — src/App.jsx
//  Changes from v3.0:
//  + PDF generation via invoice-generator.com on invoice save
//  + Download PDF button on every invoice
//  + Drive save to folder 1cCU3BBUbHE1YeTTxxOGJztMtpqplQ8sk
//  + Void Invoice button
//  + Add Vendor form
//  + Rider sync indicator
// ============================================================

import { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  signInWithEmailAndPassword
} from "firebase/auth";

const firebaseConfig = {
  apiKey:     import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:  import.meta.env.VITE_FIREBASE_PROJECT_ID,
};
const firebaseApp    = initializeApp(firebaseConfig);
const auth           = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

const ALLOWED_EMAILS = [
  "ahsanilyas35@gmail.com",
  "tahafayyazlp@gmail.com",
];

// Robust fetch helper that handles HTML/non-JSON responses gracefully
async function safeGasFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  
  if (!res.ok) {
    try {
      const errJson = JSON.parse(text);
      throw new Error(errJson.error || errJson.message || `HTTP status ${res.status}`);
    } catch(e) {
      if (text.trim().startsWith("<")) {
        throw new Error("Vercel Serverless Function or upstream Apps Script returned HTML. Check API deployment and logs.");
      }
      throw new Error(text.substring(0, 100) || `HTTP status ${res.status}`);
    }
  }
  
  try {
    return JSON.parse(text);
  } catch(e) {
    if (text.trim().startsWith("<")) {
      throw new Error("Server returned HTML page instead of JSON. Ensure Web App is deployed and 'Anyone' can access it.");
    }
    throw new Error(`Invalid JSON response: ${e.message} (${text.substring(0, 50)})`);
  }
}

async function gasGet(action, params = {}) {
  const url = new URL("/api/gas", window.location.origin);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const json = await safeGasFetch(url.toString());
  if (!json.success) throw new Error(json.error || "API error");
  return json.data;
}

async function gasPost(action, data, extra = {}) {
  const json = await safeGasFetch("/api/gas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data, ...extra }),
  });
  if (!json.success) throw new Error(json.error || "API error");
  return json.data;
}

async function sbPost(action, params = {}) {
  const res = await fetch("/api/supabase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Supabase error");
  return json.data !== undefined ? json.data : [];
}

const RIDER_HUB_TABS = new Set(["rider-orders","rider-stores","riders","locations","rider-products","store-assign","areas","rider-reports","rider-config"]);

// ── Brand Colors ──────────────────────────────────────────────
const G = {
  dark:"#1A5C20", mid:"#2E7D32", light:"#4CAF50", pale:"#E8F5E9",
  accent:"#8BC34A", gold:"#F9A825", amber:"#FF8F00", red:"#C62828",
  pink:"#FFEBEE", blue:"#1565C0", sky:"#E3F2FD", purple:"#6A1B9A",
  ink:"#1B2B1C", muted:"#607D63", white:"#FFFFFF", bg:"#F4FAF4",
  card:"#FFFFFF", border:"#D0E8D0", sidebar:"#0F2010",
};

const fmt  = n => "PKR " + Math.round(n || 0).toLocaleString("en-PK");
const pct  = (a, b) => b ? ((a / b) * 100).toFixed(1) + "%" : "—";
const todayStr = () => new Date().toISOString().split("T")[0];
// Normalizers for fuzzy matching store/customer/product names across systems.
const normTxt = s => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const digitsOnly = s => (s || "").toString().replace(/\D+/g, "");

// ── Primitive components ──────────────────────────────────────
const Badge = ({ text }) => {
  const m = {
    Paid:{bg:"#E8F5E9",c:G.mid}, Partial:{bg:"#FFF8E1",c:G.amber},
    Unpaid:{bg:G.pink,c:G.red}, VOIDED:{bg:"#F5F5F5",c:"#9E9E9E"},
    Active:{bg:"#E8F5E9",c:G.mid}, Received:{bg:"#E8F5E9",c:G.mid},
    Made:{bg:G.pink,c:G.red}, Overdue:{bg:G.pink,c:G.red},
  };
  const s = m[text]||{bg:G.pale,c:G.dark};
  return <span style={{background:s.bg,color:s.c,padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>{text}</span>;
};

const Inp = ({label,style:st,...p}) => (
  <div style={{display:"flex",flexDirection:"column",gap:4,...st}}>
    {label&&<label style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</label>}
    <input style={{border:`1.5px solid ${G.border}`,borderRadius:8,padding:"8px 11px",fontSize:13,color:G.ink,background:G.bg,outline:"none",width:"100%",boxSizing:"border-box"}} {...p}/>
  </div>
);
const Sel = ({label,children,style:st,...p}) => (
  <div style={{display:"flex",flexDirection:"column",gap:4,...st}}>
    {label&&<label style={{fontSize:10,fontWeight:700,color:G.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</label>}
    <select style={{border:`1.5px solid ${G.border}`,borderRadius:8,padding:"8px 11px",fontSize:13,color:G.ink,background:G.bg,outline:"none",width:"100%",boxSizing:"border-box"}} {...p}>{children}</select>
  </div>
);
const Btn = ({children,v="primary",onClick,sm,disabled,full}) => {
  const vs={primary:{bg:G.dark,c:G.white,br:"none"},secondary:{bg:G.pale,c:G.dark,br:`1.5px solid ${G.mid}`},danger:{bg:G.pink,c:G.red,br:`1.5px solid ${G.red}`},success:{bg:G.mid,c:G.white,br:"none"},ghost:{bg:"transparent",c:G.muted,br:`1.5px solid ${G.border}`},amber:{bg:"#FFF8E1",c:G.amber,br:`1.5px solid ${G.amber}`}};
  const s=vs[v]||vs.primary;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.br,borderRadius:8,padding:sm?"5px 11px":"9px 18px",fontSize:sm?11:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",gap:5,whiteSpace:"nowrap",opacity:disabled?0.6:1,width:full?"100%":"auto",justifyContent:full?"center":"flex-start"}}>{children}</button>;
};
const Kpi = ({label,value,sub,color,trend}) => (
  <div style={{background:G.card,borderRadius:12,padding:"14px 16px",boxShadow:"0 2px 12px rgba(26,92,32,0.08)",borderLeft:`3px solid ${color||G.mid}`,display:"flex",flexDirection:"column",gap:5}}>
    <span style={{fontSize:9,fontWeight:700,color:G.muted,letterSpacing:"0.09em",textTransform:"uppercase"}}>{label}</span>
    <div style={{fontSize:20,fontWeight:800,color:G.ink,letterSpacing:"-0.03em"}}>{value}</div>
    {sub&&<div style={{fontSize:10,color:trend==="up"?G.mid:trend==="dn"?G.red:G.muted}}>{trend==="up"?"↑ ":trend==="dn"?"↓ ":""}{sub}</div>}
  </div>
);
const Modal = ({title,onClose,children,wide}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
    <div style={{background:G.white,borderRadius:14,width:"100%",maxWidth:wide?720:480,maxHeight:"92vh",overflow:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.35)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",background:G.dark,borderRadius:"14px 14px 0 0"}}>
        <h3 style={{margin:0,color:G.white,fontSize:15,fontWeight:700}}>{title}</h3>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.12)",border:"none",borderRadius:7,cursor:"pointer",padding:"4px 9px",color:G.white,fontSize:15}}>✕</button>
      </div>
      <div style={{padding:20}}>{children}</div>
    </div>
  </div>
);
const TblWrap = ({heads,rows,compact}) => (
  <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:compact?11:12}}>
      <thead><tr style={{background:G.dark}}>{heads.map(h=><th key={h} style={{padding:compact?"7px 11px":"9px 13px",textAlign:"left",fontWeight:700,color:G.white,fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r,i)=><tr key={i} style={{background:i%2===0?G.bg:G.card,borderBottom:`1px solid ${G.pale}`}}>{r.map((c,j)=><td key={j} style={{padding:compact?"6px 11px":"8px 13px",verticalAlign:"middle"}}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

// ── PDF Download Button ───────────────────────────────────────
const PdfBtn = ({ invId, pdfUrl, onGenerate, sm }) => {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState(pdfUrl || "");

  const handle = async () => {
    if (url) { window.open(url, "_blank"); return; }
    setLoading(true);
    try {
      const result = await gasPost("generate_pdf", null, { invId });
      setUrl(result.url);
      window.open(result.url, "_blank");
      if (onGenerate) onGenerate(result.url);
    } catch(e) {
      alert("PDF error: " + e.message);
    } finally { setLoading(false); }
  };

  return (
    <button onClick={handle} disabled={loading} style={{
      background: url ? "#E3F2FD" : G.pale,
      color: url ? G.blue : G.dark,
      border: `1.5px solid ${url ? G.blue : G.mid}`,
      borderRadius: 8,
      padding: sm ? "4px 10px" : "8px 14px",
      fontSize: sm ? 11 : 12,
      fontWeight: 700,
      cursor: loading ? "wait" : "pointer",
      display: "inline-flex", alignItems: "center", gap: 5,
      whiteSpace: "nowrap",
    }}>
      {loading ? "⏳" : url ? "📄" : "🖨"} {loading ? "Generating..." : url ? "Download PDF" : "Generate PDF"}
    </button>
  );
};

// ── Invoice Line Items (fetched on demand) ───────────────────
const InvoiceItems = ({ invId }) => {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    setItems(null); setErr("");
    gasGet("invoice_items", { id: invId })
      .then(d => { if (on) setItems(Array.isArray(d) ? d : []); })
      .catch(e => { if (on) setErr(e.message); });
    return () => { on = false; };
  }, [invId]);

  if (err) return <div style={{fontSize:11,color:G.red,padding:"8px 2px"}}>❌ Could not load items: {err}</div>;
  if (items === null) return <div style={{fontSize:11,color:G.muted,padding:"8px 2px"}}>⏳ Loading line items…</div>;
  if (!items.length) return <div style={{fontSize:11,color:G.muted,padding:"8px 2px"}}>No line items found for this invoice.</div>;

  const total = items.reduce((s,it)=>s+(it.total || it.qty*it.rate || 0),0);
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontWeight:700,color:G.dark,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Line Items</div>
      <TblWrap compact heads={["Product","Qty","Rate","Amount"]}
        rows={items.map(it=>[
          <span style={{fontWeight:600,fontSize:11}}>{it.pname || it.pid}</span>,
          <span style={{fontSize:11}}>{it.qty}</span>,
          <span style={{fontSize:11}}>{fmt(it.rate)}</span>,
          <span style={{fontWeight:700,fontSize:11}}>{fmt(it.total || it.qty*it.rate)}</span>,
        ])}
      />
      <div style={{textAlign:"right",fontWeight:800,fontSize:12,color:G.ink,padding:"8px 4px 0"}}>Items Total: {fmt(total)}</div>
    </div>
  );
};

// ── Auth screens ──────────────────────────────────────────────
const LoginScreen = ({ error }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(error || "");

  useEffect(() => {
    setErr(error || "");
  }, [error]);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setErr("Please enter both email and password.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      let msg = e.message;
      if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
        msg = "Invalid email or password. Please try again.";
      } else if (e.code === "auth/invalid-email") {
        msg = "The email address is badly formatted.";
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErr("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch(e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:`linear-gradient(135deg,#0D1F0E 0%,${G.dark} 100%)`,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <div style={{background:G.white,borderRadius:20,padding:35,width:340,boxShadow:"0 40px 100px rgba(0,0,0,0.5)",textAlign:"center"}}>
        <div style={{width:64,height:64,background:`linear-gradient(135deg,${G.mid},${G.accent})`,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 18px",boxShadow:`0 8px 24px ${G.mid}44`}}>🌿</div>
        <h1 style={{margin:"0 0 3px",fontSize:24,fontWeight:800,color:G.ink}}>APT CRM</h1>
        <p style={{margin:"0 0 6px",fontSize:10,color:G.muted,letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:700}}>Assorted Produce Traders</p>
        <p style={{margin:"0 0 24px",fontSize:12,color:G.muted}}>Distribution Management System</p>
        
        {err && <div style={{background:G.pink,borderRadius:8,padding:"10px 14px",marginBottom:18,fontSize:12,color:G.red,fontWeight:600,textAlign:"left"}}>⛔ {err}</div>}
        
        <form onSubmit={handleEmailLogin} style={{textAlign:"left",marginBottom:20}}>
          <div style={{marginBottom:14}}>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:5}}>Email Address</label>
            <input 
              type="email" 
              placeholder="e.g. user@assortedtrade.com" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              style={{width:"100%",boxSizing:"border-box",padding:"11px 14px",borderRadius:10,border:`1px solid ${G.border}`,fontSize:13,outline:"none",transition:"border 0.2s"}}
            />
          </div>
          <div style={{marginBottom:20}}>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:5}}>Password</label>
            <input 
              type="password" 
              placeholder="••••••••" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              style={{width:"100%",boxSizing:"border-box",padding:"11px 14px",borderRadius:10,border:`1px solid ${G.border}`,fontSize:13,outline:"none",transition:"border 0.2s"}}
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            style={{width:"100%",background:G.mid,color:G.white,border:"none",borderRadius:12,padding:"12px",fontSize:14,fontWeight:700,cursor:loading?"wait":"pointer",boxShadow:`0 4px 12px ${G.mid}33`}}
          >
            {loading ? "⏳ Connecting..." : "🔑 Sign In with Password"}
          </button>
        </form>

        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
          <div style={{flex:1,height:"1px",background:G.border}}/>
          <span style={{fontSize:11,color:G.muted,fontWeight:600}}>OR CONNECT WITH</span>
          <div style={{flex:1,height:"1px",background:G.border}}/>
        </div>

        <button 
          onClick={handleGoogleLogin} 
          disabled={loading}
          type="button"
          style={{width:"100%",background:"#f1f5f9",color:"#334155",border:`1px solid ${G.border}`,borderRadius:12,padding:"12px",fontSize:14,fontWeight:700,cursor:loading?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,transition:"background 0.2s"}}
        >
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115z"/><path fill="#34A853" d="M16.04 18.013c-1.09.703-2.474 1.078-4.04 1.078a7.077 7.077 0 0 1-6.723-4.823l-4.04 3.067A11.965 11.965 0 0 0 12 24c2.933 0 5.735-1.043 7.834-3l-3.793-2.987z"/><path fill="#4A90E2" d="M19.834 21c2.195-2.048 3.62-5.096 3.62-9 0-.71-.109-1.473-.272-2.182H12v4.637h6.436c-.317 1.559-1.17 2.766-2.395 3.558L19.834 21z"/><path fill="#FBBC05" d="M5.277 14.268A7.12 7.12 0 0 1 4.909 12c0-.782.125-1.533.357-2.235L1.24 6.65A11.934 11.934 0 0 0 0 12c0 1.92.445 3.73 1.237 5.335l4.04-3.067z"/></svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
};

const AccessDenied = ({user,onLogout}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:G.bg,flexDirection:"column",gap:14,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
    <div style={{fontSize:48}}>⛔</div>
    <h2 style={{margin:0,color:G.ink}}>Access Denied</h2>
    <p style={{color:G.muted}}>{user?.email} is not authorised.</p>
    <Btn v="danger" onClick={onLogout}>Sign Out</Btn>
  </div>
);

const LoadingScreen = ({msg}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",flexDirection:"column",gap:16,background:G.bg,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
    <div style={{width:48,height:48,background:G.mid,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🌿</div>
    <div style={{fontSize:14,color:G.muted,fontWeight:600}}>{msg||"Loading..."}</div>
    <div style={{width:180,height:3,background:G.pale,borderRadius:2,overflow:"hidden"}}>
      <div style={{height:"100%",width:"60%",background:G.mid,borderRadius:2,animation:"slide 1.4s ease-in-out infinite"}}/>
    </div>
    <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
  </div>
);

// ═══════════════════════════════════════════════════════════════
//  MAIN CRM
// ═══════════════════════════════════════════════════════════════
function CrmApp({ user, onLogout }) {
  const [tab, setTab]         = useState("dashboard");
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal]     = useState(null);
  const [search, setSearch]   = useState("");
  const [toast, setToast]     = useState(null);
  const [lastSync, setLastSync] = useState(null);
  // PDF url cache: invId → url
  const [pdfCache, setPdfCache] = useState({});
  // ── Rider Hub (Supabase data) ──────────────────────────────
  const [sbData, setSbData] = useState({orders:[],stores:[],riders:[],locations:[],products:[],areas:[],assignments:[],riderAreas:[]});
  const [sbLoading, setSbLoading] = useState(false);
  const [sbSyncing, setSbSyncing] = useState(false);

  const loadSupabase = useCallback(async (silent = false) => {
    if (!silent) setSbLoading(true);
    setSbSyncing(true);
    try {
      const [orders, stores, riders, locs, products, areas, assignments, riderAreas] = await Promise.all([
        sbPost("orders"), sbPost("stores"), sbPost("riders"), sbPost("locations"),
        sbPost("products"), sbPost("areas"), sbPost("store_assignments"), sbPost("rider_areas"),
      ]);
      setSbData({ orders:orders||[], stores:stores||[], riders:riders||[], locations:locs||[], products:products||[], areas:areas||[], assignments:assignments||[], riderAreas:riderAreas||[] });
    } catch(e) { /* notify set in effect below — capture lazily */ console.error("Supabase load:", e); }
    finally { setSbLoading(false); setSbSyncing(false); }
  }, []);

  const notify = useCallback((msg, type="ok") => {
    setToast({msg,type});
    setTimeout(()=>setToast(null), 3500);
  }, []);

  // ── Global undo stack ──────────────────────────────────────
  // pushUndo(label, run) registers a reversible action; `run` is called when
  // the user clicks "Undo" on the resulting snackbar before it expires.
  const [undoStack, setUndoStack] = useState([]);
  const pushUndo = useCallback((label, run, ttl=8000) => {
    const id = Math.random().toString(36).slice(2);
    setUndoStack(s => [...s, {id, label, run}]);
    setTimeout(() => setUndoStack(s => s.filter(e => e.id !== id)), ttl);
  }, []);
  const performUndo = useCallback(async (id) => {
    const entry = undoStack.find(e => e.id === id);
    if (!entry) return;
    setUndoStack(s => s.filter(e => e.id !== id));
    try { await entry.run(); notify(`↩️ Undone: ${entry.label}`); }
    catch(e) { notify("❌ Undo failed: "+e.message, "err"); }
  }, [undoStack, notify]);

  const closeModal = () => setModal(null);

  const loadData = useCallback(async (showSync=false) => {
    if (showSync) setSyncing(true); else setLoading(true);
    try {
      const all = await gasGet("all");
      setData(all);
      setLastSync(new Date());
      if (showSync) notify("✅ Synced from Google Sheet");
    } catch(err) { notify("❌ "+err.message, "err"); }
    finally { setLoading(false); setSyncing(false); }
  }, [notify]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (RIDER_HUB_TABS.has(tab)) loadSupabase(true); }, [tab, loadSupabase]);

  // ── Maps ──────────────────────────────────────────────────
  const customers  = data?.customers  || [];
  const vendors    = data?.vendors    || [];
  const products   = data?.products   || [];
  const invoices   = data?.invoices   || [];
  const purchases  = data?.purchases  || [];
  const payments   = data?.payments   || [];
  const expenses   = data?.expenses   || [];
  const ar         = data?.ar         || [];
  const ap         = data?.ap         || [];
  const inventory  = data?.inventory  || [];
  const snap       = data?.dashboard  || {};

  const custMap = useMemo(()=>Object.fromEntries(customers.map(c=>[c.id,c])),[customers]);
  const vendMap = useMemo(()=>Object.fromEntries(vendors.map(v=>[v.id,v])),[vendors]);
  const prodMap = useMemo(()=>Object.fromEntries(products.map(p=>[p.id,p])),[products]);

  const totalRevenue    = snap.totalInvoiced   || 0;
  const totalReceived   = snap.totalReceived   || 0;
  const totalPurchases  = snap.totalPurchases  || 0;
  const totalExpenses   = snap.totalExpenses   || 0;
  const netProfit       = snap.netProfit       || 0;
  const totalAR         = snap.outstandingAR   || 0;
  const grossProfit     = totalRevenue - totalPurchases;
  const gpMargin        = totalRevenue ? ((grossProfit/totalRevenue)*100).toFixed(1) : 0;
  const npMargin        = totalRevenue ? ((netProfit/totalRevenue)*100).toFixed(1)   : 0;
  const unpaidInv       = useMemo(()=>invoices.filter(i=>i.status==="Unpaid"||i.status==="Partial"),[invoices]);
  const lowStock        = useMemo(()=>inventory.filter(p=>p.stock<=p.minStock&&p.stock>=0),[inventory]);

  // ── PDF cache handler ─────────────────────────────────────
  const cachePdf = (invId, url) => setPdfCache(p=>({...p,[invId]:url}));

  const triggerPdfDownload = (url) => {
    if (!url) return;
    let downloadUrl = url;
    const m = url.match(/\/file\/d\/([^\/]+)/) || url.match(/id=([^&]+)/);
    if (m && m[1]) {
      downloadUrl = `https://drive.google.com/uc?export=download&id=${m[1]}`;
    }
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.target = "_blank";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Generic CSV export: rows is an array of plain objects; column order follows
  // the keys of the first row (or an explicit `cols` array of [key,label] pairs).
  const exportCsv = (filename, rows, cols) => {
    if (!rows || !rows.length) { notify("Nothing to export", "err"); return; }
    const columns = cols || Object.keys(rows[0]).map(k=>[k,k]);
    const esc = (v) => {
      const s = v===null||v===undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const lines = [columns.map(([,label])=>esc(label)).join(",")];
    rows.forEach(r => lines.push(columns.map(([key])=>esc(r[key])).join(",")));
    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── API actions ───────────────────────────────────────────
  const markPaid = async (invId) => {
    const prevStatus = invoices.find(i=>i.id===invId)?.status;
    try {
      await safeGasFetch("/api/gas", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"mark_paid",invId})});
      notify(`✅ ${invId} marked as Paid`);
      await loadData(true);
      if(prevStatus&&prevStatus!=="Paid"){
        pushUndo(`${invId} marked as Paid`, async () => {
          await gasPost("set_invoice_fields",{invId,status:prevStatus});
          await loadData(true);
        });
      }
    } catch(e) { notify("❌ "+e.message,"err"); }
  };

  const voidInvoice = async (invId) => {
    if(!confirm(`Void ${invId}? This will zero the total and reverse AR.`)) return;
    const prev = invoices.find(i=>i.id===invId);
    try {
      await safeGasFetch("/api/gas", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"void_invoice",invId})});
      notify(`✅ ${invId} voided`);
      closeModal();
      await loadData(true);
      if(prev){
        pushUndo(`${invId} voided`, async () => {
          await gasPost("set_invoice_fields",{invId,status:prev.status,total:prev.total});
          await loadData(true);
        });
      }
    } catch(e) { notify("❌ "+e.message,"err"); }
  };

  const deleteInvoice = async (invId) => {
    if(!confirm(`⚠️ WARNING: Are you sure you want to permanently DELETE ${invId}? This will completely remove it from the Google Sheet and cannot be undone.`)) return;
    try {
      const json = await safeGasFetch("/api/gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_invoice", invId })
      });
      if (!json.success) throw new Error(json.error || "Delete failed");
      notify(`✅ ${invId} permanently deleted`);
      closeModal();
      await loadData(true);
    } catch(e) { notify("❌ "+e.message,"err"); }
  };

  const saveInvoice = async (formData) => {
  try {
    const cust = customers.find(c => c.id === formData.custId);
    const custName = cust ? cust.name : "";
    const enrichedItems = formData.items.map(item => {
      const pr = prodMap[item.pid];
      // Drop synthetic/unknown ids (e.g. "x:" rider products) so the sheet stores a clean
      // pid, but keep the product name so the invoice still shows what was ordered.
      return {
        ...item,
        pid: pr ? item.pid : "",
        pname: pr ? pr.name : (item.pname || "")
      };
    });
    // Generate a unique invoice ID if not provided
    const invId = formData.invId || `INV-${Date.now()}`;
    const result = await gasPost("save_invoice", {
      ...formData,
      invId,
      custName,
      customerName: custName,
      customer: custName,
      items: enrichedItems,
      createdBy: user.email
    }, {createdBy: user.email});
    const finalInvId = formData.invId || result.id || invId;
    if (result.pdfUrl) {
      cachePdf(finalInvId, result.pdfUrl);
      // Auto-download PDF immediately in browser
      triggerPdfDownload(result.pdfUrl);
    }
    notify(`✅ ${finalInvId || "Invoice"} saved — ${fmt(enrichedItems.reduce((s,i)=>s+(i.qty*i.rate),0))}`);
    closeModal();
    await loadData(true);
  } catch(e) { notify("❌ "+e.message,"err"); throw e; }
};
  const editInvoice = async (formData) => {
    try {
      const cust = customers.find(c => c.id === formData.custId);
      const custName = cust ? cust.name : "";
      const enrichedItems = formData.items.map(item => {
        const pr = prodMap[item.pid];
        return { ...item, pid: pr ? item.pid : "", pname: pr ? pr.name : (item.pname || "") };
      });
      const result = await gasPost("edit_invoice", {
        ...formData,
        custName,
        items: enrichedItems,
        editedBy: user.email
      });
      if (result.pdfUrl) {
        cachePdf(formData.invId, result.pdfUrl);
        triggerPdfDownload(result.pdfUrl);
      }
      notify(`✅ ${formData.invId} updated — ${fmt(enrichedItems.reduce((s,i)=>s+(i.qty*i.rate),0))}`);
      closeModal();
      await loadData(true);
    } catch(e) { notify("❌ "+e.message,"err"); throw e; }
  };

  const updateCustomer = async (d) => {
    try {
      await gasPost("edit_customer", d);
      notify(`✅ ${d.id} updated`);
      closeModal();
      await loadData(true);
    } catch(e) { notify("❌ "+e.message,"err"); }
  };

  const updateVendor = async (d) => {
    try {
      await gasPost("edit_vendor", d);
      notify(`✅ ${d.id} updated`);
      closeModal();
      await loadData(true);
    } catch(e) { notify("❌ "+e.message,"err"); }
  };

  const saveExpense = async (d) => {
    try { await gasPost("save_expense",{...d,by:user.email}); notify("✅ Expense saved"); closeModal(); await loadData(true); }
    catch(e) { notify("❌ "+e.message,"err"); }
  };

  const savePayment = async (d) => {
    try { await gasPost("save_payment",d); notify("✅ Payment recorded"); closeModal(); await loadData(true); }
    catch(e) { notify("❌ "+e.message,"err"); }
  };

  const savePurchase = async (d) => {
    try { await gasPost("save_purchase",d); notify("✅ Purchase saved"); closeModal(); await loadData(true); }
    catch(e) { notify("❌ "+e.message,"err"); }
  };

  const addCustomer = async (d) => {
    try {
      const r = await gasPost("add_customer", d);
      notify(`✅ ${r.id} added`);
      closeModal();
      await loadData(true);
    } catch(e) { notify("❌ "+e.message,"err"); }
  };

  if (loading) return <LoadingScreen msg="Loading APT ERP from Google Sheet…"/>;

  // ── NAV ───────────────────────────────────────────────────
  const pendingRiderOrders = sbData.orders.filter(o => o.status === "Pending").length;
  const NAV_GROUPS = [
    {group:"Operations",items:[
      {id:"dashboard", label:"Dashboard"},
      {id:"customers", label:"Customers", badge:customers.length},
      {id:"invoices",  label:"Invoices",  badge:unpaidInv.length||null},
      {id:"payments",  label:"Payments"},
    ]},
    {group:"Procurement",items:[
      {id:"purchases", label:"Purchases"},
      {id:"vendors",   label:"Vendors"},
      {id:"expenses",  label:"Expenses"},
    ]},
    {group:"Finance",items:[
      {id:"pnl",       label:"P&L"},
      {id:"arap",      label:"AR / AP"},
      {id:"inventory", label:"Inventory"},
      {id:"reports",   label:"Reports"},
    ]},
    {group:"Rider Hub",items:[
      {id:"rider-orders",   label:"Rider Orders",  badge:pendingRiderOrders||null},
      {id:"rider-stores",   label:"Rider Stores"},
      {id:"riders",         label:"Riders"},
      {id:"locations",      label:"Live Locations"},
      {id:"rider-products", label:"Products"},
      {id:"store-assign",   label:"Store Assign"},
      {id:"areas",          label:"Areas"},
      {id:"rider-reports",  label:"Rider Reports"},
      {id:"rider-config",   label:"Rider Config"},
    ]},
  ];

  // ── DASHBOARD ─────────────────────────────────────────────
  const Dashboard = () => (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{background:G.pale,borderRadius:8,padding:"9px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",border:`1px solid ${G.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:G.light,boxShadow:`0 0 6px ${G.light}`}}/>
          <span style={{fontSize:11,color:G.muted,fontWeight:600}}>Live from Google Sheet{lastSync?` · ${lastSync.toLocaleTimeString()}`:" · Not synced"}</span>
        </div>
        <Btn sm v="secondary" onClick={()=>loadData(true)}>{syncing?"⏳ Syncing…":"↻ Sync"}</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
        <Kpi label="Total Invoiced"  value={fmt(totalRevenue)}  sub={`${invoices.length} invoices`}    color={G.mid}    trend="up"/>
        <Kpi label="Total Received"  value={fmt(totalReceived)} sub="Cash collected"                   color={G.light}  trend="up"/>
        <Kpi label="AR Outstanding"  value={fmt(totalAR)}       sub={`${unpaidInv.length} unpaid`}      color={G.amber}/>
        <Kpi label="Total Purchases" value={fmt(totalPurchases)}sub={`${purchases.length} POs`}         color={G.purple}/>
        <Kpi label="Total Expenses"  value={fmt(totalExpenses)} sub="Operating costs"                  color={G.red}/>
        <Kpi label="Net Profit"      value={fmt(netProfit)}     sub={`NP: ${npMargin}%`}               color={netProfit>0?G.mid:G.red} trend={netProfit>0?"up":"dn"}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr",gap:16}}>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.dark,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:G.white,fontWeight:700,fontSize:13}}>Latest Invoices</span>
            <Btn sm v="secondary" onClick={()=>setTab("invoices")}>View All</Btn>
          </div>
          {invoices.slice(0,8).map(inv=>(
            <div key={inv.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 16px",borderBottom:`1px solid ${G.pale}`}}>
              <div>
                <div style={{fontWeight:700,fontSize:11,color:G.dark}}>{inv.id}</div>
                <div style={{fontSize:10,color:G.muted}}>{inv.custName} · {inv.date}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontWeight:800,fontSize:11}}>{fmt(inv.total)}</span>
                <Badge text={inv.status}/>
                <PdfBtn invId={inv.id} pdfUrl={pdfCache[inv.id]} onGenerate={u=>cachePdf(inv.id,u)} sm/>
                {(inv.status==="Unpaid"||inv.status==="Partial")&&
                  <button onClick={()=>markPaid(inv.id)} style={{background:G.pale,border:`1px solid ${G.mid}`,borderRadius:5,padding:"2px 8px",fontSize:10,fontWeight:700,color:G.dark,cursor:"pointer"}}>Pay</button>}
              </div>
            </div>
          ))}
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.dark,padding:"11px 16px"}}><span style={{color:G.white,fontWeight:700,fontSize:13}}>P&L Snapshot</span></div>
          <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:9}}>
            {[{l:"Gross Revenue",v:totalRevenue,c:G.mid,bold:true},{l:"Cost of Goods",v:-totalPurchases,c:G.red},{l:"GROSS PROFIT",v:grossProfit,c:grossProfit>0?G.mid:G.red,bold:true,border:true},{l:"Operating Exp.",v:-totalExpenses,c:G.red},{l:"NET PROFIT",v:netProfit,c:netProfit>0?G.mid:G.red,bold:true,border:true,big:true}].map((r,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",paddingTop:r.border?"7px":0,borderTop:r.border?`2px solid ${G.pale}`:"none"}}>
                <span style={{fontSize:r.big?13:11,fontWeight:r.bold?700:400,color:G.ink}}>{r.l}</span>
                <span style={{fontSize:r.big?14:11,fontWeight:r.bold?800:500,color:r.c}}>{r.v<0?`(${fmt(-r.v)})`:fmt(r.v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {unpaidInv.length>0&&(
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:"#B71C1C",padding:"11px 16px"}}><span style={{color:G.white,fontWeight:700,fontSize:13}}>⚠ Outstanding AR — {fmt(totalAR)}</span></div>
          <TblWrap compact heads={["Invoice","Customer","Total","Status","PDF","Action"]}
            rows={unpaidInv.slice(0,8).map(inv=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{inv.id}</span>,
              <span style={{fontSize:11,fontWeight:600}}>{inv.custName}</span>,
              <span style={{fontWeight:700,fontSize:11}}>{fmt(inv.total)}</span>,
              <Badge text={inv.status}/>,
              <PdfBtn invId={inv.id} pdfUrl={pdfCache[inv.id]} onGenerate={u=>cachePdf(inv.id,u)} sm/>,
              <Btn sm v="success" onClick={()=>markPaid(inv.id)}>✓ Paid</Btn>,
            ])}
          />
        </div>
      )}
    </div>
  );

  // ── INVOICES PAGE ─────────────────────────────────────────
  const Invoices = () => {
    const [sf,setSf] = useState("All");
    const fil = invoices.filter(i=>(sf==="All"||i.status===sf)&&(!search||i.id?.includes(search.toUpperCase())||i.custName?.toLowerCase().includes(search.toLowerCase())));
    return (
      <div>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{position:"relative",flex:1,minWidth:180}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search invoices…" style={{border:`1.5px solid ${G.border}`,borderRadius:8,padding:"7px 11px 7px 33px",fontSize:13,width:"100%",boxSizing:"border-box",background:G.bg,outline:"none",color:G.ink}}/>
            <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:G.muted}}>🔍</span>
          </div>
          {["All","Paid","Partial","Unpaid","VOIDED"].map(s=>(
            <button key={s} onClick={()=>setSf(s)} style={{padding:"5px 11px",borderRadius:20,border:`1.5px solid ${sf===s?G.dark:G.border}`,background:sf===s?G.dark:G.bg,color:sf===s?G.white:G.ink,fontSize:10,fontWeight:700,cursor:"pointer"}}>
              {s}{s!=="All"?` (${invoices.filter(i=>i.status===s).length})`:""}</button>
          ))}
          <Btn sm onClick={()=>setModal({t:"newInvoice"})}>+ New Invoice</Btn>
          <Btn sm v="secondary" onClick={()=>setModal({t:"recordPayment"})}>💳 Payment</Btn>
          <Btn sm v="secondary" onClick={()=>exportCsv("invoices.csv",fil,[["id","Invoice"],["date","Date"],["custName","Customer"],["total","Total"],["status","Status"],["payTerms","Terms"]])}>⬇ Export</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
          {[{l:"Total Invoiced",v:fmt(totalRevenue),c:G.mid},{l:"Collected",v:fmt(totalReceived),c:G.light},{l:"Outstanding",v:fmt(totalAR),c:G.amber},{l:"Invoices",v:invoices.length,c:G.dark}].map(s=>(
            <div key={s.l} style={{background:G.card,borderRadius:9,padding:"11px 14px",boxShadow:"0 1px 8px rgba(26,92,32,0.07)",borderBottom:`3px solid ${s.c}`}}>
              <div style={{fontSize:9,color:G.muted,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:16,fontWeight:800,color:G.ink}}>{s.v}</div>
            </div>
          ))}
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Invoice","Date","Customer","Total","Status","Terms","PDF","Actions"]}
            rows={fil.map(inv=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{inv.id}</span>,
              <span style={{fontSize:10,color:G.muted}}>{inv.date}</span>,
              <span style={{fontWeight:600,fontSize:11}}>{inv.custName}</span>,
              <span style={{fontWeight:700,fontSize:11}}>{fmt(inv.total)}</span>,
              <Badge text={inv.status}/>,
              <span style={{fontSize:10,color:G.muted}}>{inv.payTerms}</span>,
              <PdfBtn invId={inv.id} pdfUrl={pdfCache[inv.id]} onGenerate={u=>cachePdf(inv.id,u)} sm/>,
              <div style={{display:"flex",gap:4}}>
                <Btn sm v="ghost" onClick={()=>setModal({t:"viewInvoice",d:inv})}>View</Btn>
                {(inv.status==="Unpaid"||inv.status==="Partial")&&<Btn sm v="success" onClick={()=>markPaid(inv.id)}>✓ Paid</Btn>}
              </div>,
            ])}
          />
        </div>
      </div>
    );
  };

  // ── CUSTOMERS ─────────────────────────────────────────────
  const Customers = () => {
    const [hideDupes, setHideDupes] = useState(true);
    // Two riders syncing the same shop (or repeated manual adds) can leave duplicate Sheets rows.
    // We only collapse them in this view — nothing is deleted from the sheet, so existing invoices
    // / AR balances tied to either row stay intact. Group key = name + phone (fallback name + area).
    const custKey = (c)=>{ const n=normTxt(c.name), p=digitsOnly(c.phone); return p ? n+"|"+p : n+"|"+normTxt(c.area); };
    const dupInfo = useMemo(()=>{
      const byKey={};
      customers.forEach(c=>{ const k=custKey(c); if(!normTxt(c.name)) return; (byKey[k]=byKey[k]||[]).push(c); });
      const dupIds=new Set(), groupSize={}, groups=[];
      Object.values(byKey).forEach(arr=>{
        if(arr.length<2) return;
        // Representative: prefer whichever row already has invoices/AR history, else the lowest id.
        const sorted=[...arr].sort((a,b)=>{
          const ai=invoices.filter(i=>i.custId===a.id).length, bi=invoices.filter(i=>i.custId===b.id).length;
          if(ai!==bi) return bi-ai;
          return String(a.id).localeCompare(String(b.id));
        });
        const rep=sorted[0];
        groupSize[rep.id]=arr.length;
        const mergeIds=arr.filter(c=>c.id!==rep.id).map(c=>c.id);
        mergeIds.forEach(id=>dupIds.add(id));
        groups.push({ keepId: rep.id, mergeIds });
      });
      return { dupIds, groupSize, groups };
    },[customers, invoices]);
    const [merging, setMerging] = useState(false);
    const mergeDuplicates = async () => {
      if(!dupInfo.groups.length) return;
      if(!confirm(`Merge ${dupInfo.dupIds.size} duplicate customer row(s) into ${dupInfo.groups.length} record(s)?\n\nInvoices and payments on the duplicates will be moved to the kept record, and the duplicate Sheet rows will be removed.`)) return;
      setMerging(true);
      try {
        const result = await gasPost("merge_customers",{groups:dupInfo.groups});
        // Stores synced to a merged-away customer id need to point at the surviving one.
        const target={};
        dupInfo.groups.forEach(g=>g.mergeIds.forEach(id=>{target[id]=g.keepId;}));
        const storeRepoints=[];
        for(const s of sbData.stores){
          if(s.gas_customer_id && target[s.gas_customer_id]){
            storeRepoints.push({id:s.id,from:s.gas_customer_id,to:target[s.gas_customer_id]});
            try{ await sbPost("update_store",{id:s.id,gas_customer_id:target[s.gas_customer_id]}); }catch{/* non-fatal */}
          }
        }
        notify(`✅ Merged ${dupInfo.dupIds.size} duplicate customer(s)`);
        await loadData(true); await loadSupabase(true);
        if(result?.snapshot?.groups?.length){
          pushUndo(`Merged ${dupInfo.dupIds.size} duplicate customer(s)`, async () => {
            await gasPost("undo_merge_customers", result.snapshot);
            for(const r of storeRepoints){
              try{ await sbPost("update_store",{id:r.id,gas_customer_id:r.from}); }catch{/* non-fatal */}
            }
            await loadData(true); await loadSupabase(true);
          });
        }
      } catch(e) { notify("❌ "+e.message,"err"); } finally { setMerging(false); }
    };
    const fil=customers.filter(c=>{
      if(hideDupes && dupInfo.dupIds.has(c.id)) return false;
      return !search||c.name?.toLowerCase().includes(search.toLowerCase())||c.area?.toLowerCase().includes(search.toLowerCase());
    });
    return (
      <div>
        <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
          <div style={{position:"relative",flex:1,minWidth:200}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search stores…" style={{border:`1.5px solid ${G.border}`,borderRadius:8,padding:"8px 11px 8px 33px",fontSize:13,width:"100%",boxSizing:"border-box",background:G.bg,outline:"none",color:G.ink}}/>
            <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:G.muted}}>🔍</span>
          </div>
          <Btn sm onClick={()=>setModal({t:"addCustomer"})}>+ Add Store</Btn>
          {dupInfo.dupIds.size>0&&<Btn sm v={hideDupes?"secondary":"amber"} onClick={()=>setHideDupes(h=>!h)}>{hideDupes?`🔁 ${dupInfo.dupIds.size} dup hidden`:"Hide duplicates"}</Btn>}
          {dupInfo.dupIds.size>0&&<Btn sm v="danger" disabled={merging} onClick={mergeDuplicates}>{merging?"⏳ Merging…":`🔀 Merge ${dupInfo.dupIds.size} duplicate(s)`}</Btn>}
          <Btn sm v="secondary" onClick={()=>exportCsv("customers.csv",fil,[["id","ID"],["name","Name"],["area","Area"],["city","City"],["phone","Phone"]])}>⬇ Export</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
          {fil.map(c=>{
            const cinv=invoices.filter(i=>i.custId===c.id);
            const out=cinv.reduce((s,i)=>i.status!=="Paid"?s+i.total:s,0);
            return (
              <div key={c.id} onClick={()=>setModal({t:"viewCustomer",d:c})} style={{background:G.card,borderRadius:11,padding:16,boxShadow:"0 2px 10px rgba(26,92,32,0.07)",borderTop:`3px solid ${G.mid}`,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div><div style={{fontWeight:800,fontSize:13,color:G.ink,marginBottom:2}}>{c.name}{dupInfo.groupSize[c.id]>1&&<span title="duplicate customer rows merged into this one" style={{marginLeft:6,fontSize:9,color:G.amber,fontWeight:800}}>×{dupInfo.groupSize[c.id]}</span>}</div><div style={{fontSize:10,color:G.muted}}>{c.area} · {c.city}</div></div>
                  <span style={{fontSize:10,fontWeight:700,color:G.muted,background:G.pale,padding:"2px 6px",borderRadius:6,alignSelf:"flex-start"}}>{c.id}</span>
                </div>
                <div style={{fontSize:10,color:G.muted,marginBottom:10}}>📞 {c.phone||"—"}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                  {[{l:"Orders",v:cinv.length},{l:"Revenue",v:fmt(cinv.reduce((s,i)=>s+i.total,0))},{l:"Due",v:fmt(out),red:out>0}].map(x=>(
                    <div key={x.l} style={{background:G.pale,borderRadius:6,padding:"6px 5px",textAlign:"center"}}>
                      <div style={{fontSize:10,fontWeight:700,color:x.red&&out>0?G.red:G.dark,lineHeight:1.2}}>{x.v}</div>
                      <div style={{fontSize:8,color:G.muted,marginTop:1}}>{x.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {fil.length===0&&<div style={{padding:32,textAlign:"center",color:G.muted,fontSize:12,gridColumn:"1/-1"}}>No customers found</div>}
        </div>
      </div>
    );
  };

  // ── OTHER PAGES (Purchases, Vendors, Expenses, Payments, PnL, AR/AP, Inventory, Reports) ──
  // Identical to v3.0 — keeping compact here for brevity
  const SimplePage = ({title,content}) => <div>{content}</div>;

  const Purchases = () => (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12,gap:8}}>
        <Btn sm onClick={()=>setModal({t:"newPurchase"})}>+ New Purchase</Btn>
        <Btn sm v="secondary" onClick={()=>setModal({t:"vendorPayment"})}>💳 AP Payment</Btn>
        <Btn sm v="secondary" onClick={()=>exportCsv("purchases.csv",purchases,[["id","PO ID"],["date","Date"],["vendor","Vendor"],["total","Total"],["paid","Paid"],["notes","Notes"]])}>⬇ Export</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
        {[{l:"Total Purchases",v:fmt(totalPurchases),c:G.dark},{l:"AP Outstanding",v:fmt(ap.reduce((s,r)=>s+r.balance,0)),c:G.red},{l:"POs Raised",v:purchases.length,c:G.mid}].map(s=>(
          <div key={s.l} style={{background:G.card,borderRadius:9,padding:"11px 14px",boxShadow:"0 1px 8px rgba(26,92,32,0.07)",borderBottom:`3px solid ${s.c}`}}>
            <div style={{fontSize:9,color:G.muted,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:16,fontWeight:800,color:G.ink}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
        <TblWrap compact heads={["PO ID","Date","Vendor","Total","Paid","Balance","Notes"]}
          rows={purchases.map(p=>[
            <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{p.id}</span>,
            <span style={{fontSize:10,color:G.muted}}>{p.date}</span>,
            <span style={{fontWeight:600,fontSize:11}}>{p.vendor}</span>,
            <span style={{fontWeight:700,fontSize:11}}>{fmt(p.total)}</span>,
            <span style={{color:G.mid,fontWeight:600,fontSize:11}}>{fmt(p.paid)}</span>,
            <span style={{fontWeight:700,color:p.total-p.paid>0?G.red:G.mid,fontSize:11}}>{fmt(p.total-p.paid)}</span>,
            <span style={{fontSize:10,color:G.muted}}>{p.notes}</span>,
          ])}
        />
      </div>
    </div>
  );

  const Expenses = () => {
    const cats=[...new Set(expenses.map(e=>e.category))];
    const total=expenses.reduce((s,e)=>s+e.amount,0);
    return (
      <div>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12,gap:8}}>
          <Btn sm onClick={()=>setModal({t:"addExpense"})}>+ Add Expense</Btn>
          <Btn sm v="secondary" onClick={()=>exportCsv("expenses.csv",expenses,[["id","Exp ID"],["date","Date"],["category","Category"],["amount","Amount"],["notes","Notes"],["by","By"]])}>⬇ Export</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:9,marginBottom:12}}>
          {cats.map(c=>{const ct=expenses.filter(e=>e.category===c).reduce((s,e)=>s+e.amount,0);return(
            <div key={c} style={{background:G.card,borderRadius:9,padding:"11px 13px",boxShadow:"0 1px 8px rgba(26,92,32,0.07)"}}>
              <div style={{fontSize:10,fontWeight:700,color:G.dark,marginBottom:2}}>{c}</div>
              <div style={{fontSize:14,fontWeight:800,color:G.ink,marginBottom:5}}>{fmt(ct)}</div>
              <div style={{height:3,background:G.pale,borderRadius:2}}><div style={{height:"100%",width:pct(ct,total),background:G.mid,borderRadius:2}}/></div>
            </div>
          );})}
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Exp ID","Date","Category","Amount","Notes","By"]}
            rows={expenses.map(e=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{e.id}</span>,
              <span style={{fontSize:10,color:G.muted}}>{e.date}</span>,
              <Badge text={e.category}/>,
              <span style={{fontWeight:700,color:G.red,fontSize:11}}>{fmt(e.amount)}</span>,
              <span style={{fontSize:10,color:G.muted}}>{e.notes}</span>,
              <span style={{fontSize:9,color:G.muted}}>{e.by?.split("@")[0]}</span>,
            ])}
          />
        </div>
      </div>
    );
  };

  const PnL = () => (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[{l:"Revenue",v:fmt(totalRevenue),c:G.mid},{l:"COGS",v:fmt(totalPurchases),c:G.purple},{l:"Gross Profit",v:fmt(grossProfit),c:G.light},{l:"Net Profit",v:fmt(netProfit),c:netProfit>=0?G.mid:G.red}].map(s=>(
          <div key={s.l} style={{background:G.card,borderRadius:10,padding:"12px 15px",boxShadow:"0 1px 8px rgba(26,92,32,0.07)",borderBottom:`3px solid ${s.c}`}}>
            <div style={{fontSize:9,color:G.muted,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:18,fontWeight:800,color:G.ink}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:14}}>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.dark,padding:"12px 20px"}}><span style={{color:G.white,fontWeight:800,fontSize:14}}>APT — Profit & Loss Statement</span></div>
          <div style={{padding:"12px 20px 20px"}}>
            {[{h:"REVENUE"},{l:"Gross Sales",v:totalRevenue,indent:true},{l:"Total Revenue",v:totalRevenue,bold:true,border:true},{h:"COST OF GOODS"},{l:"Total Purchases",v:-totalPurchases,indent:true,neg:true},{l:"GROSS PROFIT",v:grossProfit,bold:true,border:true,bg:grossProfit>0?G.pale:G.pink},{note:`GP Margin: ${gpMargin}%`},{h:"EXPENSES"},{l:"Total Expenses",v:-totalExpenses,indent:true,neg:true},{l:"NET PROFIT / (LOSS)",v:netProfit,bold:true,border:true,big:true,bg:netProfit>0?G.pale:G.pink},{note:`NP Margin: ${npMargin}%`}
            ].map((r,i)=>{
              if(r.h) return <div key={i} style={{fontSize:9,fontWeight:800,color:G.dark,textTransform:"uppercase",letterSpacing:"0.12em",marginTop:12,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${G.pale}`}}>{r.h}</div>;
              if(r.note) return <div key={i} style={{fontSize:10,color:G.muted,fontStyle:"italic",marginBottom:3}}>{r.note}</div>;
              return(<div key={i} style={{display:"flex",justifyContent:"space-between",padding:`${r.big?"10px":"6px"} ${r.indent?"20px":"0"}`,paddingTop:r.border?"7px":undefined,borderTop:r.border?`2px solid ${G.pale}`:"none",background:r.bg||"transparent",borderRadius:r.bg?7:0,marginTop:r.bg?3:0}}>
                <span style={{fontSize:r.big?13:11,fontWeight:r.bold?700:400,color:G.ink}}>{r.l}</span>
                <span style={{fontSize:r.big?14:11,fontWeight:r.bold?800:500,color:r.v<0?G.red:G.mid}}>{r.v<0?`(${fmt(-r.v)})`:fmt(r.v)}</span>
              </div>);
            })}
          </div>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.mid,padding:"10px 16px"}}><span style={{color:G.white,fontWeight:700,fontSize:12}}>Revenue vs Cost</span></div>
          <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
            {[{l:"Revenue",v:totalRevenue,max:totalRevenue,c:G.mid},{l:"COGS",v:totalPurchases,max:totalRevenue,c:G.purple},{l:"Gross Profit",v:grossProfit,max:totalRevenue,c:G.light},{l:"Expenses",v:totalExpenses,max:totalRevenue,c:G.amber},{l:"Net Profit",v:Math.abs(netProfit),max:totalRevenue,c:netProfit>=0?G.mid:G.red}].map(row=>(
              <div key={row.l}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,fontWeight:600,color:G.ink}}>{row.l}</span><span style={{fontSize:10,fontWeight:700,color:row.c}}>{fmt(row.v)}</span></div>
                <div style={{height:7,background:G.pale,borderRadius:4}}><div style={{height:"100%",width:`${Math.min(100,Math.max(0,(row.v/row.max)*100)).toFixed(1)}%`,background:row.c,borderRadius:4}}/></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const ARAp = () => (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[{l:"AR Billed",v:fmt(totalRevenue),c:G.mid},{l:"AR Outstanding",v:fmt(totalAR),c:G.amber},{l:"AP Ordered",v:fmt(totalPurchases),c:G.purple},{l:"AP Outstanding",v:fmt(ap.reduce((s,r)=>s+r.balance,0)),c:G.red}].map(s=>(
          <div key={s.l} style={{background:G.card,borderRadius:9,padding:"11px 14px",boxShadow:"0 1px 8px rgba(26,92,32,0.07)",borderBottom:`3px solid ${s.c}`}}>
            <div style={{fontSize:9,color:G.muted,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:16,fontWeight:800,color:G.ink}}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Outstanding invoices — the primary thing the user needs to see in AR */}
      {unpaidInv.length>0&&(
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.amber,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:G.white,fontWeight:700,fontSize:12}}>📋 Outstanding Invoices ({unpaidInv.length})</span>
            <Btn sm onClick={()=>setModal({t:"recordPayment"})} style={{background:"rgba(255,255,255,0.2)",color:G.white,border:"none"}}>💳 Collect Payment</Btn>
          </div>
          <TblWrap compact heads={["Invoice","Date","Customer","Total","Status","Action"]}
            rows={unpaidInv.map(inv=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{inv.id}</span>,
              <span style={{fontSize:10,color:G.muted}}>{inv.date}</span>,
              <span style={{fontWeight:600,fontSize:11}}>{inv.custName}</span>,
              <span style={{fontWeight:800,color:G.red,fontSize:11}}>{fmt(inv.total)}</span>,
              <Badge text={inv.status}/>,
              <Btn sm v="success" onClick={()=>setModal({t:"recordPayment",d:{custId:inv.custId,invId:inv.id}})}>Collect</Btn>,
            ])}
          />
        </div>
      )}
      {unpaidInv.length===0&&totalAR===0&&<div style={{background:G.pale,borderRadius:9,padding:"12px 16px",fontSize:12,color:G.mid,fontWeight:600}}>✅ All invoices collected — AR is clear</div>}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.mid,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:G.white,fontWeight:700,fontSize:12}}>AR Ledger (by Customer)</span>
            <Btn sm onClick={()=>setModal({t:"recordPayment"})} style={{background:"rgba(255,255,255,0.15)",color:G.white,border:"none",fontSize:10}}>💳 Collect</Btn>
          </div>
          <TblWrap compact heads={["Customer","Billed","Paid","Balance","Status"]}
            rows={ar.filter(r=>r.totalBilled>0).map(r=>[
              <div><div style={{fontWeight:700,fontSize:11}}>{r.custName}</div><div style={{fontSize:9,color:G.muted}}>{r.custId}</div></div>,
              <span style={{fontSize:11,fontWeight:600}}>{fmt(r.totalBilled)}</span>,
              <span style={{color:G.mid,fontWeight:600,fontSize:11}}>{fmt(r.totalPaid)}</span>,
              <span style={{fontWeight:800,color:r.balance>0?G.red:G.mid,fontSize:11}}>{fmt(r.balance)}</span>,
              r.balance>0
                ?<Btn sm v="success" onClick={()=>setModal({t:"recordPayment",d:{custId:r.custId}})}>Collect</Btn>
                :<Badge text="Settled"/>,
            ])}
          />
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.purple,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:G.white,fontWeight:700,fontSize:12}}>AP Ledger (by Vendor)</span>
            <Btn sm onClick={()=>setModal({t:"vendorPayment"})} style={{background:"rgba(255,255,255,0.15)",color:G.white,border:"none",fontSize:10}}>💳 Pay</Btn>
          </div>
          <TblWrap compact heads={["Vendor","Ordered","Paid","Outstanding","Action"]}
            rows={ap.filter(r=>r.totalOrdered>0).map(r=>[
              <div><div style={{fontWeight:700,fontSize:11}}>{r.vendorName}</div><div style={{fontSize:9,color:G.muted}}>{r.vendorId}</div></div>,
              <span style={{fontWeight:600,fontSize:11}}>{fmt(r.totalOrdered)}</span>,
              <span style={{color:G.mid,fontWeight:600,fontSize:11}}>{fmt(r.totalPaid)}</span>,
              <span style={{fontWeight:800,color:r.balance>0?G.red:G.mid,fontSize:11}}>{fmt(r.balance)}</span>,
              r.balance>0
                ?<Btn sm v="danger" onClick={()=>setModal({t:"vendorPayment",d:{vendorId:r.vendorId}})}>Pay</Btn>
                :<Badge text="Settled"/>,
            ])}
          />
        </div>
      </div>
    </div>
  );

  const Inventory = () => {
    const low=inventory.filter(p=>p.stock<=p.minStock);
    return(
      <div>
        {low.length>0&&<div style={{background:"#FFF8E1",borderRadius:9,padding:"10px 14px",marginBottom:12,border:`1.5px solid ${G.amber}`,fontSize:12,fontWeight:700,color:G.amber}}>⚠️ {low.length} SKUs at/below minimum stock</div>}
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
          <Btn sm v="secondary" onClick={()=>exportCsv("inventory.csv",inventory,[["pid","PID"],["pname","Product"],["category","Category"],["cost","Cost"],["purchased","In"],["sold","Sold"],["stock","Stock"],["minStock","Min"]])}>⬇ Export</Btn>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["PID","Product","Cat","Cost","In","Sold","Stock","Min","Status"]}
            rows={inventory.map(p=>{const s=p.stock===0?"Out of Stock":p.stock<=p.minStock?"Low Stock":"Active";return[<span style={{fontWeight:700,fontSize:10,color:G.dark}}>{p.pid}</span>,<span style={{fontWeight:600,fontSize:11}}>{p.pname}</span>,<Badge text={p.category}/>,<span style={{fontSize:10,color:G.muted}}>PKR {p.cost?.toLocaleString()}</span>,<span style={{fontWeight:600}}>{p.purchased}</span>,<span style={{fontWeight:600,color:G.mid}}>{p.sold}</span>,<span style={{fontWeight:800,color:p.stock===0?G.red:p.stock<=p.minStock?G.amber:G.ink}}>{p.stock}</span>,<span style={{fontSize:10,color:G.muted}}>{p.minStock}</span>,<Badge text={s}/>];})}
          />
        </div>
      </div>
    );
  };

  const Reports = () => {
    const topCust=[...customers].map(c=>({...c,rev:invoices.filter(i=>i.custId===c.id).reduce((s,i)=>s+i.total,0)})).sort((a,b)=>b.rev-a.rev).slice(0,8);
    return(
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.mid,padding:"11px 16px"}}><span style={{color:G.white,fontWeight:700,fontSize:12}}>🏆 Top Customers by Revenue</span></div>
          <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:8}}>
            {topCust.map((c,i)=>(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{width:20,height:20,background:i<3?G.gold:G.pale,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:i<3?G.white:G.muted,fontSize:9,fontWeight:800,flexShrink:0}}>{i+1}</span>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,fontWeight:600,color:G.ink}}>{c.name}</span><span style={{fontSize:11,fontWeight:700,color:G.dark}}>{fmt(c.rev)}</span></div>
                  <div style={{height:4,background:G.pale,borderRadius:2}}><div style={{height:"100%",width:pct(c.rev,topCust[0]?.rev||1),background:G.mid,borderRadius:2}}/></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.red,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:G.white,fontWeight:700,fontSize:12}}>⚠ AR Aging</span>
            <Btn sm v="secondary" onClick={()=>exportCsv("ar_aging.csv",ar.filter(r=>r.balance>0),[["custName","Customer"],["city","City"],["billed","Billed"],["paid","Paid"],["balance","Balance"]])}>⬇ Export</Btn>
          </div>
          <TblWrap compact heads={["Customer","Outstanding","Invoices","Action"]}
            rows={ar.filter(r=>r.balance>0).sort((a,b)=>b.balance-a.balance).map(r=>[<span style={{fontWeight:700,fontSize:11}}>{r.custName}</span>,<span style={{fontWeight:800,color:G.red,fontSize:11}}>{fmt(r.balance)}</span>,<span style={{fontSize:10,color:G.muted}}>{invoices.filter(i=>i.custId===r.custId&&i.status!=="Paid"&&i.status!=="VOIDED").length}</span>,<Btn sm v="danger" onClick={()=>{
              const c=custMap[r.custId];
              const ph=(c?.phone||"").replace(/[^\d]/g,"");
              if(!ph){notify("No phone number saved for "+r.custName,"err");return;}
              const msg=encodeURIComponent(`Dear ${r.custName}, your outstanding balance with Assorted Produce Traders is ${fmt(r.balance)}. Kindly arrange payment at your earliest convenience. Thank you.`);
              window.open(`https://wa.me/${ph.startsWith("92")?ph:ph.replace(/^0/,"92")}?text=${msg}`,"_blank");
            }}>Follow Up</Btn>])}
          />
        </div>
      </div>
    );
  };

  const Vendors = () => (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <Btn sm onClick={()=>setModal({t:"addVendor"})}>+ Add Vendor</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
        {vendors.map(v=>{const apRow=ap.find(a=>a.vendorId===v.id)||{};return(
          <div key={v.id} style={{background:G.card,borderRadius:11,padding:16,boxShadow:"0 2px 10px rgba(26,92,32,0.07)",borderLeft:`4px solid ${G.mid}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{fontWeight:800,fontSize:14,color:G.ink,marginBottom:2}}>{v.name}</div>
              <Btn sm v="ghost" onClick={()=>setModal({t:"editVendor",d:v})}>✏️</Btn>
            </div>
            <div style={{fontSize:10,color:G.muted,marginBottom:2}}>{v.id} · {v.category}</div>
            <div style={{fontSize:10,color:G.muted,marginBottom:10}}>{v.contact} · {v.phone}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
              {[{l:"Ordered",v:fmt(apRow.totalOrdered||0)},{l:"Paid",v:fmt(apRow.totalPaid||0)},{l:"AP Due",v:fmt(apRow.balance||0),red:(apRow.balance||0)>0}].map(s=>(
                <div key={s.l} style={{background:G.pale,borderRadius:6,padding:"7px 5px",textAlign:"center"}}>
                  <div style={{fontSize:10,fontWeight:700,color:s.red?(apRow.balance||0)>0?G.red:G.dark:G.dark,lineHeight:1.2}}>{s.v}</div>
                  <div style={{fontSize:8,color:G.muted,marginTop:1}}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        );})}
      </div>
    </div>
  );

  // ── MODALS ────────────────────────────────────────────────
  const renderModal = () => {
    if(!modal) return null;

    // ── New / Edit Invoice ────────────────────────────────────
    if(modal.t==="newInvoice"||modal.t==="editInvoice"){
      const editing = modal.t==="editInvoice" ? modal.d : null;
      const prefill = modal.t==="newInvoice" ? modal.prefill : null;
      const InvForm=()=>{
        const [f,setF]=useState({custId:editing?.custId||prefill?.custId||"",date:editing?.date||todayStr(),payTerms:editing?.payTerms||prefill?.payTerms||"COD",notes:prefill?.notes||"",items:(prefill?.items&&prefill.items.length)?prefill.items:[{pid:"",qty:1,rate:0}]});
        const [loading, setLoading] = useState(false);
        const [itemsLoading, setItemsLoading] = useState(!!editing);
        const total=f.items.reduce((s,i)=>s+(+i.qty||0)*(+i.rate||0),0);

        useEffect(()=>{
          if(!editing) return;
          let on=true;
          gasGet("invoice_items",{id:editing.id})
            .then(d=>{
              if(!on) return;
              const items=(Array.isArray(d)&&d.length)?d.map(it=>({pid:it.pid,pname:it.pname,qty:it.qty,rate:it.rate})):[{pid:"",qty:1,rate:0}];
              setF(p=>({...p,items}));
              setItemsLoading(false);
            })
            .catch(e=>{ if(on){ notify("❌ Could not load items: "+e.message,"err"); setItemsLoading(false);} });
          return ()=>{on=false;};
        },[]);

        const handleSave = async () => {
          if (!f.custId) { notify("Please select a store", "err"); return; }
          if (f.items.some(item => !item.pid)) { notify("Please select a product for all lines", "err"); return; }
          setLoading(true);
          try {
            if (editing) await editInvoice({...f, invId: editing.id});
            else await saveInvoice(f);
          } catch(e) {
            // Error is handled inside saveInvoice/editInvoice
          } finally {
            setLoading(false);
          }
        };
        const setLine=(i,k,v)=>setF(p=>{
          const it=[...p.items];
          it[i]={...it[i],[k]:v};
          if(k==="pid"){
            const pr=prodMap[v];
            if(pr){
              it[i].rate=pr.price;
              it[i].pname=pr.name;
            }
          }
          return{...p,items:it};
        });
        const nextInvId = (() => {
          const ids = invoices.map(i=>i.id).filter(id=>/^INV-\d+$/.test(id));
          const max = ids.length ? Math.max(...ids.map(id=>parseInt(id.split('-')[1],10))) : 9;
          return `INV-${String(Math.max(max+1,10)).padStart(4,'0')}`;
        })();
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{background:G.pale,borderRadius:8,padding:"7px 12px",fontSize:11,color:G.dark,fontWeight:600,marginBottom:2}}>
              Invoice # <span style={{color:G.mid,fontWeight:800}}>{editing?editing.id:nextInvId}</span> {!editing&&<span style={{color:G.muted,fontWeight:400}}>(auto-assigned on save)</span>}
            </div>
            {itemsLoading&&<div style={{fontSize:11,color:G.muted}}>⏳ Loading invoice items…</div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Sel label="Customer" value={f.custId} onChange={e=>setF(p=>({...p,custId:e.target.value}))}>
                <option value="">— Select Store —</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name} ({c.area})</option>)}
              </Sel>
              <Inp label="Date" type="date" value={f.date} onChange={e=>setF(p=>({...p,date:e.target.value}))}/>
              <Sel label="Payment Terms" value={f.payTerms} onChange={e=>setF(p=>({...p,payTerms:e.target.value}))}>
                {["COD","NET 7","NET 15","NET 30"].map(t=><option key={t}>{t}</option>)}
              </Sel>
              <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))} placeholder="Ref / notes"/>
            </div>
            <div style={{fontWeight:700,color:G.dark,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em"}}>Line Items</div>
            {f.items.map((item,idx)=>(
              <div key={idx} style={{display:"grid",gridTemplateColumns:"2fr 0.6fr 1fr 1fr auto",gap:8,alignItems:"flex-end"}}>
                <Sel value={item.pid} onChange={e=>setLine(idx,"pid",e.target.value)}>
                  <option value="">— Product —</option>
                  {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  {item.pid&&!prodMap[item.pid]&&<option value={item.pid}>{item.pname||"Rider product"} (not in catalog)</option>}
                </Sel>
                <Inp type="number" min="1" value={item.qty} onChange={e=>setLine(idx,"qty",e.target.value)} placeholder="Qty"/>
                <Inp type="number" value={item.rate} onChange={e=>setLine(idx,"rate",e.target.value)} placeholder="Rate"/>
                <div style={{background:G.pale,borderRadius:8,padding:"8px 10px",fontSize:12,fontWeight:700,color:G.dark,display:"flex",alignItems:"center"}}>{fmt((+item.qty||0)*(+item.rate||0))}</div>
                <button onClick={()=>setF(p=>({...p,items:p.items.filter((_,j)=>j!==idx)}))} style={{background:G.pink,border:"none",borderRadius:7,padding:"8px 9px",cursor:"pointer",color:G.red,fontWeight:800}}>✕</button>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
              <Btn v="ghost" sm onClick={()=>setF(p=>({...p,items:[...p.items,{pid:"",qty:1,rate:0}]}))}>+ Line</Btn>
              <span style={{fontWeight:800,fontSize:15,color:G.ink}}>Total: {fmt(total)}</span>
            </div>
            <div style={{background:"#E8F0FE",borderRadius:8,padding:"9px 12px",fontSize:11,color:G.blue,fontWeight:600}}>
              💾 Saves to Sheet · 🖨 PDF generated via invoice-generator.com · 📂 Saved to Drive
            </div>
             <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6,paddingTop:10,borderTop:`1px solid ${G.pale}`}}>
              <Btn v="secondary" onClick={closeModal} disabled={loading}>Cancel</Btn>
              <Btn onClick={handleSave} disabled={loading||itemsLoading}>
                {loading ? "⏳ Saving & Generating PDF..." : editing ? "💾 Update + Regenerate PDF" : "💾 Save + Generate PDF"}
              </Btn>
            </div>
          </div>
        );
      };
      return <Modal title={editing?`✏️ Edit Invoice — ${editing.id}`:"🧾 New Invoice → Sheet + PDF + Drive"} onClose={closeModal} wide><InvForm/></Modal>;
    }

    // ── View Invoice (with PDF download + Void) ──────────────
    if(modal.t==="viewInvoice"){
      const inv=modal.d;
      return(
        <Modal title={`Invoice — ${inv.id}`} onClose={closeModal} wide>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            {[{l:"Invoice #",v:inv.id},{l:"Customer",v:inv.custName},{l:"Date",v:inv.date},{l:"Status",v:inv.status},{l:"Total",v:fmt(inv.total)},{l:"Terms",v:inv.payTerms||"COD"},{l:"Created By",v:(inv.createdBy||"").split("@")[0]}].map(r=>(
              <div key={r.l} style={{background:G.pale,borderRadius:7,padding:"8px 11px"}}>
                <div style={{fontSize:8,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>{r.l}</div>
                <div style={{fontSize:12,fontWeight:600,color:G.ink}}>{r.v}</div>
              </div>
            ))}
          </div>
          {/* Line items detail */}
          <InvoiceItems invId={inv.id}/>
          {/* PDF Button — prominently placed */}
          <div style={{background:"#E3F2FD",borderRadius:10,padding:"12px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:G.blue,marginBottom:2}}>📄 Invoice PDF</div>
              <div style={{fontSize:10,color:G.muted}}>Generated via invoice-generator.com · Saved to Drive</div>
            </div>
            <PdfBtn invId={inv.id} pdfUrl={pdfCache[inv.id]} onGenerate={u=>cachePdf(inv.id,u)}/>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",width:"100%"}}>
            <div style={{display:"flex",gap:8}}>
              {inv.status!=="VOIDED"&&<Btn v="secondary" onClick={()=>setModal({t:"editInvoice",d:inv})}>✏️ Edit</Btn>}
              <Btn v="danger" onClick={()=>deleteInvoice(inv.id)}>🗑️ Delete Permanently</Btn>
            </div>
            <div style={{display:"flex",gap:8}}>
              {(inv.status==="Unpaid"||inv.status==="Partial")&&<Btn v="success" onClick={()=>{markPaid(inv.id);closeModal();}}>✓ Mark Paid</Btn>}
              {(inv.status==="Unpaid"||inv.status==="Partial")&&<Btn v="secondary" onClick={()=>{closeModal();setModal({t:"recordPayment",d:{custId:inv.custId,invId:inv.id}});}}>💳 Partial</Btn>}
              {inv.status!=="VOIDED"&&<Btn v="danger" onClick={()=>voidInvoice(inv.id)}>🗑 Void</Btn>}
            </div>
          </div>
        </Modal>
      );
    }

    // ── Record Payment (AR — customer receipts only) ──────────
    if(modal.t==="recordPayment"){
      const PayForm=()=>{
        const init=modal.d||{};
        const [f,setF]=useState({date:todayStr(),type:"Received",custId:init.custId||"",invId:init.invId||"",amount:"",method:"Cash",notes:""});
        const outstanding = ar.find(r=>r.custId===f.custId)?.balance || 0;
        const remaining   = Math.max(0, outstanding - parseFloat(f.amount||0));
        const overpaid    = parseFloat(f.amount||0) > outstanding && outstanding > 0;
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="Date" type="date" value={f.date} onChange={e=>setF(p=>({...p,date:e.target.value}))}/>
              <Sel label="Customer" value={f.custId} onChange={e=>{
                const cid=e.target.value;
                const bal=ar.find(r=>r.custId===cid)?.balance||0;
                setF(p=>({...p,custId:cid,invId:"",amount:bal>0?String(Math.round(bal)):""}));
              }}>
                <option value="">— Select Customer —</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}{ar.find(r=>r.custId===c.id)?.balance>0?" ⚠":"" }</option>)}
              </Sel>
              {f.custId&&<div style={{gridColumn:"1/-1",background:outstanding>0?G.pink:G.pale,borderRadius:8,padding:"8px 12px",fontSize:11}}>
                <span style={{fontWeight:700,color:outstanding>0?G.red:G.mid}}>Outstanding: {fmt(outstanding)}</span>
                {f.amount&&outstanding>0&&<span style={{marginLeft:14,color:remaining>0?G.amber:G.mid,fontWeight:600}}> → After payment: {fmt(remaining)}</span>}
                {overpaid&&<span style={{marginLeft:10,color:G.red,fontWeight:700}}>⚠ Overpayment of {fmt(parseFloat(f.amount||0)-outstanding)}</span>}
              </div>}
              <Sel label="Against Invoice (optional)" value={f.invId} onChange={e=>setF(p=>({...p,invId:e.target.value}))}>
                <option value="">— No specific invoice —</option>
                {invoices.filter(i=>i.custId===f.custId&&i.status!=="Paid").map(i=><option key={i.id} value={i.id}>{i.id} — {fmt(i.total)} ({i.status})</option>)}
              </Sel>
              <Inp label="Amount (PKR)" type="number" value={f.amount} onChange={e=>setF(p=>({...p,amount:e.target.value}))} placeholder="0"/>
              <Sel label="Method" value={f.method} onChange={e=>setF(p=>({...p,method:e.target.value}))}>
                {["Cash","Bank Transfer","EasyPaisa","JazzCash","Cheque"].map(m=><option key={m}>{m}</option>)}
              </Sel>
            </div>
            <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))} placeholder="Reference or memo"/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn v="success" onClick={()=>savePayment({...f,type:"Received"})}>💾 Save to Sheet</Btn>
            </div>
          </div>
        );
      };
      return <Modal title="💳 Collect Payment (AR) → Google Sheet" onClose={closeModal}><PayForm/></Modal>;
    }

    // ── Vendor Payment (AP — vendor payments only) ────────────
    if(modal.t==="vendorPayment"){
      const VenPayForm=()=>{
        const init=modal.d||{};
        const [f,setF]=useState({date:todayStr(),vendorId:init.vendorId||"",amount:"",method:"Cash",notes:""});
        const outstanding = ap.find(r=>r.vendorId===f.vendorId)?.balance || 0;
        const remaining   = Math.max(0, outstanding - parseFloat(f.amount||0));
        const overpaid    = parseFloat(f.amount||0) > outstanding && outstanding > 0;
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="Date" type="date" value={f.date} onChange={e=>setF(p=>({...p,date:e.target.value}))}/>
              <Sel label="Vendor" value={f.vendorId} onChange={e=>{
                const vid=e.target.value;
                const bal=ap.find(r=>r.vendorId===vid)?.balance||0;
                setF(p=>({...p,vendorId:vid,amount:bal>0?String(Math.round(bal)):""}));
              }}>
                <option value="">— Select Vendor —</option>
                {vendors.map(v=><option key={v.id} value={v.id}>{v.name}{ap.find(r=>r.vendorId===v.id)?.balance>0?" ⚠":""}</option>)}
              </Sel>
              {f.vendorId&&<div style={{gridColumn:"1/-1",background:outstanding>0?G.pink:G.pale,borderRadius:8,padding:"8px 12px",fontSize:11}}>
                <span style={{fontWeight:700,color:outstanding>0?G.red:G.mid}}>AP Outstanding: {fmt(outstanding)}</span>
                {f.amount&&outstanding>0&&<span style={{marginLeft:14,color:remaining>0?G.amber:G.mid,fontWeight:600}}> → After payment: {fmt(remaining)}</span>}
                {overpaid&&<span style={{marginLeft:10,color:G.red,fontWeight:700}}>⚠ Overpayment of {fmt(parseFloat(f.amount||0)-outstanding)}</span>}
              </div>}
              <Inp label="Amount (PKR)" type="number" value={f.amount} onChange={e=>setF(p=>({...p,amount:e.target.value}))} placeholder="0"/>
              <Sel label="Method" value={f.method} onChange={e=>setF(p=>({...p,method:e.target.value}))}>
                {["Cash","Bank Transfer","EasyPaisa","JazzCash","Cheque"].map(m=><option key={m}>{m}</option>)}
              </Sel>
            </div>
            <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))} placeholder="Reference or memo"/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn v="success" onClick={()=>savePayment({...f,type:"Paid",vendorId:f.vendorId})}>💾 Save to Sheet</Btn>
            </div>
          </div>
        );
      };
      return <Modal title="💳 Vendor Payment (AP) → Google Sheet" onClose={closeModal}><VenPayForm/></Modal>;
    }

    // ── Add Expense ───────────────────────────────────────────
    if(modal.t==="addExpense"){
      const ExpForm=()=>{
        const [f,setF]=useState({date:todayStr(),category:"Salaries",amount:"",notes:""});
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="Date" type="date" value={f.date} onChange={e=>setF(p=>({...p,date:e.target.value}))}/>
              <Sel label="Category" value={f.category} onChange={e=>setF(p=>({...p,category:e.target.value}))}>
                {["Fuel","Bike Repairs","Salaries","Utilities","Packaging","Marketing","Misc"].map(c=><option key={c}>{c}</option>)}
              </Sel>
            </div>
            <Inp label="Amount (PKR)" type="number" value={f.amount} onChange={e=>setF(p=>({...p,amount:e.target.value}))} placeholder="0"/>
            <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))} placeholder="What is this for?"/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn onClick={()=>saveExpense(f)}>💾 Save to Sheet</Btn>
            </div>
          </div>
        );
      };
      return <Modal title="💸 Add Expense → Google Sheet" onClose={closeModal}><ExpForm/></Modal>;
    }

    // ── New Purchase ──────────────────────────────────────────
    if(modal.t==="newPurchase"){
      const PurForm=()=>{
        const [f,setF]=useState({vendorId:"",date:todayStr(),total:"",paid:"0",notes:""});
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Sel label="Vendor" value={f.vendorId} onChange={e=>setF(p=>({...p,vendorId:e.target.value}))}>
              <option value="">— Select Vendor —</option>
              {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
            </Sel>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="PO Date" type="date" value={f.date} onChange={e=>setF(p=>({...p,date:e.target.value}))}/>
              <Inp label="Total Amount (PKR)" type="number" value={f.total} onChange={e=>setF(p=>({...p,total:e.target.value}))} placeholder="0"/>
              <Inp label="Amount Paid" type="number" value={f.paid} onChange={e=>setF(p=>({...p,paid:e.target.value}))} placeholder="0"/>
              <Inp label="Notes / Vendor Invoice Ref" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))} placeholder="Invoice #"/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn onClick={()=>savePurchase(f)}>💾 Save to Sheet</Btn>
            </div>
          </div>
        );
      };
      return <Modal title="🛒 New Purchase → Google Sheet" onClose={closeModal}><PurForm/></Modal>;
    }

    // ── Add Customer ──────────────────────────────────────────
    if(modal.t==="addCustomer"){
      const CustForm=()=>{
        const [f,setF]=useState({name:"",city:"ISB",area:"",contact:"",phone:"",notes:""});
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Inp label="Store Name" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))} placeholder="e.g. Shaheen Chemist"/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="Area / Zone" value={f.area} onChange={e=>setF(p=>({...p,area:e.target.value}))} placeholder="F-7 Markaz"/>
              <Inp label="City" value={f.city} onChange={e=>setF(p=>({...p,city:e.target.value}))} placeholder="ISB"/>
              <Inp label="Purchaser Name" value={f.contact} onChange={e=>setF(p=>({...p,contact:e.target.value}))}/>
              <Inp label="Purchaser Phone" value={f.phone} onChange={e=>setF(p=>({...p,phone:e.target.value}))} placeholder="+92..."/>
            </div>
            <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn onClick={()=>addCustomer(f)}>💾 Add to Sheet</Btn>
            </div>
          </div>
        );
      };
      return <Modal title="➕ Add Store → Google Sheet" onClose={closeModal}><CustForm/></Modal>;
    }

    // ── Add Vendor ────────────────────────────────────────────
    if(modal.t==="addVendor"){
      const VenForm=()=>{
        const [f,setF]=useState({name:"",category:"",contact:"",phone:"",openBal:"0",notes:""});
        const save=async()=>{
          if(!f.name){notify("Enter vendor name","err");return;}
          try{await gasPost("save_vendor",{...f});notify("✅ Vendor added");closeModal();await loadData(true);}
          catch(e){notify("❌ "+e.message,"err");}
        };
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Inp label="Vendor Name" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))} placeholder="Company name"/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="Category" value={f.category} onChange={e=>setF(p=>({...p,category:e.target.value}))} placeholder="e.g. Skincare, Food"/>
              <Inp label="Contact Person" value={f.contact} onChange={e=>setF(p=>({...p,contact:e.target.value}))}/>
              <Inp label="Phone" value={f.phone} onChange={e=>setF(p=>({...p,phone:e.target.value}))} placeholder="+92..."/>
              <Inp label="Opening Balance (PKR)" type="number" value={f.openBal} onChange={e=>setF(p=>({...p,openBal:e.target.value}))}/>
            </div>
            <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn onClick={save}>💾 Add Vendor to Sheet</Btn>
            </div>
          </div>
        );
      };
      return <Modal title="🏭 Add Vendor → Google Sheet" onClose={closeModal}><VenForm/></Modal>;
    }

    // ── Edit Customer ─────────────────────────────────────────
    if(modal.t==="editCustomer"){
      const c=modal.d;
      const EditCustForm=()=>{
        const [f,setF]=useState({name:c.name||"",city:c.city||"ISB",area:c.area||"",contact:c.contact||"",phone:c.phone||"",notes:c.notes||""});
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Inp label="Store Name" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="Area / Zone" value={f.area} onChange={e=>setF(p=>({...p,area:e.target.value}))} placeholder="F-7 Markaz"/>
              <Inp label="City" value={f.city} onChange={e=>setF(p=>({...p,city:e.target.value}))} placeholder="ISB"/>
              <Inp label="Purchaser Name" value={f.contact} onChange={e=>setF(p=>({...p,contact:e.target.value}))}/>
              <Inp label="Purchaser Phone" value={f.phone} onChange={e=>setF(p=>({...p,phone:e.target.value}))} placeholder="+92..."/>
            </div>
            <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn onClick={()=>{if(!f.name){notify("Enter store name","err");return;}updateCustomer({...f,id:c.id});}}>💾 Update</Btn>
            </div>
          </div>
        );
      };
      return <Modal title={`✏️ Edit Store — ${c.id}`} onClose={closeModal}><EditCustForm/></Modal>;
    }

    // ── Edit Vendor ───────────────────────────────────────────
    if(modal.t==="editVendor"){
      const v=modal.d;
      const EditVenForm=()=>{
        const [f,setF]=useState({name:v.name||"",category:v.category||"",contact:v.contact||"",phone:v.phone||"",notes:v.notes||""});
        return(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Inp label="Vendor Name" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Inp label="Category" value={f.category} onChange={e=>setF(p=>({...p,category:e.target.value}))}/>
              <Inp label="Contact Person" value={f.contact} onChange={e=>setF(p=>({...p,contact:e.target.value}))}/>
              <Inp label="Phone" value={f.phone} onChange={e=>setF(p=>({...p,phone:e.target.value}))} placeholder="+92..."/>
            </div>
            <Inp label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
              <Btn v="secondary" onClick={closeModal}>Cancel</Btn>
              <Btn onClick={()=>{if(!f.name){notify("Enter vendor name","err");return;}updateVendor({...f,id:v.id});}}>💾 Update</Btn>
            </div>
          </div>
        );
      };
      return <Modal title={`✏️ Edit Vendor — ${v.id}`} onClose={closeModal}><EditVenForm/></Modal>;
    }

    // ── View Customer ─────────────────────────────────────────
    if(modal.t==="viewCustomer"){
      const c=modal.d;
      const cinv=invoices.filter(i=>i.custId===c.id);
      const outstanding=ar.find(r=>r.custId===c.id)?.balance||0;
      return(
        <Modal title={c.name} onClose={closeModal} wide>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            {[{l:"ID",v:c.id},{l:"Area",v:c.area},{l:"City",v:c.city},{l:"Phone",v:c.phone||"—"},{l:"Contact",v:c.contact||"—"},{l:"Open Bal",v:fmt(c.openBal)}].map(r=>(
              <div key={r.l} style={{background:G.pale,borderRadius:7,padding:"8px 11px"}}>
                <div style={{fontSize:8,fontWeight:700,color:G.muted,textTransform:"uppercase",marginBottom:2}}>{r.l}</div>
                <div style={{fontSize:12,fontWeight:600,color:G.ink}}>{r.v}</div>
              </div>
            ))}
          </div>
          {outstanding>0&&<div style={{background:G.pink,borderRadius:8,padding:"9px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:700,color:G.red,fontSize:12}}>⚠ Outstanding: {fmt(outstanding)}</span>
            <Btn sm v="success" onClick={()=>{closeModal();setModal({t:"recordPayment",d:{custId:c.id}});}}>Collect</Btn>
          </div>}
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
            <Btn sm v="secondary" onClick={()=>setModal({t:"editCustomer",d:c})}>✏️ Edit Store</Btn>
          </div>
          <TblWrap compact heads={["Invoice","Date","Total","Status","PDF"]}
            rows={cinv.map(inv=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{inv.id}</span>,
              <span style={{fontSize:10,color:G.muted}}>{inv.date}</span>,
              <span style={{fontWeight:700,fontSize:11}}>{fmt(inv.total)}</span>,
              <Badge text={inv.status}/>,
              <PdfBtn invId={inv.id} pdfUrl={pdfCache[inv.id]} onGenerate={u=>cachePdf(inv.id,u)} sm/>,
            ])}
          />
        </Modal>
      );
    }

    return null;
  };

  // ── RIDER HUB TABS ────────────────────────────────────────
  const STATUS_NEXT = {Pending:"Approved",Approved:"Packed",Packed:"Dispatched",Dispatched:"Delivered"};
  const STATUS_CLR  = {Pending:G.amber,Approved:G.blue,Packed:G.purple,Dispatched:"#00897B",Delivered:G.mid,Cancelled:G.red,Rejected:G.red};

  const RiderOrdersTab = () => {
    const [statusFilter, setStatusFilter] = useState("all");
    const [q, setQ] = useState("");
    const [busy, setBusy] = useState(null);
    const filtered = sbData.orders.filter(o => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (q) { const s = q.toLowerCase(); return (o.id||"").toLowerCase().includes(s)||(o.stores?.name||"").toLowerCase().includes(s)||(o.profiles?.full_name||"").toLowerCase().includes(s); }
      return true;
    });
    const advance = async (o) => {
      const next = STATUS_NEXT[o.status]; if (!next) return;
      const prevStatus = o.status;
      setBusy(o.id);
      try {
        await sbPost("update_order_status",{id:o.id,status:next}); notify(`✅ Order → ${next}`); await loadSupabase(true);
        pushUndo(`Order #${(o.id||"").slice(0,8)} → ${next}`, async () => {
          await sbPost("update_order_status",{id:o.id,status:prevStatus}); await loadSupabase(true);
        });
        if (next==="Approved") await startInvoice({...o, status:next});
      }
      catch(e) { notify("❌ "+e.message,"err"); } finally { setBusy(null); }
    };
    // Open the New Invoice journey prefilled from a rider order: maps the rider's store to its
    // Sheets customer (via gas_customer_id) and its order items to Sheets products by name.
    const startInvoice = async (o) => {
      // Prefer the full store record — sbData.stores carries mobile/address/payment_terms,
      // whereas the order-embedded o.stores only has id/name/area/category.
      const store = sbData.stores.find(s=>s.id===o.store_id) || o.stores || {};
      const custId = (store?.gas_customer_id && customers.some(c=>c.id===store.gas_customer_id)) ? store.gas_customer_id : "";
      if(!custId) notify("⚠ This store isn't in Customers yet — use “Sync to Customers”, or pick the store in the invoice","err");
      // Robust matcher: rider product names rarely match Sheets product names exactly, so
      // normalize and fall back to a contains-match. Without this the line shows qty/rate but
      // the product dropdown stays blank.
      const prodList = products.map(p=>({p,n:normTxt(p.name)}));
      const byNorm={}; prodList.forEach(x=>{ if(x.n) byNorm[x.n]=x.p; });
      const matchProduct = (name)=>{
        const n=normTxt(name); if(!n) return null;
        if(byNorm[n]) return byNorm[n];
        const hit = prodList.find(x=>x.n&&(x.n.includes(n)||n.includes(x.n)));
        return hit?hit.p:null;
      };
      let items=[];
      try {
        const rows = await sbPost("order_items",{order_id:o.id});
        items = (rows||[]).map(it=>{
          const match = matchProduct(it.product_name);
          const rate = Number(it.trade_price) || (it.quantity?Number(it.total)/Number(it.quantity):0);
          const name = it.product_name||(match?match.name:"");
          // If a rider product isn't in the Sheets catalog, keep it visible + selected via a
          // synthetic "x:" id (blanked on save, pname preserved) instead of a blank dropdown.
          const pid = match ? match.id : (name ? "x:"+(it.product_id||normTxt(name)) : "");
          return { pid, pname: name, qty: it.quantity||1, rate: Math.round(rate||0) };
        });
      } catch(e) { notify("Could not load order items: "+e.message,"err"); }
      if(!items.length) items=[{pid:"",qty:1,rate:0}];
      // Carry the store's contact + payment terms into the invoice notes.
      const ptMap={cash:"Cash / COD",bill_to_bill:"Bill to Bill",credit_25_days:"25 Days Credit"};
      const ptLabel = ptMap[store?.payment_terms]||store?.payment_terms||"";
      const payTermsMap={cash:"COD",bill_to_bill:"NET 7",credit_25_days:"NET 30"};
      const noteParts=[];
      if(store?.name) noteParts.push(`Store: ${store.name}`);
      if(store?.mobile) noteParts.push(`📞 ${store.mobile}`);
      const loc = store?.address||store?.area; if(loc) noteParts.push(loc);
      if(ptLabel) noteParts.push(`Terms: ${ptLabel}`);
      if(o.profiles?.full_name) noteParts.push(`Rider: ${o.profiles.full_name}`);
      noteParts.push(`Order #${(o.id||"").slice(0,8)}`);
      setModal({t:"newInvoice", prefill:{ custId, payTerms:payTermsMap[store?.payment_terms]||"COD", notes:noteParts.join(" · "), items }});
    };
    const cancel = async (o) => {
      if (!confirm(`Cancel order?`)) return;
      const prevStatus = o.status;
      setBusy(o.id+"_c");
      try {
        await sbPost("update_order_status",{id:o.id,status:"Cancelled"}); notify("Order cancelled"); await loadSupabase(true);
        pushUndo(`Order #${(o.id||"").slice(0,8)} cancelled`, async () => {
          await sbPost("update_order_status",{id:o.id,status:prevStatus}); await loadSupabase(true);
        });
      }
      catch(e) { notify("❌ "+e.message,"err"); } finally { setBusy(null); }
    };
    if (sbLoading) return <div style={{padding:40,textAlign:"center",color:G.muted}}>⏳ Loading rider orders…</div>;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center"}}>
          {["all","Pending","Approved","Packed","Dispatched","Delivered","Cancelled"].map(s=>(
            <button key={s} onClick={()=>setStatusFilter(s)} style={{padding:"4px 13px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",background:statusFilter===s?G.dark:G.pale,color:statusFilter===s?G.white:G.dark,border:`1.5px solid ${statusFilter===s?G.dark:G.border}`}}>{s==="all"?"All":s}</button>
          ))}
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search order / store / rider…" style={{marginLeft:"auto",border:`1.5px solid ${G.border}`,borderRadius:8,padding:"5px 11px",fontSize:12,color:G.ink,background:G.bg,outline:"none",minWidth:200}}/>
          <Btn sm v="secondary" onClick={()=>exportCsv("rider-orders.csv",filtered.map(o=>({id:o.id,store:o.stores?.name,rider:o.profiles?.full_name,total:o.total_value||o.total||0,status:o.status,gas_invoice_id:o.gas_invoice_id})),[["id","Order"],["store","Store"],["rider","Rider"],["total","Total"],["status","Status"],["gas_invoice_id","GAS Invoice"]])}>⬇ Export</Btn>
          <Btn sm v="secondary" onClick={()=>loadSupabase()}>↻ Refresh</Btn>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Order","Store","Rider","Total","Status","GAS","Actions"]}
            rows={filtered.map(o=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:10,fontFamily:"monospace"}}>{(o.id||"").slice(0,8)}</span>,
              <div><div style={{fontWeight:600,fontSize:11}}>{o.stores?.name||"—"}</div><div style={{fontSize:9,color:G.muted}}>{o.stores?.area||""}</div></div>,
              <span style={{fontSize:11}}>{o.profiles?.full_name||"—"}</span>,
              <span style={{fontWeight:700,fontSize:11}}>{fmt(o.total_value||o.total||0)}</span>,
              <span style={{background:(STATUS_CLR[o.status]||G.muted)+"22",color:STATUS_CLR[o.status]||G.muted,padding:"2px 9px",borderRadius:20,fontSize:10,fontWeight:700}}>{o.status}</span>,
              o.gas_invoice_id?<span style={{fontSize:9,color:G.mid,fontWeight:700}}>✓ {o.gas_invoice_id}</span>:<span style={{fontSize:9,color:G.muted}}>—</span>,
              <div style={{display:"flex",gap:4}}>
                {STATUS_NEXT[o.status]&&<Btn sm v="primary" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"…":"→ "+STATUS_NEXT[o.status]}</Btn>}
                {o.status!=="Pending"&&o.status!=="Cancelled"&&o.status!=="Rejected"&&!o.gas_invoice_id&&<Btn sm v="secondary" disabled={!!busy} onClick={()=>startInvoice(o)}>🧾</Btn>}
                {(o.status==="Pending"||o.status==="Approved")&&<Btn sm v="danger" disabled={!!busy} onClick={()=>cancel(o)}>✕</Btn>}
              </div>
            ])}
          />
          {filtered.length===0&&<div style={{padding:32,textAlign:"center",color:G.muted,fontSize:12}}>No orders match filter</div>}
        </div>
      </div>
    );
  };

  const RiderStoresTab = () => {
    const [storeModal, setStoreModal] = useState(null);
    const [form, setForm] = useState({});
    const [busy, setBusy] = useState(false);
    const [q, setQ] = useState("");
    const [hideDupes, setHideDupes] = useState(true);
    // Two riders adding the same physical shop creates duplicate rows here. We collapse them in
    // the CRM view + Customers sync WITHOUT deleting anything in Supabase (the rider app and its
    // orders still depend on every row). Group key = name + mobile (fallback name + area).
    const storeKey = (s)=>{ const n=normTxt(s.name), m=digitsOnly(s.mobile); return m ? n+"|"+m : n+"|"+normTxt(s.area); };
    const dupInfo = useMemo(()=>{
      const groups={};
      sbData.stores.forEach(s=>{ const k=storeKey(s); (groups[k]=groups[k]||[]).push(s); });
      const dupIds=new Set(), groupSize={};
      Object.values(groups).forEach(arr=>{
        if(arr.length<2) return;
        // Representative: prefer one already synced to Sheets, then the earliest created.
        const sorted=[...arr].sort((a,b)=>{
          const ag=a.gas_customer_id?0:1, bg=b.gas_customer_id?0:1;
          if(ag!==bg) return ag-bg;
          return new Date(a.created_at||0)-new Date(b.created_at||0);
        });
        const rep=sorted[0];
        groupSize[rep.id]=arr.length;
        arr.forEach(s=>{ if(s.id!==rep.id) dupIds.add(s.id); });
      });
      return { dupIds, groupSize };
    },[sbData.stores]);
    const filtered = sbData.stores.filter(s=>{
      if(hideDupes && dupInfo.dupIds.has(s.id)) return false;
      if(!q) return true;
      const v=q.toLowerCase();
      return(s.name||"").toLowerCase().includes(v)||(s.area||"").toLowerCase().includes(v)||(s.owner_name||"").toLowerCase().includes(v);
    });
    // Drop empty strings so nullable/enum columns (e.g. category) aren't sent as "" which fails constraints.
    const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==""&&v!==undefined&&v!==null));
    const save = async () => {
      if (!form.name) return;
      setBusy(true);
      try {
        if (storeModal==="add") { const {id,...rest}=form; await sbPost("add_store",{store:clean(rest)}); notify("✅ Store added"); }
        else { const {id}=form; await sbPost("update_store",clean({id,name:form.name,owner_name:form.owner_name,mobile:form.mobile,address:form.address,area:form.area,category:form.category})); notify("✅ Store updated"); }
        setStoreModal(null); await loadSupabase(true);
      } catch(e) { notify("❌ "+e.message,"err"); } finally { setBusy(false); }
    };
    const del = async (s) => {
      if (!confirm(`Delete ${s.name}?`)) return;
      try {
        await sbPost("delete_store",{id:s.id});
        notify("✅ Deleted");
        await loadSupabase(true);
        // Best-effort undo: re-creates the store (gets a new id — Supabase doesn't let us
        // reuse the deleted one — but restores every field so nothing is actually lost).
        pushUndo(`Deleted store "${s.name}"`, async () => {
          await sbPost("add_store",{store:clean({
            name:s.name, owner_name:s.owner_name, mobile:s.mobile, address:s.address,
            area:s.area, category:s.category, latitude:s.latitude, longitude:s.longitude,
            payment_terms:s.payment_terms, created_by:s.created_by, gas_customer_id:s.gas_customer_id
          })});
          await loadSupabase(true);
        });
      }
      catch(e) {
        const msg = /foreign key|orders_store_id_fkey/i.test(e.message)
          ? "Cannot delete — this store has orders linked to it. Remove or reassign its orders first."
          : e.message;
        notify("❌ "+msg,"err");
      }
    };
    // Bulk-push rider stores into the Google Sheets Customers list (skips test/sample and
    // already-synced stores; writes the returned customer id back onto the store for idempotency).
    const [syncing, setSyncing] = useState(false);
    const syncToCustomers = async () => {
      // Only sync de-duplicated representatives, and skip test/sample + already-synced stores.
      const candidates = sbData.stores.filter(s=>{
        const n=(s.name||"").toLowerCase();
        if(!s.name) return false;
        if(/test|sample/.test(n)) return false;
        if(s.gas_customer_id) return false;
        if(dupInfo.dupIds.has(s.id)) return false;
        return true;
      });
      if(!candidates.length){ notify("Nothing to sync — all stores are already synced, duplicates, or excluded","err"); return; }
      if(!confirm(`Sync ${candidates.length} store(s) to the Customers list?\n(test/sample, duplicate and already-synced stores are skipped; stores that already exist as a customer are linked, not duplicated)`)) return;
      setSyncing(true);
      // Cross-check: index existing Sheets customers by name+phone (and name alone).
      const custByKey={}, custByName={};
      customers.forEach(c=>{ const n=normTxt(c.name); if(!n) return; custByName[n]=c; custByKey[n+"|"+digitsOnly(c.phone)]=c; });
      let created=0, linked=0, fail=0;
      for(const s of candidates){
        try{
          const n=normTxt(s.name), mobile=digitsOnly(s.mobile);
          // Match an existing customer by name+phone, or by name when the store has no phone.
          const existing = custByKey[n+"|"+mobile] || (!mobile ? custByName[n] : null);
          if(existing){
            try{ await sbPost("update_store",{id:s.id,gas_customer_id:existing.id}); }catch{/* non-fatal */}
            linked++;
            continue;
          }
          const r = await gasPost("add_customer",{name:s.name,area:s.area||"",city:"",contact:s.owner_name||"",phone:s.mobile||"",notes:`supabase_id:${s.id}`});
          if(r?.id){ try{ await sbPost("update_store",{id:s.id,gas_customer_id:r.id}); }catch{/* non-fatal */} }
          created++;
        }catch(e){ fail++; }
      }
      setSyncing(false);
      notify(`✅ Customers sync — ${created} added, ${linked} linked to existing${fail?`, ${fail} failed`:""}`);
      await loadData(true); await loadSupabase(true);
    };
    if (sbLoading) return <div style={{padding:40,textAlign:"center",color:G.muted}}>⏳ Loading stores…</div>;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search stores…" style={{border:`1.5px solid ${G.border}`,borderRadius:8,padding:"5px 11px",fontSize:12,color:G.ink,background:G.bg,outline:"none",flex:1}}/>
          <Btn sm onClick={()=>{setForm({name:"",owner_name:"",mobile:"",address:"",area:"",category:""});setStoreModal("add");}}>+ Add Store</Btn>
          {dupInfo.dupIds.size>0&&<Btn sm v={hideDupes?"secondary":"amber"} onClick={()=>setHideDupes(h=>!h)}>{hideDupes?`🔁 ${dupInfo.dupIds.size} dup hidden`:"Hide duplicates"}</Btn>}
          <Btn sm v="secondary" disabled={syncing} onClick={syncToCustomers}>{syncing?"⏳ Syncing…":"⬆ Sync to Customers"}</Btn>
          <Btn sm v="secondary" onClick={()=>loadSupabase()}>↻ Refresh</Btn>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Name","Owner","Mobile","Area","Category","GAS ID","Actions"]}
            rows={filtered.map(s=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{s.name}{dupInfo.groupSize[s.id]>1&&<span title="duplicate stores merged into this one" style={{marginLeft:6,fontSize:9,color:G.amber,fontWeight:800}}>×{dupInfo.groupSize[s.id]}</span>}{dupInfo.dupIds.has(s.id)&&<span style={{marginLeft:6,fontSize:9,color:G.red,fontWeight:800}}>dup</span>}</span>,
              <span style={{fontSize:11}}>{s.owner_name||"—"}</span>,
              <span style={{fontSize:11}}>{s.mobile||"—"}</span>,
              <span style={{fontSize:11}}>{s.area||"—"}</span>,
              <span style={{fontSize:10,color:G.muted}}>{s.category||"—"}</span>,
              s.gas_customer_id?<span style={{fontSize:9,color:G.mid,fontWeight:700}}>✓ {s.gas_customer_id}</span>:<span style={{fontSize:9,color:G.muted}}>—</span>,
              <div style={{display:"flex",gap:4}}>
                <Btn sm v="secondary" onClick={()=>{setForm({...s});setStoreModal("edit");}}>✏</Btn>
                <Btn sm v="danger" onClick={()=>del(s)}>✕</Btn>
              </div>
            ])}
          />
          {filtered.length===0&&<div style={{padding:32,textAlign:"center",color:G.muted,fontSize:12}}>No stores found</div>}
        </div>
        {storeModal&&(
          <Modal title={storeModal==="add"?"Add Rider Store":"Edit Rider Store"} onClose={()=>setStoreModal(null)}>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <Inp label="Store Name *" value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
                <Inp label="Owner Name" value={form.owner_name||""} onChange={e=>setForm(f=>({...f,owner_name:e.target.value}))}/>
                <Inp label="Mobile" value={form.mobile||""} onChange={e=>setForm(f=>({...f,mobile:e.target.value}))}/>
                <Inp label="Area" value={form.area||""} onChange={e=>setForm(f=>({...f,area:e.target.value}))}/>
                <Inp label="Category" value={form.category||""} onChange={e=>setForm(f=>({...f,category:e.target.value}))}/>
              </div>
              <Inp label="Address" value={form.address||""} onChange={e=>setForm(f=>({...f,address:e.target.value}))}/>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <Btn v="secondary" onClick={()=>setStoreModal(null)}>Cancel</Btn>
                <Btn disabled={busy} onClick={save}>{busy?"Saving…":"Save"}</Btn>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  };

  const RidersTab = () => {
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({});
    const [busy, setBusy] = useState(false);
    const save = async () => {
      setBusy(true);
      try { await sbPost("update_rider",{id:editingId,full_name:form.full_name,mobile:form.mobile,cnic:form.cnic,city:form.city,area:form.area,bike_available:form.bike_available}); notify("✅ Rider updated"); setEditingId(null); await loadSupabase(true); }
      catch(e) { notify("❌ "+e.message,"err"); } finally { setBusy(false); }
    };
    if (sbLoading) return <div style={{padding:40,textAlign:"center",color:G.muted}}>⏳ Loading riders…</div>;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
          <Btn sm v="secondary" onClick={()=>exportCsv("riders.csv",sbData.riders,[["full_name","Name"],["mobile","Mobile"],["cnic","CNIC"],["city","City"],["area","Area"],["bike_available","Bike Available"]])}>⬇ Export</Btn>
          <Btn sm v="secondary" onClick={()=>loadSupabase()}>↻ Refresh</Btn>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Name","Mobile","CNIC","City","Area","Bike","Action"]}
            rows={sbData.riders.map(r=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{r.full_name||"—"}</span>,
              <span style={{fontSize:11}}>{r.mobile||"—"}</span>,
              <span style={{fontSize:10,color:G.muted,fontFamily:"monospace"}}>{r.cnic||"—"}</span>,
              <span style={{fontSize:11}}>{r.city||"—"}</span>,
              <span style={{fontSize:11}}>{r.area||"—"}</span>,
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:r.bike_available?"#E8F5E9":G.pink,color:r.bike_available?G.mid:G.red,fontWeight:700}}>{r.bike_available?"Yes":"No"}</span>,
              <Btn sm v="secondary" onClick={()=>{setEditingId(r.id);setForm({...r});}}>✏ Edit</Btn>
            ])}
          />
          {sbData.riders.length===0&&<div style={{padding:32,textAlign:"center",color:G.muted,fontSize:12}}>No riders found</div>}
        </div>
        {editingId&&(
          <Modal title="Edit Rider" onClose={()=>setEditingId(null)}>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <Inp label="Full Name" value={form.full_name||""} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))}/>
                <Inp label="Mobile" value={form.mobile||""} onChange={e=>setForm(f=>({...f,mobile:e.target.value}))}/>
                <Inp label="CNIC" value={form.cnic||""} onChange={e=>setForm(f=>({...f,cnic:e.target.value}))}/>
                <Inp label="City" value={form.city||""} onChange={e=>setForm(f=>({...f,city:e.target.value}))}/>
                <Inp label="Area" value={form.area||""} onChange={e=>setForm(f=>({...f,area:e.target.value}))}/>
              </div>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:600,color:G.ink,cursor:"pointer"}}>
                <input type="checkbox" checked={!!form.bike_available} onChange={e=>setForm(f=>({...f,bike_available:e.target.checked}))}/> Bike Available
              </label>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <Btn v="secondary" onClick={()=>setEditingId(null)}>Cancel</Btn>
                <Btn disabled={busy} onClick={save}>{busy?"Saving…":"Save"}</Btn>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  };

  const LocationsTab = () => {
    const [tick, setTick] = useState(0);
    useEffect(()=>{const id=setInterval(()=>setTick(t=>t+1),30000);return()=>clearInterval(id);},[]);
    useEffect(()=>{if(tick>0)loadSupabase(true);},[tick]);
    const riderMap = Object.fromEntries(sbData.riders.map(r=>[r.id,r]));
    const timeAgo = (ts) => { const s=Math.floor((Date.now()-new Date(ts).getTime())/1000); if(s<60)return s+"s ago"; const m=Math.floor(s/60); if(m<60)return m+"m ago"; return Math.floor(m/60)+"h ago"; };
    if (sbLoading) return <div style={{padding:40,textAlign:"center",color:G.muted}}>⏳ Loading locations…</div>;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:11,color:G.muted,fontWeight:600}}>Auto-refreshes every 30 seconds</span>
          <Btn sm v="secondary" onClick={()=>loadSupabase()}>↻ Refresh Now</Btn>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Rider","Last Seen","Accuracy","Location"]}
            rows={sbData.locations.map(loc=>{
              const r=riderMap[loc.rider_id];
              return [
                <div><div style={{fontWeight:700,color:G.dark,fontSize:11}}>{r?.full_name||loc.rider_id?.slice(0,8)||"—"}</div><div style={{fontSize:9,color:G.muted}}>{r?.mobile||""}</div></div>,
                <span style={{fontSize:11,color:G.muted}}>{loc.updated_at?timeAgo(loc.updated_at):"—"}</span>,
                <span style={{fontSize:11,color:G.muted}}>{loc.accuracy?`±${Math.round(loc.accuracy)}m`:"—"}</span>,
                <a href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:G.blue,fontWeight:600,textDecoration:"none"}}>📍 {loc.latitude?.toFixed(4)}, {loc.longitude?.toFixed(4)}</a>
              ];
            })}
          />
          {sbData.locations.length===0&&<div style={{padding:32,textAlign:"center",color:G.muted,fontSize:12}}>No location data available</div>}
        </div>
      </div>
    );
  };

  const RiderProductsTab = () => {
    const [pModal, setPModal] = useState(null);
    const [form, setForm] = useState({});
    const [busy, setBusy] = useState(false);
    const [q, setQ] = useState("");
    const filtered = sbData.products.filter(p=>{if(!q)return true;const v=q.toLowerCase();return(p.name||"").toLowerCase().includes(v)||(p.category||"").toLowerCase().includes(v);});
    const save = async () => {
      setBusy(true);
      try {
        // Whitelist real product columns (the products table has no sale_price or unit column).
        const prod={name:form.name,category:form.category,trade_price:Number(form.trade_price||0),current_stock:Number(form.current_stock||0),min_stock:Number(form.min_stock||0),active:!!form.active};
        if(pModal==="add"){await sbPost("insert_product",{product:prod});notify("✅ Product added");}
        else{await sbPost("update_product",{id:form.id,...prod});notify("✅ Product updated");}
        setPModal(null); await loadSupabase(true);
      } catch(e){notify("❌ "+e.message,"err");} finally{setBusy(false);}
    };
    const toggleActive = async (p) => {
      try{await sbPost("update_product",{id:p.id,active:!p.active});notify(`✅ ${p.name} ${!p.active?"activated":"deactivated"}`);await loadSupabase(true);}
      catch(e){notify("❌ "+e.message,"err");}
    };
    if(sbLoading)return <div style={{padding:40,textAlign:"center",color:G.muted}}>⏳ Loading products…</div>;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search products…" style={{border:`1.5px solid ${G.border}`,borderRadius:8,padding:"5px 11px",fontSize:12,color:G.ink,background:G.bg,outline:"none",flex:1}}/>
          <Btn sm onClick={()=>{setForm({name:"",category:"",trade_price:0,current_stock:0,min_stock:0,active:true});setPModal("add");}}>+ Add Product</Btn>
          <Btn sm v="secondary" onClick={()=>exportCsv("products.csv",filtered,[["name","Name"],["category","Category"],["trade_price","Trade Price"],["current_stock","Stock"],["min_stock","Min"],["active","Active"]])}>⬇ Export</Btn>
          <Btn sm v="secondary" onClick={()=>loadSupabase()}>↻ Refresh</Btn>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Name","Category","Trade","Stock","Min","Active","Action"]}
            rows={filtered.map(p=>[
              <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{p.name}</span>,
              <span style={{fontSize:10,color:G.muted}}>{p.category||"—"}</span>,
              <span style={{fontSize:11}}>{fmt(p.trade_price||0)}</span>,
              <span style={{fontSize:11,color:(p.current_stock||0)<=(p.min_stock||0)?G.red:G.ink,fontWeight:(p.current_stock||0)<=(p.min_stock||0)?700:400}}>{p.current_stock||0}</span>,
              <span style={{fontSize:11,color:G.muted}}>{p.min_stock||0}</span>,
              <button onClick={()=>toggleActive(p)} style={{background:p.active?"#E8F5E9":G.pink,color:p.active?G.mid:G.red,border:"none",borderRadius:20,padding:"2px 9px",fontSize:10,fontWeight:700,cursor:"pointer"}}>{p.active?"Active":"Inactive"}</button>,
              <Btn sm v="secondary" onClick={()=>{setForm({...p});setPModal("edit");}}>✏</Btn>
            ])}
          />
          {filtered.length===0&&<div style={{padding:32,textAlign:"center",color:G.muted,fontSize:12}}>No products found</div>}
        </div>
        {pModal&&(
          <Modal title={pModal==="add"?"Add Product":"Edit Product"} onClose={()=>setPModal(null)}>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <Inp label="Name *" value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
                <Inp label="Category" value={form.category||""} onChange={e=>setForm(f=>({...f,category:e.target.value}))}/>
                <Inp label="Trade Price" type="number" value={form.trade_price||0} onChange={e=>setForm(f=>({...f,trade_price:e.target.value}))}/>
                <Inp label="Current Stock" type="number" value={form.current_stock||0} onChange={e=>setForm(f=>({...f,current_stock:e.target.value}))}/>
                <Inp label="Min Stock" type="number" value={form.min_stock||0} onChange={e=>setForm(f=>({...f,min_stock:e.target.value}))}/>
              </div>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:600,color:G.ink,cursor:"pointer"}}>
                <input type="checkbox" checked={!!form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))}/> Active (visible to riders)
              </label>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <Btn v="secondary" onClick={()=>setPModal(null)}>Cancel</Btn>
                <Btn disabled={busy} onClick={save}>{busy?"Saving…":"Save"}</Btn>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  };

  const StoreAssignTab = () => {
    const [selRider, setSelRider] = useState("");
    const [busy, setBusy] = useState(null);
    const assigned = new Set(sbData.assignments.filter(a=>a.rider_id===selRider).map(a=>a.store_id));
    const toggle = async (storeId, on) => {
      setBusy(storeId);
      try{await sbPost("toggle_store_assignment",{rider_id:selRider,store_id:storeId,on});await loadSupabase(true);}
      catch(e){notify("❌ "+e.message,"err");} finally{setBusy(null);}
    };
    if(sbLoading)return <div style={{padding:40,textAlign:"center",color:G.muted}}>⏳ Loading…</div>;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={selRider} onChange={e=>setSelRider(e.target.value)} style={{flex:1,maxWidth:300,border:`1.5px solid ${G.border}`,borderRadius:8,padding:"7px 11px",fontSize:13,color:G.ink,background:G.bg,outline:"none"}}>
            <option value="">— Select a Rider —</option>
            {sbData.riders.map(r=><option key={r.id} value={r.id}>{r.full_name} ({r.mobile||"no mobile"})</option>)}
          </select>
          <Btn sm v="secondary" onClick={()=>loadSupabase()}>↻ Refresh</Btn>
        </div>
        {selRider?(
          <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
            <TblWrap compact heads={["Store","Area","Assigned"]}
              rows={sbData.stores.map(s=>[
                <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{s.name}</span>,
                <span style={{fontSize:11,color:G.muted}}>{s.area||"—"}</span>,
                <button disabled={busy===s.id} onClick={()=>toggle(s.id,!assigned.has(s.id))} style={{background:assigned.has(s.id)?"#E8F5E9":G.pale,color:assigned.has(s.id)?G.mid:G.muted,border:`1.5px solid ${assigned.has(s.id)?G.mid:G.border}`,borderRadius:8,padding:"3px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>{busy===s.id?"…":assigned.has(s.id)?"✓ Assigned":"Assign"}</button>
              ])}
            />
          </div>
        ):<div style={{padding:32,textAlign:"center",color:G.muted,fontSize:12,background:G.card,borderRadius:12}}>Select a rider to manage their store assignments</div>}
      </div>
    );
  };

  const AreasTab = () => {
    const [addForm, setAddForm] = useState({city:"",name:""});
    const [busy, setBusy] = useState(false);
    const [selRider, setSelRider] = useState("");
    const [areaBusy, setAreaBusy] = useState(null);
    const assignedAreas = new Set(sbData.riderAreas.filter(a=>a.rider_id===selRider).map(a=>a.area_id));
    const addArea = async () => {
      if(!addForm.city||!addForm.name)return;
      setBusy(true);
      try{await sbPost("add_area",{area:{city:addForm.city,name:addForm.name}});notify("✅ Area added");setAddForm({city:"",name:""});await loadSupabase(true);}
      catch(e){notify("❌ "+e.message,"err");} finally{setBusy(false);}
    };
    const toggleArea = async (areaId, on) => {
      setAreaBusy(areaId);
      try{await sbPost("toggle_area_assignment",{rider_id:selRider,area_id:areaId,on});await loadSupabase(true);}
      catch(e){notify("❌ "+e.message,"err");} finally{setAreaBusy(null);}
    };
    if(sbLoading)return <div style={{padding:40,textAlign:"center",color:G.muted}}>⏳ Loading areas…</div>;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div style={{background:G.card,borderRadius:12,padding:16,boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{fontWeight:700,fontSize:12,color:G.dark,marginBottom:10}}>Add Area</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end"}}>
            <Inp label="City *" value={addForm.city} onChange={e=>setAddForm(f=>({...f,city:e.target.value}))}/>
            <Inp label="Area Name *" value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))}/>
            <Btn disabled={busy||!addForm.city||!addForm.name} onClick={addArea}>{busy?"Adding…":"+ Add"}</Btn>
          </div>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{background:G.dark,padding:"9px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:G.white,fontWeight:700,fontSize:12}}>Areas ({sbData.areas.length})</span>
            <Btn sm v="secondary" onClick={()=>loadSupabase()}>↻ Refresh</Btn>
          </div>
          <TblWrap compact heads={["City","Name","Riders Assigned"]}
            rows={sbData.areas.map(a=>[
              <span style={{fontWeight:600,color:G.dark,fontSize:11}}>{a.city}</span>,
              <span style={{fontSize:11}}>{a.name}</span>,
              <span style={{fontSize:10,color:G.muted}}>{sbData.riderAreas.filter(ra=>ra.area_id===a.id).length}</span>
            ])}
          />
          {sbData.areas.length===0&&<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:12}}>No areas yet</div>}
        </div>
        <div style={{background:G.card,borderRadius:12,padding:16,boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{fontWeight:700,fontSize:12,color:G.dark,marginBottom:10}}>Rider Area Assignments</div>
          <select value={selRider} onChange={e=>setSelRider(e.target.value)} style={{maxWidth:280,border:`1.5px solid ${G.border}`,borderRadius:8,padding:"7px 11px",fontSize:12,color:G.ink,background:G.bg,outline:"none",marginBottom:12,display:"block"}}>
            <option value="">— Select a Rider —</option>
            {sbData.riders.map(r=><option key={r.id} value={r.id}>{r.full_name}</option>)}
          </select>
          {selRider&&(
            <TblWrap compact heads={["City","Area","Assigned"]}
              rows={sbData.areas.map(a=>[
                <span style={{fontSize:11,color:G.muted}}>{a.city}</span>,
                <span style={{fontWeight:600,fontSize:11}}>{a.name}</span>,
                <button disabled={areaBusy===a.id} onClick={()=>toggleArea(a.id,!assignedAreas.has(a.id))} style={{background:assignedAreas.has(a.id)?"#E8F5E9":G.pale,color:assignedAreas.has(a.id)?G.mid:G.muted,border:`1.5px solid ${assignedAreas.has(a.id)?G.mid:G.border}`,borderRadius:8,padding:"3px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>{areaBusy===a.id?"…":assignedAreas.has(a.id)?"✓ Assigned":"Assign"}</button>
              ])}
            />
          )}
        </div>
      </div>
    );
  };

  const RiderReportsTab = () => {
    const [days, setDays] = useState(30);
    const [repData, setRepData] = useState(null);
    const [repLoading, setRepLoading] = useState(false);
    useEffect(()=>{
      let on=true;
      setRepLoading(true);
      Promise.all([sbPost("report_orders",{days}),sbPost("report_items",{days})])
        .then(([orders,items])=>{if(on)setRepData({orders:orders||[],items:items||[]});})
        .catch(e=>notify("❌ "+e.message,"err"))
        .finally(()=>{if(on)setRepLoading(false);});
      return()=>{on=false;};
    },[days]);
    const riderMap = Object.fromEntries(sbData.riders.map(r=>[r.id,r.full_name||r.id?.slice(0,8)||"?"]));
    const riderStats = repData ? (() => {
      const m={};
      repData.orders.forEach(o=>{const n=riderMap[o.rider_id]||"Unknown";if(!m[n])m[n]={name:n,count:0,revenue:0,incentive:0};m[n].count++;m[n].revenue+=Number(o.total_value||0);m[n].incentive+=Number(o.incentive||0);});
      return Object.values(m).sort((a,b)=>b.count-a.count);
    })() : [];
    const productStats = repData ? (() => {
      const m={};
      repData.items.forEach(i=>{const n=i.product_name||i.product_id||"?";if(!m[n])m[n]={name:n,qty:0,revenue:0};m[n].qty+=Number(i.quantity||0);m[n].revenue+=Number(i.total||0);});
      return Object.values(m).sort((a,b)=>b.qty-a.qty).slice(0,20);
    })() : [];
    const total = repData ? {
      orders:repData.orders.length,
      revenue:repData.orders.reduce((s,o)=>s+Number(o.total_value||0),0),
      incentive:repData.orders.reduce((s,o)=>s+Number(o.incentive||0),0),
      delivered:repData.orders.filter(o=>o.status==="Delivered").length,
    } : null;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {[7,30,90].map(d=>(
            <button key={d} onClick={()=>setDays(d)} style={{padding:"5px 14px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",background:days===d?G.dark:G.pale,color:days===d?G.white:G.dark,border:`1.5px solid ${days===d?G.dark:G.border}`}}>Last {d} days</button>
          ))}
          {repLoading&&<span style={{fontSize:11,color:G.muted}}>⏳ Loading…</span>}
          <div style={{flex:1}}/>
          <Btn sm v="secondary" onClick={()=>exportCsv(`rider_performance_${days}d.csv`,riderStats,[["name","Rider"],["count","Orders"],["revenue","Revenue"],["incentive","Incentive"]])}>⬇ Export Riders</Btn>
          <Btn sm v="secondary" onClick={()=>exportCsv(`top_products_${days}d.csv`,productStats,[["name","Product"],["qty","Qty"],["revenue","Revenue"]])}>⬇ Export Products</Btn>
        </div>
        {total&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
            <Kpi label="Total Orders" value={total.orders} sub={`${total.delivered} delivered`} color={G.blue}/>
            <Kpi label="Total Revenue" value={fmt(total.revenue)} color={G.mid} trend="up"/>
            <Kpi label="Total Incentive" value={fmt(total.incentive)} color={G.amber}/>
            <Kpi label="Delivery Rate" value={total.orders?pct(total.delivered,total.orders):"—"} color={G.purple}/>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
            <div style={{background:G.dark,padding:"9px 14px"}}><span style={{color:G.white,fontWeight:700,fontSize:12}}>By Rider</span></div>
            <TblWrap compact heads={["Rider","Orders","Revenue","Incentive"]}
              rows={riderStats.map(r=>[
                <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{r.name}</span>,
                <span style={{fontSize:11}}>{r.count}</span>,
                <span style={{fontSize:11,fontWeight:600}}>{fmt(r.revenue)}</span>,
                <span style={{fontSize:11,color:G.amber}}>{fmt(r.incentive)}</span>
              ])}
            />
            {riderStats.length===0&&<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:12}}>No data</div>}
          </div>
          <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
            <div style={{background:G.dark,padding:"9px 14px"}}><span style={{color:G.white,fontWeight:700,fontSize:12}}>Top Products</span></div>
            <TblWrap compact heads={["Product","Qty","Revenue"]}
              rows={productStats.map(p=>[
                <span style={{fontWeight:700,color:G.dark,fontSize:11}}>{p.name}</span>,
                <span style={{fontSize:11}}>{p.qty}</span>,
                <span style={{fontSize:11,fontWeight:600}}>{fmt(p.revenue)}</span>
              ])}
            />
            {productStats.length===0&&<div style={{padding:24,textAlign:"center",color:G.muted,fontSize:12}}>No data</div>}
          </div>
        </div>
      </div>
    );
  };

  const RiderConfigTab = () => {
    const [settings, setSettings] = useState([]);
    const [busy, setBusy] = useState(null);
    const [pushCount, setPushCount] = useState(null);
    useEffect(()=>{
      sbPost("app_settings").then(d=>setSettings(d||[])).catch(()=>{});
      sbPost("push_subscriptions_count").then(n=>setPushCount(n)).catch(()=>{});
    },[]);
    const getVal = (key) => settings.find(s=>s.key===key)?.value??"";
    const saveSetting = async (key, value) => {
      setBusy(key);
      try{await sbPost("upsert_setting",{key,value});setSettings(prev=>{const i=prev.findIndex(s=>s.key===key);return i>=0?prev.map((s,j)=>j===i?{...s,value}:s):[...prev,{key,value}];});notify("✅ Setting saved");}
      catch(e){notify("❌ "+e.message,"err");} finally{setBusy(null);}
    };
    const SettingRow = ({k,label,type="text"}) => {
      const [val,setVal] = useState(getVal(k));
      useEffect(()=>setVal(getVal(k)),[k,settings.length]);
      return <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:10}}>
        <Inp label={label} value={val} type={type} onChange={e=>setVal(e.target.value)} style={{flex:1}}/>
        <Btn sm disabled={busy===k} onClick={()=>saveSetting(k,val)}>{busy===k?"Saving…":"Save"}</Btn>
      </div>;
    };
    return (
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div style={{background:G.card,borderRadius:12,padding:18,boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{fontWeight:700,fontSize:13,color:G.dark,marginBottom:14}}>Incentive Settings</div>
          <SettingRow k="incentive_per_order" label="Incentive per Order (PKR)" type="number"/>
          <SettingRow k="monthly_target_orders" label="Monthly Target (Orders)" type="number"/>
          <SettingRow k="bonus_amount" label="Bonus Amount (PKR)" type="number"/>
          <SettingRow k="bonus_threshold_orders" label="Bonus Threshold (Orders)" type="number"/>
        </div>
        <div style={{background:G.card,borderRadius:12,padding:18,boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{fontWeight:700,fontSize:13,color:G.dark,marginBottom:14}}>Google Sheets Sync</div>
          <SettingRow k="gas_sync_enabled" label="Sheets Sync Enabled (true/false)"/>
          <SettingRow k="gas_webhook_url" label="GAS Webhook URL (override)"/>
        </div>
        <div style={{background:G.card,borderRadius:12,padding:18,boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:13,color:G.dark}}>Push Notifications</div>
            {pushCount!==null&&<span style={{fontSize:11,color:G.muted,fontWeight:600}}>{pushCount} subscribers</span>}
          </div>
          <SettingRow k="push_title_default" label="Default Push Title"/>
          <SettingRow k="push_body_default" label="Default Push Body"/>
        </div>
      </div>
    );
  };

  // ── PAGES ─────────────────────────────────────────────────
  const PAGES={
    dashboard:<Dashboard/>,customers:<Customers/>,invoices:<Invoices/>,
    payments:(
      <div>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12,gap:8}}>
          <Btn sm onClick={()=>setModal({t:"recordPayment"})}>+ Record Payment</Btn>
          <Btn sm v="secondary" onClick={()=>exportCsv("payments.csv",payments,[["id","Pay ID"],["date","Date"],["type","Type"],["partyName","Party"],["refId","Invoice"],["amount","Amount"],["notes","Notes"]])}>⬇ Export</Btn>
        </div>
        <div style={{background:G.card,borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(26,92,32,0.07)"}}>
          <TblWrap compact heads={["Pay ID","Date","Type","Party","Invoice","Amount","Notes"]}
            rows={payments.map(p=>[<span style={{fontWeight:700,color:G.dark,fontSize:11}}>{p.id}</span>,<span style={{fontSize:10,color:G.muted}}>{p.date}</span>,<Badge text={p.type}/>,<span style={{fontWeight:600,fontSize:11}}>{p.partyName||p.partyId}</span>,<span style={{fontSize:10,color:G.muted}}>{p.refId||"—"}</span>,<span style={{fontWeight:800,color:p.type==="Received"?G.mid:G.red,fontSize:11}}>{fmt(p.amount)}</span>,<span style={{fontSize:10,color:G.muted}}>{p.notes||"—"}</span>])}
          />
        </div>
      </div>
    ),
    purchases:<Purchases/>,vendors:<Vendors/>,expenses:<Expenses/>,
    pnl:<PnL/>,arap:<ARAp/>,inventory:<Inventory/>,reports:<Reports/>,
    "rider-orders":<RiderOrdersTab/>,"rider-stores":<RiderStoresTab/>,
    riders:<RidersTab/>,locations:<LocationsTab/>,"rider-products":<RiderProductsTab/>,
    "store-assign":<StoreAssignTab/>,areas:<AreasTab/>,"rider-reports":<RiderReportsTab/>,"rider-config":<RiderConfigTab/>,
  };

  return (
    <div style={{display:"flex",height:"100vh",overflow:"hidden",fontFamily:"'DM Sans',system-ui,sans-serif",background:G.bg}}>
      {/* SIDEBAR */}
      <div style={{width:200,background:G.sidebar,display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
        <div style={{padding:"16px 14px 12px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <div style={{width:32,height:32,background:`linear-gradient(135deg,${G.mid},${G.accent})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>🌿</div>
            <div>
              <div style={{color:G.white,fontWeight:800,fontSize:12}}>APT CRM</div>
              <div style={{display:"flex",alignItems:"center",gap:4,marginTop:1}}>
                <div style={{width:5,height:5,borderRadius:"50%",background:G.light,boxShadow:`0 0 4px ${G.light}`}}/>
                <span style={{color:"rgba(255,255,255,0.35)",fontSize:8,letterSpacing:"0.1em",fontWeight:600}}>LIVE · SHEET + PDF</span>
              </div>
            </div>
          </div>
        </div>
        <nav style={{flex:1,padding:"8px 6px",overflowY:"auto",display:"flex",flexDirection:"column",gap:0}}>
          {NAV_GROUPS.map(section=>(
            <div key={section.group}>
              <div style={{fontSize:8,fontWeight:800,color:"rgba(255,255,255,0.22)",textTransform:"uppercase",letterSpacing:"0.12em",padding:"8px 8px 3px"}}>{section.group}</div>
              {section.items.map(n=>{
                const active=tab===n.id;
                return(
                  <button key={n.id} onClick={()=>{setTab(n.id);setSearch("");}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 9px",borderRadius:7,border:"none",cursor:"pointer",background:active?"rgba(76,175,80,0.18)":"transparent",color:active?"#8BC34A":"rgba(255,255,255,0.52)",fontWeight:active?700:500,fontSize:12,width:"100%",textAlign:"left"}}>
                    <span>{n.label}</span>
                    {n.badge&&<span style={{background:typeof n.badge==="number"&&n.badge>10?G.blue:G.red,color:G.white,borderRadius:9,padding:"1px 6px",fontSize:8,fontWeight:800}}>{n.badge}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{padding:"10px 12px",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:G.mid,display:"flex",alignItems:"center",justifyContent:"center",color:G.white,fontWeight:800,fontSize:10,flexShrink:0}}>{(user.displayName||"A").charAt(0)}</div>
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.65)",fontWeight:700}}>{user.displayName?.split(" ")[0]||"User"}</div>
              <div style={{fontSize:8,color:"rgba(255,255,255,0.28)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user.email}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"none",borderRadius:6,padding:"6px 8px",color:"rgba(255,255,255,0.4)",fontSize:10,fontWeight:600,cursor:"pointer",textAlign:"center"}}>Sign Out</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:G.white,borderBottom:`1px solid ${G.border}`,padding:"0 22px",height:52,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,boxShadow:"0 1px 4px rgba(26,92,32,0.06)"}}>
          <h1 style={{margin:0,fontSize:17,fontWeight:800,color:G.ink}}>{NAV_GROUPS.flatMap(g=>g.items).find(n=>n.id===tab)?.label}</h1>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {(syncing||sbSyncing)&&<span style={{fontSize:10,color:G.muted,fontWeight:600}}>⏳ Syncing…</span>}
            {RIDER_HUB_TABS.has(tab)
              ?<button onClick={()=>loadSupabase()} style={{background:"#E3F2FD",border:`1px solid ${G.blue}`,borderRadius:7,padding:"4px 11px",fontSize:10,fontWeight:700,color:G.blue,cursor:"pointer"}}>↻ Rider Sync</button>
              :<button onClick={()=>loadData(true)} style={{background:G.pale,border:`1px solid ${G.mid}`,borderRadius:7,padding:"4px 11px",fontSize:10,fontWeight:700,color:G.dark,cursor:"pointer"}}>↻ Sync</button>}
          </div>
        </div>

        {toast&&<div style={{position:"fixed",top:62,right:18,background:toast.type==="err"?G.red:G.mid,color:G.white,padding:"10px 16px",borderRadius:9,fontWeight:700,fontSize:12,zIndex:9999,boxShadow:"0 8px 28px rgba(0,0,0,0.22)"}}>{toast.msg}</div>}

        {undoStack.length>0&&(
          <div style={{position:"fixed",bottom:18,left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",gap:8,zIndex:9999}}>
            {undoStack.map(entry=>(
              <div key={entry.id} style={{background:G.dark,color:G.white,padding:"9px 10px 9px 16px",borderRadius:9,fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 28px rgba(0,0,0,0.28)",minWidth:260}}>
                <span style={{flex:1}}>{entry.label}</span>
                <button onClick={()=>performUndo(entry.id)} style={{background:"rgba(255,255,255,0.16)",border:"none",borderRadius:7,padding:"6px 14px",fontSize:11,fontWeight:800,color:G.white,cursor:"pointer"}}>↩ Undo</button>
              </div>
            ))}
          </div>
        )}

        <div style={{flex:1,overflow:"auto",padding:18}}>{PAGES[tab]}</div>
      </div>

      {renderModal()}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────
export default function App() {
  const [authState, setAuthState] = useState("loading");
  const [user, setUser]           = useState(null);
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (!u) { setAuthState("login"); setUser(null); return; }
      if (!ALLOWED_EMAILS.includes(u.email)) { setUser(u); setAuthState("denied"); signOut(auth); return; }
      setUser(u); setAuthState("app");
    });
    return unsub;
  }, []);

  const handleLogin  = async () => { setLoginError(""); try { await signInWithPopup(auth, googleProvider); } catch(e) { setLoginError(e.message); } };
  const handleLogout = () => signOut(auth);

  if (authState==="loading") return <LoadingScreen msg="Initialising APT CRM…"/>;
  if (authState==="login")   return <LoginScreen error={loginError}/>;
  if (authState==="denied")  return <AccessDenied user={user} onLogout={handleLogout}/>;
  return <CrmApp user={user} onLogout={handleLogout}/>;
}
