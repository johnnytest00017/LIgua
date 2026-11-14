#!/usr/bin/env python3
"""Turns both_24.html into both_25.html: translation + AI tutor go through the shared engine (safina-ai.js).
Every replacement must match exactly once, otherwise the script stops, so nothing is changed silently."""
import os, sys

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit('PATCH FAILED: expected %d match(es), found %d for:\n%s' % (count, n, old[:160]))
    s = s.replace(old, new)


def between(start, end, new):
    global s
    a = s.index(start)
    b = s.index(end, a)
    s = s[:a] + new + s[b:]


# 1. scripts: engine before the page's own code, UI after it
rep('<script src="lingua-native.js"></script>',
    '<script src="safina-trace.js"></script>\n<script src="safina-ai.js"></script>\n<script src="safina-models.js"></script>\n<script src="safina-boot.js"></script>')   # lingua-native.js is gone from the project and nothing else used it
rep('</script>\n<script src="safina-library.js"></script>',
    '</script>\n<script src="safina-ai-ui.js"></script>\n<script src="safina-library.js"></script>')

# 2. the translation block: draft -> AI pass -> user
between('// ---------- Local ONNX translation (the ONLY translation engine', '\nfunction show(i){', r'''// ---------- Translation: draft (on-phone translator or API) -> AI pass -> you. The engine is safina-ai.js ----------
const errText=e=>(e&&e.message)?e.message:String(e);
const LEARN=()=>SAI.lang().learn,NATIVE=()=>SAI.lang().native;
const LANG_TTS=()=>SAI.langInfo(LEARN()).tts;
const SHOWDIA=()=>window.SAFINA_SHOWDIA();
const isWord=t=>!/\s/.test(String(t||'').trim());
/* kept for the many call sites: a single word is looked up in its sentence, anything longer is a line */
async function translateCached(text,sentence){
  const q=String(text||'').trim();
  if(!q)return '';
  if(isWord(q))return (await SAI.lookupWord(q,sentence||'')).gloss;
  return (await SAI.translateLine(q)).t;
}
const cueCtx=i=>({prev:[AR[i-2],AR[i-1]].filter(Boolean).map(c=>c.t),next:[AR[i+1]].filter(Boolean).map(c=>c.t)});
/* diacritised words for line i, only when the AI produced them for exactly the same words */
function diaWords(i){
  if(!AR[i]||!SHOWDIA())return null;
  const c=SAI.cached(AR[i].t);if(!c||!c.d)return null;
  const w=c.d.split(/\s+/).filter(Boolean);
  return w.length===tokens(AR[i].t).length?w:null;
}
function applyDia(box,i){
  if(!box||!AR[i])return;
  const w=diaWords(i),t=tokens(AR[i].t);
  box.querySelectorAll('.w').forEach(sp=>{const k=+sp.dataset.k;sp.textContent=w?w[k]:t[k]});
}
window.addEventListener('safina-dia',()=>{if(cur>=0){applyDia($('ar'),cur);if(C.classList.contains('open'))applyDia($('pAr'),cur)}});
function setNote(html){
  let n=$('pNote');
  if(!n){const pe=$('pEn');if(!pe)return;n=document.createElement('div');n.id='pNote';n.className='pnote';pe.after(n)}
  n.innerHTML=html||'';
}
function noteFor(r){
  if(!r)return '';
  const bits=[];
  if(r.m)bits.push(escapeHtml(r.m));
  if(r.refined===false)bits.push('<span class="dim">Draft only, no AI pass. <a href="#" data-open-ai>Set up AI</a></span>');
  else if(r.via&&r.via.label)bits.push('<span class="dim">Checked by '+escapeHtml(r.via.label)+'</span>');
  return bits.join('<br>');
}
/* translate the next lines in one request, only when the lines already ready are running low */
function prefetchAhead(i){
  try{
    let ready=0;
    for(let k=i+1;k<=i+4&&k<AR.length;k++){if(findEn(AR[k]).trim()||SAI.cached(AR[k].t))ready++;else break}
    if(ready>=Math.min(4,AR.length-1-i))return;
    const list=[];
    for(let k=i+1;k<Math.min(AR.length,i+14);k++){if(!findEn(AR[k]).trim())list.push(AR[k].t)}
    if(list.length)SAI.prefetch(list);
  }catch(e){}
}
async function translateMissingSubtitle(i){
  if(i<0||!AR[i])return '';
  const cue=AR[i],arabic=String(cue.t||'').trim();
  if(!arabic||findEn(cue).trim())return '';
  let res=null,failure='';
  try{res=await SAI.translateLine(arabic,{ctx:cueCtx(i)})}
  catch(e){console.error('Subtitle translation failed:',e);failure=errText(e)}
  // never let an older translation replace the line now on screen
  if(cur===i&&AR[i]===cue&&!findEn(cue).trim()){
    const result=(res&&res.t)||failure||'Translation unavailable.';
    $('en').textContent=result;
    if(C.classList.contains('open')){$('pEn').textContent=result;setNote(failure?'<a href="#" data-open-ai>Open AI settings</a>':noteFor(res)) }
    if(failure){$('pEn').classList.add('errorNote');$('en').classList.add('errorNote')}
    else{$('pEn').classList.remove('errorNote');$('en').classList.remove('errorNote')}
    if(res&&res.d){applyDia($('ar'),i);if(C.classList.contains('open'))applyDia($('pAr'),i)}
  }
  return res?res.t:'';
}
''')

# 3. diacritics are applied after the tokens are drawn
rep("    box.appendChild(sp);box.appendChild(document.createTextNode(' '));\n  });\n}",
    "    box.appendChild(sp);box.appendChild(document.createTextNode(' '));\n  });\n  applyDia(box,i);\n}")

# 4. status text + prefetch + panel note
rep("Translating locally…", "Translating…", count=3)
rep("Translating on this device…", "Translating…")
rep("  if(!english) void translateMissingSubtitle(i);\n\n  if(C.classList.contains('open')) fillPanel(i);",
    "  if(!english) void translateMissingSubtitle(i);\n  prefetchAhead(i);\n\n  if(C.classList.contains('open')) fillPanel(i);")
rep("  if(!english) void translateMissingSubtitle(i);\n\n  $('word').innerHTML",
    "  if(english)setNote('');\n  if(!english) void translateMissingSubtitle(i);\n\n  $('word').innerHTML")

# 5. word panel: meaning in this sentence, diacritics, part of speech
rep("// Word panel: translation comes from the local ONNX model only.", "// Word panel: meaning in this sentence, with diacritics, from the shared engine (draft -> AI pass).")
rep("""    const en=await translateCached(word);
    if(!ok())return;
    LW.tr=en;
    const M=$('mean');M.className='';
    M.innerHTML='<div class="m">'+escapeHtml(en)+'</div><div class="apiNote">On-device ONNX translation (Arabic → English). A single word is translated without context, so the sentence translation above is usually more reliable.</div>';""",
"""    const r=await SAI.lookupWord(word,sentence);
    if(!ok())return;
    const en=r.gloss;LW.tr=en;LW.dia=r.d||'';
    const M=$('mean');M.className='';
    M.innerHTML=(r.d?'<div class="m" dir="auto" style="font-size:1.4em">'+escapeHtml(r.d)+'</div>':'')+'<div class="m">'+escapeHtml(en)+'</div>'+
      ((r.pos||r.root)?'<div class="apiNote">'+escapeHtml([r.pos,r.root?'root '+r.root:''].filter(Boolean).join(' · '))+'</div>':'')+
      (r.note?'<div class="apiNote">'+escapeHtml(r.note)+'</div>':'')+
      (r.refined===false?'<div class="apiNote">Draft only, no AI pass. <a href="#" data-open-ai>Set up AI</a></div>':'<div class="apiNote">Meaning in this sentence'+(r.via&&r.via.label?' · '+escapeHtml(r.via.label):'')+'</div>');""")
rep('gloss=(await translateCached(w))||""}catch(e){gloss=""}}\n  const msg=await saveCards',
    'gloss=(await translateCached(w,AR[i]&&AR[i].t))||""}catch(e){gloss=""}}\n  const msg=await saveCards')

# 6. voices follow the language being learned
rep("u.lang='ar-SA';u.rate=.8;", "u.lang=LANG_TTS();u.rate=.8;")
rep('u.lang="ar-SA";u.rate=r||.85;', 'u.lang=LANG_TTS();u.rate=r||.85;')
rep('ar=(t.match(/[\\u0600-\\u06FF]/g)||[]).length,la=(t.match(/[A-Za-z]/g)||[]).length;u.lang=ar>la?"ar-SA":"en-US"',
    'ar=(t.match(new RegExp(SAI.langInfo(LEARN()).script.source,"g"))||[]).length,la=(t.match(/[A-Za-z]/g)||[]).length;u.lang=ar>la?LANG_TTS():"en-US"')

# 7. profile: language-aware heading + entry to AI settings
rep('<h2 style="margin:0">Profile · Learning Arabic</h2>', '<h2 style="margin:0">Profile · Learning <span id="sai-learn-name">Arabic</span></h2>')
rep(' <div class="card" id="xp"></div>',
    ' <div class="card"><b>AI &amp; downloads</b><div class="mu" id="sai-profile-status" style="margin:6px 0 10px"></div><button class="pri" id="safinaAiOpen">Open AI settings</button></div>\n <div class="card" id="xp"></div>')

# 8. the tutor: real accounts, limits, hand-off
between('// ---- AI (viewer\'s Claude via the sample capability)', '\n// ---- AI tutor (Claude-app style)',
       '// ---- AI: every call goes through the shared engine (accounts, limits, hand-off, on-phone fallback): see safina-ai.js')
rep("AIS.chats.slice(0,40).map(c=>({id:c.id,t:c.t,ts:c.ts,msgs:c.msgs.slice(-60)}))",
    "AIS.chats.slice(0,40).map(c=>({id:c.id,t:c.t,ts:c.ts,lastVia:c.lastVia,msgs:c.msgs.slice(-60)}))")
rep("function aiRow(m,opts){opts=opts||{};const me=m.r==\"me\"",
    "function aiRow(m,opts){opts=opts||{};if(m.r==\"sys\"){const d=document.createElement(\"div\");d.className=\"wa-sys\";d.textContent=m.t;d.dir=\"auto\";d._m=m;return d}const me=m.r==\"me\"")
rep("bb.append(tx);col.append(bb);\n", "bb.append(tx);col.append(bb);if(!me&&m.via){const vv=document.createElement(\"div\");vv.className=\"wa-via\";vv.textContent=m.via;col.append(vv)}\n")
rep("<b>Arabic Tutor</b></div>\"", "<b>\"+SAI.langInfo(LEARN()).name+\" Tutor</b></div>\"")
rep("h+=\"<div class='dfoot'>\"+\"<div class='dr' data-act='exit'>\"",
    "h+=\"<div class='dfoot'>\"+\"<div class='dr' data-act='settings'>\"+AI_I.plus+\"<span>AI settings</span></div>\"+\"<div class='dr' data-act='exit'>\"")
rep("else if(k==\"exit\"){aiOpenDrawer(false);pane(\"hub\")}};",
    "else if(k==\"settings\"){aiOpenDrawer(false);SafinaUI.open()}else if(k==\"exit\"){aiOpenDrawer(false);pane(\"hub\")}};")

between('function aiPrompt(){', '\nfunction aiTyping()', r'''function aiPrompt(){   /* system prompt only: the conversation goes as real messages, so any AI can take it over */
 const ids=[...new Set(AIH.slice(-14).filter(m=>m.f).map(m=>m.f.id))],fl=ids.map(id=>AIS.files.find(f=>f.id==id)).filter(Boolean).map(f=>"[File: "+f.name+"]\n"+f.text.slice(0,5000)).join("\n\n");
 return aiMods(0)+SAI.tutorSystem((AIX.research?"Give a thorough, well-structured answer with headings, examples and a short summary at the end.":"Keep answers under 150 words.")+" You may use **bold**, short lists and line breaks. Stay in the conversation and use its context. Learner's saved words: "+(vocab.map(v=>v.lemma+"="+v.tr).slice(0,40).join(", ")||"none yet")+"."+(fl?"\n\nFiles shared by the learner:\n"+fl:""))}''')

rep(' try{const S=await getAI();if(!S)throw Object.assign(new Error("na"),{code:"na"});const r=await S(aiPrompt(),{cache:false,model:AIX.model,web:AIX.web,think:AIX.think,images:aiImgs()});txt=String(r.text||"").trim()||"…"}catch(e){err=e}',
    ' let via=null;try{const r=await SAI.chat({system:aiPrompt(),messages:AIH.slice(-40),images:aiImgs()});txt=String(r.text||"").trim()||"…";via=r.via}catch(e){err=e}')
rep(""" if(err){const m={r:"bot",t:err.code=="na"?"The AI tutor is not available in this app. Translation in Safina runs on-device only.":"Something went wrong ("+(err.code||"unknown")+").",ts:Date.now()},row=aiRow(m,{noact:true});
  if(err.code!="na"){const bt=document.createElement("button");bt.className="wa-retry";bt.textContent="Try again";bt.onclick=()=>{row.remove();aiRun()};row.querySelector(".wa-col").append(bt)}""",
""" if(err){const soft=err.kind=="none"||err.kind=="limit",m={r:"bot",t:soft?err.message:"Something went wrong: "+(err.message||"unknown"),ts:Date.now()},row=aiRow(m,{noact:true});
  {const bt=document.createElement("button");bt.className="wa-retry";bt.textContent=soft?"Open AI settings":"Try again";bt.onclick=()=>{if(soft)SafinaUI.open();else{row.remove();aiRun()}};row.querySelector(".wa-col").append(bt)}""")
rep(" const m={r:\"bot\",t:\"\",ts:Date.now()},row=aiRow(m);L.append(row);",
    " if(via){const lv=curChat&&curChat.lastVia;if(lv&&lv!==via.label){const n={r:\"sys\",t:\"Continuing with \"+via.label+\". The chat so far was passed on.\",ts:Date.now()};AIH.push(n);L.append(aiRow(n))}if(curChat)curChat.lastVia=via.label}\n const m={r:\"bot\",t:\"\",ts:Date.now(),via:via&&via.label},row=aiRow(m);L.append(row);")

# 9. the picker lists real accounts and models; "web search" is dropped because no provider path supports it here
rep('const aiModel=()=>AI_MODELS.find(m=>m.id==AIX.model)||AI_MODELS[1];',
    'const aiModel=()=>{const s=SAI.active();if(!s)return{n:"Add AI"};if(s.accountId=="local")return{n:"On phone"};const a=SAI.state().accounts.find(x=>x.id==s.accountId);return{n:a?SAI.PROVIDERS[a.provider].name+(a.label!==SAI.PROVIDERS[a.provider].name?" · "+a.label:""):"AI"}};')
rep("  h+=item(MI.web,\"Web search\",\"Let the AI look things up\",\"tg:web\",sw(AIX.web));\n", "")
rep('if(aiMenuView=="model")h+=AI_MODELS.map(m=>item("","<b>"+m.n+"</b>",m.d,"model:"+m.id,m.id==AIX.model?"<b class=\'ck\'>✓</b>":"")).join("");',
    'if(aiMenuView=="model"){const act=SAI.active();h+=SAI.listSlots().map((s,i)=>item("","<b>"+esc(s.provider=="local"?"On-phone AI":SAI.PROVIDERS[s.provider].name+" · "+s.account)+"</b>",esc(s.model=="local"?(s.usable?"Free, works offline":"Not downloaded yet"):s.model)+(s.limit?" · limit until "+new Date(s.limit.until).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):!s.usable?" · unavailable":""),"slot:"+i,act&&act.accountId==s.slot.accountId&&act.model==s.slot.model?"<b class=\'ck\'>✓</b>":"")).join("")+item("","<b>AI settings…</b>","Accounts, downloads, languages","settings","")}')
rep('else if(k=="model"){AIX.model=v;',
    'else if(k=="slot"){const s=SAI.listSlots()[+v];if(s&&s.usable){SAI.setActive(s.slot);aiAixUI();aiPopClose();toast("Using "+SAI.describe(s.slot))}else toast("Not available. Check AI settings.")}else if(k=="settings"){aiPopClose();SafinaUI.open()}\n else if(k=="model"){AIX.model=v;')

# 10. Socials and the library: no invented data. YouTube is real; news comes from RSS; the other platforms get AI-written practice posts (marked as such)
rep('<span id="aimodelname">Sonnet 5.5</span>', '<span id="aimodelname">AI</span>')
rep('+" · Arabic</div>";', '+" · "+esc(SAI.langInfo(LEARN()).name)+"</div>";')
rep('["Daily Phrases","A1","w","#1f5f7a,#0b1e2b"]', '["Daily Phrases","Soon","","#1f5f7a,#0b1e2b"]')
rep('["Beginner Dialogues","A1","w","#6b1f2f,#1a0a0e"]', '["Beginner Dialogues","Soon","","#6b1f2f,#1a0a0e"]')
rep("{if(typeof capShow==='function'){const _c=capShow;capShow=function(){const r=_c.apply(this,arguments);paintAll();return r}}}\n", "")

between('// ---- data: word|lemma|gloss in THIS sentence', 'const $=id=>', '')
between('const T=[["تعلّم', 'const GR=[', '')
between('const CM=[["سارة"', '// ---- real YouTube', r'''// ---- news: a real RSS feed per source, read through the app's native HTTP (no CORS). Set your own feed URL per source if these move.
const NEWS={aj:"https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdb33344e47",bbc:"https://feeds.bbci.co.uk/arabic/rss.xml",f24:"https://www.france24.com/ar/rss"};
const plain=h=>new DOMParser().parseFromString(String(h||""),"text/html").body.textContent.replace(/\s+/g," ").trim();
async function newsFetch(p){
 const url=ld("lp_rss_"+p,"")||(LEARN()=="ar"?NEWS[p]:"");if(!url)return{err:"nofeed"};
 const ck="lp_n:"+url,c=ld(ck,null);if(c&&Date.now()-c.t<9e5)return{items:c.v};
 try{const r=await window.SAFINA_HTTP({url,method:"GET",headers:{Accept:"application/rss+xml, application/xml, text/xml, */*"}});
  if(r.status>=400)throw new Error("The feed answered "+r.status);
  const doc=new DOMParser().parseFromString(r.text,"text/xml");if(doc.querySelector("parsererror"))throw new Error("That address is not an RSS feed.");
  const txt=(n,t)=>{const e=n.getElementsByTagName(t)[0];return e?e.textContent.trim():""};
  const items=[...doc.querySelectorAll("item,entry")].slice(0,30).map((n,i)=>{
   const enc=n.getElementsByTagName("enclosure")[0],mt=n.getElementsByTagNameNS("*","thumbnail")[0]||n.getElementsByTagNameNS("*","content")[0],le=n.getElementsByTagName("link")[0];
   const th=(mt&&mt.getAttribute("url"))||(enc&&/image/.test(enc.getAttribute("type")||"")&&enc.getAttribute("url"))||null;
   return{id:p+i,i,ar:plain(txt(n,"title")),en:"",ch:PL[pi()][1],t:(ms=>ms?ytAgo(ms):"")(Date.parse(txt(n,"pubDate")||txt(n,"published")||txt(n,"updated"))),d:"",th,link:(le&&(le.textContent.trim()||le.getAttribute("href")))||"",desc:plain(txt(n,"description")||txt(n,"summary")||txt(n,"content"))}}).filter(x=>x.ar);
  if(!items.length)throw new Error("The feed has no articles.");
  sv(ck,{t:Date.now(),v:items});return{items}}
 catch(e){return{err:e.message||"Could not load the feed."}}}
async function articleBody(x){
 const ck="lp_a:"+x.link,c=ld(ck,null);if(c&&c.length)return c;let ps=[];
 if(x.link)try{const r=await window.SAFINA_HTTP({url:x.link,method:"GET",headers:{}});const d=new DOMParser().parseFromString(r.text,"text/html"),root=d.querySelector("article")||d.querySelector("main")||d.body;
  ps=[...root.querySelectorAll("p")].map(p=>p.textContent.replace(/\s+/g," ").trim()).filter(t=>t.length>40).slice(0,14)}catch(e){}
 if(!ps.length&&x.desc)ps=[x.desc];if(ps.length)sv(ck,ps);return ps}
// ---- practice posts: TikTok, Facebook, Instagram and X do not let apps read their feeds, so the AI writes short posts in the style of each. They are labelled as practice text.
async function practice(p,topic,fresh){
 const nm=SAI.langInfo(LEARN()).name,ck="lp_pp:"+LEARN()+":"+p+":"+(topic||"");if(fresh)localStorage.removeItem(ck);
 const c=ld(ck,null);if(c&&Date.now()-c.t<216e5)return{items:c.v};
 const style={tt:"short video captions",fb:"friendly everyday status updates",ig:"photo captions with a few hashtags",x:"short opinionated posts under 200 characters"}[p]||"short posts";
 try{const r=await SAI.chat({system:"You write reading practice for language learners. Reply with JSON only, no other text.",messages:[{r:"me",t:"Write 8 different "+style+" in natural, everyday "+nm+" for a beginner to intermediate learner"+(topic?", about: "+topic:"")+". Each is 1 to 3 short sentences. JSON: {\"posts\":[{\"text\":\"...\",\"topic\":\"one or two English words\"}]}"}]});
  const j=SafinaAI.parseLooseJSON(r.text),a=(j&&j.posts||[]).filter(x=>x&&x.text);if(!a.length)throw new Error("The AI did not return any posts. Try again.");
  const items=a.slice(0,10).map((x,i)=>({id:p+i,i,ar:String(x.text).trim(),topic:String(x.topic||"").trim()}));sv(ck,{t:Date.now(),v:items});return{items}}
 catch(e){return{err:e.message||"Could not write posts."}}}
''')

rep('relevanceLanguage=ar&order=', 'relevanceLanguage="+LEARN()+"&order=')
rep('const YQ={Learn:"تعلم اللغة العربية",story:"قصص عربية",coffee:"طبخ عربي",news:"نشرة أخبار"};',
    'const YQ=n=>({Learn:"learn "+n,story:n+" stories",coffee:n+" cooking",news:n+" news"});')
rep(' if(p!="yt")return API0.feed(p,tab,q);\n YERR="";const short=tab=="shorts",base=q?(YQ[q]||q):short?"#shorts عربي":tab=="subs"?"قصص عربية":"تعلم اللغة العربية للمبتدئين",order=',
    ' YERR="";const nm=SAI.langInfo(LEARN()).name,short=tab=="shorts",base=q?(YQ(nm)[q]||q):short?"#shorts "+nm:tab=="subs"?nm+" stories":"learn "+nm+" for beginners",order=')
rep(""":"<div class='th sim "+(c||"")+"' style='"+tb(x)+"' data-a='tog'>"+art(x)+"<span class='pl'>▶</span><div class='pb'><i style='animation-duration:"+sec(x.d)+"s'></i></div></div>";""", ':"";')

between('const cmt=c=>', 'const ACC=', r'''const card=x=>"<div class='vi' data-a='v:"+x.i+"'>"+thumb(x)+"<div class='po' style='margin-top:10px;align-items:flex-start'>"+av(x)+"<div><div class='pt rt' style='margin:0'>"+esc(x.ar)+"</div><div class='pm'>"+esc(x.ch)+" · "+x.t+"</div></div></div></div>";
const nr=x=>"<div class='nr' data-a='v:"+x.i+"'>"+pic(x)+"<div><div class='rt' style='font-weight:700'>"+esc(x.ar)+"</div><div class='pm'>"+esc(x.ch)+" · "+x.t+"</div></div></div>";
const tabs=a=>"<div class='bar'>"+a.map(k=>"<button class='"+(tab==k[0]?"on":"")+"' data-a='t:"+k[0]+"'>"+k[1]+"</button>").join("")+"</div>";
const chips="<div class='shelf'>"+[["","All"],["Learn","Learn"],["story","Stories"],["coffee","Cooking"],["news","News"]].map(c=>"<button data-a='c:"+c[0]+"'>"+c[1]+"</button>").join("")+"</div>";
const feed=it=>"<div class='tt'>"+it.map(x=>"<div class='tv sim ps' style='"+tb(x)+"' data-a='v:"+x.i+"'>"+art(x)+"<span class='pl'>▶</span><div class='cap'><b>"+esc(x.ch)+"</b><div class='rt'>"+esc(x.ar)+"</div></div></div>").join("")+"</div>";
/* every word becomes tappable; the block it sits in is the sentence given to the AI for context */
const tapw=t=>{t=String(t||"");let o="",last=0;for(const m of t.matchAll(/[\p{L}\p{M}\p{N}]+/gu)){o+=esc(t.slice(last,m.index))+"<span class='w' data-a='w'>"+esc(m[0])+"</span>";last=m.index+m[0].length}return o+esc(t.slice(last))};
const tblock=(t,st)=>"<div class='tp' data-p><div class='rt' style='"+(st||"font-size:20px;line-height:2")+"'>"+tapw(t)+"</div><div class='mu tr'></div></div>";
const pcard=x=>"<div class='card'><div class='mu' style='margin-bottom:6px'>"+esc(x.topic||"Practice")+"</div>"+tblock(x.ar,"font-size:19px;line-height:2")+"<div class='shelf' style='margin:8px 0 0'><button data-a='tr1'>Translate</button><button data-a='say1'>🔊 Listen</button></div></div>";
const detail=(x,ty,l)=>ty=="news"
 ?(x.th?pic(x):"")+tblock(x.ar,"font-size:22px;line-height:2;font-weight:700")+"<div class='pm'>"+esc(x.ch)+" · "+x.t+"</div><div id='nbody'><p class='mu'>Loading the article…</p></div><div class='shelf'><button class='pri' data-a='trall'>Translate</button>"+(x.link?"<button data-a='orig'>Open original</button>":"")+"</div><div class='mu' style='font-size:12px'>Tap any word for its meaning in context.</div>"
 :med(x)+"<div class='pt rt'>"+esc(x.ar)+"</div><div class='pm'>"+esc(x.ch)+" · "+x.t+"</div><div class='shelf'><button class='pri' data-a='learn'>🎓 Learn with this</button></div><div class='sh'>Up next</div><div class='vr'>"+l.filter(y=>y.id!=x.id).slice(0,8).map(card).join("")+"</div>";
''')

between('let CT=0,CI=-1;', 'function chrome()', r'''/* word sheet: the AI explains the word in this sentence (draft meaning first, then the AI pass), and you can save it */
async function wsheet(word,sent){document.querySelectorAll(".sheet").forEach(e=>e.remove());
 const d=document.createElement("div");d.className="sheet";
 d.innerHTML="<div class='po'><div class='ar rt' style='flex:1'>"+esc(word)+"</div><button data-a='x'>✕</button></div><div class='wb mu'>Looking it up…</div><div class='shelf' style='margin:12px 0 0'><button class='b1'>🔊 Word</button><button class='b2'>🔊 Sentence</button></div>";
 d.querySelector(".b1").onclick=()=>say(word);d.querySelector(".b2").onclick=()=>say(sent);$("soc").append(d);const wb=d.querySelector(".wb");
 try{const r=await SAI.lookupWord(word,sent),have=vocab.find(v=>v.lemma==r.lemma);
  wb.className="wb";wb.innerHTML=(r.d&&SHOWDIA()?"<div class='rt' style='font-size:22px'>"+esc(r.d)+"</div>":"")+"<b>"+esc(r.gloss)+"</b><div class='mu'>"+esc([r.lemma&&r.lemma!=word?r.lemma:"",r.pos,r.root?"root "+r.root:""].filter(Boolean).join(" · "))+"</div>"+(r.note?"<div class='mu'>"+esc(r.note)+"</div>":"")+(r.refined?"":"<div class='mu' style='font-size:12px'>Draft meaning, not checked by the AI.</div>");
  const b=document.createElement("button");b.className="pri";b.textContent=have?"Saved ✓":"+ Add to vocabulary";
  b.onclick=()=>{const ex=vocab.find(v=>v.lemma==r.lemma);if(ex)ex.n++;else vocab.push({word,lemma:r.lemma||word,tr:r.gloss,sent,sentTr:"",src:"Socials",date:today(),n:1,ease:2.5,ivl:0,due:today(),reps:0,hist:[]});sv("lp_v",vocab);b.textContent="Saved ✓";render()};
  d.querySelector(".shelf").append(b)}
 catch(e){wb.innerHTML=esc(e.message||"Lookup failed")+" <button data-a='aiset'>AI settings</button>"}}
/* translate one block (title, paragraph or post) and, for diacritic languages, show it voweled */
async function trBlock(el,ctx){const rt=el.querySelector(".rt"),out=el.querySelector(".tr");if(!rt||!out||out.dataset.done)return;out.textContent="…";
 try{const r=await SAI.translateLine(rt.textContent,{ctx});out.dataset.done=1;out.textContent=r.t;if(r.d&&SHOWDIA()&&!rt.dataset.dia){rt.dataset.dia=1;rt.innerHTML=tapw(r.d)}}
 catch(e){out.textContent=(e&&e.message)||"Translation failed"}}
let SOCN=0;
''')

between('async function soc(){const S=$("soc");', '$("bk").onclick', r'''const rssCard=m=>"<div class='card'><b>"+(m=="nofeed"?"Add a news feed":"Could not load the feed")+"</b><div class='mu' style='margin:6px 0 10px'>"+(m=="nofeed"?"There is no built-in feed for this language and source. Paste an RSS address.":esc(m))+"</div><input id='rin' placeholder='https://…/rss.xml' style='width:100%;padding:10px;border-radius:10px;border:1px solid var(--ln);background:var(--bg);color:var(--tx);font:inherit;margin-bottom:8px'><button class='pri' data-a='rss'>Use this feed</button></div>";
async function soc(){const S=$("soc"),nm=SAI.langInfo(LEARN()).name,my=++SOCN;
 if(!P){S.innerHTML="<div class='rh'><div><h2>Socials</h2><div class='mu'>Videos, social and news in "+esc(nm)+"</div></div></div><div class='sg'>"+PL.map(p=>"<div class='sc' data-a='p:"+p[0]+"' style='background:linear-gradient(150deg,"+p[3]+")'><i>"+p[2]+"</i><div>"+p[1]+"<small>"+(p[4]=="news"?"News":p[4]=="yt"?"Videos":"Practice posts")+"</small></div></div>").join("")+"</div><p class='mu'>YouTube and the news sources are real. TikTok, Facebook, Instagram and X do not let apps read their feeds, so those show posts the AI writes in "+esc(nm)+" for reading practice. They are marked as practice text.</p>";return}
 const ty=PL[pi()][4];let it=[],pre="";
 if(ty=="yt")it=await API.feed(P,tab,Q);
 else if(ty=="news"){S.innerHTML="<p class='mu'>Loading…</p>";const r=await newsFetch(P);if(my!=SOCN)return;if(r.err){S.innerHTML=rssCard(r.err);return}it=Q?r.items.filter(x=>x.ar.includes(Q)):r.items}
 else{S.innerHTML="<p class='mu'>Writing practice posts…</p>";const r=await practice(P,Q);if(my!=SOCN)return;
  if(r.err){S.innerHTML="<p class='mu'>"+esc(r.err)+"</p><button class='pri' data-a='aiset'>AI settings</button>";return}
  S.innerHTML="<div class='card'><b>Practice posts</b><div class='mu' style='margin:4px 0 8px'>Written by the AI in "+esc(nm)+" for reading practice. These are not real "+PL[pi()][1]+" accounts, because "+PL[pi()][1]+" does not let apps read its feed. Type a topic in the search box to change what they are about.</div><button data-a='pref'>New posts</button></div>"+r.items.map(pcard).join("");return}
 if(my!=SOCN)return;
 if(!it.length){S.innerHTML=emptyMsg();return}
 const x=V!==null?it.find(y=>y.i==V):null;let h;
 if(x)h=detail(x,ty,it);
 else if(ty=="yt")h=tabs([["home","Home"],["shorts","Shorts"],["subs","Stories"]])+(tab=="shorts"?feed(it):chips+(tab=="home"?"<div class='sh'>Shorts</div><div class='shelf'>"+it.slice(0,6).map(s=>"<div class='s9' data-a='t:shorts' style='"+tb(s)+"'>"+esc(s.ar)+"</div>").join("")+"</div>":"")+"<div class='vr'>"+it.map(card).join("")+"</div>");
 else h="<div class='vi' data-a='v:"+it[0].i+"'>"+pic(it[0])+"<h2 class='rt' style='font-size:22px'>"+esc(it[0].ar)+"</h2><div class='pm'>"+esc(it[0].ch)+" · "+it[0].t+"</div></div><div class='sh'>Latest</div>"+it.slice(1).map(nr).join("");
 S.innerHTML=h;
 if(x&&ty=="news")articleBody(x).then(ps=>{const b=$("nbody");if(!b||my!=SOCN)return;b.innerHTML=ps.length?ps.map(p=>tblock(p)).join(""):"<p class='mu'>The article text could not be read. Use Open original.</p>"})}
$("soc").onclick=e=>{const a=e.target.closest("[data-a]");if(!a)return;const[k,v]=a.dataset.a.split(":");
 if(k=="w"){const el=a.closest("[data-p]");wsheet(a.textContent,el?el.querySelector(".rt").textContent:a.textContent);return}
 if(k=="tr1"){const el=a.closest(".card").querySelector("[data-p]");trBlock(el,"");return}
 if(k=="say1"){say(a.closest(".card").querySelector(".rt").textContent);return}
 if(k=="trall"){const t=PL[pi()][1];document.querySelectorAll("#soc [data-p]").forEach(el=>trBlock(el,t));return}
 if(k=="orig"){const x=(ld("lp_n:"+(ld("lp_rss_"+P,"")||NEWS[P]),null)||{v:[]}).v.find(y=>y.i==V);if(x&&x.link)window.open(x.link,"_blank");return}
 if(k=="aiset"){SafinaUI.open();return}
 if(k=="pref"){practice(P,Q,true).then(()=>soc());$("soc").innerHTML="<p class='mu'>Writing practice posts…</p>";return}
 if(k=="rss"){const u=$("rin").value.trim();if(!/^https?:\/\//.test(u))return;sv("lp_rss_"+P,u)}
 if(k=="learn")return nav("watch");if(k=="ykey"){const kv=$("kin").value.trim();if(!kv)return;sv(YK,kv)}
 if(k=="x"){document.querySelectorAll(".sheet").forEach(s=>s.remove());return}
 if(k=="p"){P=v;tab=v=="tt"?"fy":"home";V=null;Q="";$("sq").value=""}if(k=="t"){tab=v;V=null}if(k=="v")V=+v;if(k=="c"){Q=v;$("sq").value=v}
 chrome();soc();scrollTo(0,0)};
''')

# 11. The learner brain: signals from watching and reviewing, the sentence verdict chip, AI-made flashcards, review order, tutor level
rep('<script src="safina-boot.js"></script>', '<script src="safina-brain.js"></script>\n<script src="safina-boot.js"></script>')
rep('<script src="safina-ai-ui.js"></script>', '<script src="safina-ai-ui.js"></script>\n<script src="safina-brain-ui.js"></script>')
rep('<script src="safina-brain-ui.js"></script>', '<script src="safina-brain-ui.js"></script>\n<script src="safina-learn-ui.js"></script>')
# 12. Smooth playback: translate everything first (with progress), keep the layout still, do less work per frame
rep('<script src="safina-learn-ui.js"></script>', '<script src="safina-learn-ui.js"></script>\n<script src="safina-path.js"></script>\n<script src="safina-film.js"></script>\n<script src="safina-prep-ui.js"></script>\n<script src="safina-color.js"></script>')
rep('  if(!AR.length)toast("No Arabic subtitle for this item. Import an Arabic .srt together with the video.")}\n catch(e){toast("Could not start playback: "+e.message)}}',
    '  if(!AR.length)toast("No Arabic subtitle for this item. Import an Arabic .srt together with the video.");\n  else{window.SAFINA_PREP_BUSY=true;setTimeout(()=>{try{SAFINA_PREP.offer()}catch(e){window.SAFINA_PREP_BUSY=false}},80)}}\n catch(e){toast("Could not start playback: "+e.message)}}')
rep("  toast(msg.join(' · '));e.target.value=''};",
    "  toast(msg.join(' · '));e.target.value='';window.SAFINA_PREP_BUSY=true;setTimeout(()=>{try{SAFINA_PREP.offer()}catch(e){window.SAFINA_PREP_BUSY=false}},80)};")
rep("async function translateMissingSubtitle(i){\n  if(i<0||!AR[i])return '';","async function translateMissingSubtitle(i){\n  if(window.SAFINA_PREP_BUSY)return '';\n  if(i<0||!AR[i])return '';")
rep("function prefetchAhead(i){\n  try{","function prefetchAhead(i){\n  if(window.SAFINA_PREP_BUSY)return;\n  try{")
# the two status lines above the video appeared and vanished (display:none when empty), which pushed the video up and down
rep('#watch#watch.lp #onnxStatus{margin:0 14px 4px;flex:0 0 auto}',
    '#watch#watch.lp #onnxStatus{margin:0 14px 4px;flex:0 0 auto}\n#watch #st,#watch #onnxStatus{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}\n#watch #onnxStatus{height:16px;min-height:16px}\n#watch#watch.lp #onnxStatus:empty{display:block}')
# the time bar and clock were rewritten on every frame; about 8 times a second is enough to look smooth
rep("  if(v.duration&&!seeking)$('seek').value=v.currentTime/v.duration*1000;\n  $('seek').style.setProperty('--p',(v.duration?v.currentTime/v.duration*100:0)+'%');$('seek').style.setProperty('--pf',v.duration?Math.min(1,v.currentTime/v.duration):0);\n  $('tc').textContent=fmt(v.currentTime);$('td').textContent=fmt(v.duration||0);\n  requestAnimationFrame(tick);",
    "  const __n=performance.now();if(__n-(tick.__l||0)>120){tick.__l=__n;\n  if(v.duration&&!seeking)$('seek').value=v.currentTime/v.duration*1000;\n  $('seek').style.setProperty('--p',(v.duration?v.currentTime/v.duration*100:0)+'%');$('seek').style.setProperty('--pf',v.duration?Math.min(1,v.currentTime/v.duration):0);\n  $('tc').textContent=fmt(v.currentTime);$('td').textContent=fmt(v.duration||0)}\n  requestAnimationFrame(tick);")
# video behaviour: pauses (count and length), skips and rewinds, and watch time
rep("if(!v.paused&&!v.ended&&$(\"watch\").classList.contains(\"show\"))day().sec+=dt;",
    "if(!v.paused&&!v.ended&&$(\"watch\").classList.contains(\"show\")){day().sec+=dt;try{BRAIN.track('watch',dt)}catch(e){}};")
rep("let lastT=Date.now(),scT=0;",
    "let __pz=0;v.addEventListener('pause',()=>{if(!v.ended&&$('watch').classList.contains('show'))__pz=Date.now()});v.addEventListener('play',()=>{if(__pz){const d=(Date.now()-__pz)/1000;__pz=0;if(d>0.7&&d<1800)try{BRAIN.track('pauses',1);BRAIN.track('pauseSec',d)}catch(e){}}});v.addEventListener('seeked',()=>{try{BRAIN.track('seeks',1)}catch(e){}});\nlet lastT=Date.now(),scT=0;")


rep("  renderTokens($('ar'),i);\n\n  const english=findEn(AR[i]).trim();\n  $('en').textContent=english",
    "  renderTokens($('ar'),i);\n  try{if(typeof window.__ls==='number'&&i<window.__ls&&window.__ls-i<=8)BRAIN.lineReplayed(AR[i].t);window.__ls=i;BRAIN.lineShown(AR[i].t,{src:(typeof curTitle==='string'?curTitle:'')});BRAIN.tick()}catch(e){}\n\n  const english=findEn(AR[i]).trim();\n  $('en').textContent=english")
rep("  renderTokens($('pAr'),i);\n  $('pidx').textContent=(i+1)+' / '+AR.length;",
    "  renderTokens($('pAr'),i);\n  $('pidx').textContent=(i+1)+' / '+AR.length;\n  if(window.SAFINA_CHIP)SAFINA_CHIP(i);")
rep("async function lookup(tok,i){", "async function lookup(tok,i){\n  try{BRAIN.wordTapped(tok,AR[i]&&AR[i].t)}catch(e){}")
rep("async function showMean(tok,k,i){\n  const w=clean(tok),my=++ms;", "async function showMean(tok,k,i){\n  const w=clean(tok),my=++ms;try{BRAIN.wordTapped(w,AR[i]&&AR[i].t)}catch(e){}")
rep("function playLoaded(o){\n try{\n", "function playLoaded(o){\n try{\n  BRAIN.newSession();window.__ls=-1;\n")
rep("v.hist.push([today(),r]);day().rev++;",
    "v.hist.push([today(),r]);day().rev++;try{if(v.kind===\"line\"){if(r>0)BRAIN.tokens(v.lemma).forEach(t=>BRAIN.reviewed(t.w,true))}else BRAIN.reviewed(v.lemma,r>0)}catch(e){}")
rep("async function saveCards(w,tr,i,force){\n", r'''/* flashcards the AI writes after it has looked at what you watched (level-fitted; marked with the brain icon) */
window.SAFINA_ADDCARDS=cards=>{let n=0;
  cards.forEach(c=>{const line=c.type==="line";
    if(vocab.some(x=>line?(x.kind==="line"&&x.lemma===(c.sentence||c.lemma)):(x.kind!=="line"&&BRAIN.norm(x.lemma)===BRAIN.norm(c.lemma))))return;
    vocab.push(newCard(line?{kind:"line",word:c.sentence||c.lemma,lemma:c.sentence||c.lemma,tr:c.meaning,sent:c.sentence||c.lemma,sentTr:c.meaning,auto:1,why:c.why,hint:c.hint,lvl:c.level,src:curTitle||"AI"}
      :{kind:"word",word:c.word,lemma:c.lemma,tr:c.meaning,sent:c.sentence,sentTr:"",auto:1,why:c.why,hint:c.hint,lvl:c.level,src:curTitle||"AI"}));n++});
  if(n){sv("lp_v",vocab);try{render();fillMissing()}catch(e){}toast("🧠 AI added "+n+" flashcard"+(n>1?"s":"")+" from what you watched")}
  return n};
async function saveCards(w,tr,i,force){
  try{if(w!=null)BRAIN.saved(w,AR[i]&&AR[i].t)}catch(e){}
''')
rep('use its context. Learner\'s saved words: "', 'use its context. "+BRAIN.profileText()+" Learner\'s saved words: "')
rep('window.__lsnPick=()=>{lsnState.clear();const S=(window.__lsn||{}).S||[];return lsnShuf(S.filter(x=>x.due)).concat(lsnShuf(S.filter(x=>!x.due)))};',
    'window.__lsnPick=()=>{lsnState.clear();const S=(window.__lsn||{}).S||[],rk=a=>BRAIN.rank(a.map(x=>(x.text=x.ar.join(" "),x)));return rk(S.filter(x=>x.due)).concat(rk(S.filter(x=>!x.due)))};   /* sentences with the most words you do not know yet come first */')
rep('''(v.kind=="line"?"<div class='mu' style='direction:ltr;text-align:left'>whole line</div>":"")+"</td><td>"+v.tr+''',
    '''(v.kind=="line"?"<div class='mu' style='direction:ltr;text-align:left'>whole line</div>":"")+(v.auto?"<div class='mu' style='direction:ltr;text-align:left'>🧠 AI"+(v.lvl?" · "+esc(v.lvl):"")+(v.why?" · "+esc(v.why):"")+"</div>":"")+"</td><td>"+v.tr+''')

rep('const xp=n*10+rv*2+mins,lv=', 'const xp=n*10+rv*2+mins+(window.SAFINA_XP?window.SAFINA_XP.total():0),lv=')

# ---- library: books and comics ----
rep('[[0,LIBD.movies],[1,LIBD.shows]].forEach(z=>', '[[0,LIBD.movies],[1,LIBD.shows],[2,LIBD.books||[]],[3,LIBD.comics||[]]].forEach(z=>')
rep('[["all","All"],["MOVIE","Movies"],["TV","TV shows"]]', '[["all","All"],["MOVIE","Movies"],["TV","TV shows"],["BOOK","Books"],["COMIC","Comics"]]')
rep('"<div><h2>"+(RI[r[3]]||"")+r[0]+"</h2><div class=\'mu\'>"+r[1]+"</div></div>', '"<div><h2>"+(RI[r[3]]||"")+r[0]+"</h2></div>')
rep('["Import EPUB","Soon","","#2f5d5a,#0d1a19"]', '["Import Book (PDF / EPUB / TXT)","Your file","w","#2f5d5a,#0d1a19"]')
rep('["Import Pages","Soon","","#3a5a2f,#121a0d"]', '["Import Comic (PDF / images / CBZ)","Your file","w","#3a5a2f,#121a0d"]')
rep('/^Import/.test(name)?openImport({type:r[3]=="TV"?"tv":"movie"})', '/^Import/.test(name)?(r[3]=="BOOK"||r[3]=="COMIC"?window.SAFINA_BOOKS.pick(r[3]):openImport({type:r[3]=="TV"?"tv":"movie"}))')
rep('(on?"<i class=\'pp\'>▶</i>":"")', '(on?"<i class=\'pp\'>"+(it&&it.glyph||"▶")+"</i>":"")')
rep('const lvOf=it=>it.ar?(it.en?"AR + EN":"AR"):(it.en?"EN only":"No subs");', 'const lvOf=it=>it.lvl||(it.ar?(it.en?"AR + EN":"AR"):(it.en?"EN only":"No subs"));')
rep('<script src="safina-prep-ui.js"></script>', '<script src="safina-prep-ui.js"></script>\n<script src="safina-books.js"></script>')

# ---- storage shim: pages opened in a sandboxed viewer have no localStorage; fall back to memory so the app still starts ----
_B = '<script src="safina-tree.js"></script>'
assert s.count(_B) == 1
s = s.replace(_B, _B + '\n<script>(function(){function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}})})();</script>', 1)

# ---- look: planet header + rounded sheet, dark with red (www/safina-theme.css) ----
_i = s.rindex('</body>')
s = s[:_i] + '<link rel="stylesheet" href="safina-theme.css">\n' + s[_i:]

open(dst, 'w', encoding='utf-8').write(s)
print('patched OK ->', dst, len(s), 'chars')
