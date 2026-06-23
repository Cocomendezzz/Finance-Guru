import { useState, useEffect, useRef, useCallback } from 'react'
import { deriveKey, encryptVault, decryptVault, newSalt } from './crypto.js'

// ── Storage keys (vault is the only thing that holds financial data) ──────────
const K_SALT  = 'fg_salt'    // unencrypted salt (not secret)
const K_VAULT = 'fg_vault'   // AES-256-GCM ciphertext
const AUTO_LOCK_MS = 5 * 60 * 1000   // 5 min background → lock

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt  = n => '$' + Math.round(n).toLocaleString()
const fmtK = n => { const a=Math.abs(n); return (n<0?'−$':'$')+(a>=1000?(a/1000).toFixed(a>=10000?0:1)+'k':Math.round(a)) }
const fmtA = n => n>=1000?'$'+Math.round(n/1000)+'k':'$'+n
const uid  = () => Date.now() + Math.floor(Math.random() * 100000)

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:'#07080C', surface:'#0C0E14', lift:'#111420', border:'#181D2A', border2:'#1F2738',
  text:'#E4E8EF', muted:'#374353', faint:'#748090',
  accent:'#4A98DF', teal:'#40B5AA', red:'#B86262', green:'#48AF90',
}

// ── Month helpers ─────────────────────────────────────────────────────────────
const FULL=['January','February','March','April','May','June','July','August','September','October','November','December']
const ABBR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const todayKey  = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
const parts     = k => { const [y,m]=k.split('-').map(Number); return {y,m} }
const labelLong = k => { const {y,m}=parts(k); return `${FULL[m-1]} ${y}` }
const shift     = (k,d) => { const {y,m}=parts(k); const dt=new Date(y,m-1+d,1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}` }

// ── Default state ─────────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  name:'Coco', business:'', age:26, retireAge:65,
  expectedIncome:6500, efMonthly:3500, investMonthly:500, annualProfit:120000, salary:60000,
  pins:[
    {id:1,label:'Rent',amount:1900},{id:2,label:'Health insurance',amount:350},
    {id:3,label:'Internet',amount:70},{id:4,label:'Phone',amount:80},
    {id:5,label:'Subscriptions (Adobe, etc.)',amount:150},
  ],
}
const DEFAULT_VAULT = { months:{}, profile:DEFAULT_PROFILE, efSaved:0 }
const seedMonth  = p => ({ expenses:p.pins.map(x=>({id:uid(),label:x.label,amount:x.amount,pinId:x.id})), expectedIncome:p.expectedIncome, extra:[] })
const sumExp     = r => r.expenses.reduce((a,e)=>a+e.amount,0)
const monthIncome= r => r.expectedIncome + r.extra.reduce((a,e)=>a+e.amount,0)

// ── Shared primitives ─────────────────────────────────────────────────────────
const Card = ({children,style={}}) => <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'18px 20px',marginBottom:10,...style}}>{children}</div>
const Dim  = ({children,style={}}) => <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:'16px 20px',marginBottom:10,...style}}>{children}</div>
const Eye  = ({children,style={}}) => <p style={{fontSize:9,fontWeight:700,letterSpacing:'0.14em',textTransform:'uppercase',color:C.muted,margin:'22px 0 8px',...style}}>{children}</p>
const H1   = ({children}) => <h1 style={{fontFamily:'Georgia,serif',fontSize:22,fontWeight:400,lineHeight:1.25,color:C.text,margin:'2px 0 12px'}}>{children}</h1>

const PinIcon = ({on}) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill={on?C.accent:'none'} stroke={on?C.accent:C.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'block',flexShrink:0}}>
    <path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l2 3.2H7z"/>
  </svg>
)
function CommitNum({value, onCommit, width=64, style={}}) {
  const [local, setLocal] = useState(value===0?'':String(value))
  const committed = useRef(value)
  useEffect(() => { if(value!==committed.current){setLocal(value===0?'':String(value));committed.current=value} },[value])
  return (
    <div style={{display:'flex',alignItems:'center',gap:3}}>
      <span style={{fontSize:11,color:C.muted}}>$</span>
      <input type="number" value={local} onChange={e=>setLocal(e.target.value)}
        onBlur={()=>{const n=+local||0;committed.current=n;onCommit(n)}}
        style={{width,textAlign:'right',background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:'6px 8px',borderRadius:6,fontSize:13,fontFamily:'ui-monospace,monospace',...style}}/>
    </div>
  )
}
function TextField({value, onChange, placeholder, style={}}) {
  return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
    style={{background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:'9px 11px',borderRadius:7,fontSize:14,width:'100%',...style}}/>
}
function Slider({label, value, min, max, step, onChange, display, color=C.accent}) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:7}}>
        <span style={{fontSize:13,color:C.faint}}>{label}</span>
        <span style={{fontFamily:'ui-monospace,monospace',fontSize:13,color,fontWeight:600}}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)} style={{width:'100%',accentColor:color}}/>
    </div>
  )
}
function MonthNav({month, setMonth}) {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
      <button onClick={()=>setMonth(shift(month,-1))} style={{background:'none',border:'none',color:C.faint,fontSize:20,cursor:'pointer',minWidth:40,minHeight:40,display:'flex',alignItems:'center',justifyContent:'flex-start'}}>‹</button>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.14em',textTransform:'uppercase',color:C.muted,marginBottom:3}}>{parts(month).y}</div>
        <div style={{fontFamily:'Georgia,serif',fontSize:20,color:C.text}}>{FULL[parts(month).m-1]}</div>
      </div>
      <button onClick={()=>setMonth(shift(month,1))} style={{background:'none',border:'none',color:C.faint,fontSize:20,cursor:'pointer',minWidth:40,minHeight:40,display:'flex',alignItems:'center',justifyContent:'flex-end'}}>›</button>
    </div>
  )
}

// ── PIN Numpad ────────────────────────────────────────────────────────────────
function PinDots({length, filled}) {
  return (
    <div style={{display:'flex',justifyContent:'center',gap:14,margin:'28px 0 36px'}}>
      {Array.from({length}).map((_,i) => (
        <div key={i} style={{width:13,height:13,borderRadius:'50%',background:i<filled?C.accent:'none',border:`1.5px solid ${i<filled?C.accent:C.muted}`,transition:'all 0.12s'}}/>
      ))}
    </div>
  )
}
function Numpad({onDigit, onDelete}) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫']
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,maxWidth:256,margin:'0 auto'}}>
      {keys.map((k,i) => k==='' ? <div key={i}/> : (
        <button key={i} onClick={()=>k==='⌫'?onDelete():onDigit(k)}
          style={{background:k==='⌫'?'transparent':C.surface,border:`1px solid ${k==='⌫'?'transparent':C.border}`,borderRadius:14,minHeight:64,fontSize:k==='⌫'?20:22,color:C.text,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s'}}
        >{k}</button>
      ))}
    </div>
  )
}

// ── Lock Screen ───────────────────────────────────────────────────────────────
function LockScreen({onUnlock, isSetup}) {
  const [step,    setStep]    = useState('enter')   // enter | confirm
  const [pin,     setPin]     = useState('')
  const [draft,   setDraft]   = useState('')        // first entry during setup
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const PIN_LEN = 4

  const addDigit = d => {
    setError('')
    const next = pin + d
    if (next.length > PIN_LEN) return
    setPin(next)
    if (next.length === PIN_LEN) handleComplete(next)
  }

  const delDigit = () => { setPin(p => p.slice(0,-1)); setError('') }

  const handleComplete = async entered => {
    if (isSetup) {
      if (step === 'enter') {
        setDraft(entered)
        setStep('confirm')
        setPin('')
      } else {
        if (entered !== draft) { setError('Passcodes don\'t match. Try again.'); setPin(''); setStep('enter'); setDraft('') }
        else { setLoading(true); await onUnlock(entered) }
      }
    } else {
      setLoading(true)
      const ok = await onUnlock(entered)
      if (!ok) { setError('Incorrect passcode.'); setPin(''); setLoading(false) }
    }
  }

  const label = isSetup
    ? step==='enter' ? 'Create a 6-digit passcode.' : 'Confirm your passcode.'
    : 'Enter your passcode.'

  return (
    <div style={{background:C.bg,minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 32px',paddingTop:'calc(40px + env(safe-area-inset-top))'}}>
      <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.16em',textTransform:'uppercase',color:C.muted,marginBottom:32}}>Financial guide</div>
      <div style={{fontFamily:'Georgia,serif',fontSize:18,color:C.text,marginBottom:4,textAlign:'center'}}>{label}</div>
      {error && <div style={{fontSize:12,color:C.red,marginTop:6,textAlign:'center'}}>{error}</div>}
      <PinDots length={PIN_LEN} filled={pin.length}/>
      {loading
        ? <div style={{color:C.muted,fontSize:13}}>Unlocking…</div>
        : <Numpad onDigit={addDigit} onDelete={delDigit}/>
      }
      {!isSetup && (
        <button onClick={()=>{ if(confirm('This will erase all data. Continue?')){ localStorage.clear(); window.location.reload() }}}
          style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer',marginTop:36,fontFamily:'inherit'}}>
          Forgot passcode — reset app
        </button>
      )}
    </div>
  )
}

// ── Change PIN (in Profile) ───────────────────────────────────────────────────
function ChangePinFlow({cryptoKey, onDone}) {
  const [step,  setStep]  = useState('current')  // current | new | confirm
  const [pin,   setPin]   = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [ok,    setOk]    = useState(false)
  const PIN_LEN = 4

  const addDigit = async d => {
    setError('')
    const next = pin + d
    if (next.length > PIN_LEN) return
    setPin(next)
    if (next.length < PIN_LEN) return
    if (step === 'current') {
      // Verify current PIN by trying to re-derive and compare
      try {
        const salt = localStorage.getItem(K_SALT)
        const vault = localStorage.getItem(K_VAULT)
        const testKey = await deriveKey(next, salt)
        await decryptVault(testKey, vault)
        setStep('new'); setPin('')
      } catch { setError('Incorrect current passcode.'); setPin('') }
    } else if (step === 'new') {
      setDraft(next); setStep('confirm'); setPin('')
    } else {
      if (next !== draft) { setError('Passcodes don\'t match.'); setPin(''); setStep('new'); setDraft('') }
      else {
        // Re-encrypt vault with new key
        const salt = newSalt()
        const vault = localStorage.getItem(K_VAULT)
        const data = await decryptVault(cryptoKey, vault)
        const newKey = await deriveKey(next, salt)
        const newVault = await encryptVault(newKey, data)
        localStorage.setItem(K_SALT, salt)
        localStorage.setItem(K_VAULT, newVault)
        setOk(true)
        setTimeout(onDone, 1200)
      }
    }
  }
  const delDigit = () => { setPin(p=>p.slice(0,-1)); setError('') }

  const labels = { current:'Enter current passcode.', new:'Enter new passcode.', confirm:'Confirm new passcode.' }

  if (ok) return <div style={{padding:'20px 0',textAlign:'center',color:C.green,fontSize:14}}>Passcode updated.</div>

  return (
    <div>
      <div style={{fontFamily:'Georgia,serif',fontSize:16,color:C.text,marginBottom:4,textAlign:'center'}}>{labels[step]}</div>
      {error && <div style={{fontSize:12,color:C.red,marginTop:6,marginBottom:-10,textAlign:'center'}}>{error}</div>}
      <PinDots length={PIN_LEN} filled={pin.length}/>
      <Numpad onDigit={addDigit} onDelete={delDigit}/>
      <button onClick={onDone} style={{display:'block',margin:'20px auto 0',background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
    </div>
  )
}

// ── Performance chart ─────────────────────────────────────────────────────────
function PerformanceChart({months}) {
  const [filter, setFilter] = useState('year')
  const [tooltip,setTooltip]= useState(null)
  const svgRef = useRef()
  const cy = new Date().getFullYear()

  const keys = (() => {
    if(filter==='year')   return Array.from({length:12},(_,i)=>`${cy}-${String(i+1).padStart(2,'0')}`)
    if(filter==='prev')   return Array.from({length:12},(_,i)=>`${cy-1}-${String(i+1).padStart(2,'0')}`)
    const out=[]; for(let i=11;i>=0;i--){const d=new Date(cy,new Date().getMonth()-i,1);out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)}; return out
  })()

  const data = keys.map(k=>{const r=months[k];if(!r)return{key:k,label:ABBR[parts(k).m-1],income:0,expenses:0,gross:0,hasData:false};const income=monthIncome(r),expenses=sumExp(r);return{key:k,label:ABBR[parts(k).m-1],income,expenses,gross:income-expenses,hasData:true}})
  const wd=data.filter(d=>d.hasData), hasAny=wd.length>0
  const avgI=hasAny?Math.round(wd.reduce((a,d)=>a+d.income,0)/wd.length):0
  const avgE=hasAny?Math.round(wd.reduce((a,d)=>a+d.expenses,0)/wd.length):0
  const avgG=hasAny?Math.round(wd.reduce((a,d)=>a+d.gross,0)/wd.length):0
  const best=hasAny?wd.reduce((a,d)=>d.gross>a.gross?d:a):null
  const worst=hasAny?wd.reduce((a,d)=>d.gross<a.gross?d:a):null
  const W=560,H=160,PL=44,PR=10,PT=12,PB=24,cW=W-PL-PR,cH=H-PT-PB
  const maxVal=Math.max(...data.map(d=>Math.max(d.income,d.expenses,1)),1)
  const sy=v=>PT+cH-(Math.max(v,0)/maxVal*cH),cx=i=>PL+cW/12*(i+.5),bW=Math.min(cW/12*.27,9)

  return (
    <div>
      <div style={{display:'flex',gap:6,marginBottom:14}}>
        {[['year','This year'],['prev','Last year'],['last12','12 months']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{background:filter===k?C.accent:'none',border:`1px solid ${filter===k?C.accent:C.border}`,color:filter===k?'#04080C':C.faint,borderRadius:20,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
            {l}
          </button>
        ))}
      </div>
      {!hasAny ? (
        <Dim><p style={{fontSize:13,color:C.muted,textAlign:'center',padding:'18px 0',lineHeight:1.7}}>Monthly performance data will appear here once transactions have been recorded.</p></Dim>
      ) : (
        <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
            {[['Avg Income',avgI,C.accent],['Avg Expenses',avgE,C.red],['Avg Gross',avgG,avgG>=0?C.green:C.red]].map(([l,v,col])=>(
              <Dim key={l} style={{padding:'12px 14px',marginBottom:0}}>
                <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:C.muted,marginBottom:4}}>{l}</div>
                <div style={{fontFamily:'ui-monospace,monospace',fontSize:12,color:col,fontWeight:600}}>{fmtK(v)}</div>
              </Dim>
            ))}
          </div>
          {best && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
              {[[best,'Best',C.green],[worst,'Worst',C.red]].map(([m,l,col])=>(
                <Dim key={l} style={{padding:'11px 14px',marginBottom:0}}>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:C.muted,marginBottom:3}}>{l} month</div>
                  <div style={{fontSize:13,color:col,fontWeight:500}}>{FULL[parts(m.key).m-1]}</div>
                  <div style={{fontFamily:'ui-monospace,monospace',fontSize:11,color:C.faint,marginTop:1}}>{fmtK(m.gross)}</div>
                </Dim>
              ))}
            </div>
          )}
          <div style={{overflowX:'auto',position:'relative',marginLeft:-4}}>
            <svg ref={svgRef} width={W} height={H} style={{display:'block',overflow:'visible'}} onMouseLeave={()=>setTooltip(null)}>
              {[0,.25,.5,.75,1].map(t=>(
                <g key={t}>
                  <line x1={PL} y1={PT+cH*(1-t)} x2={PL+cW} y2={PT+cH*(1-t)} stroke={C.border} strokeWidth={t===0?1:.5}/>
                  <text x={PL-5} y={PT+cH*(1-t)+4} textAnchor="end" fill={C.muted} fontSize={8}>{t===0?'$0':fmtA(Math.round(maxVal*t))}</text>
                </g>
              ))}
              {data.map((d,i)=>(
                <g key={d.key} onMouseEnter={e=>{const r=svgRef.current?.getBoundingClientRect();setTooltip({i,d,x:e.clientX-(r?.left||0),y:e.clientY-(r?.top||0)})}} onMouseLeave={()=>setTooltip(null)}>
                  <rect x={cx(i)-cW/12*.45} y={PT} width={cW/12*.9} height={cH} fill="transparent"/>
                  {d.hasData&&<rect x={cx(i)-bW-1.5} y={sy(d.income)} width={bW} height={Math.max(cH-(sy(d.income)-PT),0)} fill={C.accent} opacity={.75} rx={1}/>}
                  {d.hasData&&<rect x={cx(i)+1.5} y={sy(d.expenses)} width={bW} height={Math.max(cH-(sy(d.expenses)-PT),0)} fill={C.red} opacity={.7} rx={1}/>}
                  <text x={cx(i)} y={H-6} textAnchor="middle" fill={d.hasData?C.faint:C.muted} fontSize={9}>{d.label}</text>
                </g>
              ))}
              {wd.length>=2&&<>
                <polyline points={data.map((d,i)=>d.hasData?`${cx(i).toFixed(1)},${sy(d.gross).toFixed(1)}`:null).filter(Boolean).join(' ')} fill="none" stroke={C.green} strokeWidth={1.5} strokeLinejoin="round"/>
                {data.map((d,i)=>d.hasData&&<circle key={i} cx={cx(i)} cy={sy(d.gross)} r={2.5} fill={C.green} stroke={C.bg} strokeWidth={1}/>)}
              </>}
            </svg>
            {tooltip&&(
              <div style={{position:'absolute',left:Math.min(tooltip.x+10,W-160),top:Math.max(tooltip.y-90,4),background:C.lift,border:`1px solid ${C.border2}`,borderRadius:8,padding:'10px 13px',pointerEvents:'none',minWidth:150,zIndex:10}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:C.faint,marginBottom:7}}>{FULL[parts(tooltip.d.key).m-1]}</div>
                {[['Income',tooltip.d.income,C.accent],['Expenses',tooltip.d.expenses,C.red],['Gross',tooltip.d.gross,tooltip.d.gross>=0?C.green:C.red]].map(([l,v,col])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',gap:14,marginBottom:3}}>
                    <span style={{fontSize:11,color:C.muted}}>{l}</span>
                    <span style={{fontFamily:'ui-monospace,monospace',fontSize:11,color:col,fontWeight:600}}>{fmt(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:'flex',gap:16,paddingLeft:PL,marginTop:10}}>
              {[['Income',C.accent,true],['Expenses',C.red,true],['Gross',C.green,false]].map(([l,col,bar])=>(
                <div key={l} style={{display:'flex',alignItems:'center',gap:5}}>
                  {bar?<div style={{width:8,height:8,borderRadius:1,background:col,opacity:.8}}/>:<div style={{width:12,height:2,background:col,borderRadius:1}}/>}
                  <span style={{fontSize:10,color:C.faint}}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── S-corp tax calc ───────────────────────────────────────────────────────────
function calcScorp(profit,salary){
  salary=Math.min(salary,profit);const ef=salary*.0765,tf=salary*.153
  const dist=Math.max(0,profit-salary-ef),gp=salary+dist
  const ft=Math.max(0,gp-dist*.20-14600);let fed=0
  if(ft<=11600)fed=ft*.10;else if(ft<=47150)fed=1160+(ft-11600)*.12
  else if(ft<=100525)fed=5426+(ft-47150)*.22;else if(ft<=191950)fed=17168+(ft-100525)*.24
  else fed=39110+(ft-191950)*.32
  const ny=Math.max(0,gp-8000)*.0585,nyc=gp*.03876,bct=profit*.0885,pit=fed+ny+nyc
  return{salary,tf,dist,fed,ny,nyc,bct,pit,pct:gp>0?Math.round(pit/gp*100):0,q:pit/4}
}

// ── Financial sections ────────────────────────────────────────────────────────
function Overview({profile,months,month,setMonth,updateMonth}) {
  const r=months[month]||seedMonth(profile)
  const budget=sumExp(r),income=monthIncome(r),surplus=income-budget
  const {y}=parts(month)
  const [xl,setXl]=useState(''),  [xa,setXa]=useState('')
  const addExtra=()=>{const a=+xa||0;if(!a)return;updateMonth(month,{...r,extra:[...r.extra,{id:uid(),label:xl||'Extra income',amount:a}]});setXl('');setXa('')}
  const rmExtra=id=>updateMonth(month,{...r,extra:r.extra.filter(e=>e.id!==id)})
  const sa=surplus>0?Math.round(surplus*.28):0,em=surplus>0?Math.round(surplus*.10):0,iv=surplus>0?Math.round(surplus*.07):0

  return (
    <div style={{padding:'20px 20px 0'}}>
      <MonthNav month={month} setMonth={setMonth}/>
      <div style={{textAlign:'center',padding:'10px 0 22px'}}>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.14em',textTransform:'uppercase',color:surplus>=0?C.green:C.red,marginBottom:8}}>{surplus>=0?'Monthly surplus':'Monthly deficit'}</div>
        <div style={{fontFamily:'Georgia,serif',fontSize:52,color:surplus>=0?C.green:C.red,lineHeight:1,letterSpacing:'-.02em'}}>{surplus>=0?'':'−'}{fmt(Math.abs(surplus))}</div>
        <div style={{display:'flex',justifyContent:'center',gap:28,marginTop:14}}>
          <div style={{textAlign:'center'}}><div style={{fontFamily:'ui-monospace,monospace',fontSize:14,color:C.accent,fontWeight:600}}>{fmt(income)}</div><div style={{fontSize:9,fontWeight:600,letterSpacing:'.1em',textTransform:'uppercase',color:C.muted,marginTop:2}}>Income</div></div>
          <div style={{width:1,background:C.border,alignSelf:'stretch'}}/>
          <div style={{textAlign:'center'}}><div style={{fontFamily:'ui-monospace,monospace',fontSize:14,color:C.faint,fontWeight:600}}>{fmt(budget)}</div><div style={{fontSize:9,fontWeight:600,letterSpacing:'.1em',textTransform:'uppercase',color:C.muted,marginTop:2}}>Budgeted</div></div>
        </div>
      </div>
      <Eye>Income this month</Eye>
      <Card>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingBottom:12}}>
          <div><div style={{fontSize:14,color:C.text}}>Expected</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>Salary + distributions</div></div>
          <CommitNum value={r.expectedIncome} onCommit={v=>updateMonth(month,{...r,expectedIncome:v})} width={80}/>
        </div>
        {r.extra.map(e=>(
          <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderTop:`1px solid ${C.border}`}}>
            <span style={{fontSize:13,color:C.faint,flex:1,marginRight:8}}>{e.label}</span>
            <span style={{fontFamily:'ui-monospace,monospace',fontSize:13,color:C.green,marginRight:12}}>+{fmt(e.amount)}</span>
            <button onClick={()=>rmExtra(e.id)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:0,minWidth:24,minHeight:24,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
          </div>
        ))}
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,marginTop:r.extra.length?0:4}}>
          <TextField value={xl} onChange={setXl} placeholder="Extra income label" style={{marginBottom:8}}/>
          <div style={{display:'flex',gap:8}}>
            <CommitNum value={+xa||0} onCommit={v=>setXa(String(v))} width="100%"/>
            <button onClick={addExtra} style={{background:C.accent,border:'none',color:'#040810',fontWeight:600,padding:'0 20px',borderRadius:7,fontSize:13,cursor:'pointer',minHeight:36,flexShrink:0,fontFamily:'inherit'}}>Add</button>
          </div>
        </div>
      </Card>
      {surplus>0&&<><Eye>Surplus allocation</Eye>
        <Card>{[['Tax set-aside',sa,'28%',C.red],['Emergency fund',em,'10%',C.green],['Investments',iv,'7%',C.teal],['Free / reinvest',surplus-sa-em-iv,'',C.faint]].map(([l,v,p,col],i,a)=>(
          <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:i<a.length-1?`1px solid ${C.border}`:'none'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:13,color:C.faint}}>{l}</span>{p&&<span style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:'.06em'}}>{p}</span>}</div>
            <span style={{fontFamily:'ui-monospace,monospace',fontSize:13,color:col,fontWeight:600}}>{fmt(v)}</span>
          </div>
        ))}</Card>
      </>}
      <Eye>Financial performance</Eye>
      <Card style={{padding:'16px'}}><PerformanceChart months={months}/></Card>
      <Eye>{y} calendar</Eye>
      <Card><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
        {ABBR.map((mn,i)=>{const k=`${y}-${String(i+1).padStart(2,'0')}`,rr=months[k],act=k===month,net=rr?monthIncome(rr)-sumExp(rr):null
          return <button key={k} onClick={()=>setMonth(k)} style={{background:act?C.accent:(rr?C.lift:'transparent'),border:`1px solid ${act?C.accent:C.border}`,borderRadius:8,padding:'10px 2px',cursor:'pointer',textAlign:'center'}}>
            <div style={{fontSize:11,color:act?'#040810':C.text,fontWeight:500}}>{mn}</div>
            <div style={{fontSize:9,fontFamily:'ui-monospace,monospace',marginTop:2,color:act?'#040810':(net===null?C.muted:(net>=0?C.green:C.red))}}>{rr?(net>=0?'+':'−')+fmtK(Math.abs(net)).replace('$',''):'·'}</div>
          </button>
        })}
      </div></Card>
      <div style={{height:28}}/>
    </div>
  )
}

function Budget({profile,months,month,setMonth,updateMonth,copyPrev,pinLine,unpinLine}) {
  const r=months[month]||seedMonth(profile),total=sumExp(r)
  const isNew=!months[month],hasPrev=!!months[shift(month,-1)]
  const setRow=(id,patch)=>updateMonth(month,{...r,expenses:r.expenses.map(e=>e.id===id?{...e,...patch}:e)})
  const del=id=>updateMonth(month,{...r,expenses:r.expenses.filter(e=>e.id!==id)})
  const add=()=>updateMonth(month,{...r,expenses:[...r.expenses,{id:uid(),label:'',amount:0,pinId:null}]})
  return (
    <div style={{padding:'20px 20px 0'}}>
      <MonthNav month={month} setMonth={setMonth}/>
      <H1>Monthly budget.</H1>
      {isNew&&hasPrev&&<button onClick={()=>copyPrev(month)} style={{width:'100%',background:'none',border:`1px solid ${C.accent}`,color:C.accent,borderRadius:8,padding:'11px',fontSize:13,cursor:'pointer',marginBottom:12,opacity:.7,fontFamily:'inherit'}}>Copy last month's budget</button>}
      <Card>
        {r.expenses.map((e,i)=>(
          <div key={e.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:i<r.expenses.length-1?`1px solid ${C.border}`:'none'}}>
            <button onClick={()=>e.pinId?unpinLine(month,e.id):pinLine(month,e.id)} style={{background:'none',border:'none',cursor:'pointer',padding:2,display:'flex',flexShrink:0,minWidth:24,minHeight:24,alignItems:'center',justifyContent:'center'}}><PinIcon on={!!e.pinId}/></button>
            <input value={e.label} onChange={ev=>setRow(e.id,{label:ev.target.value})} placeholder="Expense name" style={{flex:1,background:'transparent',border:'none',color:e.pinId?C.text:C.faint,fontSize:13,minWidth:0,padding:'2px 0'}}/>
            <CommitNum value={e.amount} onCommit={v=>setRow(e.id,{amount:v})} width={62}/>
            <button onClick={()=>del(e.id)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:0,minWidth:24,minHeight:24,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>×</button>
          </div>
        ))}
        <button onClick={add} style={{width:'100%',background:'none',border:`1px dashed ${C.border}`,color:C.accent,borderRadius:7,padding:'9px',fontSize:13,cursor:'pointer',marginTop:10,fontFamily:'inherit'}}>+ Add line</button>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0 0',borderTop:`1px solid ${C.border}`,marginTop:10}}>
          <span style={{fontSize:9,fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:C.muted}}>Total</span>
          <span style={{fontFamily:'ui-monospace,monospace',fontSize:15,fontWeight:600,color:C.text}}>{fmt(total)}</span>
        </div>
      </Card>
      <p style={{fontSize:11,color:C.muted,margin:'0 0 12px',display:'flex',alignItems:'center',gap:5}}><PinIcon on/> Pinned expenses carry into future months.</p>
      <Dim><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div><div style={{fontSize:13,color:C.accent,fontWeight:600}}>Min gross income needed</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Budget ÷ 0.72</div></div>
        <span style={{fontFamily:'ui-monospace,monospace',fontSize:19,fontWeight:600,color:C.accent,marginLeft:12}}>{fmt(Math.round(total/0.72))}</span>
      </div></Dim>
      <div style={{height:28}}/>
    </div>
  )
}

function Fund({profile,setProfile,efSaved,setEfSaved}) {
  const monthly=profile.efMonthly,target=monthly*9,capped=Math.min(efSaved,target)
  const pct=target>0?Math.min(100,Math.round(capped/target*100)):0
  return (
    <div style={{padding:'20px 20px 0'}}>
      <Eye style={{marginTop:4}}>Emergency fund</Eye><H1>9 months.<br/>Not 3. Not 6.</H1>
      <Card>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingBottom:12}}>
          <span style={{fontSize:13,color:C.faint}}>Monthly expenses</span>
          <CommitNum value={monthly} onCommit={v=>{setProfile({...profile,efMonthly:v});setEfSaved(s=>Math.min(s,v*9))}} width={84}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0',borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,marginBottom:16}}>
          <span style={{fontSize:13,color:C.text}}>9-month target</span>
          <span style={{fontFamily:'ui-monospace,monospace',fontSize:16,fontWeight:600,color:C.text}}>{fmt(target)}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:7}}>
          <span style={{fontSize:13,color:C.faint}}>Saved so far</span>
          <span style={{fontFamily:'ui-monospace,monospace',fontSize:13,color:C.green}}>{pct}% · {fmt(capped)}</span>
        </div>
        <div style={{height:4,background:C.border,borderRadius:2,overflow:'hidden',marginBottom:10}}><div style={{height:'100%',width:`${pct}%`,background:C.green,borderRadius:2,transition:'width 0.2s'}}/></div>
        <input type="range" min={0} max={Math.max(target,1)} step={50} value={capped} onChange={e=>setEfSaved(+e.target.value)} style={{width:'100%',accentColor:C.green}}/>
      </Card>
      <Eye>Where to keep it</Eye>
      <Card>
        <p style={{fontSize:13,color:C.faint,margin:'0 0 14px',lineHeight:1.6}}>High-yield savings — 4–5% APY, zero risk. Do not invest this money.</p>
        {[['SoFi','~4.6% APY, no minimums'],['Marcus by Goldman','No fees, competitive rate'],['Ally Bank','Reliable, great UX'],['Wealthfront Cash','~4.5%+ APY']].map(([n,d],i,a)=>(
          <div key={n} style={{padding:'9px 0',borderBottom:i<a.length-1?`1px solid ${C.border}`:'none'}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>{n}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:1}}>{d}</div>
          </div>
        ))}
      </Card>
      <div style={{height:28}}/>
    </div>
  )
}

function Taxes({profile,setProfile}) {
  const profit=profile.annualProfit,salary=Math.min(profile.salary,profit),t=calcScorp(profit,salary)
  return (
    <div style={{padding:'20px 20px 0'}}>
      <Eye style={{marginTop:4}}>S-corp taxes</Eye><H1>Salary low.<br/>Distributions clean.</H1>
      <Card>
        <Slider label="S-corp net profit" value={profit} min={40000} max={400000} step={1000} onChange={v=>setProfile({...profile,annualProfit:v,salary:Math.min(profile.salary,v)})} display={fmt(profit)}/>
        <Slider label="Your W-2 salary" value={salary} min={20000} max={profit} step={1000} onChange={v=>setProfile({...profile,salary:v})} display={fmt(salary)} color={C.teal}/>
        <div style={{fontSize:11,color:C.muted,marginTop:-4}}>Salary is {Math.round(salary/profit*100)}% of profit. Target: 40–60%.</div>
      </Card>
      <Eye>Income split</Eye>
      <Card>{[['Salary (W-2)',fmt(t.salary),C.text],['Distribution (no FICA)',fmt(t.dist),C.green],['Payroll taxes (15.3%)',fmt(t.tf),C.red]].map(([l,v,col],i,a)=>(
        <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:i<a.length-1?`1px solid ${C.border}`:'none'}}><span style={{fontSize:13,color:C.faint}}>{l}</span><span style={{fontFamily:'ui-monospace,monospace',fontSize:13,color:col,fontWeight:600}}>{v}</span></div>
      ))}</Card>
      <Eye>Estimated burden</Eye>
      <Card>
        {[['Federal income tax',t.fed],['NY state income tax',t.ny],['NYC personal tax',t.nyc]].map(([l,v])=>(
          <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:13,color:C.faint}}>{l}</span><span style={{fontFamily:'ui-monospace,monospace',fontSize:13,color:C.red}}>{fmt(v)}</span></div>
        ))}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 0 4px',borderTop:`1px solid ${C.border}`}}><span style={{fontSize:13,fontWeight:600,color:C.text}}>Total income tax</span><span style={{fontFamily:'ui-monospace,monospace',fontSize:15,fontWeight:600,color:C.red}}>{fmt(t.pit)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}><span style={{fontSize:12,color:C.muted}}>Quarterly (4×)</span><span style={{fontFamily:'ui-monospace,monospace',fontSize:12,color:C.accent}}>{fmt(t.q)}</span></div>
      </Card>
      <Dim>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}><span style={{fontSize:13,color:C.faint}}>Set aside on every distribution</span><span style={{fontFamily:'Georgia,serif',fontSize:28,color:C.accent}}>{t.pct}%</span></div>
        <p style={{fontSize:12,color:C.muted,margin:0,lineHeight:1.6}}>Move this immediately to your tax HYSA — distributions have no withholding.</p>
      </Dim>
      <Card style={{borderColor:C.red+'33'}}><div style={{fontSize:9,fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:C.red,marginBottom:6}}>NYC gotcha</div><p style={{fontSize:13,color:C.faint,margin:0,lineHeight:1.6}}>NYC doesn't recognize S-corp status. The city taxes your business under the Business Corporation Tax (~8.85%, ≈{fmt(t.bct)}). Separate from everything above.</p></Card>
      <Eye>Quarterly dates</Eye>
      <Card>{[['Q1','April 15'],['Q2','June 15'],['Q3','September 15'],['Q4','January 15']].map(([q,d],i,a)=>(
        <div key={q} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:i<a.length-1?`1px solid ${C.border}`:'none'}}><span style={{fontFamily:'ui-monospace,monospace',fontSize:11,color:C.accent}}>{q}</span><span style={{fontFamily:'ui-monospace,monospace',fontSize:13,color:C.text}}>Due {d}</span></div>
      ))}
      <p style={{fontSize:11,color:C.muted,margin:'10px 0 0'}}>Pay free at irs.gov/payments</p></Card>
      <div style={{height:28}}/>
    </div>
  )
}

function Invest({profile,setProfile}) {
  const monthly=profile.investMonthly,yrs=Math.max(1,profile.retireAge-profile.age)
  const fut=monthly*12*((Math.pow(1.07,yrs)-1)/0.07)*1.07
  return (
    <div style={{padding:'20px 20px 0'}}>
      <Eye style={{marginTop:4}}>Investing</Eye><H1>You're {profile.age}.<br/>Time is your edge.</H1>
      <Card>
        <Slider label="Monthly investment" value={monthly} min={50} max={4000} step={25} onChange={v=>setProfile({...profile,investMonthly:v})} display={`${fmt(monthly)}/mo`}/>
        <div style={{textAlign:'center',padding:'20px 0',background:C.bg,borderRadius:8}}>
          <div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:'.12em',fontWeight:700,marginBottom:8}}>Estimated value at {profile.retireAge}</div>
          <div style={{fontFamily:'Georgia,serif',fontSize:44,color:C.accent,lineHeight:1}}>${fmtK(fut)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:8}}>${fmtK(monthly*12*yrs)} contributed · {yrs} yrs · 7% avg</div>
        </div>
      </Card>
      <Eye>Account order</Eye>
      {[['01','Roth IRA','$7,000/yr','Post-tax now, tax-free forever.','Fidelity (FSKAX) or Vanguard (VTSAX)'],['02','Solo 401(k)','$23k + 25% employer','S-corp contributes as employer. Far higher ceiling.','Fidelity or Vanguard — open by Dec 31'],['03','Taxable brokerage','No limit','Same funds, fully liquid, once maxed.','Same brokerages']].map(([n,name,limit,why,where])=>(
        <Card key={n}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
            <div><div style={{fontFamily:'ui-monospace,monospace',fontSize:9,color:C.accent,marginBottom:3}}>{n}</div><div style={{fontFamily:'Georgia,serif',fontSize:18,color:C.text}}>{name}</div></div>
            <div style={{fontFamily:'ui-monospace,monospace',fontSize:10,color:C.accent,textAlign:'right',marginLeft:12,flexShrink:0}}>{limit}</div>
          </div>
          <p style={{fontSize:13,color:C.faint,margin:'0 0 5px',lineHeight:1.5}}>{why}</p>
          <p style={{fontSize:12,color:C.muted,margin:0}}><span style={{color:C.text}}>Open at: </span>{where}</p>
        </Card>
      ))}
      <Eye>Three funds. That's it.</Eye>
      <Card>{[['VTI / FSKAX','US Total Market','70%'],['VXUS / FTIHX','International','20%'],['BND / FXNAX','US Bonds','10%']].map(([tk,n,p],i,a)=>(
        <div key={tk} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:i<a.length-1?`1px solid ${C.border}`:'none'}}>
          <div><div style={{fontFamily:'ui-monospace,monospace',fontSize:10,color:C.accent,marginBottom:1}}>{tk}</div><div style={{fontSize:13,color:C.text}}>{n}</div></div>
          <span style={{fontFamily:'ui-monospace,monospace',fontSize:18,color:C.faint,marginLeft:12}}>{p}</span>
        </div>
      ))}</Card>
      <div style={{height:28}}/>
    </div>
  )
}

function ProfileTab({profile,setProfile,pinsEdit,pinsRemove,pinsAdd,cryptoKey,lock}) {
  const [changingPin,setChangingPin]=useState(false)
  const set=patch=>setProfile({...profile,...patch})
  return (
    <div style={{padding:'20px 20px 0'}}>
      <Eye style={{marginTop:4}}>Profile</Eye><H1>Your details.</H1>
      <Eye>Identity</Eye>
      <Card>
        <div style={{marginBottom:10}}><div style={{fontSize:11,color:C.muted,marginBottom:5}}>Name</div><TextField value={profile.name} onChange={v=>set({name:v})} placeholder="Your name"/></div>
        <div style={{marginBottom:10}}><div style={{fontSize:11,color:C.muted,marginBottom:5}}>Business / entity</div><TextField value={profile.business} onChange={v=>set({business:v})} placeholder="Your S-corp name"/></div>
        <div style={{display:'flex',gap:10}}>
          <div style={{flex:1}}><div style={{fontSize:11,color:C.muted,marginBottom:5}}>Age</div><CommitNum value={profile.age} onCommit={v=>set({age:v})} width="100%"/></div>
          <div style={{flex:1}}><div style={{fontSize:11,color:C.muted,marginBottom:5}}>Retire at</div><CommitNum value={profile.retireAge} onCommit={v=>set({retireAge:v})} width="100%"/></div>
        </div>
      </Card>
      <Eye>Defaults</Eye>
      <Card>{[['Monthly income','expectedIncome'],['Annual profit','annualProfit'],['W-2 salary','salary'],['Emergency fund/mo','efMonthly'],['Investment/mo','investMonthly']].map(([l,k],i,a)=>(
        <div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:i<a.length-1?`1px solid ${C.border}`:'none'}}>
          <span style={{fontSize:13,color:C.faint}}>{l}</span>
          <CommitNum value={profile[k]} onCommit={v=>set({[k]:v})} width={84}/>
        </div>
      ))}</Card>
      <Eye>Pinned expenses</Eye>
      <p style={{fontSize:12,color:C.muted,margin:'0 0 8px',lineHeight:1.5}}>Carry into every new month. Changes here only affect future months.</p>
      <Card>
        {profile.pins.length===0&&<p style={{fontSize:13,color:C.muted,padding:'4px 0'}}>No pins yet — pin one from the Budget tab.</p>}
        {profile.pins.map((p,i)=>(
          <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:i<profile.pins.length-1?`1px solid ${C.border}`:'none'}}>
            <PinIcon on/>
            <input value={p.label} onChange={e=>pinsEdit(p.id,{label:e.target.value})} style={{flex:1,background:'transparent',border:'none',color:C.text,fontSize:13,minWidth:0,padding:'2px 0'}}/>
            <CommitNum value={p.amount} onCommit={v=>pinsEdit(p.id,{amount:v})} width={62}/>
            <button onClick={()=>pinsRemove(p.id)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:0,minWidth:24,minHeight:24,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>×</button>
          </div>
        ))}
        <button onClick={pinsAdd} style={{width:'100%',background:'none',border:`1px dashed ${C.border}`,color:C.accent,borderRadius:7,padding:'9px',fontSize:13,cursor:'pointer',marginTop:10,fontFamily:'inherit'}}>+ Add pinned expense</button>
      </Card>
      <Eye>Security</Eye>
      <Card>
        {changingPin ? (
          <ChangePinFlow cryptoKey={cryptoKey} onDone={()=>setChangingPin(false)}/>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:13,color:C.text}}>Passcode</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>6-digit · AES-256 encrypted at rest</div></div>
              <button onClick={()=>setChangingPin(true)} style={{background:'none',border:`1px solid ${C.border}`,color:C.accent,borderRadius:7,padding:'7px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Change</button>
            </div>
            <div style={{height:1,background:C.border}}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:13,color:C.text}}>Lock now</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>Also auto-locks after 5 min in background</div></div>
              <button onClick={lock} style={{background:'none',border:`1px solid ${C.border}`,color:C.faint,borderRadius:7,padding:'7px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>Lock</button>
            </div>
          </div>
        )}
      </Card>
      <button onClick={()=>{if(confirm('Erase all data and reset? Cannot be undone.')){localStorage.clear();window.location.reload()}}}
        style={{width:'100%',background:'none',border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:'12px',fontSize:13,cursor:'pointer',marginBottom:28,fontFamily:'inherit'}}>
        Erase all data
      </button>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
const TABS=[['overview','Overview'],['budget','Budget'],['fund','Fund'],['taxes','Taxes'],['invest','Invest'],['profile','Profile']]

export default function App() {
  const [phase,  setPhase]  = useState('loading')   // loading | setup | locked | unlocked
  const [cryptoKey, setCKey]= useState(null)
  const [tab,    setTab]    = useState('overview')
  const [month,  setMonth]  = useState(todayKey)
  const [months, setMonths] = useState({})
  const [profile,setProfileSt]=useState(DEFAULT_PROFILE)
  const [efSaved,setEfSaved]=useState(0)
  const bgTime = useRef(null)

  // Detect if vault exists on mount
  useEffect(()=>{
    const salt=localStorage.getItem(K_SALT)
    setPhase(salt?'locked':'setup')
  },[])

  // Auto-lock on background
  useEffect(()=>{
    const handler=()=>{
      if(document.hidden){ bgTime.current=Date.now() }
      else if(bgTime.current&&Date.now()-bgTime.current>AUTO_LOCK_MS){ lock() }
    }
    document.addEventListener('visibilitychange',handler)
    return ()=>document.removeEventListener('visibilitychange',handler)
  },[])

  // Save vault whenever financial state changes
  useEffect(()=>{
    if(phase!=='unlocked'||!cryptoKey) return
    encryptVault(cryptoKey,{months,profile,efSaved}).then(v=>localStorage.setItem(K_VAULT,v)).catch(()=>{})
  },[months,profile,efSaved,phase,cryptoKey])

  const lock = useCallback(()=>{ setCKey(null); setPhase('locked') },[])

  const handleSetup = async pin => {
    const salt=newSalt()
    localStorage.setItem(K_SALT,salt)
    const key=await deriveKey(pin,salt)
    const vault=await encryptVault(key,DEFAULT_VAULT)
    localStorage.setItem(K_VAULT,vault)
    setCKey(key); setPhase('unlocked')
    return true
  }

  const handleUnlock = async pin => {
    const salt=localStorage.getItem(K_SALT), vault=localStorage.getItem(K_VAULT)
    if(!salt||!vault){ setPhase('setup'); return false }
    try {
      const key=await deriveKey(pin,salt)
      const data=await decryptVault(key,vault)
      setMonths(data.months||{})
      setProfileSt(data.profile||DEFAULT_PROFILE)
      setEfSaved(data.efSaved||0)
      setCKey(key); setPhase('unlocked')
      return true
    } catch { return false }
  }

  const setProfile=p=>setProfileSt(p)
  const updateMonth=(key,rec)=>setMonths(m=>({...m,[key]:rec}))
  const copyPrev=key=>{const prev=months[shift(key,-1)];if(prev)setMonths(m=>({...m,[key]:{expenses:prev.expenses.map(e=>({...e})),expectedIncome:prev.expectedIncome,extra:[]}}))}

  const pinLine=(mk,lineId)=>{const rec=months[mk]||seedMonth(profile),line=rec.expenses.find(e=>e.id===lineId);if(!line)return;const pin={id:uid(),label:line.label,amount:line.amount};setProfileSt(p=>({...p,pins:[...p.pins,pin]}));setMonths(m=>({...m,[mk]:{...rec,expenses:rec.expenses.map(e=>e.id===lineId?{...e,pinId:pin.id}:e)}}))}
  const removePinPropagate=(pid,detach=null)=>{const cur=todayKey();setProfileSt(p=>({...p,pins:p.pins.filter(x=>x.id!==pid)}));setMonths(ms=>{const out={};for(const[k,rec]of Object.entries(ms)){if(k===detach)out[k]={...rec,expenses:rec.expenses.map(e=>e.pinId===pid?{...e,pinId:null}:e)};else if(k>cur)out[k]={...rec,expenses:rec.expenses.filter(e=>e.pinId!==pid)};else out[k]=rec};return out})}
  const unpinLine=(mk,lineId)=>{const r=months[mk]||seedMonth(profile);const l=r.expenses.find(e=>e.id===lineId);if(!l||!l.pinId)return;if(!months[mk])updateMonth(mk,r);removePinPropagate(l.pinId,mk)}
  const pinsEdit=(pid,patch)=>{const cur=todayKey();setProfileSt(p=>({...p,pins:p.pins.map(x=>x.id===pid?{...x,...patch}:x)}));setMonths(ms=>{const out={};for(const[k,r]of Object.entries(ms)){if(k>cur)out[k]={...r,expenses:r.expenses.map(e=>e.pinId===pid?{...e,...patch}:e)};else out[k]=r};return out})}
  const pinsRemove=pid=>removePinPropagate(pid)
  const pinsAdd=()=>setProfileSt(p=>({...p,pins:[...p.pins,{id:uid(),label:'New pinned expense',amount:0}]}))
  const goTab=t=>{setTab(t);window.scrollTo(0,0)}

  if(phase==='loading') return <div style={{background:C.bg,minHeight:'100vh'}}/>
  if(phase==='setup')   return <LockScreen onUnlock={handleSetup} isSetup/>
  if(phase==='locked')  return <LockScreen onUnlock={handleUnlock} isSetup={false}/>

  return (
    <div style={{background:C.bg,minHeight:'100vh'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:C.bg+'EE',backdropFilter:'blur(16px)',WebkitBackdropFilter:'blur(16px)',borderBottom:`1px solid ${C.border}`,paddingTop:'env(safe-area-inset-top)'}}>
        <div style={{display:'flex',maxWidth:480,margin:'0 auto'}}>
          {TABS.map(([id,lbl])=>(
            <button key={id} onClick={()=>goTab(id)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'13px 2px 11px',borderBottom:`2px solid ${tab===id?C.accent:'transparent'}`,color:tab===id?C.text:C.muted,fontSize:11,fontWeight:tab===id?600:400,fontFamily:'inherit',letterSpacing:'0.01em'}}>
              {lbl}
            </button>
          ))}
        </div>
      </header>
      <main style={{maxWidth:480,margin:'0 auto',paddingBottom:'calc(32px + env(safe-area-inset-bottom))'}}>
        {tab==='overview'&&<Overview profile={profile} months={months} month={month} setMonth={setMonth} updateMonth={updateMonth}/>}
        {tab==='budget'  &&<Budget   profile={profile} months={months} month={month} setMonth={setMonth} updateMonth={updateMonth} copyPrev={copyPrev} pinLine={pinLine} unpinLine={unpinLine}/>}
        {tab==='fund'    &&<Fund   profile={profile} setProfile={setProfile} efSaved={efSaved} setEfSaved={setEfSaved}/>}
        {tab==='taxes'   &&<Taxes  profile={profile} setProfile={setProfile}/>}
        {tab==='invest'  &&<Invest profile={profile} setProfile={setProfile}/>}
        {tab==='profile' &&<ProfileTab profile={profile} setProfile={setProfile} pinsEdit={pinsEdit} pinsRemove={pinsRemove} pinsAdd={pinsAdd} cryptoKey={cryptoKey} lock={lock}/>}
      </main>
    </div>
  )
}
