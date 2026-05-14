import { useState, useEffect, useRef, useCallback } from "react";

// ─── STORAGE (localStorage – browserkompatibel) ───────────────────────────────
async function persist(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch(e) { console.warn("persist failed", e); }
}
async function retrieve(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

// ─── EYLA THEME ───────────────────────────────────────────────────────────────
const T = {
  bg:     "#050A14",
  bg2:    "#090F1C",
  card:   "#0D1525",
  border: "#00E5FF14",
  borderS:"#00E5FF28",
  acc:    "#00E5FF",
  bright: "#38D9F5",
  dim:    "#0891B2",
  gold:   "#EAAB00",
  goldL:  "#FFB800",
  rose:   "#818CF8",
  text:   "#F0F9FF",
  mid:    "#7DD3FC",
  muted:  "#64748B",
  faint:  "#1E293B",
  green:  "#34D399",
  red:    "#F87171",
  serif:  "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  mono:   "'Courier New', Courier, monospace",
  sans:   "'Trebuchet MS', 'Gill Sans', sans-serif",
};

const DEFAULT_PROFILE = {
  name: "Phil",
  age: "35",
  weight: "79",
  height: "183",
  goal: "Beweglich, fit und energiegeladen bleiben",
  activity: "5x pro Woche, 1,5–2h Beweglichkeitstraining",
  preferences: ["Wenig Fleisch", "Proteinreich", "Mediterran"],
  intolerances: [],
  apps: [],
};

const TODAY = new Date().toDateString();
const EMPTY_LOG = () => ({ meals:[], water:0, energy:"", sleep:"", date:TODAY });

// ─── DATUMS-HELFER ────────────────────────────────────────────────────────────
// Liefert ein Array der letzten n Tage als toDateString()-Keys (heute zuerst).
function lastNDays(n) {
  const out = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(d.toDateString());
  }
  return out;
}

// Komprimiertes 7-Tage-History-Objekt für Chat-Prompt aus logsByDate ableiten.
function weekHistoryFromLogs(logsByDate) {
  return lastNDays(7).map(dateKey => {
    const l = logsByDate?.[dateKey];
    const kcal = l?.meals?.reduce((s,m)=>s+(m.calories||0),0) || 0;
    return {
      date: dateKey,
      water: l?.water || 0,
      sleep: l?.sleep || "",
      kcal,
      mood: l?.energy || "",
    };
  });
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
function buildPrompt(profile, log, events, weekHistory = []) {
  const eaten = log.meals.reduce((s,m)=>s+(m.calories||0),0);
  const eventStr = events.length > 0
    ? events.map(e=>`  - ${e.time||"?"} ${e.title}${e.duration?" ("+e.duration+")":""}`).join("\n")
    : "  Keine Termine heute.";

  const historyStr = (weekHistory && weekHistory.length > 0)
    ? weekHistory.map((d, i) => {
        const label = i === 0 ? "Heute" : i === 1 ? "Gestern" : new Date(d.date).toLocaleDateString("de-DE",{weekday:"short",day:"numeric",month:"short"});
        const parts = [];
        parts.push(`💧${d.water}/8`);
        parts.push(`😴${d.sleep||"–"}h`);
        parts.push(`🍽${d.kcal}kcal`);
        if (d.mood) parts.push(d.mood);
        return `  - ${label}: ${parts.join("  ")}`;
      }).join("\n")
    : "  Noch keine Historie.";

  return `Du bist EYLA – synthetische KI-Begleiterin von ${profile.name}. Zweites Gehirn. Körper und Tag in einer Intelligenz.

CHARAKTER: Präzise, direkt, warm aber nicht weich. Du weißt was heute ansteht und was der Körper braucht. Du sagst was Sache ist – mit Lösung. Kein Motivationsposter. Trocken-humorvoll wenn passend.

PROFIL: ${profile.name}, ${profile.age}J, ${profile.weight}kg, ${profile.height}cm
Aktivität: ${profile.activity||"k.A."} | Ziel: ${profile.goal||"Wohlbefinden"}
Vorlieben: ${profile.preferences?.join(", ")||"k.A."} | Intoleranzen: ${profile.intolerances?.join(", ")||"keine"}

HEUTE:
- Gegessen: ${eaten} kcal (${log.meals.map(m=>m.name).join(", ")||"noch nichts"})
- Wasser: ${log.water} Gläser (${(log.water*.25).toFixed(1)}L)
- Energie: ${log.energy||"k.A."} | Schlaf: ${log.sleep||"k.A."}h

LETZTE 7 TAGE:
${historyStr}

WAS HEUTE ANSTEHT:
${eventStr}

REGELN: Immer Deutsch. 2–4 Sätze. Konkret mit Mengen/Zeiten. Termine einbeziehen wenn sinnvoll. Letzte 7 Tage nur einbeziehen wenn relevant (z.B. Schlaf-Muster, Wasser-Trend). Nie "Als KI". Nie "ich sehe/kenne deinen Kalender" – einfach natürlich damit umgehen.`;
}

// ─── VOICE HOOK ───────────────────────────────────────────────────────────────
function useVoice(onResult) {
  const recRef = useRef(null);
  const cbRef = useRef(onResult);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => { cbRef.current = onResult; }, [onResult]);
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);
    const rec = new SR();
    rec.lang = "de-DE"; rec.continuous = false; rec.interimResults = false;
    rec.onresult = e => { const t = e.results[0][0].transcript; if(t) cbRef.current(t); setListening(false); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
  }, []);
  const toggle = useCallback(() => {
    if (!recRef.current) return;
    if (listening) { try { recRef.current.stop(); } catch {} setListening(false); }
    else { try { recRef.current.start(); setListening(true); } catch(e) { try { recRef.current.abort(); recRef.current.start(); setListening(true); } catch {} } }
  }, [listening]);
  return { listening, supported, toggle };
}

// ─── CALENDAR FETCH ───────────────────────────────────────────────────────────
// Google-Calendar-MCP-Sync ist im Browser/Vercel nicht verfügbar (nur in der
// Claude-Sandbox). Hier wird ein leeres Array zurückgegeben – Termine werden
// rein lokal verwaltet (siehe KalenderScreen, "+ TERMIN"-Button).
async function fetchCalendarEvents() {
  return [];
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function EylaOrb({ size=48, thinking=false, listening=false }) {
  const col = listening ? T.green : T.acc;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <style>{`
        @keyframes eR1{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes eR2{from{transform:rotate(0)}to{transform:rotate(-360deg)}}
        @keyframes eFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
        @keyframes eGlow{0%,100%{box-shadow:0 0 12px ${T.acc}44}50%{box-shadow:0 0 24px ${T.acc}88}}
        @keyframes eListen{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
        @keyframes eThink{0%,100%{box-shadow:0 0 16px ${T.acc}88}50%{box-shadow:0 0 32px ${T.acc}ff}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>
      <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:`1px solid ${col}33`, borderTopColor:`${col}88`, animation:`eR1 ${thinking?1.5:10}s linear infinite` }}/>
      <div style={{ position:"absolute", inset:size*.1, borderRadius:"50%", border:`1px solid ${col}18`, borderBottomColor:`${col}55`, animation:`eR2 ${thinking?1:7}s linear infinite` }}/>
      <div style={{ position:"absolute", inset:size*.18, borderRadius:"50%",
        background:`radial-gradient(circle at 35% 35%, ${T.goldL}, ${col}, ${T.dim})`,
        animation: listening?`eListen .6s ease-in-out infinite`:thinking?`eThink .8s ease-in-out infinite`:`eFloat 4s ease-in-out infinite, eGlow 3s ease-in-out infinite`,
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.3,
        boxShadow:`0 0 ${size*.3}px ${col}55`
      }}>✦</div>
    </div>
  );
}

function Waveform() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3, height:22 }}>
      {Array.from({length:16}).map((_,i)=>(
        <div key={i} style={{ width:3, borderRadius:3, background:`linear-gradient(${T.dim},${T.acc})`,
          animation:`eW ${.5+(i%4)*.2}s ease-in-out infinite alternate`, animationDelay:`${(i*.07).toFixed(2)}s` }}/>
      ))}
      <style>{`@keyframes eW{from{height:3px;opacity:.3}to{height:18px;opacity:1}}`}</style>
    </div>
  );
}

function Card({ children, style={}, accent=false, gold=false }) {
  return (
    <div style={{
      background: gold ? "linear-gradient(135deg,#1C1500,#211A00)" : accent ? `linear-gradient(135deg,${T.dim}18,${T.acc}08)` : T.card,
      border:`1px solid ${gold?T.gold+"44":accent?T.acc+"33":T.borderS}`,
      borderRadius:14, padding:"18px 22px",
      boxShadow: accent ? `0 0 24px ${T.acc}0A` : "none",
      ...style
    }}>{children}</div>
  );
}

function Lbl({ children, color=T.muted, style={} }) {
  return <div style={{ fontFamily:T.mono, fontSize:9, letterSpacing:3, color, textTransform:"uppercase", ...style }}>{children}</div>;
}

function VoiceBtn({ toggle, listening, supported }) {
  if (!supported) return null;
  return (
    <button onClick={toggle} style={{ width:40, height:40, borderRadius:10, flexShrink:0,
      border:`1px solid ${listening?T.green:T.borderS}`,
      background:listening?T.green+"22":T.bg2,
      color:listening?T.green:T.muted, fontSize:17, cursor:"pointer", transition:"all .2s",
      display:"flex", alignItems:"center", justifyContent:"center",
      boxShadow:listening?`0 0 12px ${T.green}44`:"none"
    }}>🎙</button>
  );
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState({ name:"", age:"", weight:"", height:"", goal:"", activity:"", preferences:"", intolerances:"", apps:[] });
  const set = (k,v) => setP(prev=>({...prev,[k]:v}));
  const iStyle = { width:"100%", background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
    padding:"12px 16px", color:T.text, fontSize:14, fontFamily:T.serif, outline:"none",
    fontStyle:"italic", boxSizing:"border-box", transition:"border-color .2s" };

  const goals = ["Langfristig fit bleiben","Mehr Energie","Gesünder essen","Gewicht halten","Besser schlafen","Leistung steigern"];
  const apps  = ["Apple Health","Google Fit","Garmin","Polar","MyFitnessPal","Whoop","Oura Ring"];

  const steps = [
    { title:"Ich bin EYLA.", sub:"Dein zweites Gehirn. Körper und Kalender in einer Intelligenz.", content:(
      <div style={{ textAlign:"center" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:32 }}><EylaOrb size={90}/></div>
        <p style={{ color:T.mid, lineHeight:1.9, fontStyle:"italic", fontSize:15, fontFamily:T.serif }}>
          Ich kenne deinen Körper. Ich kenne deinen Kalender.<br/>
          Ich lüge nicht. Ich optimiere nicht um des Optimierens willen.<br/>
          Ich helfe dir, besser zu leben.
        </p>
      </div>
    )},
    { title:"Wer bist du?", sub:"Je mehr ich weiß, desto präziser bin ich.", content:(
      <div>
        <div style={{ marginBottom:14 }}>
          <Lbl style={{ marginBottom:8 }}>Dein Name</Lbl>
          <input value={p.name} onChange={e=>set("name",e.target.value)} placeholder="Wie soll ich dich nennen?" style={iStyle}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          {[["Alter","age","Jahre","number"],["Gewicht","weight","kg","number"],["Größe","height","cm","number"]].map(([l,k,ph,t])=>(
            <div key={k}>
              <Lbl style={{ marginBottom:8 }}>{l}</Lbl>
              <input value={p[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} type={t} style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
            </div>
          ))}
        </div>
      </div>
    )},
    { title:"Was willst du?", sub:"Kein Muss. Nur eine Richtung.", content:(
      <div>
        <Lbl style={{ marginBottom:12 }}>Mein Ziel</Lbl>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
          {goals.map(g=>(
            <button key={g} onClick={()=>set("goal",g)} style={{ background:p.goal===g?T.acc+"22":"transparent",
              border:`1px solid ${p.goal===g?T.acc:T.borderS}`, borderRadius:20, padding:"8px 16px",
              color:p.goal===g?T.text:T.muted, fontFamily:T.serif, fontSize:13, cursor:"pointer",
              fontStyle:"italic", transition:"all .2s" }}>{g}</button>
          ))}
        </div>
        <Lbl style={{ marginBottom:8 }}>Wie aktiv bist du?</Lbl>
        <input value={p.activity} onChange={e=>set("activity",e.target.value)}
          placeholder="z.B. 4x pro Woche Laufen, täglich Yoga …" style={iStyle}/>
      </div>
    )},
    { title:"Deine Küche.", sub:"Was liebst du? Was verträgst du nicht?", content:(
      <div>
        {[["Vorlieben","preferences","z.B. Mediterran, vegetarisch, Meal Prep …"],["Intoleranzen","intolerances","z.B. Laktose, Gluten, Nüsse …"]].map(([l,k,ph])=>(
          <div key={k} style={{ marginBottom:16 }}>
            <Lbl style={{ marginBottom:8 }}>{l}</Lbl>
            <input value={p[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} style={iStyle}/>
          </div>
        ))}
      </div>
    )},
    { title:"Deine Apps.", sub:"Optional – was nutzt du?", content:(
      <div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {apps.map(a=>{ const sel=p.apps.includes(a); return (
            <button key={a} onClick={()=>set("apps",sel?p.apps.filter(x=>x!==a):[...p.apps,a])} style={{
              background:sel?T.acc+"22":"transparent", border:`1px solid ${sel?T.acc:T.borderS}`,
              borderRadius:20, padding:"8px 16px", color:sel?T.text:T.muted,
              fontFamily:T.mono, fontSize:11, cursor:"pointer", letterSpacing:1, transition:"all .2s" }}>{a}</button>
          );})}
        </div>
        <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", marginTop:20, fontFamily:T.serif }}>
          Echte Sync kommt in der nächsten Version.
        </p>
      </div>
    )},
  ];

  function finish() {
    const cleaned = {...p,
      preferences:p.preferences.split(",").map(s=>s.trim()).filter(Boolean),
      intolerances:p.intolerances.split(",").map(s=>s.trim()).filter(Boolean)
    };
    onDone(cleaned);
  }

  const cur = steps[step];
  const canNext = step!==1 || p.name.trim().length > 0;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center",
      justifyContent:"center", padding:24, fontFamily:T.serif }}>
      <style>{`*{box-sizing:border-box} input:focus{border-color:${T.acc}88!important} input::placeholder{color:${T.muted};font-style:italic}`}</style>
      <div style={{ width:"100%", maxWidth:520 }}>
        {/* Progress */}
        <div style={{ display:"flex", gap:6, marginBottom:44 }}>
          {steps.map((_,i)=><div key={i} style={{ height:2, flex:1, borderRadius:2,
            background:i<=step?T.acc:T.faint, transition:"background .4s" }}/>)}
        </div>
        <div style={{ animation:"fadeUp .4s ease both" }}>
          <Lbl style={{ marginBottom:10 }}>Schritt {step+1} von {steps.length}</Lbl>
          <h2 style={{ fontSize:28, fontWeight:300, color:T.text, margin:"0 0 6px", letterSpacing:.5 }}>{cur.title}</h2>
          <p style={{ color:T.muted, fontStyle:"italic", margin:"0 0 32px", fontSize:13 }}>{cur.sub}</p>
          {cur.content}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:36 }}>
          {step>0
            ? <button onClick={()=>setStep(s=>s-1)} style={{ background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:12, padding:"12px 24px", color:T.muted, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontStyle:"italic" }}>← Zurück</button>
            : <div/>}
          {step===0
            ? <button onClick={()=>setStep(1)} style={{ background:`linear-gradient(135deg,${T.dim},${T.acc})`, border:"none", borderRadius:12, padding:"12px 28px", color:T.bg, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontWeight:700 }}>Los geht's →</button>
            : step===steps.length-1
            ? <button onClick={finish} disabled={!canNext} style={{ background:canNext?`linear-gradient(135deg,${T.dim},${T.acc})`:"transparent", border:canNext?"none":`1px solid ${T.borderS}`, borderRadius:12, padding:"12px 28px", color:canNext?T.bg:T.muted, fontFamily:T.serif, fontSize:14, cursor:canNext?"pointer":"default", fontWeight:700 }}>EYLA starten ✦</button>
            : <button onClick={()=>setStep(s=>s+1)} disabled={!canNext} style={{ background:canNext?`linear-gradient(135deg,${T.dim},${T.acc})`:"transparent", border:canNext?"none":`1px solid ${T.borderS}`, borderRadius:12, padding:"12px 28px", color:canNext?T.bg:T.muted, fontFamily:T.serif, fontSize:14, cursor:canNext?"pointer":"default", fontWeight:700 }}>Weiter →</button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
function TodayScreen({ profile, log, setLog }) {
  const [mealName, setMealName] = useState("");
  const [mealCal, setMealCal] = useState("");
  const eaten = log.meals.reduce((s,m)=>s+(m.calories||0),0);
  const tdee = Math.round(10*profile.weight + 6.25*profile.height - 5*profile.age + 5 + 400);

  const onMealVoice = useCallback((text) => {
    const calMatch = text.match(/(\d+)\s*(kal|kalorien|kcal)?/i);
    const cal = calMatch ? parseInt(calMatch[1]) : 0;
    const name = text.replace(/\d+\s*(kal|kalorien|kcal)?/gi,"").trim() || text;
    if (name) setLog(l=>({...l, meals:[...l.meals, {id:Date.now(),name,calories:cal,time:new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}]}));
  }, [setLog]);

  const { listening, supported, toggle } = useVoice(onMealVoice);

  function addMeal() {
    if (!mealName.trim()) return;
    setLog(l=>({...l, meals:[...l.meals, {id:Date.now(),name:mealName.trim(),calories:parseInt(mealCal)||0,time:new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}]}));
    setMealName(""); setMealCal("");
  }

  const energyOpts = ["💤 Erschöpft","😴 Müde","😐 Ok","😊 Gut","⚡ Energiegeladen"];

  return (
    <div>
      <div style={{ marginBottom:22 }}>
        <Lbl style={{ marginBottom:6 }}>HEUTE · {new Date().toLocaleDateString("de-DE",{weekday:"long",day:"numeric",month:"long"})}</Lbl>
        <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:0 }}>
          Wie geht's dir, <span style={{ color:T.acc }}>{profile.name.split(" ")[0]}</span>?
        </h2>
      </div>

      {/* Energie & Schlaf */}
      <Card style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:10 }}>Wie fühlst du dich?</Lbl>
        <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:16 }}>
          {energyOpts.map(e=>(
            <button key={e} onClick={()=>setLog(l=>({...l,energy:e}))} style={{
              background:log.energy===e?T.acc+"22":"transparent",
              border:`1px solid ${log.energy===e?T.acc:T.borderS}`,
              borderRadius:20, padding:"7px 14px", color:log.energy===e?T.text:T.muted,
              fontFamily:T.serif, fontSize:12, cursor:"pointer", transition:"all .2s"
            }}>{e}</button>
          ))}
        </div>
        <Lbl style={{ marginBottom:8 }}>Schlaf letzte Nacht</Lbl>
        <div style={{ display:"flex", gap:7 }}>
          {["4","5","6","7","8","9+"].map(s=>(
            <button key={s} onClick={()=>setLog(l=>({...l,sleep:s}))} style={{
              background:log.sleep===s?T.acc+"22":T.bg2,
              border:`1px solid ${log.sleep===s?T.acc:T.borderS}`,
              borderRadius:8, padding:"7px 14px", color:log.sleep===s?T.text:T.muted,
              fontFamily:T.mono, fontSize:12, cursor:"pointer", transition:"all .2s"
            }}>{s}h</button>
          ))}
        </div>
      </Card>

      {/* Wasser */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <Lbl style={{ marginBottom:5 }}>Wasser heute</Lbl>
            <div style={{ fontSize:24, fontWeight:300, color:T.text }}>{log.water}
              <span style={{ fontSize:12, color:T.muted, marginLeft:6 }}>{(log.water*.25).toFixed(1)}L</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button onClick={()=>setLog(l=>({...l,water:Math.max(0,l.water-1)}))} style={{ width:36,height:36,borderRadius:"50%",background:T.bg2,border:`1px solid ${T.borderS}`,color:T.muted,fontSize:18,cursor:"pointer" }}>−</button>
            <div style={{ display:"flex", gap:3 }}>
              {Array.from({length:8}).map((_,i)=>(
                <div key={i} style={{ width:11,height:24,borderRadius:3,
                  background:i<log.water?`linear-gradient(${T.dim},${T.acc})`:T.bg2,
                  border:`1px solid ${T.borderS}`,transition:"background .2s" }}/>
              ))}
            </div>
            <button onClick={()=>setLog(l=>({...l,water:Math.min(12,l.water+1)}))} style={{ width:36,height:36,borderRadius:"50%",background:T.acc+"22",border:`1px solid ${T.acc}`,color:T.acc,fontSize:18,cursor:"pointer" }}>+</button>
          </div>
        </div>
      </Card>

      {/* Mahlzeiten */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
          <div>
            <Lbl style={{ marginBottom:5 }}>Mahlzeiten heute</Lbl>
            <div style={{ fontSize:22, fontWeight:300, color:T.text }}>{eaten}
              <span style={{ fontSize:12, color:T.muted, marginLeft:6 }}>von ~{tdee} kcal</span>
            </div>
          </div>
          <div style={{ width:48,height:48,borderRadius:"50%",
            background:`conic-gradient(${T.acc} ${Math.min(100,Math.round(eaten/tdee*100))}%,${T.bg2} 0)`,
            display:"flex",alignItems:"center",justifyContent:"center" }}>
            <div style={{ width:36,height:36,borderRadius:"50%",background:T.card,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:10,color:T.muted,fontFamily:T.mono }}>
              {Math.min(100,Math.round(eaten/tdee*100))}%
            </div>
          </div>
        </div>

        {/* Input */}
        <div style={{ background:T.bg2, borderRadius:10, padding:12, marginBottom:12 }}>
          {listening && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10,
              padding:"6px 12px", background:T.green+"11", border:`1px solid ${T.green}33`, borderRadius:8 }}>
              <div style={{ width:6,height:6,borderRadius:"50%",background:T.green,animation:"blink 1s infinite" }}/>
              <span style={{ color:T.green, fontFamily:T.mono, fontSize:10, letterSpacing:1 }}>EYLA HÖRT ZU …</span>
            </div>
          )}
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <input value={mealName} onChange={e=>setMealName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMeal()}
              placeholder="Was hast du gegessen?" style={{ flex:1,background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 12px",color:T.text,fontFamily:T.serif,fontSize:13,fontStyle:"italic",outline:"none" }}/>
            <input value={mealCal} onChange={e=>setMealCal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMeal()}
              placeholder="kcal" type="number" style={{ width:70,background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:13,outline:"none" }}/>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <VoiceBtn toggle={toggle} listening={listening} supported={supported}/>
            {supported && <span style={{ color:T.muted,fontSize:11,fontStyle:"italic",fontFamily:T.serif,alignSelf:"center" }}>oder sprich: "Haferflocken 380 Kalorien"</span>}
            <button onClick={addMeal} style={{ marginLeft:"auto",background:`linear-gradient(135deg,${T.dim},${T.acc})`,border:"none",borderRadius:8,padding:"0 18px",color:T.bg,fontSize:18,cursor:"pointer",fontWeight:700 }}>+</button>
          </div>
        </div>

        {log.meals.length===0
          ? <p style={{ color:T.muted,fontStyle:"italic",fontSize:12,textAlign:"center",padding:"8px 0",margin:0 }}>Noch nichts – tippen oder sprechen.</p>
          : log.meals.map(m=>(
            <div key={m.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${T.border}` }}>
              <div style={{ color:T.text,fontSize:13 }}>{m.name}</div>
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                {m.calories>0&&<div style={{ color:T.acc,fontFamily:T.mono,fontSize:12 }}>{m.calories}</div>}
                <div style={{ color:T.muted,fontFamily:T.mono,fontSize:10 }}>{m.time}</div>
                <button onClick={()=>setLog(l=>({...l,meals:l.meals.filter(x=>x.id!==m.id)}))} style={{ background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:15,padding:2 }}>×</button>
              </div>
            </div>
          ))
        }
      </Card>
    </div>
  );
}

// ─── KALENDER SCREEN ──────────────────────────────────────────────────────────
function KalenderScreen({ events, eventsLoading, onRefresh, profile, log }) {
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newDur, setNewDur] = useState("");
  const [localEvents, setLocalEvents] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    retrieve("eyla_local_events_v2", []).then(e => setLocalEvents(e||[]));
  }, []);

  function saveLocal(evts) { setLocalEvents(evts); persist("eyla_local_events_v2", evts); }

  function addEvent() {
    if (!newTitle.trim()) return;
    saveLocal([...localEvents, { id:Date.now(), title:newTitle.trim(), time:newTime||"", duration:newDur||"", local:true }]);
    setNewTitle(""); setNewTime(""); setNewDur(""); setShowAdd(false);
  }

  const allEvents = [
    ...events.map(e=>({...e,local:false})),
    ...localEvents
  ].sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));

  const nowH = new Date().getHours();
  const nowM = new Date().getMinutes();
  const nowStr = `${String(nowH).padStart(2,"0")}:${String(nowM).padStart(2,"0")}`;

  // Hours to show: 6:00 – 22:00
  const hours = Array.from({length:17},(_,i)=>i+6);

  function eventAtHour(h) {
    return allEvents.filter(e=>{
      if (!e.time) return false;
      const eh = parseInt(e.time.split(":")[0]);
      return eh === h;
    });
  }

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <Lbl style={{ marginBottom:6 }}>KALENDER · {new Date().toLocaleDateString("de-DE",{weekday:"long",day:"numeric",month:"long"})}</Lbl>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:0 }}>
            Dein <span style={{ color:T.gold }}>heutiger Tag</span>
          </h2>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>setShowAdd(s=>!s)} style={{ background:showAdd?T.gold+"22":"transparent",
              border:`1px solid ${showAdd?T.gold:T.borderS}`, borderRadius:8, padding:"6px 14px",
              color:showAdd?T.gold:T.muted, fontFamily:T.mono, fontSize:10, cursor:"pointer", letterSpacing:1 }}>
              + TERMIN
            </button>
            <button onClick={onRefresh} style={{ background:T.acc+"18", border:`1px solid ${T.acc}44`,
              borderRadius:8, padding:"6px 14px", color:T.acc, fontFamily:T.mono, fontSize:10,
              cursor:"pointer", letterSpacing:1 }}>
              {eventsLoading?"…":"↻ SYNC"}
            </button>
          </div>
        </div>
      </div>

      {/* Termin hinzufügen */}
      {showAdd && (
        <Card gold style={{ marginBottom:14, animation:"fadeUp .3s ease both" }}>
          <Lbl color={T.gold} style={{ marginBottom:10 }}>Neuer Termin</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8, marginBottom:10 }}>
            <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEvent()}
              placeholder="Was?" autoFocus
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 12px",color:T.text,fontFamily:T.serif,fontSize:13,fontStyle:"italic",outline:"none" }}/>
            <input value={newTime} onChange={e=>setNewTime(e.target.value)} type="time"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
            <input value={newDur} onChange={e=>setNewDur(e.target.value)} placeholder="z.B. 1h"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={addEvent} disabled={!newTitle.trim()} style={{
              background:newTitle.trim()?`linear-gradient(135deg,#78350F,${T.goldL})`:"transparent",
              border:"none",borderRadius:8,padding:"9px 20px",color:newTitle.trim()?T.bg:T.muted,
              fontFamily:T.serif,fontSize:13,cursor:newTitle.trim()?"pointer":"default",fontWeight:700 }}>
              Speichern
            </button>
            <button onClick={()=>setShowAdd(false)} style={{ background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 16px",color:T.muted,fontFamily:T.serif,fontSize:13,cursor:"pointer" }}>
              Abbrechen
            </button>
          </div>
        </Card>
      )}

      {/* Zeitstrahl */}
      <Card style={{ padding:"16px 0", overflow:"hidden" }}>
        {eventsLoading && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <Lbl>LADE GOOGLE CALENDAR …</Lbl>
          </div>
        )}
        {hours.map(h=>{
          const hStr = `${String(h).padStart(2,"0")}:00`;
          const isNow = h === nowH;
          const evts = eventAtHour(h);
          const past = h < nowH;

          return (
            <div key={h} style={{ display:"flex", gap:0, position:"relative",
              opacity:past?0.45:1, minHeight:evts.length>0?undefined:36 }}>
              {/* Stunde */}
              <div style={{ width:52, flexShrink:0, paddingTop:2, paddingLeft:16,
                fontFamily:T.mono, fontSize:10, color:isNow?T.acc:T.muted, letterSpacing:1 }}>
                {hStr}
              </div>

              {/* Linie + Jetzt-Marker */}
              <div style={{ width:1, background:isNow?T.acc:T.border, flexShrink:0, position:"relative" }}>
                {isNow && (
                  <>
                    <div style={{ position:"absolute", left:-3, top:8, width:7, height:7,
                      borderRadius:"50%", background:T.acc, boxShadow:`0 0 8px ${T.acc}` }}/>
                    <div style={{ position:"absolute", left:0, top:11, right:-300, height:1,
                      background:`linear-gradient(90deg,${T.acc}88,transparent)` }}/>
                  </>
                )}
              </div>

              {/* Inhalt */}
              <div style={{ flex:1, paddingLeft:12, paddingBottom:evts.length>0?8:4, paddingTop:2, paddingRight:16 }}>
                {evts.map((e,i)=>(
                  <div key={e.id||i} style={{ background:e.local?T.gold+"18":T.acc+"12",
                    border:`1px solid ${e.local?T.gold+"44":T.acc+"33"}`,
                    borderRadius:8, padding:"8px 12px", marginBottom:4,
                    display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div>
                      <div style={{ color:T.text, fontSize:13, fontWeight:500 }}>{e.title}</div>
                      <div style={{ display:"flex", gap:10, marginTop:3 }}>
                        {e.time && <span style={{ color:e.local?T.gold:T.acc, fontFamily:T.mono, fontSize:10 }}>{e.time}</span>}
                        {e.duration && <span style={{ color:T.muted, fontFamily:T.mono, fontSize:10 }}>⏱ {e.duration}</span>}
                        {e.location && <span style={{ color:T.muted, fontSize:10 }}>📍 {e.location}</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      {e.local && <span style={{ fontFamily:T.mono,fontSize:8,color:T.gold,background:T.gold+"18",border:`1px solid ${T.gold}33`,borderRadius:3,padding:"1px 6px",letterSpacing:1 }}>LOKAL</span>}
                      {e.local && <button onClick={()=>saveLocal(localEvents.filter(x=>x.id!==e.id))} style={{ background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:14,padding:2 }}>×</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Card>

      {/* Keine Termine Info */}
      {!eventsLoading && allEvents.length === 0 && (
        <div style={{ textAlign:"center", padding:"20px 0", color:T.muted, fontStyle:"italic", fontSize:13, fontFamily:T.serif }}>
          Keine Termine heute. Verbinde Google Calendar über den SYNC-Button oder füge manuell hinzu.
        </div>
      )}
    </div>
  );
}

// ─── WOCHEN SCREEN ────────────────────────────────────────────────────────────
function WeekScreen({ logsByDate }) {
  const days = lastNDays(7);

  // Aggregate für Summary
  const stats = days.reduce((acc, key) => {
    const l = logsByDate?.[key];
    if (!l) return acc;
    const kcal = l.meals?.reduce((s,m)=>s+(m.calories||0),0) || 0;
    const hasAny = (l.meals?.length||0) > 0 || l.water > 0 || l.sleep || l.energy;
    if (!hasAny) return acc;
    acc.count++;
    acc.water += l.water || 0;
    acc.kcal += kcal;
    const sleepNum = parseFloat(String(l.sleep).replace("+","")) || 0;
    if (sleepNum > 0) { acc.sleep += sleepNum; acc.sleepN++; }
    return acc;
  }, { count:0, water:0, kcal:0, sleep:0, sleepN:0 });

  const avgWater = stats.count>0 ? (stats.water/stats.count).toFixed(1) : "0";
  const avgSleep = stats.sleepN>0 ? (stats.sleep/stats.sleepN).toFixed(1) : "–";
  const avgKcal  = stats.count>0 ? Math.round(stats.kcal/stats.count) : 0;

  function labelFor(dateKey, idx) {
    if (idx === 0) return "Heute";
    if (idx === 1) return "Gestern";
    const d = new Date(dateKey);
    return d.toLocaleDateString("de-DE",{weekday:"short",day:"numeric",month:"short"});
  }

  function moodEmoji(energy) {
    if (!energy) return "·";
    // Extrahiere erstes Emoji aus dem Energie-String
    const m = energy.match(/\p{Emoji}/u);
    return m ? m[0] : "·";
  }

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <Lbl style={{ marginBottom:6 }}>WOCHE · LETZTE 7 TAGE</Lbl>
        <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:0 }}>
          Dein <span style={{ color:T.acc }}>Verlauf.</span>
        </h2>
      </div>

      {/* Summary */}
      <Card accent style={{ marginBottom:14 }}>
        <Lbl style={{ marginBottom:12 }}>SCHNITTWERTE</Lbl>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
          <div>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>💧 Wasser</div>
            <div style={{ fontSize:22, fontWeight:300, color:T.text, fontFamily:T.mono }}>
              {avgWater}<span style={{ fontSize:11, color:T.muted, marginLeft:4 }}>/8</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>😴 Schlaf</div>
            <div style={{ fontSize:22, fontWeight:300, color:T.text, fontFamily:T.mono }}>
              {avgSleep}<span style={{ fontSize:11, color:T.muted, marginLeft:4 }}>h</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>🍽 kcal</div>
            <div style={{ fontSize:22, fontWeight:300, color:T.text, fontFamily:T.mono }}>
              {avgKcal}
            </div>
          </div>
        </div>
        {stats.count === 0 && (
          <p style={{ color:T.muted, fontStyle:"italic", fontSize:12, fontFamily:T.serif, margin:"12px 0 0" }}>
            Noch keine Daten – trag heute was ein, dann füllt sich der Verlauf.
          </p>
        )}
      </Card>

      {/* Tagesliste */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {days.map((dateKey, idx) => {
          const l = logsByDate?.[dateKey];
          const kcal = l?.meals?.reduce((s,m)=>s+(m.calories||0),0) || 0;
          const empty = !l || ((l.meals?.length||0)===0 && !l.water && !l.sleep && !l.energy);
          const isToday = idx === 0;
          return (
            <Card key={dateKey} style={{
              opacity: empty ? 0.55 : 1,
              borderColor: isToday ? T.acc+"55" : T.borderS,
              padding:"14px 18px"
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                <div style={{ minWidth:0, flex:"0 0 auto" }}>
                  <div style={{ fontSize:13, color:isToday?T.acc:T.text, fontWeight:500 }}>
                    {labelFor(dateKey, idx)}
                  </div>
                  {!isToday && idx !== 1 && (
                    <div style={{ fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginTop:2 }}>
                      {new Date(dateKey).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})}
                    </div>
                  )}
                </div>
                {empty ? (
                  <div style={{ color:T.muted, fontStyle:"italic", fontSize:12, fontFamily:T.serif }}>
                    Keine Einträge
                  </div>
                ) : (
                  <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.acc }}>
                      💧 {l.water||0}<span style={{ color:T.muted }}>/8</span>
                    </div>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.mid }}>
                      😴 {l.sleep||"–"}<span style={{ color:T.muted }}>h</span>
                    </div>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.gold }}>
                      🍽 {kcal}
                    </div>
                    <div style={{ fontSize:14 }}>{moodEmoji(l.energy)}</div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── EYLA CHAT ────────────────────────────────────────────────────────────────
function ChatScreen({ profile, log, events, logsByDate }) {
  const [messages, setMessages] = useState(()=>[{
    role:"assistant",
    content:`${profile.name.split(" ")[0]}. Ich weiß was heute ansteht${events.length>0?` – ${events.length} Termine`:""}. Was brauchst du?`
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const onVoice = useCallback((text)=>send(text),[]);
  const { listening, supported, toggle } = useVoice(onVoice);

  const SUGG = [
    "Was würde mir jetzt gut tun?",
    "Analysiere meinen Tag",
    "Was esse ich vor dem nächsten Termin?",
    "Genug Wasser heute?",
    "Abendessen-Idee?",
    "Bin ich auf Kurs?",
  ];

  async function send(text) {
    const t = text||input.trim();
    if (!t||loading) return;
    setInput("");
    const next = [...messages, {role:"user",content:t}];
    setMessages(next);
    setLoading(true);
    try {
      const weekHistory = weekHistoryFromLogs(logsByDate || {});
      const res = await fetch("/api/chat",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ model:"claude-sonnet-4-5", max_tokens:1000,
          system:buildPrompt(profile,log,events,weekHistory), messages:next })
      });
      const data = await res.json();
      const reply = data.content?.find(b=>b.type==="text")?.text||"…";
      setMessages([...next,{role:"assistant",content:reply}]);
    } catch { setMessages([...next,{role:"assistant",content:"Kurze Unterbrechung."}]); }
    setLoading(false);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 130px)" }}>
      {listening && (
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 16px",
          background:T.green+"11",border:`1px solid ${T.green}33`,borderRadius:10,marginBottom:12 }}>
          <div style={{ width:7,height:7,borderRadius:"50%",background:T.green,animation:"blink 1s infinite" }}/>
          <span style={{ color:T.green,fontFamily:T.mono,fontSize:10,letterSpacing:1 }}>EYLA HÖRT ZU – sprich jetzt</span>
        </div>
      )}

      <div style={{ flex:1, overflowY:"auto", paddingRight:4 }}>
        {messages.length<6&&(
          <div style={{ marginBottom:18 }}>
            <Lbl style={{ marginBottom:10 }}>SCHNELLZUGRIFF</Lbl>
            <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
              {SUGG.map((s,i)=>(
                <button key={i} onClick={()=>send(s)} style={{ background:"transparent",
                  border:`1px solid ${T.borderS}`, borderRadius:20, padding:"7px 14px",
                  color:T.muted, fontFamily:T.serif, fontSize:12, cursor:"pointer",
                  fontStyle:"italic", transition:"all .2s" }}
                onMouseEnter={e=>{e.target.style.borderColor=T.acc;e.target.style.color=T.text;}}
                onMouseLeave={e=>{e.target.style.borderColor=T.borderS;e.target.style.color=T.muted;}}
                >{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg,i)=>{
          const isE = msg.role==="assistant";
          return (
            <div key={i} style={{ display:"flex",gap:10,flexDirection:isE?"row":"row-reverse",marginBottom:16,animation:"fadeUp .3s ease both" }}>
              <div style={{ width:30,height:30,borderRadius:"50%",flexShrink:0,marginTop:4,
                background:isE?`radial-gradient(circle at 35% 35%,${T.goldL},${T.acc},${T.dim})`:"linear-gradient(135deg,#1e293b,#0f172a)",
                border:`1px solid ${isE?T.acc+"55":"#334155"}`,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:11 }}>
                {isE?"✦":"◉"}
              </div>
              <div style={{ maxWidth:"80%" }}>
                <Lbl style={{ marginBottom:5 }}>{isE?"EYLA":profile.name.split(" ")[0].toUpperCase()}</Lbl>
                <div style={{ background:isE?`linear-gradient(135deg,${T.bg2},${T.card})`:"linear-gradient(135deg,#0f172a,#1e293b)",
                  border:`1px solid ${isE?T.acc+"22":"#1e293b"}`,
                  borderRadius:isE?"3px 14px 14px 14px":"14px 3px 14px 14px",
                  padding:"11px 15px",color:isE?T.text:"#cbd5e1",fontSize:14,lineHeight:1.75 }}>
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {loading&&(
          <div style={{ display:"flex",gap:10,marginBottom:14 }}>
            <div style={{ width:30,height:30,borderRadius:"50%",flexShrink:0,marginTop:4,
              background:`radial-gradient(circle at 35% 35%,${T.goldL},${T.acc},${T.dim})`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:11 }}>✦</div>
            <div style={{ paddingTop:8 }}><Waveform/></div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{ paddingTop:12, borderTop:`1px solid ${T.border}` }}>
        <div style={{ display:"flex",gap:8,alignItems:"center",background:T.card,
          border:`1px solid ${T.borderS}`,borderRadius:12,padding:"5px 5px 5px 14px" }}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
            placeholder="Frag EYLA …" style={{ flex:1,background:"none",border:"none",outline:"none",
            color:T.text,fontSize:14,fontFamily:T.serif,padding:"9px 0",fontStyle:"italic" }}/>
          <VoiceBtn toggle={toggle} listening={listening} supported={supported}/>
          <button onClick={()=>send()} disabled={!input.trim()||loading} style={{
            width:38,height:38,borderRadius:9,border:"none",flexShrink:0,
            background:input.trim()&&!loading?`linear-gradient(135deg,${T.dim},${T.acc})`:T.bg2,
            color:input.trim()&&!loading?T.bg:T.muted,
            fontSize:15,cursor:input.trim()&&!loading?"pointer":"default",transition:"all .2s"
          }}>{loading?"✦":"↑"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── PLAN SCREEN ──────────────────────────────────────────────────────────────
function PlanScreen({ profile }) {
  const [days, setDays] = useState([]);
  const [intro, setIntro] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setDays([]);
    setIntro("");
    try {
      const msg = "Erstelle einen 7-Tage-Ernährungsplan für " + (profile.name||"Phil") + ", " +
        (profile.age||35) + " Jahre, " + (profile.weight||79) + "kg. " +
        "Aktivität: " + (profile.activity||"5x Woche Beweglichkeitstraining") + ". " +
        "Vorlieben: " + (profile.preferences?.join(", ")||"wenig Fleisch, proteinreich") + ". " +
        "Antworte in genau diesem Format:\n\n" +
        "INTRO: [ein Satz]\n\n" +
        "TAG: Montag\nFRUEHSTUECK: [Mahlzeit]\nMITTAG: [Mahlzeit]\nABEND: [Mahlzeit]\nSNACK: [Snack]\nTIPP: [Tipp]\n\n" +
        "TAG: Dienstag\nFRUEHSTUECK: [Mahlzeit]\nMITTAG: [Mahlzeit]\nABEND: [Mahlzeit]\nSNACK: [Snack]\nTIPP: [Tipp]\n\n" +
        "TAG: Mittwoch\nFRUEHSTUECK: [Mahlzeit]\nMITTAG: [Mahlzeit]\nABEND: [Mahlzeit]\nSNACK: [Snack]\nTIPP: [Tipp]\n\n" +
        "TAG: Donnerstag\nFRUEHSTUECK: [Mahlzeit]\nMITTAG: [Mahlzeit]\nABEND: [Mahlzeit]\nSNACK: [Snack]\nTIPP: [Tipp]\n\n" +
        "TAG: Freitag\nFRUEHSTUECK: [Mahlzeit]\nMITTAG: [Mahlzeit]\nABEND: [Mahlzeit]\nSNACK: [Snack]\nTIPP: [Tipp]\n\n" +
        "TAG: Samstag\nFRUEHSTUECK: [Mahlzeit]\nMITTAG: [Mahlzeit]\nABEND: [Mahlzeit]\nSNACK: [Snack]\nTIPP: [Tipp]\n\n" +
        "TAG: Sonntag\nFRUEHSTUECK: [Mahlzeit]\nMITTAG: [Mahlzeit]\nABEND: [Mahlzeit]\nSNACK: [Snack]\nTIPP: [Tipp]";

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 2000,
          messages: [{ role: "user", content: msg }]
        })
      });
      if (!res.ok) throw new Error("Status " + res.status);
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      if (!text) throw new Error("Leere Antwort");

      const introMatch = text.match(/INTRO:\s*(.+)/);
      if (introMatch) setIntro(introMatch[1].trim());

      const blocks = text.split(/TAG:\s*/g).slice(1);
      const parsed = blocks.map(block => {
        const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
        const day = lines[0]?.replace(/[*_#]/g, "").trim() || "";
        const get = (keys) => {
          for (const key of keys) {
            const line = lines.find(l => l.toUpperCase().replace(/Ü/g,"UE").replace(/Ä/g,"AE").replace(/Ö/g,"OE")
              .startsWith(key.toUpperCase().replace(/Ü/g,"UE").replace(/Ä/g,"AE").replace(/Ö/g,"OE") + ":"));
            if (line) return line.slice(line.indexOf(":") + 1).trim();
          }
          return "–";
        };
        return {
          day,
          breakfast: get(["FRÜHSTÜCK","FRUEHSTUECK","FRUEHS","BREAKFAST","MORGEN"]),
          lunch:     get(["MITTAG","LUNCH","MITTAGESSEN"]),
          dinner:    get(["ABEND","DINNER","ABENDESSEN"]),
          snack:     get(["SNACK","ZWISCHENMAHLZEIT","IMBISS"]),
          tip:       get(["TIPP","TIP","HINWEIS","EYLA"]),
        };
      }).filter(d => d.day && d.day.length > 1);

      if (parsed.length === 0) throw new Error("Konnte Plan nicht lesen");
      setDays(parsed);
    } catch(e) {
      setError("Fehler: " + e.message);
    }
    setLoading(false);
  }

  const icons = { breakfast:"☀️", lunch:"🌿", dinner:"🌙", snack:"✦" };
  const labels = { breakfast:"Frühstück", lunch:"Mittag", dinner:"Abend", snack:"Snack" };

  return (
    <div>
      <Lbl style={{ marginBottom:8 }}>ERNÄHRUNGSPLAN</Lbl>
      <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:"0 0 20px" }}>
        Eine Woche, <span style={{ color:T.gold }}>nur für dich.</span>
      </h2>
      {days.length === 0 && !loading && (
        <Card accent style={{ textAlign:"center", padding:40 }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}><EylaOrb size={60}/></div>
          <p style={{ color:T.mid, fontStyle:"italic", marginBottom:12, fontSize:14, fontFamily:T.serif }}>
            Ich erstelle dir einen Plan passend zu deinem Training und deinen Vorlieben.
          </p>
          {error && <p style={{ color:T.red, fontSize:12, fontFamily:T.mono, marginBottom:16, padding:"8px 12px", background:T.red+"11", borderRadius:8 }}>{error}</p>}
          <button onClick={generate} style={{ background:"linear-gradient(135deg," + T.dim + "," + T.acc + ")", border:"none", borderRadius:12, padding:"12px 28px", color:T.bg, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontWeight:700 }}>
            Plan erstellen ✦
          </button>
        </Card>
      )}
      {loading && (
        <Card style={{ textAlign:"center", padding:48 }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}><EylaOrb size={64} thinking/></div>
          <Lbl style={{ marginBottom:8 }}>EYLA ERSTELLT DEINEN PLAN …</Lbl>
          <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:0 }}>Dauert ca. 15 Sekunden.</p>
        </Card>
      )}
      {days.length > 0 && (
        <div>
          {intro && (
            <Card accent style={{ marginBottom:16 }}>
              <p style={{ color:T.mid, fontStyle:"italic", fontSize:14, margin:0, lineHeight:1.7, fontFamily:T.serif }}>✦ {intro}</p>
            </Card>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))", gap:12 }}>
            {days.map((day, i) => (
              <Card key={i}>
                <Lbl color={T.acc} style={{ marginBottom:12 }}>{day.day.toUpperCase()}</Lbl>
                {["breakfast","lunch","dinner","snack"].map(m => (
                  <div key={m} style={{ marginBottom:9 }}>
                    <div style={{ display:"flex", gap:6, alignItems:"baseline" }}>
                      <span style={{ fontSize:11 }}>{icons[m]}</span>
                      <Lbl style={{ fontSize:8 }}>{labels[m]}</Lbl>
                    </div>
                    <div style={{ color:T.mid, fontSize:12, paddingLeft:18, fontStyle:"italic", fontFamily:T.serif }}>{day[m]}</div>
                  </div>
                ))}
                {day.tip && day.tip !== "–" && (
                  <div style={{ marginTop:10, padding:"8px 12px", background:T.acc+"0A", borderRadius:8, borderLeft:"2px solid "+T.acc }}>
                    <Lbl color={T.acc} style={{ marginBottom:3 }}>EYLA</Lbl>
                    <div style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif }}>{day.tip}</div>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <div style={{ textAlign:"center", marginTop:16 }}>
            <button onClick={generate} style={{ background:"transparent", border:"1px solid "+T.borderS, borderRadius:10, padding:"9px 20px", color:T.muted, fontFamily:T.serif, fontSize:12, cursor:"pointer", fontStyle:"italic" }}>Neu generieren</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── PROFIL SCREEN ────────────────────────────────────────────────────────────
function ProfilScreen({ profile, onReset }) {
  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",gap:18,marginBottom:28 }}>
        <EylaOrb size={60}/>
        <div>
          <Lbl style={{ marginBottom:5 }}>DEIN PROFIL</Lbl>
          <h2 style={{ fontSize:22,fontWeight:300,color:T.text,margin:0 }}>{profile.name}</h2>
          <p style={{ color:T.muted,fontStyle:"italic",fontSize:12,margin:"4px 0 0",fontFamily:T.serif }}>{profile.goal||"Wohlbefinden"}</p>
        </div>
      </div>
      <Card style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:14 }}>KÖRPERDATEN</Lbl>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
          {[["Alter",`${profile.age}J`],["Gewicht",`${profile.weight}kg`],["Größe",`${profile.height}cm`],["Aktivität",profile.activity||"–"]].map(([k,v])=>(
            <div key={k}><Lbl style={{ marginBottom:3,fontSize:8 }}>{k}</Lbl><div style={{ color:T.text,fontSize:14 }}>{v}</div></div>
          ))}
        </div>
      </Card>
      {profile.preferences?.length>0&&<Card style={{ marginBottom:12 }}><Lbl style={{ marginBottom:10 }}>VORLIEBEN</Lbl><div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{profile.preferences.map((p,i)=><span key={i} style={{ background:T.acc+"18",border:`1px solid ${T.acc}33`,borderRadius:20,padding:"3px 12px",fontSize:11,color:T.acc,fontFamily:T.mono }}>{p}</span>)}</div></Card>}
      {profile.intolerances?.length>0&&<Card style={{ marginBottom:12 }}><Lbl style={{ marginBottom:10 }}>INTOLERANZEN</Lbl><div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{profile.intolerances.map((p,i)=><span key={i} style={{ background:T.gold+"18",border:`1px solid ${T.gold}33`,borderRadius:20,padding:"3px 12px",fontSize:11,color:T.gold,fontFamily:T.mono }}>{p}</span>)}</div></Card>}
      {profile.apps?.length>0&&<Card style={{ marginBottom:20 }}><Lbl style={{ marginBottom:10 }}>VERBUNDENE APPS</Lbl><div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{profile.apps.map((a,i)=><div key={i} style={{ display:"flex",alignItems:"center",gap:6,background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"5px 12px" }}><div style={{ width:5,height:5,borderRadius:"50%",background:T.green,boxShadow:`0 0 5px ${T.green}` }}/><span style={{ color:T.mid,fontFamily:T.mono,fontSize:10 }}>{a}</span></div>)}</div></Card>}
      <button onClick={onReset} style={{ background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:10,padding:"9px 18px",color:T.muted,fontFamily:T.serif,fontSize:12,cursor:"pointer",fontStyle:"italic" }}>Profil zurücksetzen</button>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null);
  const [logsByDate, setLogsByDate] = useState({});
  const [screen, setScreen] = useState("heute");
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // Abgeleiteter Log für heute
  const log = logsByDate[TODAY] || EMPTY_LOG();

  // Load everything on mount – migriert alle alten Keys automatisch
  useEffect(()=>{
    (async()=>{
      const profileKeys = ["eyla_profile_v3","eyla_profile_v2","lyra_profile_v2","lyra_profile"];

      let p = null;
      for (const k of profileKeys) { p = await retrieve(k); if (p) break; }

      // Profil: gespeichertes prüfen – wenn Name noch "Marcus" war, Default nehmen
      const finalProfile = (p && p.name !== "Marcus") ? p : DEFAULT_PROFILE;
      setProfile(finalProfile);
      persist("eyla_profile_v3", finalProfile);

      // Neue Date-Map laden
      let map = await retrieve("eyla_logs_v1", null) || {};

      // Migration: alter Single-Day-Log → Date-Map
      const legacyLog = await retrieve("eyla_log_v3", null);
      if (legacyLog && legacyLog.date) {
        // Nur einfügen wenn dieser Tag noch nicht in der neuen Map ist
        if (!map[legacyLog.date]) {
          map = { ...map, [legacyLog.date]: legacyLog };
        }
        await persist("eyla_logs_v1", map);
        await persist("eyla_log_v3", null);
      }

      setLogsByDate(map);
      setReady(true);
    })();
  },[]);

  // Fetch calendar when profile ready
  useEffect(()=>{
    if (!profile) return;
    loadCalendar();
  },[profile]);

  function loadCalendar() {
    setEventsLoading(true);
    fetchCalendarEvents().then(ev=>{ setEvents(ev||[]); setEventsLoading(false); });
  }

  function setLog(fn) {
    setLogsByDate(prevMap=>{
      const prevLog = prevMap[TODAY] || EMPTY_LOG();
      const next = typeof fn==="function" ? fn(prevLog) : fn;
      const withDate = {...next, date:TODAY};
      const nextMap = { ...prevMap, [TODAY]: withDate };
      persist("eyla_logs_v1", nextMap);
      return nextMap;
    });
  }

  function finishOnboarding(p) {
    persist("eyla_profile_v3", p);
    setProfile(p);
  }

  function reset() {
    persist("eyla_profile_v3", null);
    persist("eyla_log_v3", null);
    persist("eyla_logs_v1", null);
    persist("eyla_local_events_v2", null);
    setProfile(null);
    setLogsByDate({});
    setEvents([]);
  }

  if (!ready) return (
    <div style={{ minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <EylaOrb size={60} thinking/>
    </div>
  );

  if (!profile) return <Onboarding onDone={finishOnboarding}/>;

  const nav = [
    {id:"heute",    icon:"◎", label:"Heute"},
    {id:"woche",    icon:"≡", label:"Woche"},
    {id:"kalender", icon:"▦", label:"Kalender"},
    {id:"chat",     icon:"✦", label:"EYLA"},
    {id:"plan",     icon:"◈", label:"Plan"},
    {id:"profil",   icon:"◉", label:"Profil"},
  ];

  const sectionColor = screen==="heute" ? T.acc : screen==="woche" ? T.acc : screen==="kalender" ? T.gold : screen==="chat" ? T.acc : screen==="plan" ? T.gold : T.muted;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.serif, color:T.text }}>
      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:${T.acc}22;border-radius:2px}
        input::placeholder{color:${T.muted};font-style:italic}
        input:focus{border-color:${T.acc}88!important;outline:none}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>

      {/* BG glow */}
      <div style={{ position:"fixed",inset:0,pointerEvents:"none",
        background:"radial-gradient(ellipse at 50% 0%, #00E5FF05 0%, transparent 50%)" }}/>

      {/* Top bar */}
      <div style={{ position:"sticky",top:0,zIndex:40,background:T.bg+"F0",
        backdropFilter:"blur(20px)",borderBottom:`1px solid ${T.border}`,
        padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          <EylaOrb size={38} thinking={eventsLoading}/>
          <div>
            <Lbl style={{ marginBottom:2 }}>EYLA · ZWEITES GEHIRN</Lbl>
            <div style={{ fontSize:14,color:T.text }}>
              {profile.name.split(" ")[0]}<span style={{ color:T.acc }}>.</span>
            </div>
          </div>
        </div>
        <div style={{ display:"flex",gap:6,alignItems:"center" }}>
          {events.length>0&&<span style={{ background:T.gold+"18",border:`1px solid ${T.gold}33`,borderRadius:20,padding:"3px 10px",fontSize:10,color:T.gold,fontFamily:T.mono }}>▦ {events.length}</span>}
          {log.water>0&&<span style={{ background:T.acc+"18",border:`1px solid ${T.acc}33`,borderRadius:20,padding:"3px 10px",fontSize:10,color:T.acc,fontFamily:T.mono }}>💧 {log.water}</span>}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:760,margin:"0 auto",padding:"22px 18px 96px",position:"relative",zIndex:2 }}>
        {screen==="heute"    && <TodayScreen profile={profile} log={log} setLog={setLog}/>}
        {screen==="woche"    && <WeekScreen logsByDate={logsByDate}/>}
        {screen==="kalender" && <KalenderScreen events={events} eventsLoading={eventsLoading} onRefresh={loadCalendar} profile={profile} log={log}/>}
        {screen==="chat"     && <ChatScreen profile={profile} log={log} events={events} logsByDate={logsByDate}/>}
        {screen==="plan"     && <PlanScreen profile={profile}/>}
        {screen==="profil"   && <ProfilScreen profile={profile} onReset={reset}/>}
      </div>

      {/* Bottom nav */}
      <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:40,
        background:T.bg+"F0",backdropFilter:"blur(20px)",borderTop:`1px solid ${T.border}`,
        padding:"8px 0 14px" }}>
        <div style={{ display:"flex",justifyContent:"space-around",maxWidth:560,margin:"0 auto",padding:"0 4px" }}>
          {nav.map(n=>(
            <button key={n.id} onClick={()=>setScreen(n.id)} style={{
              background:"none",border:"none",cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              color:screen===n.id?sectionColor:T.muted,
              transition:"color .2s",padding:"4px 6px",flex:"1 1 0",minWidth:0
            }}>
              <span style={{ fontSize:17,
                filter:screen===n.id?`drop-shadow(0 0 6px ${sectionColor})`:"none",
                transition:"filter .2s" }}>{n.icon}</span>
              <span style={{ fontFamily:T.mono,fontSize:8,letterSpacing:1.5 }}>{n.label.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
