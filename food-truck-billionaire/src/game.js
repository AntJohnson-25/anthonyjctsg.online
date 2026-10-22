/* ============================================================================
   BILLIONAIRE FOOD TRUCK
   Single-file 3D food-truck business simulation.
   Sections:
     A. Constants & content data      F. Customer AI
     B. Utility helpers               G. Order system / kitchen
     C. Game state + economy engine   H. UI manager
     D. Simulation engine (day loop)  I. Bootstrap / main loop
     E. 3D world (scene, park, chars)
   ============================================================================ */
'use strict';

/* ========================= A. CONSTANTS & DATA ============================ */

const CFG = {
  DAY_SECONDS: 240,          // 240 real seconds = 1 business day
  OPEN_HOUR: 8, CLOSE_HOUR: 22,
  MAX_CUSTOMERS: 70,         // hard cap on simultaneous 3D agents
  SPOTS: 16,                 // truck spaces per park
  START_CASH: 78000,
  SAVE_KEY: 'bft_save_v2',
  PARK_CONTROL: 0.5,         // ownership fraction that unlocks park purchase
  WIN_NET_WORTH: 1e9
};

/* Phones get a lighter 3D budget. A handset has a fraction of the VRAM and fill
   rate of a laptop, and the kitchen photos are decoded on top of whatever the
   park is already holding — so the shadow map and pixel ratio come down here
   rather than starving the images later. */
const MOBILE = innerWidth < 820 ||
  (window.matchMedia && matchMedia('(pointer:coarse)').matches);

// ---- commodity market ------------------------------------------------------
const COMMODITIES = {
  beef:      {name:'Beef',        unit:'lb', base:4.00, vol:.030},
  chicken:   {name:'Chicken',     unit:'lb', base:2.60, vol:.028},
  pork:      {name:'Pork',        unit:'lb', base:3.10, vol:.028},
  cheese:    {name:'Cheese',      unit:'lb', base:3.40, vol:.022},
  flour:     {name:'Flour',       unit:'lb', base:0.90, vol:.018},
  vegetables:{name:'Vegetables',  unit:'lb', base:2.10, vol:.035},
  oil:       {name:'Cooking oil', unit:'gal',base:9.50, vol:.030},
  rice:      {name:'Rice/beans',  unit:'lb', base:1.20, vol:.016},
  tortillas: {name:'Tortillas',   unit:'dz', base:2.40, vol:.020},
  bread:     {name:'Bread',       unit:'ea', base:0.55, vol:.020},
  pasta:     {name:'Pasta',       unit:'lb', base:1.40, vol:.018},
  fuel:      {name:'Fuel',        unit:'gal',base:3.60, vol:.035},
  packaging: {name:'Packaging',   unit:'ea', base:0.34, vol:.014}
};

// ---- cuisines & menus ------------------------------------------------------
// station: grill | fryer | prep    cook: seconds of real time at base speed
const CUISINES = {
  american: {
    name:'American', blurb:'Classic comfort food. Fast tickets, steady crowds.',
    difficulty:1, hue:0xD8453C, accent:0x2B4C8C, trim:0xF2F2F2, prop:'burger',
    menu:[
      {id:'burger', name:'Classic Cheeseburger', price:12.00, station:'grill', cook:8,  pop:.82,
       rec:{beef:.33,cheese:.14,bread:.22,vegetables:.18,packaging:1}},
      {id:'chick',  name:'Fried Chicken Sandwich',price:11.50, station:'fryer', cook:9,  pop:.74,
       rec:{chicken:.35,bread:.22,vegetables:.12,oil:.05,packaging:1}},
      {id:'fries',  name:'Loaded Fries',          price:7.50,  station:'fryer', cook:6,  pop:.68,
       rec:{vegetables:.45,cheese:.10,oil:.05,packaging:1}},
      {id:'dog',    name:'Hot Dog',               price:6.00,  station:'prep',  cook:5,  pop:.61,
       rec:{pork:.18,bread:.16,vegetables:.06,packaging:1}}
    ]},
  italian: {
    name:'Italian', blurb:'High margins, longer cook times. Rewards patience.',
    difficulty:2, hue:0x2E7D4F, accent:0xC0392B, trim:0xF3E6C8, prop:'pizza',
    menu:[
      {id:'pizza',  name:'Margherita Pizza',      price:15.00, station:'grill', cook:11, pop:.86,
       rec:{flour:.42,cheese:.28,vegetables:.20,packaging:1}},
      {id:'parm',   name:'Chicken Parm Sandwich', price:14.00, station:'fryer', cook:10, pop:.70,
       rec:{chicken:.32,cheese:.16,bread:.24,packaging:1}},
      {id:'sub',    name:'Meatball Sub',          price:12.50, station:'grill', cook:9,  pop:.66,
       rec:{beef:.26,bread:.26,cheese:.10,packaging:1}},
      {id:'alfredo',name:'Pasta Alfredo',         price:13.00, station:'prep',  cook:8,  pop:.63,
       rec:{pasta:.30,cheese:.20,oil:.03,packaging:1}}
    ]},
  hispanic: {
    name:'Hispanic', blurb:'Huge demand, flexible menu. Volume business.',
    difficulty:2, hue:0xE08A1E, accent:0x8E44AD, trim:0x2FA0A0, prop:'taco',
    menu:[
      {id:'tacos',  name:'Street Tacos (3)',      price:10.00, station:'grill', cook:7,  pop:.89,
       rec:{beef:.26,tortillas:.25,vegetables:.16,packaging:1}},
      {id:'burrito',name:'Burrito',               price:11.50, station:'prep',  cook:6,  pop:.81,
       rec:{chicken:.28,rice:.30,tortillas:.18,vegetables:.14,packaging:1}},
      {id:'quesa',  name:'Quesadilla',            price:8.50,  station:'grill', cook:6,  pop:.72,
       rec:{cheese:.26,tortillas:.20,vegetables:.08,packaging:1}},
      {id:'emp',    name:'Empanadas (2)',         price:7.00,  station:'fryer', cook:7,  pop:.64,
       rec:{flour:.22,pork:.18,oil:.05,packaging:1}}
    ]}
};
const CUISINE_KEYS = Object.keys(CUISINES);

// ---- customer personalities ------------------------------------------------
const PERSONAS = {
  worker:  {name:'Business worker', patience:.62, spend:1.20, tipBase:.14, items:[2,4], weight:24, color:0x3C4A63},
  family:  {name:'Family',          patience:.90, spend:1.85, tipBase:.12, items:[4,7], weight:18, color:0xD9A24B},
  tourist: {name:'Tourist',         patience:1.05,spend:1.35, tipBase:.18, items:[2,5], weight:14, color:0x4FA3C7},
  student: {name:'Student',         patience:1.15,spend:0.72, tipBase:.06, items:[1,4], weight:22, color:0x7A5CC4},
  foodie:  {name:'Foodie',          patience:.95, spend:1.55, tipBase:.22, items:[3,5], weight:12, color:0x3FA06B},
  hurry:   {name:'Impatient',       patience:.42, spend:1.05, tipBase:.09, items:[1,3], weight:10, color:0xC7513F}
};
const PERSONA_KEYS = Object.keys(PERSONAS);

// ---- black swan / random events -------------------------------------------
// effect keys: traffic (multiplier), spendMul, costMul, commodity {key:mult}, cash, repDelta
const EVENTS = [
 // positives
 {id:'festival', good:1, w:7, title:'Food festival in the district',
  text:'Foot traffic is way up all day.', days:1, eff:{traffic:1.8, spendMul:1.15}},
 {id:'viral', good:1, w:6, title:'Your truck went viral',
  text:'A clip of your line is circulating. Expect a crowd.', days:2, eff:{traffic:1.45, repDelta:5}, mineOnly:1},
 {id:'celeb', good:1, w:3, title:'Celebrity sighting at the park',
  text:'Everyone wants a photo — and a taco.', days:1, eff:{traffic:1.6, spendMul:1.2}},
 {id:'champs', good:1, w:4, title:'The city won the championship',
  text:'The whole town is out celebrating.', days:1, eff:{traffic:1.7, spendMul:1.25}},
 {id:'tourism', good:1, w:5, title:'Tourism boom',
  text:'Convention season fills the sidewalks.', days:3, eff:{traffic:1.3}},
 {id:'closed', good:1, w:4, title:'A competitor shut down',
  text:'Their customers are looking for a new favourite.', days:4, eff:{traffic:1.15}},
 {id:'supplier', good:1, w:6, title:'Supplier discount secured',
  text:'Ingredient costs drop while the deal lasts.', days:3, eff:{costMul:.82}},
 {id:'catering', good:1, w:5, title:'Catering contract offered',
  text:'A one-off corporate order lands in your lap.', days:1, eff:{cash:'catering'}},
 {id:'construction+', good:1, w:3, title:'Office tower opened next door',
  text:'A permanent bump in lunchtime traffic.', days:6, eff:{traffic:1.22}},
 // negatives
 {id:'pandemic', good:0, w:2, title:'Health emergency declared',
  text:'Crowds thin out sharply. Everyone is affected.', days:6, eff:{traffic:.42, spendMul:.85}},
 {id:'recession', good:0, w:3, title:'Recession hits the region',
  text:'People are spending less per order.', days:8, eff:{spendMul:.76, traffic:.88}},
 {id:'contam', good:0, w:3, title:'Contamination scare in the news',
  text:'Diners are nervous about street food.', days:3, eff:{traffic:.7, repDelta:-6}},
 {id:'meat', good:0, w:7, title:'Regional meat shortage',
  text:'Protein prices spike hard.', days:4, eff:{commodity:{beef:1.42, pork:1.3, chicken:1.25}}},
 {id:'fuelcrisis', good:0, w:5, title:'Fuel crisis',
  text:'Generators and deliveries just got expensive.', days:5, eff:{commodity:{fuel:1.55}, costMul:1.06}},
 {id:'weather', good:0, w:8, title:'Severe weather warning',
  text:'Rain is keeping the park empty.', days:1, eff:{traffic:.45}},
 {id:'roadwork', good:0, w:5, title:'Road construction at the entrance',
  text:'Access is restricted for a while.', days:4, eff:{traffic:.72}},
 {id:'rent', good:0, w:4, title:'Park raises rents',
  text:'Every space costs more per day from now on.', days:0, eff:{rentUp:1.12}},
 {id:'labor', good:0, w:4, title:'Labour shortage',
  text:'Wages are climbing across the park.', days:5, eff:{wageUp:1.18}},
 {id:'backlash', good:0, w:3, title:'Social media backlash',
  text:'A bad review is making the rounds.', days:2, eff:{traffic:.82, repDelta:-8}, mineOnly:1},
 {id:'equip', good:0, w:5, title:'Equipment failure',
  text:'A burner is down. Repairs are not cheap.', days:1, eff:{cash:'repair', cookSlow:1.25}, mineOnly:1},
 {id:'oilspike', good:0, w:6, title:'Cooking oil squeeze',
  text:'Fryer costs are up sharply.', days:3, eff:{commodity:{oil:1.5}}},
 {id:'produce', good:0, w:6, title:'Crop failure upstream',
  text:'Produce prices jump.', days:4, eff:{commodity:{vegetables:1.45}}}
];

// ---- upgrades --------------------------------------------------------------
const UPGRADES = [
 {id:'grill2',  cat:'Kitchen',    name:'High-output grill',     cost:14000, desc:'Grill items cook 25% faster.',       max:3, eff:'cook'},
 {id:'fryer2',  cat:'Kitchen',    name:'Double-basket fryer',   cost:12000, desc:'Fryer items cook 25% faster.',       max:3, eff:'cook'},
 {id:'fridge',  cat:'Kitchen',    name:'Walk-in refrigeration', cost:9000,  desc:'Cuts spoilage and ingredient waste.',max:2, eff:'waste'},
 {id:'prep',    cat:'Kitchen',    name:'Prep station',          cost:7500,  desc:'Prep items cook 30% faster.',        max:2, eff:'cook'},
 {id:'pos',     cat:'Service',    name:'Fast POS terminal',     cost:6000,  desc:'Orders are taken quicker; less walk-away.',max:2, eff:'patience'},
 {id:'digital', cat:'Service',    name:'Digital menu board',    cost:8000,  desc:'Customers decide faster and order more.',max:2, eff:'aov'},
 {id:'social',  cat:'Marketing',  name:'Social media push',     cost:5000,  desc:'+8% customers drawn to your truck.', max:4, eff:'draw'},
 {id:'influ',   cat:'Marketing',  name:'Influencer campaign',   cost:22000, desc:'+18% draw and a reputation bump.',   max:3, eff:'draw'},
 {id:'paint',   cat:'Appearance', name:'Premium wrap & paint',  cost:11000, desc:'Better looking truck, better tips.', max:2, eff:'tip'},
 {id:'neon',    cat:'Appearance', name:'Neon signage',          cost:9500,  desc:'Visibility bonus, especially at night.',max:2, eff:'draw'},
 {id:'train',   cat:'Staff',      name:'Staff training program',cost:13000, desc:'All employees gain skill immediately.',max:3, eff:'staff'},
 {id:'bonus',   cat:'Staff',      name:'Bonus scheme',          cost:16000, desc:'Staff work faster, wages rise 12%.', max:2, eff:'staff'}
];

const FIRST=['Marcus','Elena','Dre','Priya','Tomas','Nia','Owen','Sofia','Jamal','Bea','Luis','Hana','Ray','Yuki','Cole','Ines','Ade','Mira','Sam','Tariq'];
const LAST =['Reyes','Okafor','Vance','Nakamura','Silva','Bello','Hart','Duran','Kowal','Mensah','Ito','Cruz','Osei','Lang','Moreau'];
const BIZ_A=['Golden','Iron','Blue','Smoky','Little','Big','Wild','Corner','Sunset','Rolling','Copper','Neon','Hungry','Midnight'];
const BIZ_B=['Skillet','Wheel','Spoon','Flame','Cart','Kitchen','Griddle','Barrel','Wagon','Anchor','Lantern','Pantry'];

/* ========================= B. UTILITIES =================================== */

const rnd  = (a,b)=> a + Math.random()*(b-a);
const rint = (a,b)=> Math.floor(rnd(a,b+1));
const pick = arr => arr[Math.floor(Math.random()*arr.length)];
const clamp= (v,a,b)=> v<a?a:(v>b?b:v);
const lerp = (a,b,t)=> a+(b-a)*t;
function wpick(list, wkey='w'){                       // weighted pick
  let t=0; for(const o of list) t+=o[wkey];
  let r=Math.random()*t;
  for(const o of list){ r-=o[wkey]; if(r<=0) return o; }
  return list[list.length-1];
}
function gauss(mean,sd){                              // Box-Muller, clipped
  let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random();
  return clamp(mean+sd*Math.sqrt(-2*Math.log(u))*Math.cos(6.283185*v), mean-3*sd, mean+3*sd);
}
function money(n,dec){
  const neg=n<0; n=Math.abs(n);
  let s;
  if(n>=1e9)      s='$'+(n/1e9).toFixed(2)+'B';
  else if(n>=1e6) s='$'+(n/1e6).toFixed(2)+'M';
  else if(n>=1e5) s='$'+Math.round(n).toLocaleString();
  else            s='$'+n.toLocaleString(undefined,{minimumFractionDigits:dec?2:0,maximumFractionDigits:dec?2:0});
  return (neg?'-':'')+s;
}
const pct = n => Math.round(n*100)+'%';
const el  = id => document.getElementById(id);
function bizName(){ return pick(BIZ_A)+' '+pick(BIZ_B); }
function personName(){ return pick(FIRST)+' '+pick(LAST); }

/* ========================= C. GAME STATE ================================== */

const G = {
  started:false, paused:false, speed:1, sound:true,
  day:1, dayT:0,                 // dayT: 0..CFG.DAY_SECONDS
  cash:CFG.START_CASH, debt:0,
  totalProfit:0, totalRevenue:0, totalCustomers:0,
  parks:[], parkIdx:0,
  today:null, history:[], events:[], seenMilestones:[],
  franchises:0, franchiseIncome:0,
  wageMul:1, rentMul:1,
  won:false, tutorialStep:0, tips:0,
  phase:'truck',                 // 'cart' during the prologue, 'truck' after trading up
  // social / calendar / networking
  followers:0, posts:[], postedToday:false, boostNext:false, viral:null,
  fairs:[], fairYear:0, regulars:[]
};

// ---- commodity market ------------------------------------------------------
const Market = {
  price:{}, prev:{}, shock:{},
  init(){ for(const k in COMMODITIES){ this.price[k]=COMMODITIES[k].base; this.prev[k]=this.price[k]; this.shock[k]=1; } },
  step(){                                        // once per simulated day
    for(const k in COMMODITIES){
      this.prev[k]=this.price[k];
      const c=COMMODITIES[k];
      const drift=(c.base-this.price[k])*0.07;   // mean reversion
      const noise=gauss(0,c.vol)*c.base;
      const season=Math.sin((G.day/28)*Math.PI*2)*c.base*0.03;
      this.shock[k]=lerp(this.shock[k],1,0.18);  // shocks decay
      this.price[k]=clamp((this.price[k]+drift+noise+season)*(1+(this.shock[k]-1)*0.35), c.base*0.55, c.base*2.6);
    }
  },
  applyShock(k,mult){ this.shock[k]=mult; this.price[k]=clamp(this.price[k]*mult, COMMODITIES[k].base*.5, COMMODITIES[k].base*3); },
  change(k){ return (this.price[k]-COMMODITIES[k].base)/COMMODITIES[k].base; }
};

// ---- item costing ----------------------------------------------------------
function itemCost(item){
  let c=0;
  for(const k in item.rec) c += item.rec[k]*Market.price[k];
  return c * Economy.costMul();
}
function itemMargin(truck,item){
  const p = truck.prices[item.id];
  return (p - itemCost(item)) / p;
}

/* ---- Economy: aggregated modifiers from events & upgrades ---------------- */
const Economy = {
  trafficMul(){ let m=1; for(const e of G.events) if(e.eff.traffic) m*=e.eff.traffic; return m; },
  spendMul(){   let m=1; for(const e of G.events) if(e.eff.spendMul) m*=e.eff.spendMul; return m; },
  costMul(){    let m=1; for(const e of G.events) if(e.eff.costMul) m*=e.eff.costMul; return m; },
  cookSlow(){   let m=1; for(const e of G.events) if(e.eff.cookSlow) m*=e.eff.cookSlow; return m; }
};

/* ========================= LOCATIONS / TRUCKS / STAFF ===================== */

function makeEmployee(tier){
  tier = tier||1;
  const b = 46 + tier*13;
  return {
    id:'e'+Math.random().toString(36).slice(2,8),
    name:personName(),
    cooking:Math.round(clamp(gauss(b,12),25,99)),
    speed:Math.round(clamp(gauss(b,12),25,99)),
    service:Math.round(clamp(gauss(b,12),25,99)),
    reliability:Math.round(clamp(gauss(b+6,10),30,99)),
    salary:Math.round(clamp(gauss(105+tier*38,22),70,420)),
    fatigue:0, xp:0
  };
}
function empSkill(e){ return (e.cooking*.5 + e.speed*.35 + e.reliability*.15) * (1 - e.fatigue*0.32); }

/** Build a park: spaces laid out around a rounded perimeter, entrance bottom-centre. */
function makePark(index){
  const park = {
    index, name: index===0 ? 'Riverside Truck Park' : 'Harborlight Truck Park',
    owned:false, spots:[], w:index===0?86:96, h:index===0?70:76,
    priceMul: index===0?1:3.4, trafficMul: index===0?1:1.55
  };
  const n = CFG.SPOTS;
  for(let i=0;i<n;i++){
    // perimeter parametric position, gap reserved at bottom-centre for entrance
    const t = (i+0.5)/n;
    const p = perimeterPoint(t, park.w, park.h);
    const distEntrance = Math.hypot(p.x-0, p.z-park.h/2) / (park.w*0.9);
    const traffic  = clamp(gauss(0.92 - distEntrance*0.55, .07), .30, .98);
    const vis      = clamp(traffic + gauss(0,.10), .28, .99);
    const access   = clamp(gauss(0.5+(1-distEntrance)*0.45,.09), .3, .99);
    const quality  = traffic*.5 + vis*.3 + access*.2;
    const price    = Math.round((15000 + Math.pow(quality,2.2)*152000) * park.priceMul / 500)*500;
    park.spots.push({
      id:i+1, park:index, x:p.x, z:p.z, rot:p.rot,
      traffic, vis, access, quality,
      price, rent: Math.round((50 + quality*470)*park.priceMul/10)*10,
      truck:null
    });
  }
  return park;
}
/** point on a rounded-rectangle perimeter; t in [0,1) starting at bottom-left of entrance */
function perimeterPoint(t,w,h){
  const hw=w/2, hh=h/2, gap=0.09;           // entrance gap fraction at bottom-centre
  // remap t to skip the entrance gap centred at t=0.875 of the loop
  let u=t;
  const a=2*Math.PI*(u+0.06);
  // superellipse for an organic rounded park
  const n=3.2;
  const c=Math.cos(a), s=Math.sin(a);
  const x=Math.sign(c)*Math.pow(Math.abs(c),2/n)*hw;
  const z=Math.sign(s)*Math.pow(Math.abs(s),2/n)*hh;
  const rot=Math.atan2(-x,-z);              // face the centre
  return {x,z,rot};
}

function makeTruck(spot, cuisineKey, isPlayer){
  const cu = CUISINES[cuisineKey];
  const prices = {};
  for(const it of cu.menu) prices[it.id] = it.price * (isPlayer?1:clamp(gauss(1,.09),.8,1.25));
  return {
    id:'t'+spot.park+'_'+spot.id,
    spotId:spot.id, park:spot.park,
    name: isPlayer ? 'Your Truck' : bizName(),
    cuisine:cuisineKey, mine:!!isPlayer,
    prices,
    rep: isPlayer?55:Math.round(clamp(gauss(64,12),30,95)),
    equip: isPlayer?1:clamp(gauss(1,.14),.7,1.4),
    staff: isPlayer?[makeEmployee(1),makeEmployee(1)]:[],
    staffCount: isPlayer?2:rint(1,3),
    upgrades:{}, salesToday:0, custToday:0, revToday:0, costToday:0, tipsToday:0,
    revYest:0, profitYest:0, dayRev:0, dayProfit:0,
    lifetimeProfit:0, lifetimeCust:0,
    served:0, walkaways:0, satSum:0, satN:0,
    mesh:null, queue:[]
  };
}

const Park = {
  cur(){ return G.parks[G.parkIdx]; },
  spots(){ return this.cur().spots; },
  trucks(pi){ const p = G.parks[pi===undefined?G.parkIdx:pi]; return p.spots.filter(s=>s.truck).map(s=>s.truck); },
  myTrucks(pi){ return this.trucks(pi).filter(t=>t.mine); },
  allMyTrucks(){ let a=[]; for(let i=0;i<G.parks.length;i++) a=a.concat(this.myTrucks(i)); return a; },
  ownership(pi){
    const p=G.parks[pi===undefined?G.parkIdx:pi];
    const total=p.spots.length, mine=p.spots.filter(s=>s.truck&&s.truck.mine).length;
    return mine/total;
  },
  playerTruck(){ return Park.myTrucks(G.parkIdx)[0] || Park.allMyTrucks()[0] || null; },
  homeTruck(){ return G.homeTruck && G.homeTruck.spotId ? G.homeTruck : Park.playerTruck(); }
};

/* ---- valuation ------------------------------------------------------------ */
function truckValue(t){
  const spot = G.parks[t.park].spots.find(s=>s.id===t.spotId);
  const earnings = Math.max(200, t.profitYest||t.dayProfit||600);
  return Math.round(spot.price*0.35 + earnings*17 + t.rep*180 + (t.staff.length||t.staffCount)*1500);
}
function netWorth(){
  let nw = G.cash - G.debt;
  for(let i=0;i<G.parks.length;i++){
    const p=G.parks[i];
    for(const s of p.spots) if(s.truck && s.truck.mine) nw += truckValue(s.truck);
    if(p.owned) nw += parkValue(i);
  }
  nw += (G.franchiseValue||0);
  return nw;
}
function parkValue(i){
  const p=G.parks[i];
  return Math.round(p.spots.reduce((a,s)=>a+s.price,0)*2.1 + 4e6*p.priceMul);
}
function parkBuyPrice(i){
  const p=G.parks[i];
  const remaining = p.spots.filter(s=>!(s.truck&&s.truck.mine));
  return Math.round((remaining.reduce((a,s)=>a+s.price+ (s.truck?truckValue(s.truck)*.55:0),0) + 1.2e6*p.priceMul)/1000)*1000;
}

/* ========================= D. SIMULATION ENGINE =========================== */

const Sim = {
  spawnAcc:0,

  /** current in-game clock as fraction of the trading day */
  clockFrac(){ return G.dayT / CFG.DAY_SECONDS; },
  hour(){ return CFG.OPEN_HOUR + this.clockFrac()*(CFG.CLOSE_HOUR-CFG.OPEN_HOUR); },
  clockText(){
    const h=this.hour(); let hh=Math.floor(h), mm=Math.floor((h-hh)*60);
    const ap=hh>=12?'PM':'AM'; let d=hh%12; if(d===0)d=12;
    return d+':'+String(mm).padStart(2,'0')+' '+ap;
  },
  /** demand curve across the day: breakfast trickle, lunch peak, dinner peak */
  demandCurve(){
    const h=this.hour();
    const lunch  = Math.exp(-Math.pow((h-12.6)/1.5,2))*1.0;
    const dinner = Math.exp(-Math.pow((h-19.0)/1.9,2))*0.85;
    const base   = 0.16;
    return base + lunch + dinner;
  },
  /** customers per real-time second entering the park right now */
  arrivalRate(){
    const p=Park.cur();
    const trucks = Park.trucks().length;
    const pull = 1 + trucks*0.045;
    let m = Cal.seasonMul();                       // the year has a shape
    const fair = Fairs.activeToday();
    if(fair) m *= Fairs.tpl(fair).traffic;         // a fair is a different world
    if(G.viral && G.viral.day===G.day) m *= G.viral.mult;
    return this.demandCurve() * 1.45 * pull * p.trafficMul * Economy.trafficMul() * m;
  },

  update(dt){
    if(!G.started || G.paused) return;
    const sdt = dt*G.speed;
    G.dayT += sdt;

    // spawn customers
    this.spawnAcc += this.arrivalRate()*sdt;
    while(this.spawnAcc>=1){
      this.spawnAcc-=1;
      if(World.customers.length < CFG.MAX_CUSTOMERS && this.hour()<CFG.CLOSE_HOUR-0.4) World.spawnCustomer();
    }

    World.update(sdt);
    Kitchen.update(sdt);

    if(G.dayT>=CFG.DAY_SECONDS) this.endDay();
  },

  /* ------------------------------------------------------------------ */
  endDay(){
    G.dayT = 0;
    const home = Park.homeTruck();
    const T = G.today;

    // --- judge the day's headline events before the books close ---------
    if(home){
      const fairToday = Fairs.activeToday();
      if(fairToday) Fairs.judge(fairToday, T, home);
      if(G.viral && G.viral.day===G.day) Social.judgeViral(T, home);
    }
    G.postedToday=false;

    // --- simulate every non-player-operated truck for the day -----------
    for(let pi=0; pi<G.parks.length; pi++){
      for(const s of G.parks[pi].spots){
        const t=s.truck; if(!t) continue;
        if(t===home) continue;                 // played live
        this.simTruckDay(t,s);
      }
    }

    // --- roll the live truck's real-time results ------------------------
    if(home){
      home.dayRev = home.revToday; home.revYest = home.revToday;
      const spot = G.parks[home.park].spots.find(x=>x.id===home.spotId);
      const wages = home.staff.reduce((a,e)=>a+e.salary,0)*G.wageMul;
      const rent  = spot.rent*G.rentMul;
      const other = 40 + Market.price.fuel*14 + home.rep*0.4;
      T.labor += wages; T.rent += rent; T.other += other;
      home.costToday += wages+rent+other;
      home.dayProfit = home.revToday - home.costToday;
      home.profitYest = home.dayProfit;
      home.lifetimeProfit += home.dayProfit;
    }

    // --- park rent income if the player owns a park ---------------------
    let parkIncome=0;
    for(let i=0;i<G.parks.length;i++){
      if(!G.parks[i].owned) continue;
      for(const s of G.parks[i].spots) if(s.truck && !s.truck.mine) parkIncome += s.rent*G.rentMul;
    }
    T.parkIncome = parkIncome;
    T.franchise  = G.franchiseIncome;
    T.debtPay    = G.debt*0.0015;          // daily interest

    // --- finalise the books --------------------------------------------
    const revenue  = T.rev + T.tips + T.parkIncome + T.franchise;
    const expenses = T.ing + T.labor + T.rent + T.other + T.debtPay;
    const profit   = revenue - expenses;
    G.cash += profit;
    G.totalProfit += profit; G.totalRevenue += revenue; G.totalCustomers += T.cust;
    G.tips += T.tips;
    if(G.debt>0){ const pay=Math.min(G.debt, G.debt*0.02); G.debt-=pay; }

    const rec = {day:G.day, rev:revenue, exp:expenses, profit, cash:G.cash, nw:netWorth(),
                 cust:T.cust, sat:T.satN? T.satSum/T.satN : .8, tips:T.tips};
    G.history.push(rec); if(G.history.length>400) G.history.shift();

    // --- world tick -----------------------------------------------------
    Market.step();
    this.tickEvents();
    this.staffTick();
    this.competitorTick();
    UI.endOfDay(rec);

    G.day++;
    G.today = blankDay();
    for(const t of Park.trucks(0).concat(G.parks[1]?Park.trucks(1):[])){
      t.revToday=0;t.costToday=0;t.custToday=0;t.tipsToday=0;t.salesToday=0;
    }
    World.clearCustomers();
    Kitchen.clear();
    Save.write();
    this.checkMilestones();
  },

  /** abstract daily simulation for a truck the player is not personally running */
  simTruckDay(t,spot){
    const cu=CUISINES[t.cuisine];
    const draw = spot.traffic*0.55 + spot.vis*0.2 + (t.rep/100)*0.25;
    const compete = 1 / (1 + Park.trucks(t.park).length*0.035);
    let cust = 245 * draw * compete * Economy.trafficMul() * Park.cur().trafficMul * clamp(gauss(1,.16),.5,1.6);
    if(t.mine) cust *= 1.06;                    // player operations are run tighter
    cust = Math.max(0, Math.round(cust));

    let rev=0, ing=0;
    for(let i=0;i<cust;i++){
      const item = wpick(cu.menu.map(m=>({m,w:m.pop*100})), 'w').m;
      const qty = Math.random()<.55?2:1;
      rev += t.prices[item.id]*qty*Economy.spendMul();
      ing += itemCost(item)*qty;
    }
    const tips = rev * (0.09 + (t.rep/100)*0.09);
    const wages = (t.staff.length? t.staff.reduce((a,e)=>a+e.salary,0) : t.staffCount*165) * G.wageMul;
    const rent = spot.rent*G.rentMul;
    const other = 35 + Market.price.fuel*12;
    const profit = rev+tips-ing-wages-rent-other;

    t.revToday=rev+tips; t.costToday=ing+wages+rent+other;
    t.dayRev=rev+tips; t.revYest=rev+tips;
    t.dayProfit=profit; t.profitYest=profit; t.lifetimeProfit+=profit;
    t.custToday=cust; t.lifetimeCust+=cust;

    if(t.mine){
      G.today.rev+=rev; G.today.tips+=tips; G.today.ing+=ing;
      G.today.labor+=wages; G.today.rent+=rent; G.today.other+=other;
      G.today.cust+=cust;
    }
    // reputation drifts toward equipment/staff quality
    const target = clamp(50 + (t.equip-1)*40 + ((t.staff.length?t.staff.reduce((a,e)=>a+empSkill(e),0)/t.staff.length:60)-55)*0.6, 20, 98);
    t.rep = clamp(t.rep + (target-t.rep)*0.08 + gauss(0,1.2), 5, 99);
  },

  /* ---------------- events ---------------- */
  tickEvents(){
    // expire
    G.events = G.events.filter(e=>{ e.left--; return e.left>0; });
    // chance of a new event
    if(Math.random() < 0.30){
      const ev = wpick(EVENTS);
      if(G.events.some(e=>e.id===ev.id)) return;
      this.fireEvent(ev);
    }
  },
  fireEvent(ev){
    const inst = Object.assign({}, ev, {left:Math.max(1,ev.days||1)});
    if(ev.eff.commodity) for(const k in ev.eff.commodity) Market.applyShock(k, ev.eff.commodity[k]);
    if(ev.eff.rentUp){ G.rentMul*=ev.eff.rentUp; }
    if(ev.eff.wageUp){ G.wageMul*=ev.eff.wageUp; }
    if(ev.eff.repDelta){ const t=Park.homeTruck(); if(t) t.rep=clamp(t.rep+ev.eff.repDelta,5,99); }
    if(ev.eff.cash==='catering'){ const amt=Math.round(rnd(2200,9000)*(1+Park.allMyTrucks().length*.4)); G.cash+=amt;
      UI.note('good','💼 Catering contract', 'Paid '+money(amt)+' up front.'); }
    if(ev.eff.cash==='repair'){ const amt=Math.round(rnd(700,3400)); G.cash-=amt;
      UI.note('bad','🔧 Equipment failure', 'Repairs cost '+money(amt)+'.'); }
    if(ev.days>0) G.events.push(inst);
    UI.note(ev.good?'good':'bad', (ev.good?'✨ ':'⚠ ')+ev.title, ev.text);
    if(ev.eff.commodity) UI.offerDecision(ev);
  },

  /* ---------------- staff ---------------- */
  staffTick(){
    for(const t of Park.allMyTrucks()){
      for(const e of t.staff){
        e.fatigue = clamp(e.fatigue*0.55, 0, 1);      // rest overnight
        e.xp += 1;
        if(e.xp%4===0){
          e.cooking=clamp(e.cooking+rint(0,2),0,99);
          e.speed=clamp(e.speed+rint(0,2),0,99);
          e.service=clamp(e.service+rint(0,2),0,99);
        }
      }
    }
  },

  /* ---------------- competitors ---------------- */
  competitorTick(){
    for(let pi=0;pi<G.parks.length;pi++){
      for(const s of G.parks[pi].spots){
        const t=s.truck; if(!t||t.mine) continue;
        // price moves
        if(Math.random()<0.12){
          const cu=CUISINES[t.cuisine], it=pick(cu.menu);
          const dir = t.profitYest<0 ? 1.05 : (Math.random()<.5?0.96:1.04);
          t.prices[it.id]=clamp(t.prices[it.id]*dir, it.price*.6, it.price*1.6);
        }
        // invest / decline
        if(t.profitYest>1200 && Math.random()<0.10) t.equip=clamp(t.equip+0.03,0.6,1.9);
        if(t.profitYest<-600 && Math.random()<0.07){
          // struggling truck may close, freeing the space
          s.truck=null; World.removeTruck(t);
          UI.note('good','🏚 A truck closed', t.name+' shut down. Space #'+s.id+' is open.');
        }
      }
      // an empty space occasionally attracts a new operator
      const empties = G.parks[pi].spots.filter(s=>!s.truck);
      if(empties.length && Math.random()<0.08 && !G.parks[pi].owned){
        const s=pick(empties);
        s.truck=makeTruck(s, pick(CUISINE_KEYS), false);
        if(pi===G.parkIdx) World.addTruck(s.truck,s);
      }
    }
  },

  /* ---------------- milestones ---------------- */
  checkMilestones(){
    const nw=netWorth();
    const marks=[1e4,5e4,1e5,2.5e5,5e5,1e6,5e6,1e7,5e7,1e8,5e8,1e9];
    for(const m of marks){
      if(nw>=m && !G.seenMilestones.includes(m)){
        G.seenMilestones.push(m);
        UI.note('money','🏆 Milestone', 'Net worth passed '+money(m)+'.');
        if(m>=1e6) UI.banner(money(m)+' NET WORTH','milestone reached');
      }
    }
    const own=Park.ownership(G.parkIdx);
    if(own>=CFG.PARK_CONTROL && !Park.cur().owned) el('rail').querySelector('[data-panel="park"]').classList.add('alert');
    if(!G.won && nw>=CFG.WIN_NET_WORTH && G.parks.length>1 && G.parks[0].owned && G.parks[1].owned) UI.win();
  }
};

function blankDay(){
  return {rev:0,tips:0,ing:0,labor:0,rent:0,other:0,debtPay:0,cust:0,orders:0,
          satSum:0,satN:0,parkIncome:0,franchise:0,items:{}};
}

/* ========================= E. 3D WORLD ==================================== */

const World = {
  renderer:null, scene:null, cam:null, clock:null,
  target:new THREE.Vector3(0,0,0), radius:78, theta:Math.PI*0.5, phi:0.92,
  mode:'park',                 // park | kitchen
  truckMeshes:[], customers:[], pool:[], props:[], parkGroup:null,
  interior:null, ray:new THREE.Raycaster(), mouse:new THREE.Vector2(),
  hovered:null,
  dead:false,          // true when WebGL is unavailable; the 2D game carries on

  init(){
    const vp = el('viewport');
    /* The park is the only part of the game that needs WebGL. three.js comes off
       a CDN, and a phone can refuse a GL context outright (low-power mode, too
       many live contexts, an old driver). Either way the failure has to stay
       local: boot() runs UI.init() after this, and UI.init() is what calls
       ART.init() — so letting this throw would take the kitchen art, the cart
       and the entire interface down with it. */
    try{
      if(typeof THREE === 'undefined') throw new Error('three.js did not load');
      this.renderer = new THREE.WebGLRenderer({antialias:!MOBILE, powerPreference:'high-performance'});
    }catch(err){
      this.dead = true;
      console.warn('3D park disabled:', err && err.message);
      vp.innerHTML = '<div class="glfail"><b>The park view needs WebGL</b>'+
        'This browser would not give it to us. The cart and the kitchen still work.</div>';
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE?1.25:1.5));
    this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    vp.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1219);
    this.scene.fog = new THREE.Fog(0x0d1219, 150, 300);
    this.cam = new THREE.PerspectiveCamera(innerWidth/innerHeight<0.9?62:46, innerWidth/innerHeight, 0.3, 900);
    this.clock = new THREE.Clock();
    HS.Crowd.init(MOBILE);

    // lighting: warm key, cool fill, soft ground bounce (three r158 light units)
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x2a2118, 1.5); this.scene.add(hemi); this.hemi=hemi;
    const key = new THREE.DirectionalLight(0xfff0d4, 2.6);
    key.position.set(48,72,34); key.castShadow=true;
    key.shadow.mapSize.set(MOBILE?1024:2048, MOBILE?1024:2048);   // 16MB of VRAM at 2048, 4MB at 1024
    const d=90; key.shadow.camera.left=-d; key.shadow.camera.right=d;
    key.shadow.camera.top=d; key.shadow.camera.bottom=-d;
    key.shadow.camera.far=260; key.shadow.bias=-0.0006;
    this.scene.add(key); this.key=key;
    const fill = new THREE.DirectionalLight(0x86a8ff,0.7); fill.position.set(-40,30,-30); this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff,0.35));

    this.stationMeshes={};
    this.bindInput();
    // walking your cook (arrows / thumb wheel), E at a station or the window, V = kitchen <-> park
    HS.Input.init(vp, ()=>HS.Crew.act(), ()=>{ if(G.started && G.phase!=='cart') UI.toggleKitchen(); });
    addEventListener('resize',()=>this.resize());
  },

  resize(){
    if(this.dead) return;
    this.cam.aspect=innerWidth/innerHeight;
    this.cam.fov=this.cam.aspect<0.9?62:46;        // a phone held upright needs a wider lens
    this.cam.updateProjectionMatrix();
    this.renderer.setSize(innerWidth,innerHeight);
  },

  /* ---------------- park construction ---------------- */
  buildPark(){
    if(this.dead) return;
    this.clearCustomers();
    this.pool.length=0;
    if(this.parkGroup) this.scene.remove(this.parkGroup);
    this.truckMeshes.length=0;
    const g=new THREE.Group(); this.parkGroup=g; this.scene.add(g);
    const P=Park.cur(), hw=P.w/2, hh=P.h/2;
    this.bulbs=[]; this.pools=[];
    HS.Crew.detach(); this.homeMesh=null; this.stationMeshes={};

    const M=(c,r,m)=>new THREE.MeshStandardMaterial({color:c,roughness:r===undefined?.85:r,metalness:m||0});

    // ground
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(320,320), M(0x3a3f45,.95));
    ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; g.add(ground);
    // the city around the park
    g.add(this.makeSkyline(hw,hh));

    // paved lot
    const lot=new THREE.Mesh(new THREE.PlaneGeometry(P.w+26,P.h+26), M(0x4a5058,.93));
    lot.rotation.x=-Math.PI/2; lot.position.y=0.02; lot.receiveShadow=true; g.add(lot);

    // organic central plaza (superellipse ring of points -> shape)
    const shape=new THREE.Shape();
    const pts=[];
    for(let i=0;i<=64;i++){
      const a=(i/64)*Math.PI*2, n=3.0;
      const c=Math.cos(a), s=Math.sin(a);
      const wob=1+Math.sin(a*3)*0.05+Math.cos(a*5)*0.03;
      pts.push(new THREE.Vector2(
        Math.sign(c)*Math.pow(Math.abs(c),2/n)*hw*0.66*wob,
        Math.sign(s)*Math.pow(Math.abs(s),2/n)*hh*0.66*wob));
    }
    shape.setFromPoints(pts);
    const plaza=new THREE.Mesh(new THREE.ShapeGeometry(shape), M(0x8d8a84,.9));
    plaza.rotation.x=-Math.PI/2; plaza.position.y=0.05; plaza.receiveShadow=true; g.add(plaza);
    const plazaIn=new THREE.Mesh(new THREE.ShapeGeometry(shape), M(0xa39d92,.88));
    plazaIn.rotation.x=-Math.PI/2; plazaIn.position.y=0.07; plazaIn.scale.set(.84,.84,1); g.add(plazaIn);
    this.plazaPts=pts;

    // border wall + posts + lights
    const wallM=M(0x232a34,.9);
    for(let i=0;i<72;i++){
      const t=i/72, a=t*Math.PI*2, n=3.2;
      const c=Math.cos(a), s=Math.sin(a);
      const x=Math.sign(c)*Math.pow(Math.abs(c),2/n)*(hw+11);
      const z=Math.sign(s)*Math.pow(Math.abs(s),2/n)*(hh+11);
      if(z>hh+6 && Math.abs(x)<9) continue;         // entrance gap
      const post=new THREE.Mesh(new THREE.BoxGeometry(.5,2.4,.5), wallM);
      post.position.set(x,1.2,z); post.castShadow=true; g.add(post);
      if(i%9===0){
        const lamp=new THREE.Group();
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(.16,.2,7,7), M(0x2e3742,.6,.4));
        pole.position.y=3.5; pole.castShadow=true; lamp.add(pole);
        const bulb=new THREE.Mesh(new THREE.SphereGeometry(.6,10,8), new THREE.MeshStandardMaterial({color:0xffe2a8,emissive:0xffd79a,emissiveIntensity:.3}));
        bulb.position.y=7.1; lamp.add(bulb); this.bulbs.push(bulb);
        // a pool of lamplight on the ground instead of a real light (sixteen trucks' worth of
        // shading is already enough for a laptop GPU)
        const pool=new THREE.Mesh(new THREE.CircleGeometry(6,20), new THREE.MeshBasicMaterial({color:0xffc878,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));
        pool.rotation.x=-Math.PI/2; pool.position.y=.12; lamp.add(pool); this.pools.push(pool);
        lamp.position.set(x*1.02,0,z*1.02); g.add(lamp);
      }
      if(i%5===2){ g.add(this.makeTree(x*1.05,z*1.05)); }
    }

    // entrance arch
    const arch=new THREE.Group();
    const legGeo=new THREE.BoxGeometry(1.2,7,1.2);
    const legM=M(0x39434f,.7,.2);
    const l1=new THREE.Mesh(legGeo,legM); l1.position.set(-7,3.5,0); l1.castShadow=true;
    const l2=new THREE.Mesh(legGeo,legM); l2.position.set(7,3.5,0); l2.castShadow=true;
    const top=new THREE.Mesh(new THREE.BoxGeometry(16,1.6,1.6), M(0xE8663C,.55));
    top.position.y=7.4; top.castShadow=true;
    const signTex=this.textTexture(P.name,'#2a1f06'); signTex.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Mesh(new THREE.BoxGeometry(11,2.2,.3), [M(0xF5D97A,.5),M(0xF5D97A,.5),M(0xF5D97A,.5),M(0xF5D97A,.5),
      new THREE.MeshStandardMaterial({color:0xF5D97A,map:this.signBack(signTex),roughness:.5,emissive:0xF5D97A,emissiveIntensity:.25}),M(0xF5D97A,.5)]);
    sign.position.set(0,7.4,.9);
    arch.add(l1,l2,top,sign);
    arch.position.set(0,0,hh+11); g.add(arch);
    this.entrance=new THREE.Vector3(0,0,hh+15);

    // central seating clusters
    for(let i=0;i<8;i++){
      const a=(i/8)*Math.PI*2+0.4, r=Math.min(hw,hh)*0.42;
      g.add(this.makeTable(Math.cos(a)*r, Math.sin(a)*r*0.86));
    }
    // the lot, plaza, posts, lamps, trees and tables never move: fold them into a few meshes
    HS.mergeStatic(g);
    // trucks
    for(const s of P.spots) if(s.truck) this.addTruck(s.truck,s);
    // scale camera to park, opening on your own truck's corner so you see the people up close
    this.radius=Math.max(P.w,P.h)*1.05;
    const home=Park.homeTruck();
    if(home && home.park===G.parkIdx && home.servicePt){
      // from out in the plaza, looking back at your window and your line
      this.target.set(home.servicePt.x*0.92,0,home.servicePt.z*0.92);
      this.theta=Math.atan2(-home.servicePt.z,-home.servicePt.x); this.radius=40; this.phi=0.98;
    }
  },

  makeTree(x,z){
    const t=new THREE.Group();
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.28,.4,3,6),
      new THREE.MeshStandardMaterial({color:0x4a3524,roughness:.95}));
    trunk.position.y=1.5; trunk.castShadow=true; t.add(trunk);
    const cM=new THREE.MeshStandardMaterial({color:0x2f6b45,roughness:.9});
    for(let i=0;i<3;i++){
      const b=new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(1.5,2.3),0),cM);
      b.position.set(rnd(-.9,.9),3.2+i*.85,rnd(-.9,.9)); b.castShadow=true; t.add(b);
    }
    t.position.set(x,0,z); t.rotation.y=rnd(0,6.28); return t;
  },
  // the name painted on the entrance arch: dark letters on the arch's own yellow
  signBack(textTex){
    const c=document.createElement('canvas'); c.width=512; c.height=96;
    const x=c.getContext('2d'); x.fillStyle='#F5D97A'; x.fillRect(0,0,512,96);
    x.drawImage(textTex.image,0,0);
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
  },
  /* The city around the park: blocks of buildings with lit windows, all one InstancedMesh per
     facade style so it costs a handful of draw calls. */
  makeSkyline(hw,hh){
    const g=new THREE.Group();
    const facade=(base,seed)=>{
      const c=document.createElement('canvas'); c.width=128; c.height=256;
      const x=c.getContext('2d'); x.fillStyle=base; x.fillRect(0,0,128,256);
      for(let r=0;r<12;r++) for(let k=0;k<5;k++){
        const on=((seed*7+r*13+k*29)%6)===0;
        x.fillStyle=on?'#ffd58a':'#1b2734'; x.fillRect(8+k*24,8+r*20,16,13);
      }
      const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; return t;
    };
    const styles=[['#4a525e',1],['#6b4a3c',2],['#57606b',3],['#3c4450',4]];
    this.windowMats=[];
    styles.forEach((st,si)=>{
      const mat=new THREE.MeshStandardMaterial({map:facade(st[0],st[1]),roughness:.85,emissive:0xffffff,emissiveIntensity:0});
      mat.emissiveMap=mat.map; this.windowMats.push(mat);
      const n=26, im=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat,n);
      const m=new THREE.Matrix4(), q=new THREE.Quaternion(), s=new THREE.Vector3(), p=new THREE.Vector3();
      for(let i=0;i<n;i++){
        const a=(i+si/styles.length)/n*Math.PI*2+si*.37;
        const R=1+.12*((i*7+si*3)%5)/5;
        const w=10+((i*13+si*5)%4)*4, h=14+((i*17+si*11)%7)*7, d=10+((i*3+si)%3)*3;
        p.set(Math.cos(a)*(hw+44)*R, h/2, Math.sin(a)*(hh+44)*R);
        q.setFromAxisAngle(new THREE.Vector3(0,1,0), -a+Math.PI/2);
        s.set(w,h,d); m.compose(p,q,s); im.setMatrixAt(i,m);
      }
      im.castShadow=false; im.receiveShadow=true; g.add(im);
    });
    // a ring of sidewalk + road around the lot
    const road=new THREE.Mesh(new THREE.RingGeometry(Math.max(hw,hh)+20,Math.max(hw,hh)+34,64),
      new THREE.MeshStandardMaterial({color:0x22262c,roughness:.95}));
    road.rotation.x=-Math.PI/2; road.position.y=.03; road.scale.set(1,hh/hw,1); road.receiveShadow=true; g.add(road);
    return g;
  },
  makeTable(x,z){
    const t=new THREE.Group();
    const M=(c)=>new THREE.MeshStandardMaterial({color:c,roughness:.8});
    const top=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.5,.18,12),M(0x6b5136));
    top.position.y=1.5; top.castShadow=true; t.add(top);
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,1.5,6),M(0x39434f));
    leg.position.y=.75; t.add(leg);
    for(let i=0;i<3;i++){
      const a=(i/3)*6.28;
      const st=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.16,10),M(0x8b6a45));
      st.position.set(Math.cos(a)*2.3,1.0,Math.sin(a)*2.3); st.castShadow=true; t.add(st);
      const sl=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,1,6),M(0x39434f));
      sl.position.set(Math.cos(a)*2.3,.5,Math.sin(a)*2.3); t.add(sl);
    }
    const umb=new THREE.Mesh(new THREE.ConeGeometry(2.6,1.2,10),M(0xE8663C));
    umb.position.y=3.4; umb.castShadow=true; t.add(umb);
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,2,6),M(0xcccccc));
    pole.position.y=2.5; t.add(pole);
    t.position.set(x,0,z); return t;
  },

  /* ---------------- food truck model ---------------- */
  addTruck(truck,spot){
    if(this.dead) return;
    const cu=CUISINES[truck.cuisine];
    // the truck itself (src/truck3d.js); yours is built hollow with the kitchen inside
    const home = truck===Park.homeTruck();
    const G3=HS.Truck3D.build(truck, cu, home, k=>this.makeProp(k));
    // owner marker ring
    const ring=new THREE.Mesh(new THREE.RingGeometry(5.4,6.1,28),
      new THREE.MeshBasicMaterial({color:truck.mine?0x4FD1A5:0x5a6675,transparent:true,opacity:.55,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2; ring.position.y=.09; G3.add(ring);
    truck.ring=ring;

    G3.position.set(spot.x,0,spot.z);
    G3.rotation.y=spot.rot;
    G3.userData.truck=truck;
    truck.mesh=G3;
    // service point in front of the window (local +Z)
    const fwd=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),spot.rot);
    truck.servicePt={x:spot.x+fwd.x*5.4, z:spot.z+fwd.z*5.4, fx:fwd.x, fz:fwd.z};
    this.parkGroup.add(G3); this.truckMeshes.push(G3);
    // steam emitter
    truck.smoke=[];
    if(home){
      // your truck: the stations the Kitchen heats up, and your crew inside
      this.homeMesh=G3;
      this.stationMeshes=G3.userData.k.stations;
      HS.Crew.attach(G3,truck);
      HS.Truck3D.setCutaway(G3,this.mode==='kitchen');
    }
    return G3;
  },
  // The truck you run changed (the trucks panel) without a park rebuild: rebuild the old and the
  // new one, so the kitchen is in the right truck.
  checkHome(){
    const h=Park.homeTruck();
    if(!h || !h.mesh || h.mesh===this.homeMesh) return;
    const old=this.homeMesh && this.homeMesh.userData.truck;
    const redo=t=>{ const s=G.parks[t.park].spots.find(x=>x.id===t.spotId); this.removeTruck(t); if(s && s.truck===t) this.addTruck(t,s); };
    this.homeMesh=null; this.stationMeshes={};
    if(old && old.mesh) redo(old);
    redo(h);
  },
  removeTruck(truck){
    if(!truck.mesh) return;
    if(truck.mesh===this.homeMesh){ HS.Crew.detach(); this.homeMesh=null; this.stationMeshes={}; }
    this.parkGroup.remove(truck.mesh);
    const i=this.truckMeshes.indexOf(truck.mesh); if(i>=0) this.truckMeshes.splice(i,1);
    truck.mesh=null;
  },
  makeProp(kind){
    const g=new THREE.Group();
    const M=(c,r)=>new THREE.MeshStandardMaterial({color:c,roughness:r||.6});
    if(kind==='burger'){
      const bun=new THREE.Mesh(new THREE.SphereGeometry(1.5,14,10,0,6.3,0,1.4),M(0xD9A24B));
      bun.position.set(0,.9,0); g.add(bun);
      const pat=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.5,.5,14),M(0x5b3a22)); pat.position.y=.5; g.add(pat);
      const che=new THREE.Mesh(new THREE.BoxGeometry(2.9,.18,2.9),M(0xF2B53A)); che.position.y=.82; g.add(che);
      const bot=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.4,.55,14),M(0xC8904A)); bot.position.y=.2; g.add(bot);
    } else if(kind==='pizza'){
      const p=new THREE.Mesh(new THREE.CylinderGeometry(2,2,.28,16),M(0xE8C87A)); p.position.y=.4; g.add(p);
      const s=new THREE.Mesh(new THREE.CylinderGeometry(1.7,1.7,.14,16),M(0xC0392B)); s.position.y=.58; g.add(s);
      for(let i=0;i<6;i++){ const a=i/6*6.28;
        const pep=new THREE.Mesh(new THREE.CylinderGeometry(.28,.28,.1,8),M(0x8E2B22));
        pep.position.set(Math.cos(a)*1.0,.68,Math.sin(a)*1.0); g.add(pep); }
    } else {
      const t=new THREE.Mesh(new THREE.CylinderGeometry(1.7,1.7,1.6,14,1,false,0,Math.PI),M(0xEBC479));
      t.rotation.z=Math.PI/2; t.rotation.y=Math.PI/2; t.position.y=1; g.add(t);
      const f=new THREE.Mesh(new THREE.BoxGeometry(1.5,.7,1.2),M(0x3FA06B)); f.position.y=1.1; g.add(f);
    }
    g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
    g.scale.setScalar(.9);
    return g;
  },
  textTexture(txt,color){
    const c=document.createElement('canvas'); c.width=512; c.height=96;
    const x=c.getContext('2d');
    x.clearRect(0,0,512,96);
    x.font='800 54px Archivo, sans-serif'; x.textAlign='center'; x.textBaseline='middle';
    x.fillStyle=color; x.fillText(txt.toUpperCase(),256,52,480);
    const t=new THREE.CanvasTexture(c); t.anisotropy=4; return t;
  },

  /* ---------------- stylized characters ---------------- */
  makePerson(colorTop, colorBottom, skin){
    const g=new THREE.Group();
    const M=(c,r)=>new THREE.MeshStandardMaterial({color:c,roughness:r||.75});
    const torso=new THREE.Mesh(new THREE.CylinderGeometry(.55,.42,1.25,10),M(colorTop));
    torso.position.y=1.5; torso.castShadow=true; g.add(torso);
    const hips=new THREE.Mesh(new THREE.CylinderGeometry(.44,.4,.34,10),M(colorBottom));
    hips.position.y=.85; g.add(hips);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.46,14,12),M(skin,.85));
    head.position.y=2.42; head.scale.set(1,1.06,.95); head.castShadow=true; g.add(head);
    const hair=new THREE.Mesh(new THREE.SphereGeometry(.48,12,10,0,6.3,0,1.25),M(pick([0x2b1d16,0x120e0c,0x6b4527,0xC4913E,0x8a2f2f]),.9));
    hair.position.y=2.5; g.add(hair);
    const eyeM=new THREE.MeshBasicMaterial({color:0x14181d});
    const eL=new THREE.Mesh(new THREE.SphereGeometry(.075,8,6),eyeM); eL.position.set(-.17,2.44,.4); g.add(eL);
    const eR=new THREE.Mesh(new THREE.SphereGeometry(.075,8,6),eyeM); eR.position.set(.17,2.44,.4); g.add(eR);
    const mouth=new THREE.Mesh(new THREE.BoxGeometry(.2,.05,.05),eyeM); mouth.position.set(0,2.22,.44); g.add(mouth);
    const armGeo=new THREE.CylinderGeometry(.15,.13,1.05,7);
    const aL=new THREE.Mesh(armGeo,M(colorTop)); aL.position.set(-.65,1.55,0); aL.castShadow=true; g.add(aL);
    const aR=new THREE.Mesh(armGeo,M(colorTop)); aR.position.set(.65,1.55,0); aR.castShadow=true; g.add(aR);
    const legGeo=new THREE.CylinderGeometry(.19,.16,.95,7);
    const lL=new THREE.Mesh(legGeo,M(colorBottom)); lL.position.set(-.22,.45,0); lL.castShadow=true; g.add(lL);
    const lR=new THREE.Mesh(legGeo,M(colorBottom)); lR.position.set(.22,.45,0); lR.castShadow=true; g.add(lR);
    // Far-off stand-ins only now (anyone near the camera wears a real body), and up to seventy of
    // them: two draw calls each, not twelve. The shirt (torso + arms) keeps its own material so a
    // reused figure can be recoloured; everything else is baked into one vertex-coloured mesh.
    aL.material=aR.material=torso.material;
    const shirt=new THREE.Group(); shirt.add(torso,aL,aR);
    const rest=new THREE.Group(); rest.add(hips,head,hair,eL,eR,mouth,lL,lR);
    HS.mergeStatic(shirt); HS.mergeStatic(rest,{bake:true});
    const out=new THREE.Group(); out.add(shirt,rest);
    out.userData.p={torso:shirt.children[0]};
    out.scale.setScalar(.82);
    return out;
  },
  emojiSprite(){
    const c=document.createElement('canvas'); c.width=c.height=64;
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));
    sp.scale.set(1.3,1.3,1); sp.position.y=3.2; sp.visible=false; sp.renderOrder=4;
    sp.userData.ctx=c.getContext('2d'); sp.userData.tex=t;
    return sp;
  },
  setEmoji(sp,ch,color){
    const x=sp.userData.ctx; x.clearRect(0,0,64,64);
    x.font='46px serif'; x.textAlign='center'; x.textBaseline='middle';
    if(color){ x.fillStyle=color; x.beginPath(); x.arc(32,32,26,0,6.3); x.fill(); }
    x.fillText(ch,32,36); sp.userData.tex.needsUpdate=true; sp.visible=true;
  },

  /* ---------------- customers ---------------- */
  spawnCustomer(){
    if(this.dead) return;
    const pk=PERSONA_KEYS[wpickIdx(PERSONA_KEYS.map(k=>PERSONAS[k].weight))];
    const pr=PERSONAS[pk];
    let mesh=this.pool.pop();
    if(!mesh){
      // a holder: the cheap stand-in figure for when they're far off, and room for a real body
      // (src/people.js, HS.Crowd) when they're near the camera
      mesh=new THREE.Group();
      const proxy=this.makePerson(pr.color, pick([0x232a34,0x39434f,0x4a3524,0x2b3550]), pick([0xF0C89B,0xC98A5E,0x8A5A3B,0xF7D9BB,0xE0B08A]));
      mesh.add(proxy);
      mesh.userData.proxy=proxy; mesh.userData.p=proxy.userData.p;
      mesh.userData.bubble=this.emojiSprite(); mesh.add(mesh.userData.bubble);
      this.parkGroup.add(mesh);
    } else {
      mesh.userData.p.torso.material.color.setHex(pr.color);
      mesh.visible=true;
    }
    const bubble=mesh.userData.bubble;
    bubble.visible=false;
    const c={
      mesh, bubble, persona:pk, pr,
      state:'toCenter', t:0, phase:rnd(0,6.3),
      pos:new THREE.Vector2(this.entrance.x+rnd(-3,3), this.entrance.z+rnd(0,4)),
      goal:null, truck:null, slot:-1,
      patience:1, patienceRate:0, order:null, wait:0, sat:1,
      groupSize: pk==='family'?rint(2,4):1,
      pname:personName().split(' ')[0]+' '+personName().split(' ')[1].charAt(0)+'.',
      regular:false
    };
    // a face you know is more likely to come back than a stranger is to appear
    if(G.regulars.length && Math.random()<0.22) Chat.applyRegular(c);
    mesh.userData.cust=c;
    mesh.position.set(c.pos.x,0,c.pos.y);
    c.goal=this.plazaPoint();
    this.customers.push(c);
    return c;
  },
  plazaPoint(){
    const P=Park.cur();
    const a=rnd(0,6.28), r=rnd(.15,.92);
    return new THREE.Vector2(Math.cos(a)*P.w*0.30*r, Math.sin(a)*P.h*0.30*r);
  },
  clearCustomers(){
    if(this.dead) return;
    for(const c of this.customers){ HS.Crowd.release(c); c.mesh.visible=false; this.pool.push(c.mesh); }
    this.customers.length=0;
    for(let i=0;i<G.parks.length;i++) for(const s of G.parks[i].spots) if(s.truck) s.truck.queue.length=0;
  },
  despawn(c){
    HS.Crowd.release(c);
    c.mesh.visible=false; this.pool.push(c.mesh);
    const i=this.customers.indexOf(c); if(i>=0) this.customers.splice(i,1);
  },

  /** choose a truck: weighted by draw, price fit, reputation, queue length */
  chooseTruck(c){
    const list=Park.trucks();
    if(!list.length) return null;
    const opts=[];
    for(const t of list){
      const spot=Park.cur().spots.find(s=>s.id===t.spotId);
      const cu=CUISINES[t.cuisine];
      const avgP=cu.menu.reduce((a,m)=>a+t.prices[m.id],0)/cu.menu.length;
      const basePrice=cu.menu.reduce((a,m)=>a+m.price,0)/cu.menu.length;
      const priceFit = clamp(1.6 - (avgP/basePrice)*(c.pr.spend<1?1.5:0.7), .12, 1.9);
      const q = t.queue.length;
      const queuePen = 1/(1+q*(c.pr.patience<.7?0.55:0.22));
      let draw = (t.rep/70)*priceFit*queuePen*(0.55+spot.vis*0.65);
      if(t.mine) draw *= 1 + (t.upgrades.social||0)*0.08 + (t.upgrades.influ||0)*0.18 + (t.upgrades.neon||0)*0.06;
      if(t===Park.homeTruck()) draw *= 14.0;      // the truck you personally work pulls the visible crowd
      opts.push({t, w:Math.max(0.02,draw)});
    }
    return wpick(opts).t;
  },

  update(dt){
    if(this.dead) return;
    const P=Park.cur();
    for(let i=this.customers.length-1;i>=0;i--){
      const c=this.customers[i];
      c.t+=dt; c.phase+=dt*7;
      switch(c.state){
        case 'toCenter':
          if(this.step(c,c.goal,dt)){ c.state='deciding'; c.t=0; c.decide=rnd(1.5,5.5); this.setEmoji(c.bubble,'🤔'); }
          break;
        case 'deciding':
          this.idle(c,dt);
          if(c.t>c.decide){
            const t=this.chooseTruck(c);
            if(!t){ c.state='leaving'; c.goal=new THREE.Vector2(this.entrance.x,this.entrance.z); c.bubble.visible=false; break; }
            c.truck=t; t.queue.push(c); c.slot=t.queue.length-1;
            c.state='toTruck'; c.bubble.visible=false;
            c.goal=this.queueSpot(t,c.slot);
          }
          break;
        case 'toTruck':
          c.goal=this.queueSpot(c.truck, c.truck.queue.indexOf(c));
          if(this.step(c,c.goal,dt)) c.state='queue';
          break;
        case 'queue': {
          const idx=c.truck.queue.indexOf(c);
          c.goal=this.queueSpot(c.truck,idx);
          this.step(c,c.goal,dt);
          this.face(c,c.truck.servicePt);
          c.patience -= dt*(0.010/ c.pr.patience)*(1+idx*0.12);
          if(c.patience<=0){ this.walkAway(c); break; }
          if(idx < (c.truck===Park.homeTruck()?6:3) && !c.order) this.placeOrder(c);
          break; }
        case 'waiting': {
          this.step(c,c.goal,dt);
          this.face(c,c.truck.servicePt);
          c.wait+=dt;
          c.patience -= dt*(0.012/ c.pr.patience);
          if(c.patience<0.55 && Math.random()<dt*1.5) this.setEmoji(c.bubble, c.patience<.3?'😠':'😕');
          if(c.patience<=0){ this.walkAway(c); break; }
          break; }
        case 'eating':
          this.idle(c,dt); c.eat-=dt;
          if(c.eat<=0){ c.state='leaving'; c.bubble.visible=false;
            c.goal=new THREE.Vector2(this.entrance.x+rnd(-4,4),this.entrance.z+rnd(2,8)); }
          break;
        case 'leaving':
          if(this.step(c,c.goal,dt)) this.despawn(c);
          break;
      }
      this.animate(c,dt);
    }
    // spin owner rings, drift steam
    const time=performance.now()*0.001;
    for(const m of this.truckMeshes){
      const t=m.userData.truck;
      if(t && t.ring) t.ring.material.opacity = t.mine? .35+Math.sin(time*2)*.18 : .3;
      if(m!==this.homeMesh) HS.Truck3D.updateOther(m,time);
    }
    // real bodies for the people nearest the camera (your own line first)
    const home=Park.homeTruck();
    HS.Crowd.update(dt, this.cam, this.customers, c=>c.truck===home && home);
  },

  /* Every frame, paused or not: the camera, your crew, your kitchen, the lights. */
  frame(dt){
    if(this.dead) return;
    this.checkHome();
    HS.Crew.update(dt, this.mode, this.kCamYaw||0);
    if(this.homeMesh) HS.Truck3D.updateHome(this.homeMesh, dt, Kitchen.stations, Kitchen.tickets);
    this.updateCamera(dt);
    this.watchFps(dt);
  },
  /* If the frame rate sags (6 s under 24 fps), give up a little picture at a time, as Billionaire
     Barber 2 does: a lower pixel ratio, then shadows, then a lower pixel ratio again.
     ?debug=1 shows the numbers. */
  watchFps(dt){
    const q=this.q||(this.q={acc:0,n:0,low:0,level:0,el:null});
    q.acc+=dt; q.n++;
    if(q.acc<2) return;
    const fps=q.n/q.acc; q.acc=0; q.n=0;
    if(/[?&]debug=1/.test(location.search)){
      if(!q.el){ q.el=document.createElement('div'); q.el.style.cssText='position:fixed;left:6px;bottom:6px;z-index:9999;font:11px monospace;color:#9f9;background:#000a;padding:2px 5px'; document.body.appendChild(q.el); }
      const i=this.renderer.info.render;
      q.el.textContent=fps.toFixed(0)+' fps  q'+q.level+'  '+i.triangles+' tris  '+i.calls+' calls';
    }
    if(document.hidden) return;
    q.low = fps<24 ? q.low+1 : 0;
    if(q.low<3 || q.level>=3) return;
    q.low=0; q.level++;
    const r=this.renderer;
    if(q.level===1) r.setPixelRatio(Math.min(r.getPixelRatio(),1)*0.8);
    if(q.level===2){ r.shadowMap.enabled=false; this.scene.traverse(o=>{ if(o.material) [].concat(o.material).forEach(m=>m.needsUpdate=true); }); }
    if(q.level===3) r.setPixelRatio(0.65);
    r.setSize(innerWidth,innerHeight);
  },

  queueSpot(t,idx){
    if(idx<0) idx=0;
    const sp=t.servicePt;
    // stand in a line receding from the window, slight lateral stagger
    const px=-sp.fz, pz=sp.fx;
    const back=idx*2.0, side=(idx%2? .9:-.9)*(idx?1:0);
    return new THREE.Vector2(sp.x+sp.fx*back+px*side, sp.z+sp.fz*back+pz*side);
  },
  step(c,goal,dt){
    const dx=goal.x-c.pos.x, dz=goal.y-c.pos.y;
    const d=Math.hypot(dx,dz);
    if(d<0.35){ c.moving=false; return true; }
    const sp=(c.pr.patience<.7?4.6:3.6)*dt;
    const k=Math.min(1,sp/d);
    c.pos.x+=dx*k; c.pos.y+=dz*k;
    c.mesh.position.set(c.pos.x,0,c.pos.y);
    const ang=Math.atan2(dx,dz);
    c.mesh.rotation.y=lerpAngle(c.mesh.rotation.y,ang,Math.min(1,dt*8));
    c.moving=true;
    return false;
  },
  face(c,pt){
    const ang=Math.atan2(pt.x-c.pos.x, pt.z-c.pos.y);
    c.mesh.rotation.y=lerpAngle(c.mesh.rotation.y,ang,0.1);
  },
  idle(c,dt){
    c.moving=false;
    if(Math.random()<dt*0.35){ c.goal=new THREE.Vector2(c.pos.x+rnd(-2,2), c.pos.y+rnd(-2,2)); }
    if(c.goal) this.step(c,c.goal,dt*0.5);
  },
  animate(c,dt){
    if(c.actor) return;                // a real body: HS.Crowd walks it
    // the far-off stand-in just bobs (its limbs are baked in; at that distance you can't tell)
    if(c.moving) c.mesh.position.y=Math.abs(Math.sin(c.phase))*0.07;
    else c.mesh.position.y=Math.sin(c.phase*0.35)*0.03;
  },

  /* camera */
  updateCamera(dt){
    this.camLook=this.camLook||new THREE.Vector3();
    if(this.mode==='kitchen' && this.homeMesh){
      // the cutaway: from behind your truck's back wall (lifted off), over the line, through the
      // window to your queue. It follows you along the line; drag to swing it, wheel to zoom.
      const g=this.homeMesh, me=HS.Crew.me;
      const lx=me? me.pos.x*0.6 : 0;
      const tgt=g.localToWorld(new THREE.Vector3(lx, 2.3, 0.5));
      const narrow=innerWidth/innerHeight<0.9;
      const yaw=g.rotation.y+Math.PI+(this.kYaw||0), pitch=0.6+(this.kPitch||0), dist=(narrow?12.5:10.5)*(this.kZoom||1);
      this.kCamYaw=yaw;
      const cp=Math.cos(pitch);
      const pos=new THREE.Vector3(tgt.x+Math.sin(yaw)*cp*dist, tgt.y+Math.sin(pitch)*dist, tgt.z+Math.cos(yaw)*cp*dist);
      const k=Math.min(1,dt*5);
      this.cam.position.lerp(pos,k);
      this.camLook.lerp(tgt,k);
      this.cam.lookAt(this.camLook);
    } else {
      const r=this.radius, th=this.theta, ph=clamp(this.phi,0.28,1.35);
      const x=this.target.x+r*Math.sin(ph)*Math.cos(th);
      const y=this.target.y+r*Math.cos(ph);
      const z=this.target.z+r*Math.sin(ph)*Math.sin(th);
      this.cam.position.lerp(new THREE.Vector3(x,y,z),Math.min(1,dt*6));
      this.camLook.lerp(this.target,Math.min(1,dt*6));
      this.cam.lookAt(this.camLook);
    }
    // day/night lighting
    const f=Sim.clockFrac();
    const sun=Math.sin(f*Math.PI);
    this.key.intensity=0.6+sun*2.2;
    this.key.position.set(Math.cos(f*Math.PI)*60, 20+sun*70, 34);
    if(this.hemi) this.hemi.intensity=0.55+sun*1.0;
    const night=1-clamp(sun*2.4,0,1);
    this.scene.background.setHex(0x0d1219).lerp(new THREE.Color(0x7fa6c9),1-night);
    if(this.scene.fog) this.scene.fog.color.copy(this.scene.background);
    // the lamps, lamplight pools and the city's windows come on as it gets dark
    if(this.bulbs) for(const b of this.bulbs) b.material.emissiveIntensity=.3+night*3;
    if(this.pools) for(const p of this.pools) p.material.opacity=night*.22;
    if(this.windowMats) for(const m of this.windowMats) m.emissiveIntensity=night*.9;
  },

  setMode(m){
    // the kitchen is inside your truck now: if you're looking at the other park, go to yours
    const home=Park.homeTruck();
    if(m==='kitchen' && home && home.park!==G.parkIdx){ G.parkIdx=home.park; this.buildPark(); }
    this.mode=m;
    el('kitchen').classList.toggle('open', m==='kitchen');
    document.body.classList.toggle('inkitchen', m==='kitchen');
    el('btnKitchen').textContent = m==='kitchen'?'Back to park':'Enter kitchen';
    if(this.homeMesh) HS.Truck3D.setCutaway(this.homeMesh, m==='kitchen');
    if(m==='kitchen'){ this.kYaw=0; this.kPitch=0; this.kZoom=1; }
  },

  bindInput(){
    const dom=this.renderer.domElement;
    let drag=false,lx=0,ly=0,pinch=0, moved=0;
    const down=e=>{ drag=true; moved=0; const p=e.touches?e.touches[0]:e; lx=p.clientX; ly=p.clientY; };
    const move=e=>{
      const p=e.touches?e.touches[0]:e;
      if(e.touches&&e.touches.length===2){
        const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
        if(pinch) this.radius=clamp(this.radius*(pinch/d),12,180);
        pinch=d; return;
      }
      if(!drag) return;
      const dx=p.clientX-lx, dy=p.clientY-ly; lx=p.clientX; ly=p.clientY;
      moved+=Math.abs(dx)+Math.abs(dy);
      if(Cart.on){ HS.Cart3D.drag(dx,dy); return; }
      if(this.mode==='kitchen'){
        this.kYaw=clamp((this.kYaw||0)-dx*0.005,-1.1,1.1);
        this.kPitch=clamp((this.kPitch||0)+dy*0.003,-0.25,0.55);
        return;
      }
      if(this.mode!=='park') return;
      if(e.shiftKey || (e.buttons===2)){
        const s=this.radius*0.0016;
        const right=new THREE.Vector3().setFromMatrixColumn(this.cam.matrix,0);
        const fwd=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),right);
        this.target.addScaledVector(right,-dx*s).addScaledVector(fwd,-dy*s);
        this.target.x=clamp(this.target.x,-70,70); this.target.z=clamp(this.target.z,-70,70);
      } else {
        this.theta-=dx*0.006; this.phi=clamp(this.phi-dy*0.005,0.28,1.35);
      }
    };
    const up=e=>{
      if(drag && moved<6 && this.mode==='park'){ this.pickAt(e.changedTouches?e.changedTouches[0]:e); }
      drag=false; pinch=0;
    };
    dom.addEventListener('mousedown',down); addEventListener('mousemove',move); addEventListener('mouseup',up);
    dom.addEventListener('touchstart',down,{passive:true}); dom.addEventListener('touchmove',move,{passive:true});
    dom.addEventListener('touchend',up);
    dom.addEventListener('contextmenu',e=>e.preventDefault());
    dom.addEventListener('wheel',e=>{ e.preventDefault();
      if(this.mode==='kitchen'){ this.kZoom=clamp((this.kZoom||1)*(1+Math.sign(e.deltaY)*0.08),0.55,1.7); return; }
      this.radius=clamp(this.radius*(1+Math.sign(e.deltaY)*0.09),12,190); },{passive:false});
    addEventListener('keydown',e=>{
      if(e.key==='Escape'){ UI.closeSheet(); return; }
      // during the cart prologue 1/2/3 are the hands, not the speed control
      if(Cart.on){
        const m=CART_MENU.find(x=>x.key===e.key);
        if(m){ e.preventDefault(); if(!e.repeat) Cart.press(m.id); }   // hold the key to make it
        return;
      }
      if(e.key===' '){ e.preventDefault(); UI.setSpeed(G.speed?0:1); }
      if(e.key==='k'||e.key==='K') UI.toggleKitchen();
      const n=['1','2','3','4'].indexOf(e.key); if(n>=0) UI.setSpeed([0,1,2,4][n]);
    });
    addEventListener('keyup',e=>{ const m=CART_MENU.find(x=>x.key===e.key); if(m) Cart.release(m.id); });
    addEventListener('blur',()=>{ if(Cart.holding) Cart.release(Cart.holding); });
  },
  pickAt(p){
    if(this.dead) return;
    this.mouse.x=(p.clientX/innerWidth)*2-1;
    this.mouse.y=-(p.clientY/innerHeight)*2+1;
    this.ray.setFromCamera(this.mouse,this.cam);
    // people first — they stand in front of the trucks and are the smaller target
    const people=this.customers.map(c=>c.mesh).filter(m=>m.visible);
    const ph=this.ray.intersectObjects(people,true);
    if(ph.length){
      let o=ph[0].object;
      while(o && !o.userData.cust) o=o.parent;
      if(o && o.userData.cust){ Chat.open(o.userData.cust); return; }
    }
    const hits=this.ray.intersectObjects(this.truckMeshes,true);
    if(hits.length){
      let o=hits[0].object;
      while(o && !o.userData.truck) o=o.parent;
      if(o) UI.inspectTruck(o.userData.truck);
    } else UI.closeInspect();
  },

  render(){ if(this.dead) return; this.renderer.render(this.scene,this.cam); }
};

function wpickIdx(weights){
  let t=0; for(const w of weights) t+=w;
  let r=Math.random()*t;
  for(let i=0;i<weights.length;i++){ r-=weights[i]; if(r<=0) return i; }
  return weights.length-1;
}
function lerpAngle(a,b,t){
  let d=((b-a+Math.PI)%(Math.PI*2))-Math.PI;
  if(d<-Math.PI) d+=Math.PI*2;
  return a+d*t;
}

/* ========================= G. ORDERS & KITCHEN ============================ */

World.placeOrder = function(c){
  const t=c.truck, cu=CUISINES[t.cuisine];
  const n=rint(c.pr.items[0], c.pr.items[1]);
  const items=[];
  for(let i=0;i<n;i++){
    const it=wpick(cu.menu.map(m=>({m,w:m.pop*100*(m.price<9?(c.pr.spend<1?1.5:1):(c.pr.spend>1.3?1.4:1))})),'w').m;
    const ex=items.find(o=>o.it.id===it.id);
    if(ex) ex.qty++; else items.push({it, qty:1, status:'wait', left:0, total:0});
  }
  let total=0;
  for(const o of items) total += t.prices[o.it.id]*o.qty;
  total *= Economy.spendMul();
  c.order={items, total, truck:t};
  c.state='waiting'; c.wait=0;
  c.goal=new THREE.Vector2(t.servicePt.x + t.servicePt.fx*1.6, t.servicePt.z + t.servicePt.fz*1.6);
  this.setEmoji(c.bubble,'🧾');

  if(t===Park.homeTruck()){
    Kitchen.addTicket(c);
  } else {
    const speed = t.equip*(1.55+ (t.staffCount||2)*0.22);
    c.autoLeft = items.reduce((a,o)=>a+o.it.cook*o.qty,0)/speed * rnd(.8,1.25);
  }
};

World.walkAway = function(c){
  const t=c.truck;
  if(t){
    const i=t.queue.indexOf(c); if(i>=0) t.queue.splice(i,1);
    t.walkaways++;
    if(t===Park.homeTruck()){
      t.rep=clamp(t.rep-0.2,5,99);
      G.today.satSum+=0.1; G.today.satN++;
      if(t.walkaways%5===0) UI.note('bad','😠 Customer walked out','Wait times are costing you sales.');
      Kitchen.dropTicket(c);
    }
  }
  this.setEmoji(c.bubble,'😠');
  c.state='leaving'; c.truck=null;
  c.goal=new THREE.Vector2(this.entrance.x+rnd(-4,4), this.entrance.z+rnd(2,8));
};

World.serve = function(c, bonus){
  const t=c.truck; if(!t) return;
  const i=t.queue.indexOf(c); if(i>=0) t.queue.splice(i,1);
  const speedScore = clamp(c.patience,0,1);
  const sat = clamp(0.20 + speedScore*0.55 + (t.rep/100)*0.25 + (bonus||0) + rnd(-.05,.05), 0.05, 1);
  c.sat=sat;
  t.satSum+=sat; t.satN++; t.served++;

  if(t===Park.homeTruck()){
    const o=c.order;
    let ingCost=0;
    for(const x of o.items) ingCost += itemCost(x.it)*x.qty;
    const tipRate = (c.pr.tipBase + sat*0.13 + (t.upgrades.paint||0)*0.02) * (sat>0.55?1:0.35);
    const tip = o.total*tipRate;
    t.revToday += o.total + tip; t.costToday += ingCost;
    t.custToday++; t.lifetimeCust++;
    G.today.rev += o.total; G.today.tips += tip; G.today.ing += ingCost;
    G.today.cust++; G.today.orders++;
    G.today.satSum += sat; G.today.satN++;
    for(const x of o.items) G.today.items[x.it.name]=(G.today.items[x.it.name]||0)+x.qty;
    t.rep = clamp(t.rep + (sat-0.55)*0.14, 5, 99);
    UI.floatCash(o.total+tip, sat);
    UI.quickStats();
  }
  this.setEmoji(c.bubble, sat>.8?'😄':(sat>.5?'🙂':'😐'));
  c.state='eating'; c.eat=rnd(5,11);
  c.goal=this.plazaPoint();
  c.order=null; c.truck=null;
};

/* ---- truck art ---------------------------------------------------------------
   There are no photographs any more. The kitchen is the inside of your 3D truck
   (src/truck3d.js, src/crew.js), and the pictures on the cuisine cards are studio
   renders of each cuisine's truck, made once on demand (HS.Truck3D.portrait).
   The old interface stays so the rest of the game is unchanged. */
const ART = {
  shots:{},
  path(cu, shot){
    if(shot!=='truck' || World.dead) return '';
    if(!this.shots[cu]){
      try{ this.shots[cu]=HS.Truck3D.portrait(World.renderer, CUISINES[cu], k=>World.makeProp(k)); }
      catch(e){ console.warn('truck portrait', e); this.shots[cu]=''; }
    }
    return this.shots[cu];
  },
  init(){}, preload(){}, reset(){}, update(){}
};

const Kitchen = {
  tickets:[], stations:{grill:null,fryer:null,prep:null}, auto:true, autoTimer:0, dom:{},
  clear(){ this.tickets.length=0; for(const k in this.stations) this.stations[k]=null; this.render(); },

  speedFor(station){
    const t=Park.homeTruck(); if(!t) return 1;
    let up=1;
    if(station==='grill') up += (t.upgrades.grill2||0)*0.25;
    if(station==='fryer') up += (t.upgrades.fryer2||0)*0.25;
    if(station==='prep')  up += (t.upgrades.prep||0)*0.30;
    const staff=t.staff.length? t.staff.reduce((a,e)=>a+empSkill(e),0)/t.staff.length : 50;
    return up * (1.35 + staff/110) / Economy.cookSlow();
  },

  addTicket(c){
    const t=Park.homeTruck();
    const tk={id:'k'+Math.random().toString(36).slice(2,7), c, items:c.order.items,
              total:c.order.total, ready:false, readyT:0};
    for(const o of tk.items){ o.status='wait'; o.left=o.it.cook*(1+0.55*(o.qty-1)); o.total=o.left; }
    this.tickets.push(tk);
    this.render();
    if(this.tickets.length===1 && World.mode!=='kitchen' && G.tutorialStep<99) UI.nudgeKitchen();
  },
  dropTicket(c){
    const i=this.tickets.findIndex(k=>k.c===c);
    if(i>=0){
      const tk=this.tickets[i];
      for(const k in this.stations) if(this.stations[k] && this.stations[k].tk===tk) this.stations[k]=null;
      this.tickets.splice(i,1); this.render();
    }
  },
  assign(tk,o){
    if(o.status!=='wait') return false;
    let st=o.it.station;
    if(this.stations[st]){                       // improvise on whatever is free
      st=['grill','fryer','prep'].find(k=>!this.stations[k]);
      if(!st) return false;
      o.left*=1.35; o.total*=1.35; o.crossed=true;
    }
    this.stations[st]={tk,o,worker:0,station:st,t0:performance.now()};
    o.status='cook';
    this.render();
    Sfx.play('sizzle');
    return true;
  },
  update(dt){
    // auto-cook by employees
    this.autoTimer-=dt;
    if(this.auto && this.autoTimer<=0){
      const t=Park.homeTruck();
      const rel = t && t.staff.length ? t.staff.reduce((a,e)=>a+e.reliability,0)/t.staff.length : 45;
      this.autoTimer = clamp(1.8 - rel/70, 0.25, 1.8);
      for(const tk of this.tickets){
        for(const o of tk.items){ if(o.status==='wait') this.assign(tk,o); }
      }
    }
    // cook
    let changed=false;
    for(const k in this.stations){
      const s=this.stations[k]; if(!s) continue;
      s.o.left -= dt*this.speedFor(k);
      if(s.o.left<=0){ s.o.status='done'; this.stations[k]=null; changed=true; Sfx.play('ding'); }
      const sm=World.stationMeshes[k];
      if(sm) sm.userData.heat.material.opacity = s? 0.35+Math.sin(performance.now()*0.006)*0.15 : 0;
    }
    for(const k in this.stations) if(!this.stations[k] && World.stationMeshes[k]) World.stationMeshes[k].userData.heat.material.opacity=0;

    // ready tickets auto-serve shortly after
    for(let i=this.tickets.length-1;i>=0;i--){
      const tk=this.tickets[i];
      const allDone=tk.items.every(o=>o.status==='done');
      if(allDone && !tk.ready){ tk.ready=true; tk.readyT=0; changed=true; }
      if(tk.ready){
        tk.readyT+=dt;
        if(tk.readyT>1.2) this.serve(tk,0);
      }
    }
    // auto-cook path for non-player trucks
    for(const c of World.customers){
      if(c.autoLeft!==undefined && c.state==='waiting'){
        c.autoLeft-=dt;
        if(c.autoLeft<=0){ c.autoLeft=undefined; World.serve(c,0); }
      }
    }
    if(changed) this.render();
    ART.update(dt);
    this.tick();
  },
  serve(tk,bonus){
    const i=this.tickets.indexOf(tk); if(i<0) return;
    this.tickets.splice(i,1);
    World.serve(tk.c, bonus||0);
    const node=this.dom[tk.id];
    if(node){ node.classList.add('leaving'); setTimeout(()=>node.remove(),340); delete this.dom[tk.id]; }
    Sfx.play('cash');
    this.render(true);
  },

  /* --- DOM: the order rail --- */
  render(skip){
    const wrap=el('chits');
    if(!skip) wrap.innerHTML='';
    if(!skip) this.dom={};
    if(skip) return;
    for(const tk of this.tickets){
      const d=document.createElement('div'); d.className='chit'+(tk.ready?' done':'');
      const pName=PERSONAS[tk.c.persona].name;
      let h='<div class="top"><span class="who">'+pName+'</span><span class="amt">'+money(tk.total,1)+'</span></div>';
      tk.items.forEach((o,idx)=>{
        const cls=o.status==='cook'?'cooking':(o.status==='done'?'ready':'');
        h+='<div class="it '+cls+'" data-i="'+idx+'"><span class="nm">'+(o.qty>1?o.qty+'× ':'')+o.it.name+'</span><span>'+
           (o.status==='done'?'✓':(o.status==='cook'?'…':'▸'))+'</span></div>';
      });
      h+='<div class="pbar"><i></i></div>';
      if(tk.ready) h+='<button class="serve">HAND IT OVER</button>';
      d.innerHTML=h;
      d.querySelectorAll('.it').forEach(n=>{
        n.onclick=()=>{ const o=tk.items[+n.dataset.i]; if(o.status==='wait') this.assign(tk,o); };
      });
      const sv=d.querySelector('.serve'); if(sv) sv.onclick=()=>this.serve(tk,0.12);
      wrap.appendChild(d);
      this.dom[tk.id]=d;
    }
    this.renderStations();
  },
  tick(){   // per-frame bar updates only
    for(const tk of this.tickets){
      const d=this.dom[tk.id]; if(!d) continue;
      const bar=d.querySelector('.pbar > i');
      if(bar){
        const p=clamp(tk.c.patience,0,1);
        bar.style.width=(p*100)+'%';
        bar.className = p>0.5?'ok':'';
      }
      tk.items.forEach((o,i)=>{
        if(o.status==='cook'){
          const n=d.querySelectorAll('.it')[i];
          if(n){ const p=Math.round((1-o.left/o.total)*100);
            n.style.background='linear-gradient(90deg, rgba(232,102,60,.45) '+p+'%, rgba(0,0,0,.05) '+p+'%)'; }
        }
      });
    }
    // kitchen stat panel
    const t=Park.homeTruck();
    if(t && World.mode==='kitchen'){
      el('kstats').innerHTML =
        '<div class="eyebrow">Live service</div>'+
        '<div class="kv"><span>Revenue today</span><span>'+money(t.revToday)+'</span></div>'+
        '<div class="kv"><span>Customers</span><span>'+t.custToday+'</span></div>'+
        '<div class="kv"><span>In queue</span><span>'+t.queue.length+'</span></div>'+
        '<div class="kv"><span>Walk-outs</span><span>'+t.walkaways+'</span></div>'+
        '<div class="kv"><span>Satisfaction</span><span>'+(t.satN?pct(t.satSum/t.satN):'—')+'</span></div>'+
        '<div class="kv"><span>Reputation</span><span>'+Math.round(t.rep)+'/100</span></div>';
    }
  },
  renderStations(){
    const wrap=el('stations');
    const icons={grill:'🔥',fryer:'🍟',prep:'🔪'};
    const names={grill:'GRILL',fryer:'FRYER',prep:'PREP'};
    const t=Park.homeTruck();
    wrap.innerHTML='';
    for(const k of ['grill','fryer','prep']){
      const s=this.stations[k];
      const d=document.createElement('div');
      d.className='station'+(s?' busy':'');
      d.innerHTML=(t?'<div class="shot" style="background-image:url(\''+ART.path(t.cuisine,k,true)+'\')"></div>':'')+
                  '<div class="ic">'+icons[k]+'</div><div class="nm">'+names[k]+'</div>'+
                  '<div class="job">'+(s? s.o.it.name : '<span style="color:var(--dim)">idle</span>')+'</div>';
      wrap.appendChild(d);
    }
  }
};

/* ========================= AUDIO (synthesised, no assets) ================= */
const Sfx = {
  ctx:null,
  ensure(){ if(!this.ctx){ try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return this.ctx; },
  play(kind){
    if(!G.sound) return;
    const c=this.ensure(); if(!c) return;
    const t=c.currentTime;
    const o=c.createOscillator(), g=c.createGain();
    o.connect(g); g.connect(c.destination);
    if(kind==='ding'){ o.type='sine'; o.frequency.setValueAtTime(880,t); o.frequency.exponentialRampToValueAtTime(1320,t+.08);
      g.gain.setValueAtTime(.06,t); g.gain.exponentialRampToValueAtTime(.001,t+.28); o.start(t); o.stop(t+.3); }
    else if(kind==='cash'){ o.type='triangle'; o.frequency.setValueAtTime(660,t); o.frequency.exponentialRampToValueAtTime(1180,t+.12);
      g.gain.setValueAtTime(.07,t); g.gain.exponentialRampToValueAtTime(.001,t+.34); o.start(t); o.stop(t+.36); }
    else if(kind==='sizzle'){ o.type='sawtooth'; o.frequency.setValueAtTime(160,t);
      g.gain.setValueAtTime(.025,t); g.gain.exponentialRampToValueAtTime(.001,t+.2); o.start(t); o.stop(t+.22); }
    else if(kind==='alert'){ o.type='square'; o.frequency.setValueAtTime(320,t); o.frequency.setValueAtTime(240,t+.12);
      g.gain.setValueAtTime(.05,t); g.gain.exponentialRampToValueAtTime(.001,t+.3); o.start(t); o.stop(t+.32); }
    else if(kind==='win'){ [523,659,784,1046].forEach((f,i)=>{ const oo=c.createOscillator(),gg=c.createGain();
      oo.connect(gg); gg.connect(c.destination); oo.type='triangle'; oo.frequency.value=f;
      gg.gain.setValueAtTime(.0001,t+i*.13); gg.gain.linearRampToValueAtTime(.08,t+i*.13+.02);
      gg.gain.exponentialRampToValueAtTime(.001,t+i*.13+.5); oo.start(t+i*.13); oo.stop(t+i*.13+.55); }); }
  }
};

/* ========================= H. UI ========================================= */

const UI = {
  lastStats:{}, sheetOpen:null,

  init(){
    ART.init();
    // speed buttons
    document.querySelectorAll('.sp').forEach(b=> b.onclick=()=>this.setSpeed(+b.dataset.s));
    // rail
    document.querySelectorAll('.tool[data-panel]').forEach(b=> b.onclick=()=>this.openPanel(b.dataset.panel));
    document.querySelectorAll('.tool[data-open]').forEach(b=> b.onclick=()=>{
      if(b.dataset.open==='phone')    Social.panel();
      if(b.dataset.open==='fairs')    Fairs.panel();
      if(b.dataset.open==='regulars') Chat.panel();
    });
    el('btnKitchen').onclick=()=>this.toggleKitchen();
    el('kexit').onclick=()=>this.toggleKitchen();
    el('btnPark').onclick=()=>this.parkSwitch();
    el('btnSound').onclick=()=>{ G.sound=!G.sound; el('btnSound').textContent=G.sound?'🔊':'🔇'; };
    el('veil').onclick=e=>{ if(e.target===el('veil')) this.closeSheet(); };
    this.buildStats();
  },

  setSpeed(s){
    G.speed=s; G.paused = (s===0);
    document.querySelectorAll('.sp').forEach(b=>b.classList.toggle('on', +b.dataset.s===s));
  },
  toggleKitchen(){
    const home=Park.homeTruck();
    if(!home) return;
    World.setMode(World.mode==='kitchen'?'park':'kitchen');
    if(World.mode==='kitchen'){
      ART.preload(home.cuisine); ART.reset(); ART.update(0);
      Kitchen.render();
    }else ART.reset();
  },
  parkSwitch(){
    if(G.parks.length<2){ this.note('','🗺 One park for now','Buy out Riverside to unlock the second park.'); return; }
    G.parkIdx = 1-G.parkIdx;
    World.buildPark();
    this.note('','🗺 '+Park.cur().name, 'Now viewing this park.');
  },

  /* ---------- top stats ---------- */
  buildStats(){
    const defs=[['Cash','cash'],['Revenue today','rev'],['Expenses today','exp'],['Profit today','profit'],
                ['Net worth','nw'],['Trucks','trucks'],['Park owned','own']];
    el('stats').innerHTML = defs.map(d=>
      '<div class="stat"><div class="eyebrow">'+d[0]+'</div><div class="v" id="st_'+d[1]+'">—</div></div>').join('');
  },
  quickStats(){
    const T=G.today;
    const rev=T.rev+T.tips+T.parkIncome+T.franchise;
    const exp=T.ing+T.labor+T.rent+T.other;
    const set=(id,txt,cls)=>{
      const n=el('st_'+id); if(!n) return;
      if(n.textContent!==txt){ n.textContent=txt; n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); }
      n.className='v '+(cls||'');
    };
    set('cash',money(G.cash));
    set('rev',money(rev),'pos');
    set('exp',exp>0?'-'+money(exp):'—','neg');
    set('profit',(rev-exp>=0?'+':'')+money(rev-exp), rev-exp>=0?'pos':'neg');
    set('nw',money(netWorth()));
    const mine=Park.allMyTrucks().length, tot=G.parks.reduce((a,p)=>a+p.spots.length,0);
    set('trucks',mine+' / '+tot);
    set('own',pct(Park.ownership(G.parkIdx)));
    el('dayNum').textContent=G.day;
    el('clockTime').textContent=Sim.clockText();
    const cd=el('clockDate');
    if(cd){ const s=SEASONS[Cal.season()]; cd.textContent=s.icon+' '+Cal.long(); }
    const arc=el('dayarc'); arc.style.strokeDashoffset = 100.5*(1-Sim.clockFrac());
  },

  /* ---------- notifications ---------- */
  note(kind,title,text){
    const n=document.createElement('div');
    n.className='note '+(kind||'');
    n.innerHTML='<h4>'+title+'</h4><p>'+text+'</p>';
    el('notes').appendChild(n);
    if(kind==='bad') Sfx.play('alert');
    setTimeout(()=>{ n.classList.add('out'); setTimeout(()=>n.remove(),320); }, 6800);
    while(el('notes').children.length>5) el('notes').children[0].remove();
  },
  banner(a,b){
    const n=el('banner');
    n.querySelector('.b1').textContent=a; n.querySelector('.b2').textContent=b||'';
    n.classList.add('show'); Sfx.play('win');
    clearTimeout(this._bt); this._bt=setTimeout(()=>n.classList.remove('show'),2600);
  },
  floatCash(amt,sat){
    const d=document.createElement('div');
    d.textContent='+'+money(amt,1);
    d.style.cssText='position:absolute;left:50%;bottom:130px;transform:translateX(-50%);font-family:var(--mono);'+
      'font-weight:600;font-size:'+(14+Math.min(10,amt/6))+'px;color:'+(sat>.7?'#4FD1A5':'#F5D97A')+
      ';pointer-events:none;text-shadow:0 2px 12px #000;transition:all 1.1s ease-out;opacity:1;z-index:30';
    el('hud').appendChild(d);
    requestAnimationFrame(()=>{ d.style.bottom='210px'; d.style.opacity='0'; });
    setTimeout(()=>d.remove(),1200);
  },
  nudgeKitchen(){
    if(World.mode==='kitchen') return;
    if(this._nudged && G.day<3) return;
    this._nudged=true;
    this.note('money','🧾 Order up','A ticket is on the rail. Enter the kitchen to cook it.');
  },

  /* ---------- modal plumbing ---------- */
  sheet(html){
    el('sheet').innerHTML='<button class="close">×</button>'+html;
    el('sheet').querySelector('.close').onclick=()=>this.closeSheet();
    el('veil').classList.add('open');
    el('sheet').scrollTop=0;
  },
  closeSheet(){ el('veil').classList.remove('open'); this.sheetOpen=null; if(this._resume){ this.setSpeed(this._resume); this._resume=0; } },
  closeInspect(){ el('inspect').classList.remove('open'); },

  /* ---------- inspector ---------- */
  inspectTruck(t){
    const spot=G.parks[t.park].spots.find(s=>s.id===t.spotId);
    const cu=CUISINES[t.cuisine];
    let h='<div class="eyebrow">Space #'+String(t.spotId).padStart(2,'0')+'</div>'+
      '<h4 style="font-size:17px;margin:2px 0 6px">'+t.name+'</h4>'+
      '<div class="row" style="margin-bottom:8px"><span class="tag '+(t.mine?'mine':'')+'">'+(t.mine?'Yours':'Competitor')+'</span>'+
      '<span class="tag hot">'+cu.name+'</span></div>'+
      '<div class="kv"><span>Revenue / day</span><span>'+money(t.revYest||t.revToday)+'</span></div>'+
      '<div class="kv"><span>Profit / day</span><span style="color:'+((t.profitYest||0)>=0?'var(--mint)':'var(--blood)')+'">'+
        money(t.profitYest||0)+'</span></div>'+
      '<div class="kv"><span>Reputation</span><span>'+Math.round(t.rep)+'/100</span></div>'+
      '<div class="kv"><span>Foot traffic</span><span>'+pct(spot.traffic)+'</span></div>'+
      '<div class="kv"><span>Visibility</span><span>'+pct(spot.vis)+'</span></div>'+
      '<div class="kv"><span>Daily rent</span><span>'+money(spot.rent*G.rentMul)+'</span></div>'+
      '<div class="kv"><span>Est. value</span><span>'+money(truckValue(t))+'</span></div>'+
      '<div class="row">';
    if(t.mine){
      h+='<button class="btn" data-a="menu">Menu</button><button class="btn" data-a="up">Upgrade</button>';
      if(t!==Park.homeTruck()) h+='<button class="btn" data-a="home">Operate this</button>';
      h+='<button class="btn danger" data-a="sell">Sell</button>';
    } else {
      h+='<button class="btn primary" data-a="offer">Make an offer</button>';
    }
    h+='</div>';
    const box=el('inspect'); box.innerHTML=h; box.classList.add('open');
    box.querySelectorAll('[data-a]').forEach(b=> b.onclick=()=>{
      const a=b.dataset.a;
      if(a==='offer') this.offerSheet(t);
      if(a==='menu') this.openPanel('menu');
      if(a==='up') this.openPanel('upgrade');
      if(a==='sell') this.sellTruck(t);
      if(a==='home'){ G.homeTruck=t; this.note('good','🚚 Switched trucks','You are now working '+t.name+'.'); this.closeInspect(); }
    });
  },

  /* ---------- acquisitions ---------- */
  offerSheet(t){
    const val=truckValue(t);
    const ask=Math.round(val*rnd(1.05,1.35)/500)*500;
    t._ask=ask;
    this.sheet('<h2>Acquire '+t.name+'</h2>'+
      '<p>'+CUISINES[t.cuisine].name+' truck on space #'+t.spotId+'. The owner will weigh your offer against what the business earns.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">'+
        '<div class="card"><div class="eyebrow">Estimated value</div><h4>'+money(val)+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Owner asking</div><h4>'+money(ask)+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Profit / day</div><h4>'+money(t.profitYest||0)+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Your cash</div><h4>'+money(G.cash)+'</h4></div>'+
      '</div>'+
      '<h3>Your offer</h3>'+
      '<input id="offerAmt" type="range" min="'+Math.round(val*0.6)+'" max="'+Math.round(val*1.7)+'" value="'+ask+'" step="500" style="width:100%">'+
      '<div class="row" style="justify-content:space-between;margin-top:6px">'+
        '<span class="num" id="offerVal" style="font-size:20px">'+money(ask)+'</span>'+
        '<span class="eyebrow" id="offerOdds"></span></div>'+
      '<div class="row"><button class="btn primary" id="doOffer">Send offer</button>'+
      '<button class="btn" id="cancelOffer">Walk away</button></div>');
    const sl=el('offerAmt');
    const upd=()=>{
      const v=+sl.value;
      el('offerVal').textContent=money(v);
      const odds=clamp((v/ask-0.82)/0.45,0,0.97);
      el('offerOdds').textContent='Acceptance chance ≈ '+Math.round(odds*100)+'%';
      el('doOffer').disabled = v>G.cash;
      el('doOffer').textContent = v>G.cash ? 'Not enough cash' : 'Send offer';
    };
    sl.oninput=upd; upd();
    el('cancelOffer').onclick=()=>this.closeSheet();
    el('doOffer').onclick=()=>{
      const v=+sl.value;
      const odds=clamp((v/ask-0.82)/0.45,0,0.97);
      if(Math.random()<odds){
        G.cash-=v; t.mine=true; t.name=t.name;
        t.staff=[makeEmployee(2),makeEmployee(2)];
        if(t.ring) t.ring.material.color.setHex(0x4FD1A5);
        this.closeSheet(); this.closeInspect();
        this.note('money','🤝 Acquisition complete','You bought '+t.name+' for '+money(v)+'.');
        this.banner('ACQUIRED', t.name);
        Sim.checkMilestones(); this.quickStats(); Save.write();
      } else {
        this.note('bad','✋ Offer rejected','They want closer to '+money(ask)+'.');
        this.closeSheet();
      }
    };
  },
  sellTruck(t){
    if(Park.allMyTrucks().length<=1){ this.note('bad','Cannot sell','This is your only truck.'); return; }
    const v=Math.round(truckValue(t)*0.88);
    G.cash+=v;
    const spot=G.parks[t.park].spots.find(s=>s.id===t.spotId);
    t.mine=false; t.staff=[]; t.staffCount=2;
    if(t.ring) t.ring.material.color.setHex(0x5a6675);
    if(G.homeTruck===t) G.homeTruck=Park.allMyTrucks()[0];
    this.note('money','💸 Truck sold','Received '+money(v)+'.');
    this.closeInspect(); this.quickStats();
  },

  /* ---------- decisions ---------- */
  offerDecision(ev){
    const t=Park.homeTruck(); if(!t) return;
    const key=Object.keys(ev.eff.commodity)[0];
    const affected=CUISINES[t.cuisine].menu.filter(m=>m.rec[key]);
    if(!affected.length) return;
    this._resume=G.speed; this.setSpeed(0);
    const opts=[
      {k:'raise', t:'Raise prices 12%', d:'Protects margin. Some price-sensitive customers will go elsewhere.'},
      {k:'absorb',t:'Absorb the cost', d:'Keep prices. Volume holds, margin shrinks until prices settle.'},
      {k:'portion',t:'Trim portion sizes',d:'Cuts ingredient use 12%. Satisfaction takes a small hit.'},
      {k:'swap', t:'Push the other menu items', d:'De-emphasise the affected dish. Popularity shifts.'}
    ];
    this.sheet('<h2>'+ev.title+'</h2><p>'+ev.text+' Affected: <b>'+COMMODITIES[key].name+
      '</b>, now '+money(Market.price[key],1)+'/'+COMMODITIES[key].unit+'.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'+
      opts.map(o=>'<div class="card pick" data-k="'+o.k+'"><h4>'+o.t+'</h4><p>'+o.d+'</p></div>').join('')+'</div>');
    el('sheet').querySelectorAll('[data-k]').forEach(n=> n.onclick=()=>{
      const k=n.dataset.k;
      if(k==='raise'){ for(const m of affected) t.prices[m.id]*=1.12; this.note('','Prices raised','Affected items +12%.'); }
      if(k==='absorb'){ this.note('','Holding prices','Margins will be thinner this week.'); }
      if(k==='portion'){ for(const m of affected) m.rec[key]*=0.88; t.rep=clamp(t.rep-2,5,99);
        this.note('','Portions trimmed','Ingredient use down, reputation -2.'); }
      if(k==='swap'){ for(const m of affected) m.pop=clamp(m.pop-0.12,.2,1);
        for(const m of CUISINES[t.cuisine].menu) if(!m.rec[key]) m.pop=clamp(m.pop+0.08,.2,1);
        this.note('','Menu focus shifted','Customers steered to other dishes.'); }
      this.closeSheet();
    });
  },

  /* ---------- end of day ---------- */
  endOfDay(rec){
    const T=G.today, t=Park.homeTruck();
    this._resume = G.speed || 1; this.setSpeed(0);
    const items=Object.entries(T.items).sort((a,b)=>b[1]-a[1]);
    const best=items[0], worst=items[items.length-1];
    const line=(l,v,cls)=>'<div class="kv"><span>'+l+'</span><span'+(cls?' style="color:'+cls+'"':'')+'>'+v+'</span></div>';
    let advice=[];
    if(t){
      if(t.walkaways>t.served*0.12) advice.push('Walk-outs are high — add a station upgrade or better staff.');
      const m=CUISINES[t.cuisine].menu.map(m=>({m,mg:itemMargin(t,m)})).sort((a,b)=>a.mg-b.mg)[0];
      if(m && m.mg<0.28) advice.push(m.m.name+' margin is only '+pct(m.mg)+'. Reprice it or cut it.');
      if(t.rep<50) advice.push('Reputation is dragging demand. Speed and quality lift it fastest.');
    }
    if(rec.profit<0) advice.push('You lost money today. Revenue is not profit — check the expense split.');
    if(!advice.length) advice.push('Solid day. Reinvest into a station upgrade or a second location.');

    this.sheet('<div class="eyebrow">End of day</div><h2>Day '+rec.day+' complete</h2>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">'+
        '<div class="card"><div class="eyebrow">Net profit</div><h4 style="font-size:22px;color:'+
          (rec.profit>=0?'var(--mint)':'var(--blood)')+'">'+(rec.profit>=0?'+':'')+money(rec.profit)+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Revenue</div><h4 style="font-size:22px">'+money(rec.rev)+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Margin</div><h4 style="font-size:22px">'+
          (rec.rev>0?pct(rec.profit/rec.rev):'—')+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Net worth</div><h4 style="font-size:22px">'+money(rec.nw)+'</h4></div>'+
      '</div>'+
      '<div class="grid" style="grid-template-columns:1fr 1fr">'+
        '<div class="card"><div class="eyebrow">Income</div>'+
          line('Food sales',money(T.rev))+line('Tips',money(T.tips))+
          (T.parkIncome?line('Park rents',money(T.parkIncome)):'')+
          (T.franchise?line('Franchise income',money(T.franchise)):'')+
          line('Customers served',T.cust)+
          line('Satisfaction', T.satN?pct(T.satSum/T.satN):'—')+
        '</div>'+
        '<div class="card"><div class="eyebrow">Costs</div>'+
          line('Ingredients','-'+money(T.ing))+line('Labour','-'+money(T.labor))+
          line('Rent','-'+money(T.rent))+line('Fuel &amp; other','-'+money(T.other))+
          (best?line('Best seller',best[0]+' ×'+best[1]):'')+
          (worst&&items.length>1?line('Slowest',worst[0]+' ×'+worst[1]):'')+
        '</div>'+
      '</div>'+
      '<h3>Net worth</h3><canvas class="chart" id="eodChart"></canvas>'+
      '<h3>What to do next</h3><p>'+advice.join('<br>')+'</p>'+
      '<button class="btn primary" id="nextDay" style="width:100%;padding:14px;font-size:14px">Continue to day '+(rec.day+1)+'</button>');
    drawChart(el('eodChart'), G.history.map(h=>h.nw), '#F5D97A');
    el('nextDay').onclick=()=>this.closeSheet();
  },

  win(){
    G.won=true;
    this.setSpeed(0);
    this.banner('BILLIONAIRE','you built the empire');
    this.sheet('<div class="eyebrow">Final</div><h2>Billionaire Food Truck Owner</h2>'+
      '<p>Two parks. One empire. You started with a single truck and a grill.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">'+
        '<div class="card"><div class="eyebrow">Net worth</div><h4 style="font-size:22px">'+money(netWorth())+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Days traded</div><h4 style="font-size:22px">'+G.day+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Customers served</div><h4 style="font-size:22px">'+G.totalCustomers.toLocaleString()+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Lifetime revenue</div><h4 style="font-size:22px">'+money(G.totalRevenue)+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Trucks owned</div><h4 style="font-size:22px">'+Park.allMyTrucks().length+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Parks owned</div><h4 style="font-size:22px">2</h4></div>'+
      '</div>'+
      '<canvas class="chart" id="winChart" style="height:200px"></canvas>'+
      '<button class="btn primary" id="keepGoing" style="width:100%;padding:14px">Keep playing</button>');
    drawChart(el('winChart'), G.history.map(h=>h.nw), '#4FD1A5');
    el('keepGoing').onclick=()=>{ this.closeSheet(); this.setSpeed(1); };
    Fireworks.burst();
  }
};

/* small line chart */
function drawChart(cv, series, color){
  if(!cv) return;
  const dpr=Math.min(devicePixelRatio,2);
  const w=cv.clientWidth||600, h=cv.clientHeight||150;
  cv.width=w*dpr; cv.height=h*dpr;
  const x=cv.getContext('2d'); x.scale(dpr,dpr);
  x.clearRect(0,0,w,h);
  if(series.length<2){ x.fillStyle='#8A93A3'; x.font='12px IBM Plex Mono'; x.fillText('Not enough history yet',12,h/2); return; }
  const min=Math.min(...series), max=Math.max(...series), rng=(max-min)||1;
  const px=i=> 8+(i/(series.length-1))*(w-16);
  const py=v=> h-10-((v-min)/rng)*(h-24);
  x.strokeStyle='rgba(255,255,255,.07)'; x.lineWidth=1;
  for(let i=0;i<4;i++){ const y=10+i*(h-24)/3; x.beginPath(); x.moveTo(8,y); x.lineTo(w-8,y); x.stroke(); }
  const grad=x.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,color+'55'); grad.addColorStop(1,color+'00');
  x.beginPath(); x.moveTo(px(0),py(series[0]));
  series.forEach((v,i)=>x.lineTo(px(i),py(v)));
  x.lineTo(px(series.length-1),h); x.lineTo(px(0),h); x.closePath();
  x.fillStyle=grad; x.fill();
  x.beginPath(); x.moveTo(px(0),py(series[0]));
  series.forEach((v,i)=>x.lineTo(px(i),py(v)));
  x.strokeStyle=color; x.lineWidth=2; x.lineJoin='round'; x.stroke();
  x.fillStyle='#8A93A3'; x.font='10px IBM Plex Mono';
  x.fillText(money(max),10,14); x.fillText(money(min),10,h-4);
}

/* confetti-ish celebration in DOM (cheap, no scene cost) */
const Fireworks={
  burst(){
    for(let i=0;i<70;i++){
      const d=document.createElement('div');
      const c=pick(['#F5D97A','#E8663C','#4FD1A5','#ffffff','#7A5CC4']);
      d.style.cssText='position:absolute;left:50%;top:55%;width:8px;height:12px;background:'+c+
        ';z-index:70;pointer-events:none;border-radius:2px;transition:transform 1.8s cubic-bezier(.1,.7,.3,1),opacity 1.8s';
      el('hud').appendChild(d);
      requestAnimationFrame(()=>{
        d.style.transform='translate('+rnd(-500,500)+'px,'+rnd(-420,320)+'px) rotate('+rnd(0,720)+'deg)';
        d.style.opacity='0';
      });
      setTimeout(()=>d.remove(),2000);
    }
  }
};

/* ========================= PANELS ======================================== */

UI.openPanel = function(name){
  const t = Park.homeTruck();
  const KV=(l,v,c)=>'<div class="kv"><span>'+l+'</span><span'+(c?' style="color:'+c+'"':'')+'>'+v+'</span></div>';

  if(name==='finance'){
    const T=G.today, rev=T.rev+T.tips+T.parkIncome+T.franchise;
    const exp=T.ing+T.labor+T.rent+T.other+T.debtPay;
    const hist=G.history;
    const wk=hist.slice(-7), mo=hist.slice(-30);
    const sum=(a,k)=>a.reduce((s,h)=>s+h[k],0);
    this.sheet('<div class="eyebrow">Books</div><h2>Finances</h2>'+
      '<div class="grid" style="grid-template-columns:1fr 1fr">'+
      '<div class="card"><div class="eyebrow">Today so far</div>'+
        KV('Food sales',money(T.rev))+KV('Tips',money(T.tips))+
        KV('Park rents',money(T.parkIncome))+KV('Franchise',money(T.franchise))+
        KV('Ingredients','-'+money(T.ing))+KV('Labour','-'+money(T.labor))+
        KV('Rent','-'+money(T.rent))+KV('Other','-'+money(T.other))+
        KV('Interest','-'+money(T.debtPay))+
        KV('Running profit',(rev-exp>=0?'+':'')+money(rev-exp), rev-exp>=0?'var(--mint)':'var(--blood)')+
      '</div>'+
      '<div class="card"><div class="eyebrow">Balance sheet</div>'+
        KV('Cash',money(G.cash))+
        KV('Truck &amp; property assets',money(netWorth()-G.cash+G.debt))+
        KV('Debt','-'+money(G.debt))+
        KV('Net worth',money(netWorth()),'var(--chit)')+
        KV('Lifetime revenue',money(G.totalRevenue))+
        KV('Lifetime profit',money(G.totalProfit))+
        KV('Customers served',G.totalCustomers.toLocaleString())+
      '</div></div>'+
      '<h3>Net worth over time</h3><canvas class="chart" id="fc1"></canvas>'+
      '<h3>Daily profit</h3><canvas class="chart" id="fc2"></canvas>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">'+
        '<div class="card"><div class="eyebrow">7-day revenue</div><h4>'+money(sum(wk,'rev'))+'</h4></div>'+
        '<div class="card"><div class="eyebrow">7-day profit</div><h4>'+money(sum(wk,'profit'))+'</h4></div>'+
        '<div class="card"><div class="eyebrow">30-day profit</div><h4>'+money(sum(mo,'profit'))+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Avg order value</div><h4>'+
          money(T.orders? T.rev/T.orders : 0,1)+'</h4></div>'+
      '</div>'+
      '<h3>Credit</h3><p>Borrow against your assets at 0.15% daily interest. Debt subtracts from net worth.</p>'+
      '<div class="row"><button class="btn" id="borrow">Borrow '+money(Math.max(25000,Math.round(netWorth()*0.25)))+'</button>'+
      '<button class="btn" id="repay">Repay '+money(Math.min(G.debt,G.cash))+'</button></div>');
    drawChart(el('fc1'), hist.map(h=>h.nw), '#F5D97A');
    drawChart(el('fc2'), hist.map(h=>h.profit), '#4FD1A5');
    el('borrow').onclick=()=>{ const amt=Math.max(25000,Math.round(netWorth()*0.25));
      G.debt+=amt; G.cash+=amt; this.note('money','🏦 Loan approved',money(amt)+' added to cash.'); this.openPanel('finance'); };
    el('repay').onclick=()=>{ const amt=Math.min(G.debt,G.cash); if(amt<=0) return;
      G.debt-=amt; G.cash-=amt; this.note('','🏦 Debt repaid',money(amt)+' paid down.'); this.openPanel('finance'); };
  }

  else if(name==='market'){
    let rows='';
    for(const k in COMMODITIES){
      const c=COMMODITIES[k], ch=Market.change(k);
      const col = ch>0.06?'var(--blood)':(ch<-0.06?'var(--mint)':'var(--dim)');
      rows+='<div class="card" style="padding:11px"><div class="row" style="justify-content:space-between;align-items:center">'+
        '<div><h4>'+c.name+'</h4><span class="eyebrow">normal '+money(c.base,1)+' / '+c.unit+'</span></div>'+
        '<div style="text-align:right"><div class="num" style="font-size:16px">'+money(Market.price[k],2)+'</div>'+
        '<div class="num" style="font-size:11px;color:'+col+'">'+(ch>=0?'+':'')+(ch*100).toFixed(1)+'%</div></div></div>'+
        '<div class="bar"><i style="width:'+clamp((Market.price[k]/(c.base*2))*100,4,100)+'%;background:'+col+'"></i></div></div>';
    }
    let mrows='';
    if(t){ for(const m of CUISINES[t.cuisine].menu){
      const cost=itemCost(m), mg=(t.prices[m.id]-cost)/t.prices[m.id];
      mrows+=KV(m.name, money(t.prices[m.id],2)+'  −  '+money(cost,2)+'  =  '+money(t.prices[m.id]-cost,2)+' ('+pct(mg)+')',
        mg<0.25?'var(--blood)':(mg>0.5?'var(--mint)':''));
    } }
    this.sheet('<div class="eyebrow">Wholesale</div><h2>Commodity market</h2>'+
      '<p>Prices move daily with supply, season and shocks. Your ingredient cost is calculated from these live prices.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'+rows+'</div>'+
      (t?'<h3>Margin by item — '+CUISINES[t.cuisine].name+'</h3><div class="card">'+mrows+'</div>':'')+
      (G.events.length?'<h3>Active conditions</h3>'+G.events.map(e=>
        '<div class="card"><h4>'+e.title+'</h4><p>'+e.text+' · '+e.left+' day'+(e.left>1?'s':'')+' left</p></div>').join(''):''));
  }

  else if(name==='trucks'){
    const mine=Park.allMyTrucks();
    let cards=mine.map(tr=>{
      const sp=G.parks[tr.park].spots.find(s=>s.id===tr.spotId);
      return '<div class="card"><div class="row" style="justify-content:space-between"><h4>'+tr.name+'</h4>'+
        (tr===t?'<span class="tag mine">Operating</span>':'')+'</div>'+
        '<span class="eyebrow">'+CUISINES[tr.cuisine].name+' · '+G.parks[tr.park].name+' · space #'+tr.spotId+'</span>'+
        KV('Revenue / day',money(tr.revYest||tr.revToday))+
        KV('Profit / day',money(tr.profitYest||0),(tr.profitYest||0)>=0?'var(--mint)':'var(--blood)')+
        KV('Reputation',Math.round(tr.rep)+'/100')+KV('Value',money(truckValue(tr)))+
        (tr!==t?'<button class="btn" data-op="'+tr.id+'">Operate this truck</button>':'')+'</div>';
    }).join('');
    // vacant spaces to buy
    const P=Park.cur();
    const vac=P.spots.filter(s=>!s.truck);
    let vcards=vac.map(s=>'<div class="card"><h4>Space #'+String(s.id).padStart(2,'0')+'</h4>'+
      '<span class="eyebrow">'+(s.quality>.72?'Premium':(s.quality>.5?'Solid':'Budget'))+' location</span>'+
      KV('Purchase',money(s.price))+KV('Daily rent',money(s.rent*G.rentMul))+
      KV('Foot traffic',pct(s.traffic))+KV('Visibility',pct(s.vis))+
      KV('Truck build','+'+money(38000))+
      '<button class="btn primary" data-buy="'+s.id+'" '+((G.cash<s.price+38000)?'disabled':'')+'>Buy &amp; open '+money(s.price+38000)+'</button></div>').join('');
    this.sheet('<div class="eyebrow">Empire</div><h2>My trucks</h2>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">'+cards+'</div>'+
      (vac.length?'<h3>Vacant spaces in '+P.name+'</h3>'+
        '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">'+vcards+'</div>':''));
    el('sheet').querySelectorAll('[data-op]').forEach(b=>b.onclick=()=>{
      G.homeTruck=mine.find(x=>x.id===b.dataset.op);
      if(G.homeTruck.park!==G.parkIdx){ G.parkIdx=G.homeTruck.park; World.buildPark(); }
      this.note('good','🚚 Now operating',G.homeTruck.name); this.closeSheet();
    });
    el('sheet').querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{
      const s=P.spots.find(x=>x.id===+b.dataset.buy);
      const cost=s.price+38000;
      if(G.cash<cost) return;
      G.cash-=cost;
      this.pickCuisineFor(s);
    });
  }

  else if(name==='staff'){
    if(!t) return;
    let rows=t.staff.map((e,i)=>'<div class="card"><h4>'+e.name+'</h4>'+
      '<span class="eyebrow">'+money(e.salary)+' / day</span>'+
      KV('Cooking',e.cooking)+KV('Speed',e.speed)+KV('Customer service',e.service)+
      KV('Reliability',e.reliability)+KV('Fatigue',pct(e.fatigue))+
      '<div class="row"><button class="btn danger" data-fire="'+i+'">Let go</button>'+
      '<button class="btn" data-raise="'+i+'">Raise (+15% pay, −fatigue)</button></div></div>').join('');
    const cands=G.candidates||(G.candidates=[makeEmployee(rint(1,3)),makeEmployee(rint(1,3)),makeEmployee(rint(2,4))]);
    let hire=cands.map((e,i)=>'<div class="card"><h4>'+e.name+'</h4>'+
      '<span class="eyebrow">asks '+money(e.salary)+' / day</span>'+
      KV('Cooking',e.cooking)+KV('Speed',e.speed)+KV('Service',e.service)+KV('Reliability',e.reliability)+
      '<button class="btn primary" data-hire="'+i+'" '+(t.staff.length>=4?'disabled':'')+'>Hire</button></div>').join('');
    this.sheet('<div class="eyebrow">Crew</div><h2>Staff — '+t.name+'</h2>'+
      '<p>You cook alongside two employees. Skill and reliability decide how fast tickets clear when you are not clicking.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">'+rows+'</div>'+
      '<h3>Available to hire</h3><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">'+hire+'</div>');
    el('sheet').querySelectorAll('[data-fire]').forEach(b=>b.onclick=()=>{
      if(t.staff.length<=1){ this.note('bad','Cannot fire','You need at least one employee.'); return; }
      t.staff.splice(+b.dataset.fire,1); this.openPanel('staff'); });
    el('sheet').querySelectorAll('[data-raise]').forEach(b=>b.onclick=()=>{
      const e=t.staff[+b.dataset.raise]; e.salary=Math.round(e.salary*1.15); e.fatigue=clamp(e.fatigue-0.3,0,1);
      e.reliability=clamp(e.reliability+3,0,99); this.openPanel('staff'); });
    el('sheet').querySelectorAll('[data-hire]').forEach(b=>b.onclick=()=>{
      const e=cands.splice(+b.dataset.hire,1)[0];
      t.staff.push(e); cands.push(makeEmployee(rint(1,4)));
      this.note('good','👥 Hired',e.name+' joins the crew.'); this.openPanel('staff'); });
  }

  else if(name==='upgrade'){
    if(!t) return;
    const cats={};
    for(const u of UPGRADES){ (cats[u.cat]=cats[u.cat]||[]).push(u); }
    let html='';
    for(const c in cats){
      html+='<h3>'+c+'</h3><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">';
      for(const u of cats[c]){
        const lv=t.upgrades[u.id]||0;
        const cost=Math.round(u.cost*Math.pow(1.7,lv));
        html+='<div class="card"><div class="row" style="justify-content:space-between"><h4>'+u.name+'</h4>'+
          '<span class="tag">'+lv+' / '+u.max+'</span></div><p>'+u.desc+'</p>'+
          (lv>=u.max? '<button class="btn" disabled>Maxed</button>'
            : '<button class="btn primary" data-up="'+u.id+'" '+(G.cash<cost?'disabled':'')+'>Buy '+money(cost)+'</button>')+
          '</div>';
      }
      html+='</div>';
    }
    this.sheet('<div class="eyebrow">Investment</div><h2>Upgrades — '+t.name+'</h2>'+
      '<p>Every upgrade shows up in the day: faster tickets, more customers, better tips.</p>'+html);
    el('sheet').querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{
      const u=UPGRADES.find(x=>x.id===b.dataset.up);
      const lv=t.upgrades[u.id]||0, cost=Math.round(u.cost*Math.pow(1.7,lv));
      if(G.cash<cost) return;
      G.cash-=cost; t.upgrades[u.id]=lv+1; t.equip=clamp(t.equip+0.05,0.5,2.2);
      if(u.eff==='staff') t.staff.forEach(e=>{ e.cooking=clamp(e.cooking+6,0,99); e.speed=clamp(e.speed+6,0,99);
        if(u.id==='bonus') e.salary=Math.round(e.salary*1.12); });
      if(u.id==='influ') t.rep=clamp(t.rep+4,5,99);
      if(u.id==='neon'&&t.mesh) t.mesh.children.forEach(m=>{ if(m.material&&m.material.color&&m.geometry&&m.geometry.type==='SphereGeometry') m.material.color.setHex(0xffe0a0); });
      this.note('money','🔧 Upgrade installed',u.name+' — '+u.desc);
      this.openPanel('upgrade'); this.quickStats(); Save.write();
    });
  }

  else if(name==='menu'){
    if(!t) return;
    const cu=CUISINES[t.cuisine];
    let rows=cu.menu.map(m=>{
      const cost=itemCost(m), price=t.prices[m.id], mg=(price-cost)/price;
      return '<div class="card"><div class="row" style="justify-content:space-between"><h4>'+m.name+'</h4>'+
        '<span class="tag hot">'+m.station+'</span></div>'+
        KV('Selling price',money(price,2))+KV('Ingredient cost',money(cost,2))+
        KV('Gross profit',money(price-cost,2),mg<0.25?'var(--blood)':'var(--mint)')+
        KV('Margin',pct(mg))+KV('Cook time',m.cook+'s')+KV('Popularity',pct(m.pop))+
        '<input type="range" min="'+(m.price*0.55).toFixed(2)+'" max="'+(m.price*1.9).toFixed(2)+
          '" step="0.25" value="'+price.toFixed(2)+'" data-price="'+m.id+'" style="width:100%;margin-top:8px">'+
        '<div class="eyebrow" style="margin-top:4px">Drag to reprice · higher price, fewer customers</div></div>';
    }).join('');
    this.sheet('<div class="eyebrow">Pricing</div><h2>Menu — '+cu.name+'</h2>'+
      '<p>Ingredient costs update with the commodity market. Price above the crowd and volume drops; price below and margin disappears.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">'+rows+'</div>');
    el('sheet').querySelectorAll('[data-price]').forEach(s=>{
      s.oninput=()=>{ t.prices[s.dataset.price]=+s.value;
        const card=s.closest('.card'); const m=cu.menu.find(x=>x.id===s.dataset.price);
        const cost=itemCost(m), mg=(+s.value-cost)/+s.value;
        card.querySelectorAll('.kv span:last-child')[0].textContent=money(+s.value,2);
        card.querySelectorAll('.kv span:last-child')[2].textContent=money(+s.value-cost,2);
        card.querySelectorAll('.kv span:last-child')[3].textContent=pct(mg);
      };
    });
  }

  else if(name==='park'){
    el('rail').querySelector('[data-panel="park"]').classList.remove('alert');
    const P=Park.cur(), own=Park.ownership(G.parkIdx);
    const price=parkBuyPrice(G.parkIdx);
    const mine=P.spots.filter(s=>s.truck&&s.truck.mine).length;
    let list=P.spots.map(s=>{
      const o=s.truck? (s.truck.mine?'You':s.truck.name) : 'Vacant';
      return '<div class="kv"><span>#'+String(s.id).padStart(2,'0')+' · '+
        (s.quality>.72?'Premium':(s.quality>.5?'Solid':'Budget'))+'</span><span style="color:'+
        (s.truck&&s.truck.mine?'var(--mint)':'')+'">'+o+'</span></div>';
    }).join('');
    this.sheet('<div class="eyebrow">Control</div><h2>'+P.name+'</h2>'+
      '<div class="card"><div class="row" style="justify-content:space-between"><h4>Ownership</h4>'+
      '<span class="num">'+pct(own)+' · '+mine+' of '+P.spots.length+' spaces</span></div>'+
      '<div class="bar" style="height:12px"><i style="width:'+(own*100)+'%"></i></div>'+
      '<p style="margin-top:8px">Control of half the spaces gives you the right to buy out the park itself.</p></div>'+
      (P.owned
        ? '<div class="card"><h4>You own this park</h4><p>Every competitor now pays you rent, credited daily.</p></div>'
        : (own>=CFG.PARK_CONTROL
          ? '<div class="card"><h4>Park acquisition available</h4><p>Buy the remaining ownership interest and every space becomes yours.</p>'+
            KV('Buyout price',money(price))+KV('Your cash',money(G.cash))+
            '<button class="btn primary" id="buyPark" '+(G.cash<price?'disabled':'')+'>'+
            (G.cash<price?'Not enough cash':'Buy the park for '+money(price))+'</button></div>'
          : '<div class="card"><h4>Locked</h4><p>Own '+pct(CFG.PARK_CONTROL)+' of the spaces to unlock the buyout. You are at '+pct(own)+'.</p></div>'))+
      '<h3>Spaces</h3><div class="card">'+list+'</div>');
    const bp=el('buyPark');
    if(bp) bp.onclick=()=>{
      if(G.cash<price) return;
      G.cash-=price; P.owned=true;
      for(const s of P.spots) if(s.truck && !s.truck.mine){ /* keep as tenants paying rent */ }
      this.banner('PARK ACQUIRED',P.name);
      this.note('money','🏙 Park acquired','You own '+P.name+'. Tenants now pay you rent.');
      if(G.parks.length<2) this.unlockPark2();
      this.closeSheet(); this.quickStats(); Save.write(); Fireworks.burst();
    };
  }

  else if(name==='empire'){
    const cost=Math.round(1.6e6*Math.pow(1.26,G.franchises));
    const income=Math.round(cost*0.016);
    this.sheet('<div class="eyebrow">Beyond the park</div><h2>Expansion</h2>'+
      '<p>Once a park is yours, the business scales past the fence: licensed trucks in other cities, each returning cash every day.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">'+
        '<div class="card"><div class="eyebrow">Franchise units</div><h4 style="font-size:22px">'+G.franchises+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Franchise income</div><h4 style="font-size:22px">'+money(G.franchiseIncome)+' / day</h4></div>'+
        '<div class="card"><div class="eyebrow">Net worth</div><h4 style="font-size:22px">'+money(netWorth())+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Goal</div><h4 style="font-size:22px">'+money(CFG.WIN_NET_WORTH)+'</h4></div>'+
      '</div>'+
      (G.parks[0].owned
        ? '<div class="card"><h4>Open franchise unit #'+(G.franchises+1)+'</h4>'+
          '<p>Adds '+money(income)+' a day and roughly '+money(cost*1.15)+' of enterprise value.</p>'+
          '<button class="btn primary" id="buyFr" '+(G.cash<cost?'disabled':'')+'>'+
          (G.cash<cost?'Need '+money(cost):'Open for '+money(cost))+'</button></div>'
        : '<div class="card"><h4>Locked</h4><p>Own a whole park first. Franchising needs a proven operation behind it.</p></div>')+
      (G.parks.length>1
        ? '<div class="card"><h4>'+G.parks[1].name+'</h4><p>Second park unlocked. Buy spaces and trucks there, then take it whole.</p>'+
          KV('Your ownership',pct(Park.ownership(1)))+
          '<button class="btn" id="goPark2">View '+G.parks[1].name+'</button></div>'
        : ''));
    const bf=el('buyFr');
    if(bf) bf.onclick=()=>{ if(G.cash<cost) return;
      G.cash-=cost; G.franchises++; G.franchiseIncome+=income; G.franchiseValue=(G.franchiseValue||0)+cost*1.15;
      this.note('money','🌎 Franchise opened','Unit #'+G.franchises+' returns '+money(income)+' a day.');
      this.openPanel('empire'); this.quickStats(); Save.write(); };
    const gp=el('goPark2');
    if(gp) gp.onclick=()=>{ G.parkIdx=1; World.buildPark(); this.closeSheet(); this.note('','🗺 '+G.parks[1].name,'Now viewing this park.'); };
  }

  else if(name==='settings'){
    this.sheet('<div class="eyebrow">System</div><h2>Save &amp; settings</h2>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'+
        '<div class="card"><h4>Save game</h4><p>Progress is stored in this browser and saved automatically at the end of each day.</p>'+
        '<button class="btn primary" id="sSave">Save now</button></div>'+
        '<div class="card"><h4>Sound</h4><p>Short synthesised cues for tickets, cooking and cash.</p>'+
        '<button class="btn" id="sSound">'+(G.sound?'Sound on':'Sound off')+'</button></div>'+
        '<div class="card"><h4>Start over</h4><p>Deletes the save and returns to truck selection.</p>'+
        '<button class="btn danger" id="sReset">Reset game</button></div>'+
      '</div>'+
      '<h3>Controls</h3><div class="card">'+
        KV('Rotate camera','Drag')+KV('Pan','Shift + drag / right drag')+KV('Zoom','Scroll or pinch')+
        KV('Inspect a truck','Click it')+KV('Talk to someone','Click a person')+
        KV('Kitchen','K')+KV('Pause / speed','Space, 1–4')+
      '</div>'+
      '<h3>How a day works</h3><p>240 real seconds is one business day, 8:00 AM to 10:00 PM. '+
      'Customers arrive on a curve with lunch and dinner peaks, choose a truck, queue, and lose patience while they wait. '+
      'At close, wages, rent, fuel and interest come out and the day is booked.</p>');
    el('sSave').onclick=()=>{ Save.write(); this.note('good','💾 Saved','Progress stored in this browser.'); };
    el('sSound').onclick=()=>{ G.sound=!G.sound; el('btnSound').textContent=G.sound?'🔊':'🔇'; this.openPanel('settings'); };
    el('sReset').onclick=()=>{ if(confirm('Delete the save and start over?')){ Save.clear(); location.reload(); } };
  }
};

UI.pickCuisineFor=function(spot){
  this.sheet('<h2>Open a truck on space #'+spot.id+'</h2><p>Pick the cuisine for this location.</p>'+
    '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'+
    CUISINE_KEYS.map(k=>'<div class="card pick" data-c="'+k+'">'+
      '<div class="shot" style="height:92px;background-image:url(\''+ART.path(k,'truck')+'\')"></div>'+
      '<h4>'+CUISINES[k].name+'</h4><p>'+CUISINES[k].blurb+'</p></div>').join('')+
    '</div>');
  el('sheet').querySelectorAll('[data-c]').forEach(n=>n.onclick=()=>{
    spot.truck=makeTruck(spot,n.dataset.c,true);
    spot.truck.name=bizName();
    if(spot.park===G.parkIdx) World.addTruck(spot.truck,spot);
    this.note('money','🚚 New truck open','Space #'+spot.id+' is now yours.');
    this.closeSheet(); this.quickStats(); Sim.checkMilestones(); Save.write();
  });
};

UI.unlockPark2=function(){
  const p=makePark(1);
  for(const s of p.spots) if(Math.random()<0.8) s.truck=makeTruck(s,pick(CUISINE_KEYS),false);
  G.parks.push(p);
  this.note('good','🌉 Second park unlocked',p.name+' is open to you. Switch parks from the dock.');
};

/* ========================= SAVE / LOAD =================================== */

const Save = {
  write(){
    try{
      const data={
        v:3, phase:G.phase||'truck',
        cart: G.phase==='cart' ? {day:Cart.day, rep:Cart.rep, lifeServed:Cart.lifeServed, mod:Cart.mod} : null,
        day:G.day, cash:G.cash, debt:G.debt, totalProfit:G.totalProfit, totalRevenue:G.totalRevenue,
        totalCustomers:G.totalCustomers, history:G.history.slice(-200), seenMilestones:G.seenMilestones,
        franchises:G.franchises, franchiseIncome:G.franchiseIncome, franchiseValue:G.franchiseValue||0,
        wageMul:G.wageMul, rentMul:G.rentMul, won:G.won, parkIdx:G.parkIdx, sound:G.sound,
        followers:G.followers, posts:G.posts.slice(0,24), viral:G.viral,
        fairs:G.fairs, fairYear:G.fairYear, regulars:G.regulars.slice(-60),
        events:G.events.map(e=>({id:e.id,left:e.left})),
        market:{price:Market.price, shock:Market.shock},
        homeId: G.homeTruck? G.homeTruck.id : null,
        parks:G.parks.map(p=>({
          index:p.index,name:p.name,owned:p.owned,w:p.w,h:p.h,priceMul:p.priceMul,trafficMul:p.trafficMul,
          spots:p.spots.map(s=>({
            id:s.id,x:s.x,z:s.z,rot:s.rot,traffic:s.traffic,vis:s.vis,access:s.access,quality:s.quality,
            price:s.price,rent:s.rent,
            truck: s.truck? {
              id:s.truck.id,spotId:s.truck.spotId,park:s.truck.park,name:s.truck.name,cuisine:s.truck.cuisine,
              mine:s.truck.mine,prices:s.truck.prices,rep:s.truck.rep,equip:s.truck.equip,
              staff:s.truck.staff,staffCount:s.truck.staffCount,upgrades:s.truck.upgrades,
              revYest:s.truck.revYest,profitYest:s.truck.profitYest,lifetimeProfit:s.truck.lifetimeProfit,
              lifetimeCust:s.truck.lifetimeCust,served:s.truck.served,walkaways:s.truck.walkaways
            } : null
          }))
        }))
      };
      localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(data));
    }catch(e){ console.warn('save failed',e); }
  },
  read(){ try{ const s=localStorage.getItem(CFG.SAVE_KEY); return s?JSON.parse(s):null; }catch(e){ return null; } },
  clear(){ try{ localStorage.removeItem(CFG.SAVE_KEY); }catch(e){} },

  load(d){
    Object.assign(G,{
      day:d.day, cash:d.cash, debt:d.debt||0, totalProfit:d.totalProfit, totalRevenue:d.totalRevenue,
      totalCustomers:d.totalCustomers, history:d.history||[], seenMilestones:d.seenMilestones||[],
      franchises:d.franchises||0, franchiseIncome:d.franchiseIncome||0, franchiseValue:d.franchiseValue||0,
      wageMul:d.wageMul||1, rentMul:d.rentMul||1, won:!!d.won, parkIdx:d.parkIdx||0,
      sound:d.sound!==false, dayT:0, today:blankDay(), tutorialStep:99,
      phase:d.phase||'truck',         // v2 saves predate the cart, and are all trucks
      followers:d.followers||0, posts:d.posts||[], viral:d.viral||null,
      fairs:d.fairs||[], fairYear:d.fairYear||0, regulars:d.regulars||[],
      postedToday:false, boostNext:false
    });
    if(d.market){ Object.assign(Market.price,d.market.price); Object.assign(Market.shock,d.market.shock||{}); }
    G.events=(d.events||[]).map(e=>{ const base=EVENTS.find(x=>x.id===e.id); return base?Object.assign({},base,{left:e.left}):null; }).filter(Boolean);
    G.parks=d.parks.map(p=>{
      const park={index:p.index,name:p.name,owned:p.owned,w:p.w,h:p.h,priceMul:p.priceMul,trafficMul:p.trafficMul,spots:[]};
      park.spots=p.spots.map(s=>{
        const spot={id:s.id,park:p.index,x:s.x,z:s.z,rot:s.rot,traffic:s.traffic,vis:s.vis,access:s.access,
                    quality:s.quality,price:s.price,rent:s.rent,truck:null};
        if(s.truck){
          const t=makeTruck(spot,s.truck.cuisine,s.truck.mine);
          Object.assign(t,s.truck,{queue:[],mesh:null,revToday:0,costToday:0,custToday:0,tipsToday:0,satSum:0,satN:0});
          spot.truck=t;
        }
        return spot;
      });
      return park;
    });
    let home=null;
    for(const p of G.parks) for(const s of p.spots) if(s.truck && s.truck.id===d.homeId) home=s.truck;
    G.homeTruck = home || Park.allMyTrucks()[0] || null;
    el('btnSound').textContent=G.sound?'🔊':'🔇';
  }
};

/* ========================= THE CALENDAR =================================== */
/* A real year sits on top of the existing day counter — nothing new is stored,
   the date is derived from G.day, so old saves keep working untouched.       */

const MONTHS=[['January',31],['February',28],['March',31],['April',30],['May',31],['June',30],
              ['July',31],['August',31],['September',30],['October',31],['November',30],['December',31]];
const SEASONS={
  winter:{name:'Winter', icon:'❄', traffic:0.70, note:'Cold keeps people indoors.'},
  spring:{name:'Spring', icon:'🌱', traffic:1.06, note:'The city comes back outside.'},
  summer:{name:'Summer', icon:'☀',  traffic:1.24, note:'Peak season. Make it count.'},
  autumn:{name:'Autumn', icon:'🍂', traffic:1.00, note:'Steady trade, shorter evenings.'}
};

const Cal = {
  DAYS:365,
  doy(d){ d=d||G.day; return ((d-1)%this.DAYS)+1; },
  year(d){ d=d||G.day; return Math.floor((d-1)/this.DAYS)+1; },
  md(d){ let n=this.doy(d);
    for(let i=0;i<12;i++){ if(n<=MONTHS[i][1]) return {m:i,d:n}; n-=MONTHS[i][1]; }
    return {m:11,d:31}; },
  season(d){ const m=this.md(d).m; return (m===11||m<=1)?'winter':(m<=4?'spring':(m<=7?'summer':'autumn')); },
  seasonMul(d){ return SEASONS[this.season(d)].traffic; },
  short(d){ const x=this.md(d); return MONTHS[x.m][0].slice(0,3)+' '+x.d; },
  long(d){ const x=this.md(d); return MONTHS[x.m][0]+' '+x.d+', Year '+this.year(d); },
  /** absolute day number for year / month index / day-of-month */
  abs(year,m,day){ let n=0; for(let i=0;i<m;i++) n+=MONTHS[i][1]; return (year-1)*this.DAYS+n+day; }
};

/* ========================= SOCIAL MEDIA =================================== */
/* A phone you can open at any moment. Reach depends on who follows you, how
   good your name is, and — crucially — what time you post. Going viral is not
   a reward; it is a test you can fail in public.                             */

const POST_KINDS = [
  {id:'line',   t:'Post the line out the door', body:'look at this queue 🔥',           need:s=>s.busy,    pull:1.25, conv:0.030},
  {id:'dish',   t:'Hero shot of your best item', body:'this is what we do best 🍽',      need:()=>true,     pull:1.00, conv:0.022},
  {id:'behind', t:'Behind the counter',          body:'6am prep. nobody sees this part.', need:()=>true,    pull:0.85, conv:0.028},
  {id:'fair',   t:'Announce your next fair',     body:'catch us at the fair 🎪',          need:s=>s.fair,   pull:1.15, conv:0.034},
  {id:'thanks', t:'Thank the regulars',          body:'you lot keep the lights on 🙏',    need:s=>s.regs,   pull:0.75, conv:0.040},
  {id:'deal',   t:'Run a one-day deal',          body:'today only — come hungry',         need:()=>true,    pull:1.45, conv:0.018, cost:0.06}
];

const Social = {
  /** reach multiplier by hour: two windows a day where the city is looking */
  peak(){
    const h=Sim.hour();
    const lunch =Math.exp(-Math.pow((h-12.2)/1.25,2));
    const eve   =Math.exp(-Math.pow((h-18.6)/1.55,2));
    return 0.40 + 1.60*Math.max(lunch,eve);
  },
  peakLabel(){ const p=this.peak(); return p>1.55?'PEAK':(p>0.95?'decent':'dead hours'); },
  reach(kind){
    const home=Park.homeTruck();
    const base = 70 + G.followers*0.44;
    const rep  = 0.55 + (home?home.rep:50)/100;
    return Math.round(base * this.peak() * rep * (kind?kind.pull:1) * (G.boostNext?2:1));
  },
  ctx(){
    const home=Park.homeTruck();
    return { busy:(home&&home.queue.length>=3), fair:Fairs.nextBooked()!=null, regs:G.regulars.length>=3 };
  },
  available(){ const c=this.ctx(); return POST_KINDS.filter(k=>k.need(c)); },

  post(kind){
    const home=Park.homeTruck(); if(!home) return;
    if(G.postedToday){ UI.note('bad','📱 Already posted','Flooding the feed today would cost you followers.'); return; }
    const reach=this.reach(kind);
    const gained=Math.round(reach*kind.conv*rnd(0.7,1.4));
    G.followers += gained;
    G.postedToday=true;
    if(kind.cost){ const c=Math.round(home.revYest*kind.cost)||120; G.cash-=c; }
    // a post pulls traffic for a day or two
    G.events.push({id:'post_'+Date.now(), title:'Your post is working', text:'Traffic from the feed.',
                   left:2, eff:{traffic: 1 + clamp(reach/22000,0.02,0.30)}, mineOnly:1});

    // virality: big reach on a strong post, and it is not automatically good news
    const chance = clamp(reach/60000,0,0.34) * kind.pull;
    if(Math.random()<chance) this.goViral(reach);
    else UI.note('good','📱 Posted', kind.t+' — '+reach.toLocaleString()+' reached, +'+gained+' followers.');

    G.posts.unshift({d:G.day, t:kind.t, body:kind.body, reach, gained, viral:false});
    G.posts=G.posts.slice(0,24);
    Save.write();
  },

  goViral(reach){
    const mult = rnd(2.6,4.4);
    G.viral = {day:G.day+1, mult, reach:Math.round(reach*rnd(9,26))};
    if(G.posts[0]) G.posts[0].viral=true;
    UI.banner('IT WENT VIRAL', Math.round(G.viral.reach/1000)+'k views');
    UI.note('money','🔥 You went viral','Tomorrow will be nothing like today. Be ready or be exposed.');
  },

  /** called at close on the day a viral surge landed */
  judgeViral(T,home){
    const sat = T.satN? T.satSum/T.satN : 0.5;
    const missed = home.walkaways;
    if(sat>0.62 && missed<=T.cust*0.14){
      const g=Math.round(G.viral.reach*0.030);
      G.followers+=g; home.rep=clamp(home.rep+9,5,99);
      UI.note('good','🔥 You handled it','+'+g.toLocaleString()+' followers and a reputation to match.');
    }else{
      const lost=Math.round(G.followers*0.16);
      G.followers=Math.max(0,G.followers-lost);
      home.rep=clamp(home.rep-14,5,99);
      G.events.push({id:'overhyped', title:'Overhyped', text:'The clips are of your queue, not your food.',
                     left:3, eff:{traffic:0.80, spendMul:0.92}, mineOnly:1});
      UI.note('bad','💀 You choked','-'+lost.toLocaleString()+' followers, '+missed+' walked out. The internet noticed.');
    }
    G.viral=null;
  },

  campaign(kind){
    const home=Park.homeTruck(); if(!home) return;
    if(kind==='boost'){
      if(G.cash<500) return;
      G.cash-=500; G.boostNext=true;
      UI.note('money','📣 Boost bought','Your next post reaches twice as far.');
    }else if(kind==='influencer'){
      if(G.cash<2200) return;
      G.cash-=2200;
      const ok=Math.random()<clamp(0.35+home.rep/220,0,0.9);
      if(ok){
        const g=Math.round(rnd(700,2100));
        G.followers+=g;
        G.events.push({id:'influ_run', title:'Influencer collab', text:'Their audience is trying you out.',
                       left:3, eff:{traffic:1.28}, mineOnly:1});
        UI.note('good','🤝 It landed','+'+g.toLocaleString()+' followers over three days.');
      }else{
        UI.note('bad','🤝 It flopped','The post underperformed. The fee is gone either way.');
      }
    }
    this.panel(); UI.quickStats(); Save.write();
  },

  panel(){
    const home=Park.homeTruck();
    if(!home){ UI.sheet('<h2>No truck yet</h2><p>Build the business first.</p>'); return; }
    const opts=this.available();
    const feed = G.posts.length? G.posts.map(p=>
        '<div class="card" style="padding:11px"><div class="row" style="justify-content:space-between">'+
        '<h4>'+p.t+(p.viral?' <span class="tag hot">viral</span>':'')+'</h4>'+
        '<span class="eyebrow">'+Cal.short(p.d)+'</span></div>'+
        '<p style="margin:4px 0 6px">'+p.body+'</p>'+
        '<div class="kv"><span>Reached</span><span>'+p.reach.toLocaleString()+'</span></div>'+
        '<div class="kv"><span>Followers</span><span>+'+p.gained+'</span></div></div>').join('')
      : '<div class="card"><p>Nothing posted yet. Nobody knows you exist.</p></div>';

    UI.sheet(
      '<div class="eyebrow">Social</div><h2>@'+home.name.replace(/[^A-Za-z]/g,'')+'</h2>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">'+
        '<div class="card"><div class="eyebrow">Followers</div><h4 style="font-size:22px">'+G.followers.toLocaleString()+'</h4></div>'+
        '<div class="card"><div class="eyebrow">Reach right now</div><h4 style="font-size:22px">'+this.reach().toLocaleString()+'</h4>'+
          '<span class="eyebrow">'+this.peakLabel()+' · '+Sim.clockText()+'</span></div>'+
        '<div class="card"><div class="eyebrow">Reputation</div><h4 style="font-size:22px">'+Math.round(home.rep)+'</h4></div>'+
      '</div>'+
      (G.viral? '<div class="card" style="border-color:var(--grease);margin-top:10px"><h4>🔥 Surge lands tomorrow</h4>'+
        '<p>About '+Math.round(G.viral.reach/1000)+'k people saw you. Traffic ×'+G.viral.mult.toFixed(1)+
        '. Serve them or it turns on you.</p></div>':'')+
      '<h3>Compose'+(G.boostNext?' <span class="tag hot">boost ready</span>':'')+'</h3>'+
      (G.postedToday
        ? '<div class="card"><p>You have posted today. Come back tomorrow.</p></div>'
        : '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">'+
          opts.map((k,i)=>'<div class="card pick" data-post="'+k.id+'"><h4>'+k.t+'</h4>'+
            '<p>'+k.body+'</p><div class="kv"><span>Est. reach</span><span>'+
            this.reach(k).toLocaleString()+'</span></div></div>').join('')+'</div>')+
      '<h3>Campaigns</h3><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">'+
        '<div class="card"><h4>Boost next post</h4><p>Double the reach of the next thing you post.</p>'+
          '<button class="btn'+(G.cash<500||G.boostNext?'':' primary')+'" id="cBoost"'+
          (G.cash<500||G.boostNext?' disabled':'')+'>'+(G.boostNext?'Ready':'Buy $500')+'</button></div>'+
        '<div class="card"><h4>Influencer collab</h4><p>A local name features you. Their audience may not care.</p>'+
          '<button class="btn'+(G.cash<2200?'':' primary')+'" id="cInflu"'+(G.cash<2200?' disabled':'')+
          '>Buy $2,200</button></div>'+
      '</div>'+
      '<h3>Your feed</h3>'+feed);

    el('sheet').querySelectorAll('[data-post]').forEach(n=>n.onclick=()=>{
      const k=POST_KINDS.find(x=>x.id===n.dataset.post);
      this.post(k); G.boostNext=false; this.panel();
    });
    const b=el('cBoost'); if(b) b.onclick=()=>this.campaign('boost');
    const i=el('cInflu'); if(i) i.onclick=()=>this.campaign('influencer');
  }
};

/* ========================= FAIRS & EVENTS ================================= */
/* A year of dates you apply for and can be turned down for. Booked fairs are
   played, not summarised: the truck works the fair and the crowd is brutal.  */

const FAIR_TEMPLATES = [
  {id:'farmers', name:'Spring Farmers Market', m:2,  d:18, span:1, fee:900,  rep:0,  fol:0,
   traffic:2.1, crowd:'Families and early risers.', blurb:'Small, friendly, and open to anyone with a permit.'},
  {id:'street',  name:'Street Food Festival',  m:4,  d:9,  span:2, fee:2600, rep:45, fol:800,
   traffic:3.0, crowd:'Foodies hunting the next thing.', blurb:'Two days of dense, judgemental crowds.'},
  {id:'harbor',  name:'Harbor Seafood Fair',   m:5,  d:14, span:3, fee:4500, rep:70, fol:5000,
   traffic:4.0, crowd:'Tourists, all day, all three days.', blurb:'The one everyone wants. They know it.'},
  {id:'july4',   name:'Independence Day',      m:6,  d:4,  span:1, fee:3800, rep:55, fol:2500,
   traffic:4.8, crowd:'Everyone in the city, at once.', blurb:'One day. Enormous. Unforgiving.'},
  {id:'county',  name:'County Fair',           m:7,  d:9,  span:4, fee:6500, rep:75, fol:9000,
   traffic:4.4, crowd:'Four days of families and teenagers.', blurb:'A marathon. Staff it properly or it will break you.'},
  {id:'harvest', name:'Harvest Night Market',  m:9,  d:12, span:2, fee:2200, rep:40, fol:600,
   traffic:2.7, crowd:'Evening crowd, high spend.', blurb:'Lanterns, cold air, and people with money.'},
  {id:'holiday', name:'Holiday Market',        m:11, d:6,  span:5, fee:5200, rep:60, fol:3500,
   traffic:3.3, crowd:'Shoppers who queue without complaining.', blurb:'Five days that can carry you through winter.'}
];

const Fairs = {
  tpl(f){ return FAIR_TEMPLATES.find(t=>t.id===f.tid); },
  ensure(){
    const y=Cal.year();
    if(G.fairYear===y && G.fairs.length) return;
    G.fairYear=y;
    G.fairs=FAIR_TEMPLATES.map(t=>({tid:t.id, day:Cal.abs(y,t.m,t.d), status:'open'}));
  },
  all(){ this.ensure(); return G.fairs.slice().sort((a,b)=>a.day-b.day); },
  nextBooked(){ this.ensure(); return G.fairs.filter(f=>f.status==='booked'&&f.day>=G.day).sort((a,b)=>a.day-b.day)[0]||null; },
  activeToday(){
    this.ensure();
    return G.fairs.find(f=>f.status==='booked' && G.day>=f.day && G.day<f.day+this.tpl(f).span) || null;
  },
  odds(f){
    const t=this.tpl(f), home=Park.homeTruck(); if(!home) return 0;
    const r  = clamp((home.rep-t.rep)/26+0.55, 0, 1);
    const fo = t.fol? clamp((G.followers-t.fol)/Math.max(t.fol,800)+0.62, 0, 1) : 1;
    return clamp(r*0.62+fo*0.38, 0.02, 0.95);
  },
  apply(f){
    const t=this.tpl(f);
    if(G.cash<t.fee){ UI.note('bad','Not enough cash','The booth fee is '+money(t.fee)+'.'); return; }
    const p=this.odds(f);
    if(Math.random()<p){
      G.cash-=t.fee; f.status='booked';
      UI.note('good','🎪 Accepted',t.name+' on '+Cal.short(f.day)+'. Booth fee paid.');
    }else{
      f.status='rejected';
      UI.note('bad','🎪 Turned down',t.name+' passed on you this year. Build the name and try next year.');
    }
    this.panel(); UI.quickStats(); Save.write();
  },
  /** called at close on a fair day */
  judge(f,T,home){
    const t=this.tpl(f);
    const sat=T.satN? T.satSum/T.satN : 0.5;
    const last = G.day >= f.day + t.span - 1;
    if(sat>0.6){
      const g=Math.round(T.cust*rnd(1.6,3.4));
      G.followers+=g; home.rep=clamp(home.rep+2.4,5,99);
      UI.note('good','🎪 Good day at '+t.name,'+'+g+' followers.');
    }else{
      home.rep=clamp(home.rep-3.2,5,99);
      UI.note('bad','🎪 Rough day at '+t.name,'Slow service in front of a big crowd.');
    }
    if(last){ f.status='done'; UI.banner(t.name.toUpperCase(),'that is a wrap'); }
  },

  panel(){
    this.ensure();
    const home=Park.homeTruck();
    const season=SEASONS[Cal.season()];
    const rows=this.all().map(f=>{
      const t=this.tpl(f), past=f.day+t.span-1 < G.day, live=this.activeToday()===f;
      const odds=this.odds(f);
      const tag = live? '<span class="tag hot">happening now</span>'
        : f.status==='booked'? '<span class="tag mine">booked</span>'
        : f.status==='rejected'? '<span class="tag">turned down</span>'
        : past? '<span class="tag">missed</span>' : '';
      return '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start">'+
        '<div><h4>'+t.name+'</h4><span class="eyebrow">'+Cal.short(f.day)+
          (t.span>1?' — '+Cal.short(f.day+t.span-1):'')+' · '+t.span+' day'+(t.span>1?'s':'')+'</span></div>'+tag+'</div>'+
        '<p style="margin-top:6px">'+t.blurb+'</p>'+
        '<div class="kv"><span>Booth fee</span><span>'+money(t.fee)+'</span></div>'+
        '<div class="kv"><span>Crowd</span><span>×'+t.traffic+'</span></div>'+
        '<div class="kv"><span>Wants</span><span>rep '+t.rep+'+ · '+t.fol.toLocaleString()+' followers</span></div>'+
        (f.status==='open' && !past
          ? '<div class="kv"><span>Your odds</span><span style="color:'+(odds>0.6?'var(--mint)':(odds>0.3?'var(--chit)':'var(--blood)'))+'">'+
            pct(odds)+'</span></div>'+
            '<button class="btn'+(G.cash<t.fee?'':' primary')+'" data-fair="'+f.tid+'"'+
            (G.cash<t.fee?' disabled':'')+'>Apply · '+money(t.fee)+'</button>'
          : '')+
        '</div>';
    }).join('');

    UI.sheet('<div class="eyebrow">'+Cal.long()+'</div><h2>The year ahead</h2>'+
      '<div class="card"><div class="row" style="justify-content:space-between"><h4>'+
        season.icon+' '+season.name+'</h4><span class="tag">traffic ×'+season.traffic+'</span></div>'+
        '<p>'+season.note+'</p></div>'+
      '<p style="margin-top:10px">Applications are judged on reputation and following. A rejection costs you '+
      'that fair for the year — the slate resets next January.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">'+rows+'</div>');
    el('sheet').querySelectorAll('[data-fair]').forEach(n=>n.onclick=()=>{
      const f=G.fairs.find(x=>x.tid===n.dataset.fair); if(f) this.apply(f);
    });
  }
};

/* ========================= NETWORKING ==================================== */
/* Click anyone in the park and walk over. Every conversation is time you are
   not cooking, and the line does not pause while you make friends.          */

const Chat = {
  lines:[
    'Been meaning to try you for weeks.',
    'My office is right there. We order most days.',
    'Someone posted about this place.',
    'Is it always this busy?',
    'What would you get, if you were me?'
  ],
  open(c){
    if(!c || !c.persona) return;
    const home=Park.homeTruck(); if(!home) return;
    const known=G.regulars.find(r=>r.name===c.pname);
    const hearts=known?known.hearts:0;
    const pr=PERSONAS[c.persona];
    UI.sheet('<div class="eyebrow">'+pr.name+(known?' · regular':'')+'</div>'+
      '<h2>'+c.pname+'</h2>'+
      '<div class="card"><p>"'+pick(this.lines)+'"</p>'+
      '<div class="kv"><span>Relationship</span><span>'+('♥'.repeat(hearts)+'♡'.repeat(5-hearts))+'</span></div></div>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'+
        '<div class="card pick" data-act="chat"><h4>Just chat</h4><p>Costs you a moment. Wins a little goodwill and a follower or two.</p></div>'+
        '<div class="card pick" data-act="comp"><h4>Comp them a plate</h4><p>Free food buys real loyalty. It also costs you real money.</p></div>'+
        '<div class="card pick" data-act="ask"><h4>Ask what they want</h4><p>Menu intel. They will tell you what you are missing.</p></div>'+
      '</div>'+
      '<p style="margin-top:10px;color:var(--dim);font-size:12px">Nobody is cooking while you do this.</p>');
    el('sheet').querySelectorAll('[data-act]').forEach(n=>n.onclick=()=>this.act(c,n.dataset.act));
  },
  act(c,what){
    const home=Park.homeTruck();
    let gain=0, fol=0, msg='';
    if(what==='chat'){ gain=1; fol=rint(1,4); msg='A good word costs nothing.'; }
    else if(what==='comp'){
      const cost=rint(8,16); G.cash-=cost; gain=2; fol=rint(3,9);
      msg='You comped '+money(cost)+' of food. They will remember.';
    }
    else if(what==='ask'){
      const cu=CUISINES[home.cuisine];
      const m=pick(cu.menu);
      gain=1; fol=rint(0,2);
      msg='"Honestly? Your '+m.name+' is why I come." Popularity noted.';
      m.pop=clamp(m.pop+0.03,0.2,1);
    }
    // relationship
    let r=G.regulars.find(x=>x.name===c.pname);
    if(!r){ r={name:c.pname, persona:c.persona, hearts:0, seen:G.day}; G.regulars.push(r); }
    r.hearts=clamp(r.hearts+gain,0,5); r.seen=G.day;
    G.followers+=fol;
    if(c.patience!==undefined) c.patience=clamp(c.patience+0.25,0,1.4);
    UI.closeSheet();
    UI.note('good','💬 '+c.pname, msg+(fol?'  +'+fol+' followers.':''));
    UI.quickStats(); Save.write();
  },
  /** a known face is more patient, spends more and tips better */
  applyRegular(c){
    const r=pick(G.regulars);
    if(!r) return false;
    if(G.day-r.seen>14) return false;
    c.pname=r.name; c.regular=true;
    c.patience *= 1+0.10*r.hearts;
    c.pr={...c.pr, spend:c.pr.spend*(1+0.06*r.hearts), tipBase:c.pr.tipBase+0.02*r.hearts};
    r.seen=G.day;
    return true;
  },
  panel(){
    const rows = G.regulars.length? G.regulars.slice().sort((a,b)=>b.hearts-a.hearts).map(r=>{
      const cold=G.day-r.seen;
      return '<div class="card" style="padding:11px"><div class="row" style="justify-content:space-between">'+
        '<h4>'+r.name+'</h4><span class="tag'+(cold>10?'':' mine')+'">'+PERSONAS[r.persona].name+'</span></div>'+
        '<div class="kv"><span>Relationship</span><span>'+('♥'.repeat(r.hearts)+'♡'.repeat(5-r.hearts))+'</span></div>'+
        '<div class="kv"><span>Last seen</span><span>'+(cold===0?'today':cold+' days ago')+'</span></div>'+
        (cold>10?'<div class="eyebrow" style="color:var(--blood);margin-top:4px">drifting away</div>':'')+'</div>';
    }).join('') : '<div class="card"><p>You have not spoken to anyone. Click a person in the park.</p></div>';
    UI.sheet('<div class="eyebrow">Networking</div><h2>Regulars</h2>'+
      '<p>People you have won over come back, wait longer, spend more and tip better. '+
      'Ignore them for a fortnight and they drift.</p>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">'+rows+'</div>');
  }
};

/* ========================= FOOD CART PROLOGUE ============================= */
/* Before the truck there is a cart on a sidewalk: one person, three items, two
   hands. Speed is the entire game here — how fast you physically fill an order
   sets the tip, and tips are the only way out. The reputation you build at the
   cart carries into the truck years and gates everything that comes after.   */

const CART_MENU = [
  {id:'dog',   name:'Hot Dog', em:'🌭', price:5.00, cost:1.55, taps:5, key:'1'},
  {id:'pretz', name:'Pretzel', em:'🥨', price:4.00, cost:1.05, taps:4, key:'2'},
  {id:'soda',  name:'Soda',    em:'🥤', price:3.00, cost:0.50, taps:3, key:'3'}
];
/* queued-customer portraits, tiered by patience so a face visibly sours the
   longer they wait. Each customer keeps a stable seed so they don't shuffle
   between different people inside the same tier — only the expression shifts. */
const CART_FACE_TIERS = {
  calm:   ['waiting_patrons1_1.png','waiting_patrons1_3.png','waiting_patrons2_1.png','waiting_patrons2_2.png'],
  medium: ['waiting_patrons1_2.png'],
  angry:  ['waiting_patrons1_4.png','waiting_patrons1_5.png','waiting_patrons2_4.png','waiting_patrons2_5.png']
};

/* the counter photo behind the hotspots — three crowd levels, same prop
   layout in all three so the hotspot % coordinates never need to change */
const CART_BG = [
  {max:1, file:'hotdog_cart_short_line.png'},
  {max:4, file:'hotdog_cart_long_line.png'},
  {max:99,file:'hotdog_cart_lunchtime_rush.png'}
];
/* served-customer cutouts, tagged by which item(s) they're holding, for the
   little payoff flash when an order completes. Falls back gracefully if a
   combo isn't on file. */
const CART_SERVED = [
  {items:['dog'],         file:'hotdog_patrons1_1.png'},
  {items:['dog'],         file:'hotdog_patrons2_1.png'},
  {items:['pretz'],       file:'hotdog_patrons1_2.png'},
  {items:['pretz'],       file:'hotdog_patrons2_2.png'},
  {items:['pretz'],       file:'hotdog_patrons3_2.png'},
  {items:['pretz'],       file:'hotdgo_patrons4_2.png'},
  {items:['soda'],        file:'hotdog_patrons1_3.png'},
  {items:['soda'],        file:'hotdog_patrons2_3.png'},
  {items:['pretz','soda'],file:'hotdog_patrons3_1.png'},
  {items:['pretz','soda'],file:'hotdgo_patrons4_1.png'},
  {items:['soda','dog'],  file:'hotdog_patrons3_3.png'},
  {items:['soda','dog'],  file:'hotdgo_patrons4_3.png'}
];
const CART_WALKAWAY = [
  'hotdog_patrons_walking_away_1.png','hotdog_patrons_walking_away_2.png',
  'hotdog_patrons_walking_away_3.png','hotdog_patrons2_walking_away_1.png',
  'hotdog_patrons2_walking_away_2.png','hotdog_patrons2_walking_away_3.png'
];
/* short hand-reaching-into-the-case animations, played on the counter photo
   itself when an item is actually retrieved. Only pretzel has frames so far;
   dog/soda fall back to the plain instant swap until their sheets arrive. */
const CART_ANIM = {
  pretz: ['pretz_anim_01.jpg','pretz_anim_02.jpg','pretz_anim_03.jpg',
          'pretz_anim_06.jpg','pretz_anim_08.jpg','pretz_anim_09.jpg'],
  dog:   ['pretz_anim_01.jpg','dog_anim_08.jpg','dog_anim_13.jpg']
};
/* embedded above so the hot dog cart never depends on an external assets/ folder */
/* the photos are gone: the cart is a 3D street corner (src/cart3d.js) */
const cartArt=f=>f;
/* seconds of holding to make one of each (hold to prepare, 2026-10-22) */
const CART_HOLD = {dog:1.0, pretz:0.8, soda:0.55};

/* the dice — one roll at the close of every cart day. Life happens whether or
   not you had a good shift. */
const CART_DICE = [
  {w:6, good:1, t:'A blogger posted about you',    x:'"Best five dollars in the city." Word travels.',        rep:7,  traffic:1.35},
  {w:5, good:1, t:'The offices let out early',     x:'A wave of hungry workers found your corner.',           traffic:1.25},
  {w:4, good:1, t:'You found a cheaper supplier',  x:'Buns and franks for less — while the deal lasts.',      cost:0.80},
  {w:3, good:1, t:'A regular left $50 in the jar', x:'"Keep it. You earned it."',                             cash:50},
  {w:3, good:1, t:'A film crew set up nearby',     x:'Crew catering is not your job, but they are hungry.',   traffic:1.4},
  /* good luck, the kind that actually happens to people. Amounts that vary are
     written as functions so they are rolled fresh each time. The windfalls
     carry a deliberately low w: a big one can clear the truck fund outright. */
  {w:4, good:1, t:'A site foreman pre-ordered',    x:'Forty dogs, Thursday, paid up front. The crew eats at ten.',
    cash:()=>Math.round(rnd(180,340))},
  {w:3, good:1, t:'Your tax refund landed',        x:'You had forgotten you were owed it. Most people do.',
    cash:()=>Math.round(rnd(400,900))},
  {w:3, good:1, t:'A restaurant supply closed down',x:'You bought their stock at whatever they would take for it.',
    cost:0.70},
  {w:2, good:1, t:'The local news ran a segment',  x:'Ninety seconds, your corner, your name spelled right.',
    rep:9, traffic:1.45},
  {w:2, good:1, t:'A stock tip you overheard',     x:'Two suits talked through their whole morning at your cart. You put in what you could spare.',
    cash:()=>Math.round(clamp(G.cash*rnd(.18,.55),250,3200))},
  {w:1, good:1, t:'An inheritance came through',   x:'An aunt you saw twice a year. The solicitor took a month to find you.',
    cash:()=>6000+Math.round(Math.pow(Math.random(),6)*94)*1000},
  {w:6, good:0, t:'A rival cart parked beside you',x:'Same corner, cheaper dogs. The line splits.',           traffic:0.70},
  {w:5, good:0, t:'New vendor permit law',         x:'The city wants its cut before you serve anyone.',       cash:-180},
  {w:5, good:0, t:'Rain, all day',                 x:'Nobody eats standing up in this.',                      traffic:0.60},
  {w:4, good:0, t:'The health inspector came by',  x:'A written warning. Word gets around about those.',      rep:-6},
  {w:4, good:0, t:'Your cart wheel gave out',      x:'You paid a guy to weld it back on before dawn.',        cash:-140},
  {w:3, good:0, t:'Your supplier raised prices',   x:'Beef is up. Your margin is not what it was.',           cost:1.25},
  {w:2, good:0, t:'Someone took the tip jar',      x:'You did not see who. You rarely do.',                   cash:'tips'}
];

const Cart = {
  DAY:90, GOAL_CASH:9000, GOAL_REP:60, QMAX:6,
  on:false, dayT:0, rep:20, day:1,
  served:0, walkouts:0, takings:0, spent:0, tipsDay:0, lifeServed:0,
  queue:[], spawnAcc:0, streak:0, lastTap:0, sig:'',
  mod:{traffic:1, cost:1, days:0},

  /* ---- lifecycle ---- */
  start(){
    this.on=true; this.dayT=0; this.day=1; this.rep=20;
    this.served=this.walkouts=this.takings=this.spent=this.tipsDay=this.lifeServed=0;
    this.queue.length=0; this.spawnAcc=0; this.streak=0; this.sig=''; this.summary=false;
    this.mod={traffic:1, cost:1, days:0};
    G.cash=800; G.debt=0; G.phase='cart'; G.started=true; G.paused=false; G.speed=1;
    this.mount();
    UI.banner('DAY 1','the cart');
    setTimeout(()=>UI.note('','🌭 Work the line','Press and hold an item — or hold 1, 2, 3 — until it fills to make it. The faster you serve, the bigger the tip.'),1200);
  },
  stop(){
    this.on=false;
    el('cart').classList.remove('open');
    document.body.classList.remove('cartmode');
  },
  mount(){
    el('cart').classList.add('open');
    document.body.classList.add('cartmode');
    this.buildHotspots(); this.bgSig=''; this.sizeStage();
    if(!this._resizeBound){ this._resizeBound=true; addEventListener('resize',()=>this.sizeStage()); }
    this.render(true);
  },
  /* the photo stage is gone; the hotspots follow the 3D cart (HS.Cart3D.placeHotspots) */
  sizeStage(){},
  pickBg(){
    const n=this.queue.length;
    return (CART_BG.find(b=>n<=b.max)||CART_BG[CART_BG.length-1]).file;
  },
  /* plays the hand-reaching-into-the-case frames on the counter photo when an
     item is actually retrieved, then hands control back to the normal
     crowd-level background. No-op for items without a frame set yet. */
  playAnim(mid){ HS.Cart3D.grab(mid); },     // the item comes up in your hand
  /* restore a save that was left mid-prologue */
  resume(c){
    this.on=true; G.phase='cart'; G.started=true; G.paused=false;
    this.day=c.day||1; this.rep=c.rep!=null?c.rep:20; this.lifeServed=c.lifeServed||0;
    this.dayT=0; this.served=this.walkouts=0; this.takings=this.spent=this.tipsDay=0;
    this.queue.length=0; this.spawnAcc=0; this.streak=0; this.sig=''; this.summary=false;
    this.mod=c.mod||{traffic:1, cost:1, days:0};
    this.mount();
    UI.banner('DAY '+this.day,'the cart');
  },

  /* ---- the clickable food/drink zones on the counter photo ---- */
  buildHotspots(){
    const wrap=el('carthotspots'); wrap.innerHTML='';
    for(const m of CART_MENU){
      const b=document.createElement('div');
      b.className='hotspot'; b.dataset.m=m.id;
      b.innerHTML='<span class="tag">'+m.em+' '+m.name+' · '+m.key+'</span>';
      // press and HOLD to make it (user, 2026-10-22: no more mashing the button)
      b.innerHTML+='<span class="hold"><i></i></span>';
      b.addEventListener('pointerdown',e=>{ e.preventDefault(); try{ b.setPointerCapture(e.pointerId); }catch(err){} this.press(m.id); });
      const up=()=>this.release(m.id);
      b.addEventListener('pointerup',up); b.addEventListener('pointercancel',up); b.addEventListener('lostpointercapture',up);
      wrap.appendChild(b);
    }
  },

  active(){ return this.queue.length? this.queue[0] : null; },

  /* ---- hold to prepare (2026-10-22, replaces tapping) ----
     Hold an item (pointer, or 1/2/3) and it fills over CART_HOLD seconds; when it fills, that
     one is made. If the order needs another, keep holding and the next one starts. Progress
     you let go of is kept. Pressing something the customer didn't order costs patience, once
     per press, as a wrong tap did. */
  press(mid){
    if(!this.on || this.summary) return;
    this.holding=mid;
    const btn=el('carthotspots').querySelector('[data-m="'+mid+'"]');
    if(btn) btn.classList.add('hit');
    const c=this.active(); if(!c) return;
    if(!c.items.find(x=>x.m.id===mid && x.done<x.qty)){
      c.pat=Math.max(0,c.pat-1.1);
      if(btn){ btn.classList.remove('wrong'); void btn.offsetWidth; btn.classList.add('wrong'); }
      Sfx.play('alert');
      this.holding=null;
    }
  },
  release(mid){
    if(this.holding===mid) this.holding=null;
    const btn=el('carthotspots') && el('carthotspots').querySelector('[data-m="'+mid+'"]');
    if(btn){ btn.classList.remove('hit'); const f=btn.querySelector('.hold > i'); if(f) f.style.width='0%'; }
  },
  holdStep(dt){
    const mid=this.holding; if(!mid) return;
    const c=this.active(); if(!c) return;
    const it=c.items.find(x=>x.m.id===mid && x.done<x.qty);
    const btn=el('carthotspots').querySelector('[data-m="'+mid+'"]');
    if(!it){ if(btn){ const f=btn.querySelector('.hold > i'); if(f) f.style.width='0%'; } return; }
    HS.Cart3D.holding(mid);                               // your hand stays in the compartment
    it.prog += dt*it.m.taps/CART_HOLD[mid];               // prog still counts in "taps" for the order strip
    if(btn){ const f=btn.querySelector('.hold > i'); if(f) f.style.width=Math.min(100,it.prog/it.m.taps*100)+'%'; }
    if(it.prog >= it.m.taps){ it.prog=0; it.done++; Sfx.play('sizzle'); this.playAnim(mid); }
    if(c.items.every(x=>x.done>=x.qty)) this.complete(c);
    else this.renderOrder();
  },

  tap(mid){
    if(!this.on) return;
    const c=this.active();
    const btn=el('carthotspots').querySelector('[data-m="'+mid+'"]');
    if(btn){ btn.classList.add('hit'); setTimeout(()=>btn.classList.remove('hit'),80); }
    if(!c){ return; }

    const it=c.items.find(x=>x.m.id===mid && x.done<x.qty);
    if(!it){                                   // wrong item: costs you patience
      c.pat=Math.max(0,c.pat-1.1); this.streak=0;
      if(btn){ btn.classList.remove('wrong'); void btn.offsetWidth; btn.classList.add('wrong'); }
      Sfx.play('alert');
      return;
    }
    // streak: taps landed inside 420ms compound into real speed
    const now=performance.now();
    this.streak = (now-this.lastTap < 420) ? Math.min(this.streak+1,40) : 0;
    this.lastTap=now;

    it.prog += 1 + Math.floor(this.streak/8);
    HS.Cart3D.tap(mid);                        // your hand dips into that compartment
    if(it.prog >= it.m.taps){ it.prog=0; it.done++; Sfx.play('sizzle'); this.playAnim(mid); }
    if(c.items.every(x=>x.done>=x.qty)) this.complete(c);
    else this.renderOrder();
  },

  /* ---- customers ---- */
  spawn(){
    if(this.queue.length>=this.QMAX) return;
    const items=[];
    const n=Math.random()<0.62?1:2;
    const pool=CART_MENU.slice();
    for(let i=0;i<n;i++){
      const m=pool.splice(Math.floor(Math.random()*pool.length),1)[0];
      items.push({m, qty:Math.random()<0.78?1:2, done:0, prog:0});
    }
    const pat=rnd(15,24);
    this.queue.push({
      id:'c'+(Math.random().toString(36).slice(2,7)),
      faceSeed:Math.floor(Math.random()*97), name:personName().split(' ')[0],
      items, pat, pat0:pat
    });
  },
  faceFor(c){ return HS.Cart3D.faceOf(c); },   // 🙂 → 😐 → 😠 as their patience runs out
  complete(c){
    const speed=clamp(c.pat/c.pat0,0,1);
    let gross=0, cost=0;
    for(const it of c.items){ gross += it.m.price*it.qty; cost += it.m.cost*it.qty*this.mod.cost; }
    const tip = gross * (0.04 + speed*0.30);
    const net = gross + tip;
    G.cash += net - cost;
    this.takings += net; this.spent += cost; this.tipsDay += tip;
    this.served++; this.lifeServed++;
    this.rep = clamp(this.rep + (speed-0.42)*1.7, 0, 100);
    const q = speed>0.7?'FAST':(speed>0.42?'GOOD':'SLOW');
    this.float(money(net,2)+'  '+q, speed>0.7?'var(--mint)':(speed>0.42?'var(--chit)':'var(--dim)'));
    Sfx.play('cash');
    this.flashServed(c);
    this.drop(c);
  },
  walkout(c){
    this.walkouts++;
    this.rep = clamp(this.rep-2.6,0,100);
    this.float('WALKED OFF','var(--blood)');
    Sfx.play('alert');
    HS.Cart3D.walkout(c);
    this.drop(c);
  },
  drop(c){
    const i=this.queue.indexOf(c); if(i>=0) this.queue.splice(i,1);
    this.streak=0; this.sig=''; this.render(true);
  },

  /* ---- per-frame ---- */
  update(dt){
    if(!this.on) return;
    // day summary is up: hold the shift. If the player dismissed the sheet
    // instead of choosing, roll into tomorrow rather than freezing.
    if(this.summary){
      if(!el('veil').classList.contains('open')) this.nextDay();
      return;
    }
    if(G.paused) return;
    this.dayT += dt;

    const rate = (0.26 + this.rep/300) * this.mod.traffic;
    this.spawnAcc += rate*dt;
    while(this.spawnAcc>=1){ this.spawnAcc-=1; this.spawn(); }

    for(let i=this.queue.length-1;i>=0;i--){
      const c=this.queue[i];
      c.pat -= dt * (i===0?1:0.72);          // the person being served feels it most
      if(c.pat<=0) this.walkout(c);
    }
    this.holdStep(dt);
    if(performance.now()-this.lastTap>700 && this.streak) this.streak=0;

    this.render(false);
    if(this.dayT>=this.DAY) this.endDay();
  },

  /* ---- render ---- */
  renderTop(){
    const frac=clamp(this.dayT/this.DAY,0,1), goalOk=this.canGraduate();
    el('carttop').innerHTML=
      '<div class="cbox" id="cartclock"><div class="eyebrow">Day '+this.day+'</div><b>'+
        Math.max(0,Math.ceil(this.DAY-this.dayT))+'s</b><i style="width:'+((1-frac)*100)+'%"></i></div>'+
      '<div class="cbox"><div class="eyebrow">Cash</div><b>'+money(G.cash)+'</b></div>'+
      '<div class="cbox"><div class="eyebrow">Reputation</div><b style="color:'+
        (this.rep>=this.GOAL_REP?'var(--mint)':'var(--paper)')+'">'+Math.round(this.rep)+'</b></div>'+
      '<div class="cbox"><div class="eyebrow">Served</div><b>'+this.served+'</b></div>'+
      '<div class="cbox"><div class="eyebrow">Walk-offs</div><b style="color:'+
        (this.walkouts?'var(--blood)':'var(--paper)')+'">'+this.walkouts+'</b></div>'+
      '<div class="cbox" style="flex:1;min-width:150px"><div class="eyebrow">Truck fund</div>'+
        '<b style="color:'+(goalOk?'var(--mint)':'var(--paper)')+'">'+money(G.cash)+' / '+money(this.GOAL_CASH)+'</b>'+
        '<div class="bar" style="margin-top:4px"><i style="width:'+
          clamp(G.cash/this.GOAL_CASH,0,1)*100+'%"></i></div></div>';
  },
  render(full){
    // the top strip only changes about once a second — no need to rebuild it at 60fps
    this.tf=(this.tf||0)+1;
    if(full || this.tf%8===0) this.renderTop();

    // the line — rebuilt only when its membership actually changes
    const sig=this.queue.map(c=>c.id).join(',');
    const qw=el('cartqueue');
    if(full || sig!==this.sig){
      this.sig=sig;
      qw.innerHTML=this.queue.map((c,i)=>
        '<div class="cust'+(i===0?' now':'')+'" data-c="'+c.id+'">'+
        '<div class="face"><span data-f=""></span></div>'+
        '<div class="who">'+c.name+'</div>'+
        '<div class="pat"><i></i></div></div>').join('');
      this.renderOrder();
    }
    for(const c of this.queue){                    // patience bars + face expression, every frame
      const cell=qw.querySelector('[data-c="'+c.id+'"]'); if(!cell) continue;
      const n=cell.querySelector('.pat > i');
      const p=clamp(c.pat/c.pat0,0,1);
      n.style.width=(p*100)+'%';
      n.className = p>0.5?'':(p>0.25?'warn':'bad');
      const face=cell.querySelector('.face span');
      const want=this.faceFor(c);
      if(face.dataset.f!==want){ face.dataset.f=want; face.textContent=want; }
    }
    // streak read-out
    const st=el('cartstreak');
    if(this.streak>=5){ st.classList.add('on'); st.innerHTML='<b>×'+(1+Math.floor(this.streak/8))+'</b><span>HANDS</span>'; }
    else st.classList.remove('on');
  },
  renderOrder(){
    const c=this.active(), box=el('cartorder');
    if(!c){ box.innerHTML='<div class="none">No one at the cart. Enjoy it while it lasts.</div>';
            this.want(null); return; }
    let gross=0; for(const it of c.items) gross += it.m.price*it.qty;
    box.innerHTML='<div class="hdr"><h4>'+c.name+'</h4><span class="amt">'+money(gross,2)+'</span></div>'+
      c.items.map(it=>{
        const doneAll=it.done>=it.qty;
        const f=doneAll?100:((it.done + it.prog/it.m.taps)/it.qty)*100;
        return '<div class="oi'+(doneAll?' done':'')+'"><span class="fill" style="width:'+f+'%"></span>'+
          '<span class="em">'+it.m.em+'</span><span class="nm">'+it.m.name+'</span>'+
          '<span class="ct">'+it.done+' / '+it.qty+'</span></div>';
      }).join('');
    this.want(c);
  },
  want(c){                                          // highlight what this order still needs
    const need = c? new Set(c.items.filter(x=>x.done<x.qty).map(x=>x.m.id)) : new Set();
    el('carthotspots').querySelectorAll('.hotspot').forEach(b=>
      b.classList.toggle('want', need.has(b.dataset.m)));
  },
  /* the payoff beat: a customer holding what they ordered, then walking off */
  flashServed(c){ HS.Cart3D.served(c); },     // they take it from your hand and walk off with it
  float(text,color){
    const n=document.createElement('div');
    n.className='cfloat'; n.textContent=text; n.style.color=color||'var(--paper)';
    n.style.left=(30+Math.random()*32)+'%'; n.style.top='52%';
    el('cartwrap').appendChild(n);
    setTimeout(()=>n.remove(),1000);
  },

  /* ---- close of day ---- */
  canGraduate(){ return G.cash>=this.GOAL_CASH && this.rep>=this.GOAL_REP; },

  endDay(){
    this.dayT=0; this.summary=true;
    const roll=wpick(CART_DICE);
    let effect='';
    if(this.mod.days>0){ this.mod.days--; if(!this.mod.days){ this.mod.traffic=1; this.mod.cost=1; } }
    if(roll.rep){ this.rep=clamp(this.rep+roll.rep,0,100); effect+='<div class="kv"><span>Reputation</span><span>'+(roll.rep>0?'+':'')+roll.rep+'</span></div>'; }
    if(roll.cash!==undefined){
      const amt = roll.cash==='tips' ? -Math.round(this.tipsDay)
                : (typeof roll.cash==='function' ? roll.cash() : roll.cash);
      G.cash=Math.max(0,G.cash+amt);
      effect+='<div class="kv"><span>Cash</span><span>'+(amt>0?'+':'')+money(amt,Math.abs(amt)<1000)+'</span></div>';
    }
    if(roll.traffic){ this.mod.traffic=roll.traffic; this.mod.days=2;
      effect+='<div class="kv"><span>Foot traffic, 2 days</span><span>×'+roll.traffic+'</span></div>'; }
    if(roll.cost){ this.mod.cost=roll.cost; this.mod.days=2;
      effect+='<div class="kv"><span>Ingredient cost, 2 days</span><span>×'+roll.cost+'</span></div>'; }

    const profit=this.takings-this.spent;
    const ready=this.canGraduate();

    UI.sheet(
      '<h2>Day '+this.day+' — closed</h2>'+
      '<div class="card"><div class="eyebrow">The shift</div>'+
        '<div class="kv"><span>Takings</span><span>'+money(this.takings,2)+'</span></div>'+
        '<div class="kv"><span>Of which tips</span><span>'+money(this.tipsDay,2)+'</span></div>'+
        '<div class="kv"><span>Ingredients</span><span>-'+money(this.spent,2)+'</span></div>'+
        '<div class="kv"><span>Profit</span><span style="color:'+(profit>=0?'var(--mint)':'var(--blood)')+'">'+money(profit,2)+'</span></div>'+
        '<div class="kv"><span>Served / walked off</span><span>'+this.served+' / '+this.walkouts+'</span></div>'+
        '<div class="kv"><span>Reputation</span><span>'+Math.round(this.rep)+' / 100</span></div>'+
      '</div>'+
      '<h3'+(roll.good?' style="color:var(--mint)"':'')+'>'+(roll.good?'🎲 ':'🎲 ')+roll.t+'</h3>'+
      '<div class="card"><p>'+roll.x+'</p>'+(effect?'<div style="margin-top:8px">'+effect+'</div>':'')+'</div>'+
      (ready
        ? '<h3>You have enough to trade up</h3><div class="card"><p>'+money(G.cash)+' saved and a reputation of '+
          Math.round(this.rep)+'. A dealer will take your savings as a deposit and the bank will lend you the rest '+
          'against the cart. That is how everyone starts.</p>'+
          '<button class="btn primary" id="cartGrad">Buy a food truck</button></div>'
        : '<div class="card"><div class="eyebrow">To trade up you need</div>'+
          '<div class="kv"><span>Savings</span><span>'+money(G.cash)+' / '+money(this.GOAL_CASH)+'</span></div>'+
          '<div class="kv"><span>Reputation</span><span>'+Math.round(this.rep)+' / '+this.GOAL_REP+'</span></div></div>')+
      '<button class="btn'+(ready?'':' primary')+'" id="cartNext">Open tomorrow</button>'
    );
    if(ready) el('cartGrad').onclick=()=>{ UI.closeSheet(); this.graduate(); };
    el('cartNext').onclick=()=>{ UI.closeSheet(); this.nextDay(); };
    Save.write();
  },
  nextDay(){
    this.summary=false;
    this.day++; this.served=this.walkouts=0; this.takings=this.spent=this.tipsDay=0;
    this.queue.length=0; this.sig=''; this.spawnAcc=0;
    this.render(true);
    UI.banner('DAY '+this.day,'the cart');
  },

  /* ---- hand off to the truck game ---- */
  graduate(){
    this.summary=false;
    const loan=62000;
    G.debt += loan; G.cash += loan;
    G.phase='truck';
    this.stop();
    UI.sheet('<h2>You signed for it</h2>'+
      '<div class="card"><div class="kv"><span>Cart savings</span><span>'+money(G.cash-loan)+'</span></div>'+
      '<div class="kv"><span>Bank loan</span><span>'+money(loan)+'</span></div>'+
      '<div class="kv"><span>Buying power</span><span style="color:var(--chit)">'+money(G.cash)+'</span></div>'+
      '<div class="kv"><span>Debt carried</span><span style="color:var(--blood)">'+money(loan)+'</span></div></div>'+
      '<p style="margin-top:10px">The loan accrues interest every night whether or not you sell a thing. '+
      'You carried '+Math.round(this.rep)+' reputation over from the cart — the neighbourhood already knows your name.</p>'+
      '<button class="btn primary" id="cartGo">Choose your truck</button>');
    el('cartGo').onclick=()=>{ UI.closeSheet(); el('start').style.display=''; Boot.toCuisine(this.rep); };
  }
};

/* ========================= START SCREEN / NEW GAME ======================= */

const Boot = {
  cuisine:null, spot:null,

  show(){
    const saved=Save.read();
    let html='';
    html+='<div class="stepwrap on" id="stepMenu"><div class="startrow">'+
      (saved? '<button class="startbtn go" id="btnCont"><i></i><b>Continue</b><span>'+
        (saved.phase==='cart'
          ? 'Cart \u00B7 day '+((saved.cart&&saved.cart.day)||1)+' \u00B7 '+money(saved.cash)
          : 'Day '+saved.day+' \u00B7 '+money(saved.cash))+
        '</span></button>':'')+
      '<button class="startbtn new" id="btnNew"><i></i><b>New game</b></button>'+
      '<button class="startbtn how" id="btnHow"><i></i><b>How it works</b></button>'+
      '</div></div>';

    html+='<div class="stepwrap" id="stepCuisine"><div class="eyebrow">Step one</div>'+
      '<h3 style="font-size:26px;margin-bottom:14px">Choose your first food truck</h3>'+
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">'+
      CUISINE_KEYS.map(k=>{ const c=CUISINES[k];
        return '<div class="card pick" data-cu="'+k+'">'+
          '<div class="shot" style="background-image:url(\''+ART.path(k,'truck')+'\')"></div>'+
          '<h4 style="font-size:18px">'+c.name+'</h4><p>'+c.blurb+'</p>'+
          '<div class="diffdot"><span class="eyebrow" style="margin-right:6px">difficulty</span>'+
          [0,1,2].map(i=>'<i class="'+(i<c.difficulty?'on':'')+'"></i>').join('')+'</div>'+
          '<div style="margin-top:10px">'+c.menu.map(m=>'<div class="kv"><span>'+m.name+'</span><span>'+money(m.price,2)+'</span></div>').join('')+'</div>'+
          '</div>';}).join('')+'</div></div>';

    html+='<div class="stepwrap" id="stepSpot"><div class="eyebrow">Step two</div>'+
      '<h3 style="font-size:26px;margin-bottom:4px">Choose your location</h3>'+
      '<p style="margin-bottom:14px">Foot traffic costs money. A cheap corner leaves cash for equipment; the entrance fills your queue from the first day.</p>'+
      '<div class="grid" id="spotGrid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))"></div></div>';

    // New game: pick who you are first, from Wealth Runner 2's four runners (3D, src/cast.js)
    html+='<div class="stepwrap" id="stepChar"><div class="eyebrow">New game</div>'+
      '<h3 style="font-size:26px;margin-bottom:14px">Who’s running the cart?</h3>'+
      '<div class="charrow">'+HS.RUNNERS.map(r=>
        '<button class="charpick'+(r.id===HS.PLAYER?' sel':'')+'" data-ch="'+r.id+'"><span class="charimg"><i></i></span>'+
        '<b>'+r.label+'</b></button>').join('')+'</div>'+
      '<div class="row" style="justify-content:center;margin-top:16px">'+
        '<button class="btn" id="charBack">Back</button><button class="btn primary" id="charGo">Start on the corner</button></div></div>';

    el('startSteps').innerHTML=html;
    const go=id=>{
      document.querySelectorAll('.stepwrap').forEach(s=>s.classList.remove('on'));
      el(id).classList.add('on');
      this.showreel(id==='stepCuisine');
      el('start').classList.toggle('compact', id!=='stepMenu');
    };

    if(saved) el('btnCont').onclick=()=>{ Save.load(saved); this.resume(saved); };
    el('btnNew').onclick=()=>{ go('stepChar'); this.charPortraits(); };
    el('startSteps').querySelectorAll('[data-ch]').forEach(n=>n.onclick=()=>{
      HS.setPlayer(n.dataset.ch);
      el('startSteps').querySelectorAll('[data-ch]').forEach(m=>m.classList.toggle('sel',m===n));
    });
    el('charBack').onclick=()=>go('stepMenu');
    el('charGo').onclick=()=>{ el('start').style.display='none'; this.showreel(false); Cart.start(); };
    el('btnHow').onclick=()=>{
      UI.sheet('<h2>How it works</h2>'+
        '<h3>The day</h3><p>240 real seconds is one business day, 8:00 AM to 10:00 PM. Customers arrive on a demand curve with lunch and dinner peaks.</p>'+
        '<h3>The kitchen</h3><p>Enter the kitchen and you are inside your truck. Orders land on the rail at the top as paper tickets. '+
        'Walk the line with the arrow keys (or your thumb on a phone): stand at the grill, fryer or prep station and press E to fire '+
        'the next item that belongs there, or click an item on a ticket. When a bag is on the pass, stand at the window and press E to '+
        'hand it over yourself for a better tip. Your two employees also work tickets on their own, '+
        'just slower. Every customer has a patience bar; when it empties they walk out.</p>'+
        '<h3>The money</h3><p>Ingredient costs come from a live commodity market. Wages, rent, fuel and interest are charged at close. '+
        'Revenue is not profit — a busy truck can still lose money.</p>'+
        '<h3>The cart</h3><p>You start on a sidewalk with $800 and a hot dog cart. Press and hold an item — or hold 1, 2, 3 — until it fills to build '+
        'each order. Speed is everything: the faster your hands, the bigger the tip and the faster your name grows. '+
        'At $9,000 saved and 60 reputation the bank will lend you the rest of a truck.</p>'+
        '<h3>The year</h3><p>Days are real dates across a 365-day year. Summer fills the park, winter empties it. '+
        'Seven fairs are scheduled each year — apply early, because they judge you on reputation and following, and a '+
        'rejection costs you that fair until next January.</p>'+
        '<h3>The phone</h3><p>Post once a day, and post at lunch or dinner when the city is actually looking. '+
        'Going viral is not a prize: the surge lands the next day, and if you cannot serve it you lose followers and '+
        'reputation you spent months earning. Click anyone in the park to talk to them — regulars wait longer, spend '+
        'more and tip better, but they drift if you ignore them.</p>'+
        '<h3>The empire</h3><p>Buy vacant spaces, make offers on competitors, and at half the park you can buy the whole thing. '+
        'Then franchise outward, take the second park, and reach a billion.</p>');
    };

    el('startSteps').querySelectorAll('[data-cu]').forEach(n=>n.onclick=()=>{
      this.cuisine=n.dataset.cu;
      ART.preload(this.cuisine);
      this.prepSpots(); go('stepSpot');
    });
  },

  /* the character cards: studio renders of the four runners, made once each as they download */
  charPortraits(){
    if(World.dead) return;
    this.portraits=this.portraits||{};
    HS.RUNNERS.forEach(r=>{
      const put=url=>{ const n=document.querySelector('[data-ch="'+r.id+'"] .charimg'); if(n) n.style.backgroundImage='url('+url+')', n.classList.add('ok'); };
      if(this.portraits[r.id]) return put(this.portraits[r.id]);
      HS.portrait(World.renderer, r.id).then(url=>{ this.portraits[r.id]=url; put(url); }).catch(e=>console.warn('portrait',r.id,e));
    });
  },

  /* jump straight to the cuisine step — used when the cart graduates to a truck */
  toCuisine(carriedRep){
    this.carriedRep = carriedRep || null;
    this.show();
    document.querySelectorAll('.stepwrap').forEach(s=>s.classList.remove('on'));
    el('stepCuisine').classList.add('on');
    this.showreel(true);
  },

  /* a save can land in either phase */
  resume(saved){
    if(saved.phase==='cart' && saved.cart){
      el('start').style.display='none'; this.showreel(false);
      Cart.resume(saved.cart);
    } else this.begin(true);
  },

  // looping truck showreel behind the cuisine step; muted so autoplay is allowed
  showreel(on){
    const v=el('selvid'), veil=el('selveil');
    if(!v) return;
    v.classList.toggle('on',on); veil.classList.toggle('on',on);
    if(on){ const p=v.play(); if(p&&p.catch) p.catch(()=>{}); }
    else { try{ v.pause(); }catch(e){} }
  },

  prepSpots(){
    // build park 1 now so the spot list is real
    G.parks=[makePark(0)];
    const p=G.parks[0];
    const affordable=p.spots.filter(s=>s.price<=G.cash-16000);
    const shown=(affordable.length?affordable:p.spots.slice().sort((a,b)=>a.price-b.price).slice(0,6))
      .sort((a,b)=>b.quality-a.quality).slice(0,8);
    el('spotGrid').innerHTML=shown.map(s=>{
      const stars='★'.repeat(Math.max(1,Math.round(s.quality*5)))+'☆'.repeat(5-Math.max(1,Math.round(s.quality*5)));
      return '<div class="card pick" data-sp="'+s.id+'"><div class="row" style="justify-content:space-between">'+
        '<h4>Space #'+String(s.id).padStart(2,'0')+'</h4><span class="tag hot">'+
        (s.quality>.72?'Premium':(s.quality>.5?'Solid':'Budget'))+'</span></div>'+
        '<div class="kv"><span>Purchase</span><span>'+money(s.price)+'</span></div>'+
        '<div class="kv"><span>Daily rent</span><span>'+money(s.rent)+'</span></div>'+
        '<div class="kv"><span>Foot traffic</span><span>'+pct(s.traffic)+'</span></div>'+
        '<div class="kv"><span>Visibility</span><span>'+pct(s.vis)+'</span></div>'+
        '<div class="kv"><span>Est. daily revenue</span><span>'+money(600+s.quality*2600)+'</span></div>'+
        '<div class="kv"><span>Revenue potential</span><span style="color:var(--chit)">'+stars+'</span></div>'+
        '<div class="bar"><i style="width:'+(s.quality*100)+'%"></i></div></div>';
    }).join('');
    el('spotGrid').querySelectorAll('[data-sp]').forEach(n=>n.onclick=()=>{
      this.spot=p.spots.find(s=>s.id===+n.dataset.sp);
      this.newGame();
    });
  },

  newGame(){
    const p=G.parks[0], s=this.spot;
    G.cash -= s.price;
    s.truck = makeTruck(s, this.cuisine, true);
    s.truck.name = bizName();
    // the name you made at the cart follows you to the truck
    if(this.carriedRep!=null) s.truck.rep = clamp(this.carriedRep, 5, 99);
    G.homeTruck = s.truck;
    // populate competitors
    for(const o of p.spots){
      if(o===s) continue;
      if(Math.random()<0.72) o.truck=makeTruck(o, pick(CUISINE_KEYS), false);
    }
    G.day=1; G.dayT=0; G.today=blankDay(); G.history=[];
    this.begin(false);
  },

  begin(loaded){
    this.showreel(false);
    el('start').style.display='none';
    G.started=true;
    const home=Park.homeTruck(); if(home) ART.preload(home.cuisine);
    World.buildPark();
    UI.quickStats();
    UI.setSpeed(1);
    Kitchen.render();
    if(!loaded){
      UI.banner('DAY 1','open for business');
      setTimeout(()=>UI.note('','👋 First shift','Customers gather in the middle before choosing a truck. Watch for your first ticket.'),1400);
      setTimeout(()=>UI.note('','🍳 The rail','Press Enter kitchen when an order lands. Click an item to start cooking it.'),8000);
    } else {
      UI.note('good','💾 Loaded','Back at day '+G.day+'.');
    }
    Save.write();
  }
};

/* ========================= I. MAIN LOOP ================================== */

let lastT=performance.now();
function frame(now){
  const dt=Math.min(0.05,(now-lastT)/1000); lastT=now;
  // between the cart and your first truck (choosing a cuisine and a space) there is no park yet
  const parkless = !G.parks.length || !G.parks[G.parkIdx];
  document.body.classList.toggle('inpark', G.started && !parkless);
  if(G.started){
    if(G.phase==='cart') Cart.update(dt);
    else if(!parkless){
      Sim.update(dt);
      if(!G.paused) UI.quickStats();
    }
  }
  if(!World.dead){
    try{
      if(Cart.on){
        // the cart: a 3D street corner, with the item buttons over the real compartments
        HS.Cart3D.update(dt, Cart.queue);
        HS.Cart3D.render(World.renderer, dt, false);
        HS.Cart3D.placeHotspots(el('carthotspots'));
      } else if(!G.started || parkless){
        // the start screen is the key art now (style.css #start): nothing 3D to draw behind it
      } else {
        World.frame(dt);
        World.render();
      }
    }catch(err){ console.error(err); }
  }
  requestAnimationFrame(frame);
}

(function boot(){
  Market.init();
  G.today=blankDay();
  if(innerWidth<820) CFG.MAX_CUSTOMERS=38;
  World.init();
  // your character, your crew and the public: ~1 MB each, downloaded in the background (src/body.js)
  // (you and the other three runners first: they're on the character-select cards)
  [HS.PLAYER].concat(HS.RUNNERS.map(r=>r.id), HS.STAFF.slice(0,2), HS.crowdIds(MOBILE))
    .filter((id,i,a)=>a.indexOf(id)===i)
    .reduce((p,id)=>p.then(()=>HS.Body.load(id).catch(()=>{})), Promise.resolve());
  UI.init();
  Boot.show();
  // the landing (key art + PLAY) goes first; PLAY reveals the menu
  el('btnPlay').onclick=()=>{ const l=el('landing'); l.classList.add('leaving'); Sfx.ensure(); setTimeout(()=>l.hidden=true,460); };
  requestAnimationFrame(frame);
})();
