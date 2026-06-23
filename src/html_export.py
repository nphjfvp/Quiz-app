"""Generate a standalone HTML quiz file with embedded JS engine."""

import json
import base64
import os
from pathlib import Path


def _encode_image(path: str) -> str:
    """Return a data-URI for an image file, or empty string."""
    if not path or not os.path.isfile(path):
        return ""
    ext = Path(path).suffix.lower().lstrip(".")
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"}.get(ext, "image/png")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return f"data:{mime};base64,{b64}"


def quiz_to_html(quiz, lang: str = "de") -> str:
    """Convert a Quiz object to a self-contained HTML string."""
    questions_json = []
    for q in quiz.questions:
        qd = q.to_dict()
        for img_key in ("image_path", "diagram_image_path"):
            if qd.get(img_key):
                qd[img_key] = _encode_image(qd[img_key])
        questions_json.append(qd)

    data = json.dumps({
        "name": quiz.name,
        "questions": questions_json,
    }, ensure_ascii=False)

    labels = {
        "de": {
            "title": "Quiz",
            "q_of": "Frage {c} von {t}",
            "check": "Prüfen",
            "next": "Weiter",
            "finish": "Auswertung",
            "correct": "Richtig!",
            "wrong": "Falsch!",
            "score": "Ergebnis: {c}/{t} ({p}%)",
            "restart": "Nochmal",
            "your_answer": "Deine Antwort",
            "correct_answer": "Richtige Antwort",
            "placeholder": "Antwort eingeben…",
            "drag_hint": "Ziehe die Begriffe zu den Zielen",
            "fill_hint": "Fülle die Lücken aus",
            "topics": "Themen",
            "all": "Alle",
            "points": "Punkte",
            "back": "Zurück zur Übersicht",
        },
        "en": {
            "title": "Quiz",
            "q_of": "Question {c} of {t}",
            "check": "Check",
            "next": "Next",
            "finish": "Results",
            "correct": "Correct!",
            "wrong": "Wrong!",
            "score": "Score: {c}/{t} ({p}%)",
            "restart": "Restart",
            "your_answer": "Your answer",
            "correct_answer": "Correct answer",
            "placeholder": "Enter answer…",
            "drag_hint": "Drag items to their targets",
            "fill_hint": "Fill in the blanks",
            "topics": "Topics",
            "all": "All",
            "points": "Points",
            "back": "Back to overview",
        },
    }
    L = json.dumps(labels.get(lang, labels["de"]), ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{quiz.name} – Lerntrainer Quiz</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4ff;color:#1a1a2e;min-height:100vh}}
.container{{max-width:700px;margin:0 auto;padding:20px}}
h1{{text-align:center;margin:20px 0;color:#3b5bdb;font-size:1.6em}}
.progress{{background:#dee2e6;border-radius:8px;height:8px;margin-bottom:20px;overflow:hidden}}
.progress-bar{{height:100%;background:linear-gradient(90deg,#3b5bdb,#5c7cfa);transition:width .3s}}
.card{{background:#fff;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.08)}}
.q-counter{{font-size:.85em;color:#868e96;margin-bottom:8px}}
.q-text{{font-size:1.15em;font-weight:600;margin-bottom:16px;line-height:1.4}}
.q-image{{max-width:100%;border-radius:8px;margin-bottom:12px}}
.option{{display:block;width:100%;text-align:left;padding:12px 16px;margin:6px 0;border:2px solid #dee2e6;border-radius:8px;background:#fff;cursor:pointer;font-size:1em;transition:all .15s}}
.option:hover{{border-color:#3b5bdb;background:#f0f4ff}}
.option.selected{{border-color:#3b5bdb;background:#dbe4ff}}
.option.correct{{border-color:#2f9e44;background:#d3f9d8}}
.option.wrong{{border-color:#e03131;background:#ffe3e3}}
.option.mc{{position:relative;padding-left:40px}}
.option.mc::before{{content:'';position:absolute;left:12px;top:50%;transform:translateY(-50%);width:18px;height:18px;border:2px solid #adb5bd;border-radius:4px}}
.option.mc.selected::before{{background:#3b5bdb;border-color:#3b5bdb}}
input[type=text]{{width:100%;padding:12px;border:2px solid #dee2e6;border-radius:8px;font-size:1em;outline:none}}
input[type=text]:focus{{border-color:#3b5bdb}}
.blank-input{{display:inline-block;width:120px;padding:4px 8px;border:2px solid #dee2e6;border-radius:6px;font-size:1em;margin:0 4px}}
.btn{{display:inline-block;padding:12px 28px;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer;transition:all .15s}}
.btn-primary{{background:#3b5bdb;color:#fff}}.btn-primary:hover{{background:#364fc7}}
.btn-success{{background:#2f9e44;color:#fff}}.btn-success:hover{{background:#2b8a3e}}
.btn-danger{{background:#e03131;color:#fff}}
.btn-secondary{{background:#868e96;color:#fff}}.btn-secondary:hover{{background:#495057}}
.btn-row{{display:flex;gap:10px;margin-top:16px;justify-content:flex-end}}
.feedback{{padding:12px 16px;border-radius:8px;margin-top:12px;font-weight:600}}
.feedback.ok{{background:#d3f9d8;color:#2f9e44}}
.feedback.nok{{background:#ffe3e3;color:#e03131}}
.result-card{{text-align:center;padding:40px 20px}}
.result-score{{font-size:2em;font-weight:700;color:#3b5bdb;margin-bottom:8px}}
.result-pct{{font-size:3em;font-weight:700;margin:16px 0}}
.result-detail{{text-align:left;margin:12px 0}}
.result-item{{padding:10px 14px;border-radius:8px;margin:4px 0;font-size:.95em}}
.result-item.ok{{background:#d3f9d8}}.result-item.nok{{background:#ffe3e3}}
.drag-zone{{display:flex;flex-wrap:wrap;gap:8px;min-height:50px;padding:10px;border:2px dashed #dee2e6;border-radius:8px;margin:8px 0}}
.drag-item{{padding:8px 14px;background:#dbe4ff;border-radius:6px;cursor:grab;font-size:.95em;user-select:none}}
.drag-target{{min-width:100px;min-height:40px;padding:8px;border:2px dashed #adb5bd;border-radius:6px;text-align:center;font-size:.9em;color:#868e96}}
.drag-target.filled{{border-style:solid;border-color:#3b5bdb;color:#1a1a2e}}
.topic-filter{{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}}
.topic-btn{{padding:6px 14px;border-radius:20px;border:2px solid #dee2e6;background:#fff;cursor:pointer;font-size:.85em}}
.topic-btn.active{{background:#3b5bdb;color:#fff;border-color:#3b5bdb}}
.hidden{{display:none}}
@media(max-width:600px){{.container{{padding:12px}}.card{{padding:16px}}}}
</style>
</head>
<body>
<div class="container" id="app"></div>
<script>
const QUIZ={data};
const L={L};
(function(){{
const app=document.getElementById('app');
let idx=0,answers=[],checked=false,filteredQs=QUIZ.questions.slice();
let selectedSC=null,selectedMC=new Set(),dragState={{}};

function shuffle(a){{let b=[...a];for(let i=b.length-1;i>0;i--){{let j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}}return b}}

function getTopics(){{let s=new Set();QUIZ.questions.forEach(q=>{{if(q.topic)s.add(q.topic)}});return[...s].sort()}}

function filterByTopic(topic){{
  filteredQs=topic?QUIZ.questions.filter(q=>q.topic===topic):QUIZ.questions.slice();
  idx=0;answers=[];checked=false;render();
}}

function render(){{
  if(idx<0)return renderStart();
  if(idx>=filteredQs.length)return renderResults();
  renderQuestion();
}}

function renderStart(){{
  const topics=getTopics();
  let h=`<h1>${{QUIZ.name}}</h1><div class="card"><p style="font-size:1.1em;margin-bottom:16px">${{filteredQs.length}} ${{L.q_of.replace('{{c}}','').replace('von {{t}}','').trim()||'Fragen'}}</p>`;
  if(topics.length>1){{
    h+=`<p style="font-weight:600;margin-bottom:8px">${{L.topics}}:</p><div class="topic-filter">`;
    h+=`<button class="topic-btn active" onclick="filterByTopic(null)">${{L.all}}</button>`;
    topics.forEach(t=>h+=`<button class="topic-btn" onclick="filterByTopic('${{t.replace(/'/g,"\\\\'")}}')">${{t}}</button>`);
    h+=`</div>`;
  }}
  h+=`<div class="btn-row"><button class="btn btn-primary" onclick="idx=0;checked=false;answers=[];render()">Start</button></div></div>`;
  app.innerHTML=h;
  window.filterByTopic=filterByTopic;
}}

function renderQuestion(){{
  const q=filteredQs[idx];checked=false;selectedSC=null;selectedMC=new Set();dragState={{}};
  let h=`<div class="progress"><div class="progress-bar" style="width:${{((idx)/filteredQs.length)*100}}%"></div></div>`;
  h+=`<div class="card">`;
  h+=`<div class="q-counter">${{L.q_of.replace('{{c}}',idx+1).replace('{{t}}',filteredQs.length)}}</div>`;
  h+=`<div class="q-text">${{esc(q.text||q.title)}}</div>`;
  if(q.image_path)h+=`<img class="q-image" src="${{q.image_path}}">`;
  if(q.diagram_image_path)h+=`<img class="q-image" src="${{q.diagram_image_path}}">`;

  const qt=q.question_type;
  if(qt==='single_choice'){{
    q.options.forEach((o,i)=>h+=`<button class="option" id="opt${{i}}" onclick="pickSC(${{i}})">${{esc(o.text)}}</button>`);
  }} else if(qt==='multiple_choice'){{
    q.options.forEach((o,i)=>h+=`<button class="option mc" id="opt${{i}}" onclick="pickMC(${{i}})">${{esc(o.text)}}</button>`);
  }} else if(qt==='free_text'||qt==='math_formula'){{
    h+=`<input type="text" id="freeInput" placeholder="${{L.placeholder}}">`;
  }} else if(qt==='fill_blank'){{
    let parts=(q.text||'').split(/___+/);
    h+=`<div class="q-text">`;
    parts.forEach((p,i)=>{{
      h+=esc(p);
      if(i<parts.length-1)h+=`<input type="text" class="blank-input" id="blank${{i}}">`;
    }});
    h+=`</div>`;
  }} else if(qt==='drag_drop'){{
    const sources=shuffle(q.drag_drop_pairs.map(p=>p.source));
    h+=`<p style="color:#868e96;margin-bottom:8px">${{L.drag_hint}}</p>`;
    h+=`<div class="drag-zone" id="sourceZone">`;
    sources.forEach((s,i)=>h+=`<div class="drag-item" draggable="true" data-src="${{esc(s)}}" id="di${{i}}">${{esc(s)}}</div>`);
    h+=`</div>`;
    q.drag_drop_pairs.forEach((p,i)=>{{
      h+=`<div style="display:flex;align-items:center;gap:8px;margin:6px 0"><span style="font-weight:600">${{esc(p.target)}}:</span><div class="drag-target" id="dt${{i}}" data-idx="${{i}}"></div></div>`;
    }});
  }}

  h+=`<div id="feedback"></div>`;
  h+=`<div class="btn-row"><button class="btn btn-primary" id="checkBtn" onclick="checkAnswer()">${{L.check}}</button></div>`;
  h+=`</div>`;
  app.innerHTML=h;
  setupDrag();
}}

function esc(s){{if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}}

window.pickSC=function(i){{
  if(checked)return;selectedSC=i;
  document.querySelectorAll('.option').forEach((el,j)=>el.classList.toggle('selected',j===i));
}};
window.pickMC=function(i){{
  if(checked)return;
  if(selectedMC.has(i))selectedMC.delete(i);else selectedMC.add(i);
  document.querySelectorAll('.option.mc').forEach((el,j)=>el.classList.toggle('selected',selectedMC.has(j)));
}};

function setupDrag(){{
  const items=document.querySelectorAll('.drag-item');
  const targets=document.querySelectorAll('.drag-target');
  let dragged=null;
  items.forEach(el=>{{
    el.addEventListener('dragstart',e=>{{dragged=el;e.dataTransfer.effectAllowed='move'}});
    el.addEventListener('click',()=>{{if(checked)return;dragged=el;targets.forEach(t=>t.style.background='#f0f4ff');setTimeout(()=>targets.forEach(t=>t.style.background=''),1500)}});
  }});
  targets.forEach(el=>{{
    el.addEventListener('dragover',e=>{{e.preventDefault();e.dataTransfer.dropEffect='move'}});
    el.addEventListener('drop',e=>{{
      e.preventDefault();if(!dragged||checked)return;
      const i=el.dataset.idx;
      dragState[i]=dragged.dataset.src;
      el.textContent=dragged.dataset.src;el.classList.add('filled');
      dragged.style.display='none';dragged=null;
    }});
    el.addEventListener('click',()=>{{
      if(checked)return;const i=el.dataset.idx;
      if(dragged&&!dragState[i]){{
        dragState[i]=dragged.dataset.src;
        el.textContent=dragged.dataset.src;el.classList.add('filled');
        dragged.style.display='none';dragged=null;
      }}
    }});
  }});
}}

window.checkAnswer=function(){{
  if(checked){{idx++;render();return}}
  const q=filteredQs[idx];
  const qt=q.question_type;
  let correct=false,userAnswer='';
  if(qt==='single_choice'){{
    if(selectedSC===null)return;
    correct=q.options[selectedSC].is_correct;userAnswer=q.options[selectedSC].text;
    q.options.forEach((o,i)=>{{
      const el=document.getElementById('opt'+i);
      if(o.is_correct)el.classList.add('correct');
      else if(i===selectedSC)el.classList.add('wrong');
    }});
  }} else if(qt==='multiple_choice'){{
    if(selectedMC.size===0)return;
    const correctSet=new Set(q.options.map((o,i)=>o.is_correct?i:-1).filter(i=>i>=0));
    correct=selectedMC.size===correctSet.size&&[...selectedMC].every(i=>correctSet.has(i));
    userAnswer=[...selectedMC].map(i=>q.options[i].text).join(', ');
    q.options.forEach((o,i)=>{{
      const el=document.getElementById('opt'+i);
      if(o.is_correct)el.classList.add('correct');
      else if(selectedMC.has(i))el.classList.add('wrong');
    }});
  }} else if(qt==='free_text'||qt==='math_formula'){{
    const inp=document.getElementById('freeInput');
    userAnswer=inp.value.trim();if(!userAnswer)return;
    const expected=(q.correct_text||'').trim().toLowerCase();
    correct=userAnswer.toLowerCase()===expected;
    inp.style.borderColor=correct?'#2f9e44':'#e03131';
  }} else if(qt==='fill_blank'){{
    const blanks=q.blanks||[];let allOk=true;let ans=[];
    blanks.forEach((b,i)=>{{
      const inp=document.getElementById('blank'+i);
      if(!inp)return;
      const v=inp.value.trim();ans.push(v);
      const ok=v.toLowerCase()===b.toLowerCase();
      inp.style.borderColor=ok?'#2f9e44':'#e03131';
      if(!ok)allOk=false;
    }});
    correct=allOk;userAnswer=ans.join(', ');
  }} else if(qt==='drag_drop'){{
    let allOk=true;
    q.drag_drop_pairs.forEach((p,i)=>{{
      const el=document.getElementById('dt'+i);
      const ok=(dragState[i]||'').toLowerCase()===p.source.toLowerCase();
      el.style.borderColor=ok?'#2f9e44':'#e03131';
      if(!ok)allOk=false;
    }});
    correct=allOk;userAnswer=Object.values(dragState).join(', ');
  }}
  answers.push({{correct,userAnswer,question:q}});
  checked=true;
  const fb=document.getElementById('feedback');
  const ca=qt==='free_text'?q.correct_text:qt==='fill_blank'?(q.blanks||[]).join(', '):qt==='drag_drop'?q.drag_drop_pairs.map(p=>p.target+'→'+p.source).join(', '):'';
  fb.innerHTML=`<div class="feedback ${{correct?'ok':'nok'}}">${{correct?L.correct:L.wrong}}${{!correct&&ca?' '+L.correct_answer+': '+esc(ca):''}}</div>`;
  const btn=document.getElementById('checkBtn');
  btn.textContent=idx<filteredQs.length-1?L.next:L.finish;
  btn.className='btn '+(correct?'btn-success':'btn-danger');
}};

function renderResults(){{
  const c=answers.filter(a=>a.correct).length;
  const t=answers.length;
  const p=t?Math.round(c/t*100):0;
  let col=p>=80?'#2f9e44':p>=50?'#e8590c':'#e03131';
  let h=`<div class="card result-card"><div class="result-score">${{QUIZ.name}}</div>`;
  h+=`<div class="result-pct" style="color:${{col}}">${{p}}%</div>`;
  h+=`<p>${{L.score.replace('{{c}}',c).replace('{{t}}',t).replace('{{p}}',p)}}</p>`;
  h+=`<div class="btn-row" style="justify-content:center;margin-top:20px"><button class="btn btn-primary" onclick="idx=-1;answers=[];render()">${{L.restart}}</button></div>`;
  h+=`</div>`;
  h+=`<div class="card"><h3 style="margin-bottom:12px">${{L.finish}}</h3>`;
  answers.forEach((a,i)=>{{
    const cls=a.correct?'ok':'nok';
    h+=`<div class="result-item ${{cls}}"><strong>Q${{i+1}}:</strong> ${{esc(a.question.text||a.question.title)}}`;
    if(!a.correct&&a.userAnswer)h+=`<br><small>${{L.your_answer}}: ${{esc(a.userAnswer)}}</small>`;
    h+=`</div>`;
  }});
  h+=`</div>`;
  app.innerHTML=h;
}}

idx=-1;render();
}})();
</script>
</body>
</html>"""
