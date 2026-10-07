/* ============================================================
   MindLyft AI Agent — embeddable chat widget (vanilla JS)
   - WhatsApp-style UI, quick replies, lead capture, sounds
   - Talks to POST {apiBase}/chat (Cloudflare Worker → DeepSeek)
   - Falls back to a built-in scripted flow when the API is down
   ============================================================ */
(function () {
  'use strict';

  /* ── 0. Config ─────────────────────────────────────────── */
  var C = Object.assign({
    apiBase: '/api',                    // e.g. 'https://mindlyft-agent.your-subdomain.workers.dev/api'
    logo: 'mindlyftai_logo.avif',
    privacyPolicyUrl: '#',
    earlyBirdEndDate: '',               // [EARLY_BIRD_END_DATE] — e.g. '31 Oct 2026'
    seatsLeft: '',                      // [SEATS_LEFT] — e.g. '12'
    phone: '+91 9975670303',
    email: 'info@mindlyftai.com'
  }, window.MindlyftChatConfig || {});

  var STORE = 'mindlyft_chat_v1';
  var SOUND_KEY = 'mindlyft_chat_sound';

  /* ── 1. Knowledge base (Part D — nothing else) ─────────── */
  var COURSES = {
    data: {
      id: 'data',
      name: 'Fundamentals of Data Analytics',
      link: 'https://learn.mindlyftai.com/data_analyst_classes/',
      reason: 'no coding needed and it builds analyst-ready skills',
      modules: ['Introduction to Data Analytics', 'Understanding Data, Database & Business Problems', 'Excel Fundamentals for Analytics', 'Data Cleaning & Preparation', 'Excel-Based Data Analysis', 'Power BI Data Analysis & Visualization', 'Analytical Dashboard Development', 'Mini Project & Business Insights (capstone)'],
      syllabusLine: '8 modules: Excel, Power BI, dashboards and a capstone project.'
    },
    ml: {
      id: 'ml',
      name: 'Machine Learning with AI',
      link: 'https://learn.mindlyftai.com/ai_and_ml_courses/',
      reason: 'you are comfortable with coding and aimed at AI/ML roles',
      modules: ['AI & Machine Learning Fundamentals', 'Python, Data Handling, EDA & Data Preparation', 'Regression', 'Classification', 'Unsupervised Learning', 'AI-Assisted ML & Final Project'],
      syllabusLine: '6 units over 15 days: Python, regression, classification and a final project.'
    },
    tools: {
      id: 'tools',
      name: 'AI Tools, Prompt Engineering & Automation for Everyone',
      link: 'https://learn.mindlyftai.com/prompt_engineering_course/',
      reason: 'it is made for non-coders and boosts everyday productivity',
      modules: ['AI & Generative AI Fundamentals', 'Prompt Engineering', 'Google AI Studio & Gemini', 'AI for Professional Productivity', 'AI Content Creation', 'No-Code AI Automation with n8n', 'Capstone Project'],
      syllabusLine: '7 modules over 15 days: prompts, ChatGPT, Gemini, Claude and n8n automation.'
    }
  };
  var PRICE = 2999, EARLY_BIRD = 2499; // cents not used — INR only

  var REFUSALS = [
    'Sorry, I can only help with MindLyft courses 😊 Want me to suggest the right one for you?',
    'Hmm, that is outside what I can help with 😅 Shall we talk about MindLyft courses?',
    'I am here for MindLyft course questions 🙂 Want a course suggestion?',
    'Oops, that one is not my area 😊 But I can help with courses, syllabus or pricing!',
    'Sorry, I stay in my lane — MindLyft courses and careers only 🙂 Want me to suggest a course?'
  ];
  var CHIPS_OFFTOPIC = ['Suggest a course', 'See syllabus', 'Talk to a human'];

  /* ── 2. Tiny helpers ───────────────────────────────────── */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }
  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#0369a1;font-weight:700;">$1</a>');
  }
  function now() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()); }
  function normalizePhone(v) {
    var d = String(v).replace(/[\s\-().]/g, '');
    if (/^\+91[6-9]\d{9}$/.test(d)) return d.slice(3);
    if (/^91[6-9]\d{9}$/.test(d)) return d.slice(2);
    if (/^0[6-9]\d{9}$/.test(d)) return d.slice(1);
    return d;
  }
  function validPhone(v) { return /^[6-9]\d{9}$/.test(normalizePhone(v)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function isMobile() { return window.matchMedia && window.matchMedia('(max-width: 600px)').matches; }

  /* ── 3. Sound engine (Part J — Web Audio, no files) ────── */
  var audio = {
    ctx: null, on: localStorage.getItem(SOUND_KEY) !== 'off', busy: false, unlocked: false,
    unlock: function () {
      this.unlocked = true;
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone: function (freq, start, dur, type, gain) {
      var ctx = this.ctx; if (!ctx) return;
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      var t = ctx.currentTime + start;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.05);
    },
    play: function (name) {
      if (!this.on || this.busy) return;
      if (document.hidden || reducedMotion()) return;      // never when hidden / reduced motion
      if (isMobile() && name !== 'reply') return;           // mobile quiet mode: bot replies only
      if (!this.ctx) return;
      var self = this; this.busy = true;
      setTimeout(function () { self.busy = false; }, 400);   // never overlap
      if (name === 'open')    { this.tone(660, 0, 0.14, 'sine', 0.12); this.tone(880, 0.12, 0.18, 'sine', 0.12); }
      if (name === 'send')    { this.tone(300, 0, 0.09, 'sine', 0.1); this.tone(220, 0.04, 0.1, 'triangle', 0.08); }
      if (name === 'reply')   { this.tone(740, 0, 0.16, 'sine', 0.11); }
      if (name === 'success') { this.tone(523, 0, 0.14, 'sine', 0.12); this.tone(659, 0.13, 0.14, 'sine', 0.12); this.tone(784, 0.26, 0.22, 'sine', 0.12); }
      if (name === 'sparkle') { this.tone(1320, 0, 0.12, 'triangle', 0.09); this.tone(1760, 0.09, 0.14, 'triangle', 0.07); }
    },
    toggle: function () {
      this.on = !this.on;
      localStorage.setItem(SOUND_KEY, this.on ? 'on' : 'off');
      return this.on;
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function unlock() { audio.unlock(); }, { once: true, passive: true });
  });

  /* ── 4. State (sessionStorage) ─────────────────────────── */
  var S = {
    messages: [],           // {who:'bot'|'user', text, ts, kind?:'price'}
    lead: { name: '', role: '', coding_level: '', goal: '', email: '', phone: '', course: '', agreed_price: 0 },
    consentAsked: false,
    consent: null,
    submitted: false,
    offTopic: 0,
    flowStep: 'welcome',    // local scripted flow
    mode: 'chat',           // 'chat' | 'lead'
    leadStage: '',          // 'consent' | 'email' | 'phone' | 'done'
    awaiting: '',           // 'name' | 'more'
    syllabusIdx: 0
  };
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
  function load() {
    try {
      var raw = sessionStorage.getItem(STORE);
      if (raw) { var d = JSON.parse(raw); if (d && d.messages) S = Object.assign(S, d); }
    } catch (e) {}
  }
  load();

  /* ── 5. Build DOM ──────────────────────────────────────── */
  var root = document.createElement('div');
  root.className = 'mlw-root';
  root.innerHTML =
    '<button class="mlw-launcher" aria-label="Open MindLyft AI Agent chat" aria-expanded="false">' +
      '<img src="' + esc(C.logo) + '" alt="">' +
      '<span class="mlw-launcher__pulse" aria-hidden="true"></span>' +
    '</button>' +
    '<div class="mlw-tooltip" role="status" hidden>Need help choosing a course? <button type="button" aria-label="Dismiss tip">×</button></div>' +
    '<section class="mlw-panel" role="dialog" aria-label="MindLyft AI Agent chat" hidden>' +
      '<header class="mlw-header">' +
        '<img class="mlw-header__logo" src="' + esc(C.logo) + '" alt="">' +
        '<div class="mlw-header__meta">' +
          '<h2 class="mlw-header__title">MindLyft AI Agent</h2>' +
          '<div class="mlw-header__status"><span class="mlw-header__dot" aria-hidden="true"></span> Online <span class="mlw-header__tag">AI assistant</span></div>' +
        '</div>' +
        '<div class="mlw-header__actions">' +
          '<button type="button" class="mlw-iconbtn mlw-sound" aria-label="Mute sounds" title="Sounds"></button>' +
          '<button type="button" class="mlw-iconbtn mlw-menubtn" aria-label="Menu" aria-haspopup="true" aria-expanded="false">⋯</button>' +
          '<button type="button" class="mlw-iconbtn mlw-min" aria-label="Minimise chat">–</button>' +
          '<button type="button" class="mlw-iconbtn mlw-close" aria-label="Close chat">×</button>' +
        '</div>' +
        '<div class="mlw-menu" hidden>' +
          '<button type="button" data-act="human">Talk to a human</button>' +
          '<a href="' + esc(C.privacyPolicyUrl) + '" target="_blank" rel="noopener">Privacy Policy</a>' +
          '<button type="button" data-act="restart">Start over</button>' +
        '</div>' +
      '</header>' +
      '<div class="mlw-body">' +
        '<div class="mlw-msgs" role="log" aria-live="polite" aria-label="Chat messages"></div>' +
        '<div class="mlw-chips"></div>' +
      '</div>' +
      '<footer class="mlw-input-row">' +
        '<a class="mlw-human" href="#" >Talk to a human</a>' +
        '<form class="mlw-form">' +
          '<input class="mlw-input" type="text" maxlength="300" autocomplete="off" placeholder="Type a message…" aria-label="Type a message">' +
          '<button type="submit" class="mlw-send" aria-label="Send message">' +
            '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10 17 3l-5 14-2.4-5.2L3 10Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>' +
          '</button>' +
        '</form>' +
      '</footer>' +
    '</section>';
  document.body.appendChild(root);

  var launcher = $('.mlw-launcher', root),
      tooltip = $('.mlw-tooltip', root),
      panel = $('.mlw-panel', root),
      msgs = $('.mlw-msgs', root),
      chipsRow = $('.mlw-chips', root),
      form = $('.mlw-form', root),
      input = $('.mlw-input', root),
      menu = $('.mlw-menu', root),
      soundBtn = $('.mlw-sound', root);

  var SPEAKER_ON = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 8v4h3l4 3V5L7 8H4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.8 5.5a6.5 6.5 0 0 1 0 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var SPEAKER_OFF = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 8v4h3l4 3V5L7 8H4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m13.5 8 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function paintSound() {
    soundBtn.innerHTML = audio.on ? SPEAKER_ON : SPEAKER_OFF;
    soundBtn.setAttribute('aria-label', audio.on ? 'Mute sounds' : 'Unmute sounds');
  }
  paintSound();

  /* ── 6. Rendering ──────────────────────────────────────── */
  function scrollDown() { msgs.scrollTop = msgs.scrollHeight; }

  function addBubble(who, text, kind) {
    var row = document.createElement('div');
    row.className = 'mlw-row mlw-row--' + who;
    if (kind === 'price') {
      row.innerHTML = priceCardHTML();
    } else {
      row.innerHTML =
        (who === 'bot' ? '<img class="mlw-avatar" src="' + esc(C.logo) + '" alt="">' : '') +
        '<div class="mlw-bubble">' + linkify(esc(text)) + '<span class="mlw-time">' + now() + '</span></div>';
    }
    msgs.appendChild(row);
    scrollDown();
    S.messages.push({ who: who, text: text, ts: now(), kind: kind || '' });
    save();
  }

  function priceCardHTML() {
    var tag = (C.earlyBirdEndDate || C.seatsLeft) ? 'Early Bird' : 'Special offer';
    var note = '';
    if (C.earlyBirdEndDate) note += 'Early Bird price valid till ' + esc(C.earlyBirdEndDate) + '. ';
    if (C.seatsLeft) note += 'Only ' + esc(C.seatsLeft) + ' seats left in this batch.';
    return '<div class="mlw-price">' +
      '<span class="mlw-price__tag">' + tag + '</span>' +
      '<div class="mlw-price__row"><s class="mlw-price__old">₹' + PRICE.toLocaleString('en-IN') + '</s>' +
      '<strong class="mlw-price__new">₹' + EARLY_BIRD.toLocaleString('en-IN') + '</strong></div>' +
      '<p class="mlw-price__per">per course · 30 hours live training</p>' +
      (note ? '<p class="mlw-price__note">' + note + '</p>' : '') +
      '</div>';
  }

  var typingEl = null;
  function showTyping() {
    hideTyping();
    typingEl = document.createElement('div');
    typingEl.className = 'mlw-typing';
    typingEl.setAttribute('aria-label', 'Bot is typing');
    typingEl.innerHTML = '<i></i><i></i><i></i>';
    msgs.appendChild(typingEl);
    scrollDown();
  }
  function hideTyping() { if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl); typingEl = null; }

  function showChips(list, accentFirst) {
    chipsRow.innerHTML = '';
    (list || []).slice(0, 4).forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mlw-chip' + (accentFirst && i === 0 ? ' mlw-chip--accent' : '');
      b.textContent = c.slice(0, 28);
      b.addEventListener('click', function () { sendText(c, true); });
      chipsRow.appendChild(b);
    });
    if (S.mode === 'lead' && S.leadStage === 'consent') {
      var a = document.createElement('a');
      a.className = 'mlw-human';
      a.href = C.privacyPolicyUrl; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'Privacy Policy';
      a.style.margin = '4px 2px 0';
      chipsRow.appendChild(a);
    }
    scrollDown();
  }
  function clearChips() { chipsRow.innerHTML = ''; }

  /* ── 7. Scripted flow (fallback engine + lead capture) ── */
  function recommendCourse() {
    var l = S.lead, clarifying = false, course = null;
    if (l.coding_level === 'Comfortable') return COURSES.ml;
    if (l.coding_level === 'None' || l.coding_level === 'A little') {
      if (l.role === 'Student') return COURSES.data;
      if (l.role === 'Working') return COURSES.tools;
    }
    clarifying = true;
    return { clarifying: clarifying };
  }

  function fallbackReply(text) {
    var t = (text || '').trim(), low = t.toLowerCase();
    var R = { reply: '', quick_replies: [], show_price_card: false, on_topic: true, lead: {}, ready_to_submit: false };

    /* hand-off triggers (Part F) */
    if (/human|agent|person|call me|talk to (someone|team)|callback|refund|payment|money back|complain/i.test(low)) {
      R.reply = 'Let me connect you with our team. You can call ' + C.phone + ' or email ' + C.email + '.';
      R.quick_replies = ['Request a callback', 'See syllabus'];
      if (/callback/i.test(low)) { S.mode = 'lead'; S.leadStage = S.consentAsked ? (S.consent ? 'email' : 'consent') : 'consent'; }
      return R;
    }

    /* lead-mode collector overrides chat */
    if (S.mode === 'lead') return leadCollector(t, R);

    /* scripted funnel */
    if (S.flowStep === 'welcome' || S.flowStep === 'name') {
      var nm = t.replace(/^(hi|hello|hey|namaste)[,!\s]*/i, '').split(/\s+/)[0] || t;
      S.lead.name = nm.slice(0, 30);
      S.flowStep = 'role';
      R.reply = 'Nice to meet you, ' + S.lead.name + '! Are you a student or working?';
      R.quick_replies = ['Student', 'Working', 'Other'];
      return R;
    }
    if (S.flowStep === 'role') {
      if (/student|study|college|school/i.test(low)) S.lead.role = 'Student';
      else if (/work|job|professional|employ/i.test(low)) S.lead.role = 'Working';
      else S.lead.role = 'Other';
      S.flowStep = 'coding';
      R.reply = 'Do you know any coding?';
      R.quick_replies = ['None', 'A little', 'Comfortable'];
      return R;
    }
    if (S.flowStep === 'coding') {
      if (/comfortable|good|yes|know/i.test(low)) S.lead.coding_level = 'Comfortable';
      else if (/little|some|basics|beginner/i.test(low)) S.lead.coding_level = 'A little';
      else S.lead.coding_level = 'None';
      S.flowStep = 'goal';
      R.reply = 'What do you want from this course?';
      R.quick_replies = ['Get a job', 'Switch careers', 'Upskill at work', 'Just exploring'];
      return R;
    }
    if (S.flowStep === 'goal') {
      if (/job|placement|career start/i.test(low)) S.lead.goal = 'Get a job';
      else if (/switch|change/i.test(low)) S.lead.goal = 'Switch careers';
      else if (/upskill|work|promotion|productiv/i.test(low)) S.lead.goal = 'Upskill at work';
      else S.lead.goal = 'Just exploring';
      S.flowStep = 'qna';
      return recommendTurn(R);
    }

    /* free Q&A (KB only) */
    if (/syllabus|module|curriculum|what.*(learn|cover|teach)/i.test(low)) return syllabusTurn(R, low);
    if (/price|fees?|cost|charge|discount|offer|early bird|₹|rs\.?/i.test(low)) {
      R.reply = "It's ₹2,999, but you can get the Early Bird price of ₹2,499 right now 🎉";
      R.show_price_card = true;
      R.quick_replies = ['Register now', 'See syllabus', 'Talk to a human'];
      return R;
    }
    if (/tool|chatgpt|gemini|claude|n8n|power bi|excel|python/i.test(low)) {
      var cr = findCourseByText(low);
      R.reply = cr ? ('Yes — ' + cr.syllabusLine + ' 🙂') : 'Our courses cover Excel, Power BI, Python, ChatGPT, Gemini, Claude and n8n 🙂';
      R.quick_replies = ['See syllabus', 'Suggest a course', 'Register now'];
      return R;
    }
    if (/duration|hours?|days?|how long|timing|schedule|batch|when.*start|certificate|certificat|emi|instal?lment|gst|refund/i.test(low)) {
      R.reply = "I'll check that with the team and have them call you 🙂";
      R.quick_replies = ['Request a callback', 'See syllabus', 'Register now'];
      return R;
    }
    if (/placement|job guarantee|salary|get.*(job|placed)/i.test(low)) {
      R.reply = 'We offer placement support — guidance, resume and interview prep. It is guidance, not a job guarantee 🙂';
      R.quick_replies = ['Suggest a course', 'Register now', 'Talk to a human'];
      return R;
    }
    if (/register|enrol|sign ?up|join|book|lock|admission/i.test(low)) {
      S.mode = 'lead';
      S.leadStage = S.consentAsked ? (S.consent ? 'email' : 'consent') : 'consent';
      return leadCollector('', R);
    }
    if (/suggest|which course|right course|recommend|best.*me/i.test(low)) {
      S.flowStep = S.flowStep === 'welcome' ? 'name' : S.flowStep;
      if (S.flowStep === 'name') { R.reply = "First, what's your name? 🙂"; return R; }
      return recommendTurn(R);
    }
    if (/code|coding|program|debug|python code|homework|assignment/i.test(low)) {
      var rec = recommendCourse();
      R.reply = "Sorry, I can't write code here, but you'll learn it hands-on in our courses 🙂";
      R.quick_replies = rec && rec.link ? ['See ' + shortName(rec), 'Register now', 'Talk to a human'] : ['Suggest a course', 'Register now', 'Talk to a human'];
      return R;
    }
    if (/^(hi|hello|hey|namaste|hlo)/i.test(low)) {
      R.reply = 'Hello! 👋 Want me to suggest the right MindLyft course for you?';
      R.quick_replies = ['Suggest a course', 'See syllabus', 'Pricing'];
      return R;
    }
    if (/course|mindlyft|ai|data|learn|train/i.test(low)) {
      R.reply = 'Good question! Our team covers that in detail 🙂 Want me to suggest a course?';
      R.quick_replies = ['Suggest a course', 'See syllabus', 'Talk to a human'];
      return R;
    }

    /* off-topic (Part I) */
    S.offTopic = (S.offTopic || 0) + 1;
    if (S.offTopic >= 3) {
      S.offTopic = 0;
      R.reply = 'Want me to connect you with our team instead? You can call ' + C.phone + ' or email ' + C.email + '.';
      R.quick_replies = ['Request a callback', 'Suggest a course', 'Talk to a human'];
      return R;
    }
    R.reply = pick(REFUSALS);
    R.quick_replies = CHIPS_OFFTOPIC.slice();
    return R;
  }

  function shortName(c) {
    return c.id === 'data' ? 'Data Analytics' : c.id === 'ml' ? 'ML with AI' : 'AI Tools';
  }

  function findCourseByText(low) {
    if (/power bi|excel|dashboard|analyt/i.test(low)) return COURSES.data;
    if (/python|machine learning|ml|regression|classif/i.test(low)) return COURSES.ml;
    if (/chatgpt|gemini|claude|n8n|prompt|no-?code|automat/i.test(low)) return COURSES.tools;
    return null;
  }

  function recommendTurn(R) {
    var rec = recommendCourse();
    if (rec.clarifying) {
      R.reply = 'One quick question — which of these sounds most like you?';
      R.quick_replies = ['Data & dashboards', 'AI tools & automation', 'Building AI models'];
      S.flowStep = 'goal';
      return R;
    }
    S.lead.course = rec.name;
    S.lead.agreed_price = EARLY_BIRD;
    R.reply = 'Based on what you shared, ' + rec.name + ' fits you best — ' + rec.reason + ' 🎯';
    R.quick_replies = ['See syllabus', 'Price', 'Register now'];
    return R;
  }

  function syllabusTurn(R, low) {
    var c = COURSES[S.lead.course ? courseIdFromName(S.lead.course) : (findCourseByText(low) ? findCourseByText(low).id : 'data')];
    S.syllabusIdx = (S.syllabusIdx || 0) % c.modules.length;
    var slice = c.modules.slice(S.syllabusIdx, S.syllabusIdx + 4);
    R.reply = c.name + ':\n' + slice.map(function (m) { return '• ' + m; }).join('\n');
    if (S.syllabusIdx + 4 < c.modules.length) {
      S.syllabusIdx += 4;
      R.quick_replies = ['Next module', 'See full syllabus', 'Register now'];
    } else {
      S.syllabusIdx = 0;
      R.quick_replies = ['Register now', 'Price', 'Talk to a human'];
    }
    if (/full/i.test(low)) {
      R.reply = c.name + ':\n' + c.modules.slice(0, 4).map(function (m) { return '• ' + m; }).join('\n') + '\n…and ' + (c.modules.length - 4) + ' more 🙂';
    }
    return R;
  }

  function courseIdFromName(n) {
    if (/data analyt/i.test(n)) return 'data';
    if (/machine learning/i.test(n)) return 'ml';
    if (/prompt|ai tools|automation/i.test(n)) return 'tools';
    return '';
  }

  /* Deterministic lead capture (Part E) — one question at a time */
  function leadCollector(t, R) {
    if (S.leadStage === 'consent') {
      if (S.consentAsked && t) {
        if (/^no|nah|dont|don't/i.test(t)) {
          S.consent = false; S.mode = 'chat'; S.leadStage = '';
          R.reply = "No problem! I won't collect anything 😊 What else would you like to know?";
          R.quick_replies = ['See syllabus', 'Price', 'Suggest a course'];
          return R;
        }
        if (/^yes|yeah|ok|okay|sure|haan|yes please/i.test(t)) {
          S.consent = true; S.leadStage = 'email';
          R.reply = "Great — share your email and I'll lock in the Early Bird price for you 🎉";
          return R;
        }
      }
      S.consentAsked = true;
      R.reply = "I'll use your details only to share course info and contact you. OK?";
      R.quick_replies = ['Yes', 'No'];
      return R;
    }
    if (S.leadStage === 'email') {
      if (!validEmail(t)) {
        R.reply = "Hmm, that email doesn't look right 😅 Can you send it again?";
        return R;
      }
      S.lead.email = t.trim();
      S.leadStage = 'phone';
      R.reply = 'And your mobile number? Just 10 digits 🙂';
      return R;
    }
    if (S.leadStage === 'phone') {
      if (!validPhone(t)) {
        R.reply = "That mobile number doesn't look right 😅 Please share a 10-digit number.";
        return R;
      }
      S.lead.phone = normalizePhone(t);
      S.leadStage = 'submitting';
      R.reply = 'One moment, saving your details…';
      return R;
    }
    if (S.leadStage === 'done') {
      R.reply = 'You are all set! Anything else about the course? 🙂';
      R.quick_replies = ['See syllabus', 'Talk to a human'];
      return R;
    }
    R.reply = 'No worries — what would you like to know next?';
    R.quick_replies = ['See syllabus', 'Price', 'Talk to a human'];
    return R;
  }

  /* ── 8. Lead submission → worker → Formspree ───────────── */
  function conversationSummary() {
    var l = S.lead;
    var line1 = 'Role: ' + (l.role || '?') + ' · Coding: ' + (l.coding_level || '?') + ' · Goal: ' + (l.goal || '?');
    var line2 = 'Course recommended: ' + (l.course || '?');
    var last = S.messages.slice(-2).map(function (m) { return (m.who === 'user' ? 'U: ' : 'B: ') + m.text; }).join(' | ').slice(0, 140);
    return (line1 + '\n' + line2 + '\n' + last).slice(0, 400);
  }

  function submitLead() {
    if (S.submitted) return;                                     // one submission per session
    S.submitted = true;
    var payload = {
      name: S.lead.name || 'Unknown',
      email: S.lead.email,
      phone: S.lead.phone,
      course_recommended: S.lead.course || 'Not decided',
      agreed_price: S.lead.agreed_price || EARLY_BIRD,
      coding_level: S.lead.coding_level || '',
      goal: S.lead.goal || '',
      role: S.lead.role || '',
      conversation_summary: conversationSummary(),
      page_url: location.href,
      timestamp: new Date().toISOString(),
      _gotcha: ''                                                 // honeypot — must stay empty
    };
    var attempt = 0;
    function trySend() {
      attempt++;
      fetch(C.apiBase + '/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (!r.ok) throw new Error('bad');
        return r.json();
      }).then(function (d) {
        if (!d.ok) throw new Error('nope');
        leadSuccess();
      }).catch(function () {
        if (attempt < 2) setTimeout(trySend, 800);                // retry once
        else leadFailure();
      });
    }
    trySend();
  }

  function leadSuccess() {
    S.leadStage = 'done'; S.mode = 'chat'; save();
    var link = (COURSES[courseIdFromName(S.lead.course)] || COURSES.data).link;
    addBubble('bot', 'Thanks ' + (S.lead.name || 'friend') + "! I've saved your details. Here's your registration link: " + link);
    audio.play('success');
    showChips(['Talk to our team', 'See syllabus']);
  }
  function leadFailure() {
    S.leadStage = 'done'; S.mode = 'chat'; save();
    addBubble('bot', "Our team will reach out to you soon 🙂 You can also call " + C.phone + " or email " + C.email + ".");
    showChips(['Talk to a human', 'See syllabus']);
  }

  /* ── 9. API call → worker (DeepSeek) with fallback ─────── */
  function askModel(userText) {
    var history = S.messages.slice(-12).map(function (m) {
      return { role: m.who === 'user' ? 'user' : 'assistant', content: m.text };
    });
    if (!history.length || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: userText });
    }
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;

    return fetch(C.apiBase + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, lead: S.lead, page_url: location.href, config: { early_bird_end_date: C.earlyBirdEndDate, seats_left: C.seatsLeft } }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('api');
      return r.json();
    }).then(function (d) {
      if (!d || !d.reply) throw new Error('bad-reply');
      return d;
    }).catch(function () {
      if (timer) clearTimeout(timer);
      return fallbackReply(userText);                              // friendly local fallback
    });
  }

  /* ── 10. Send pipeline ─────────────────────────────────── */
  var busy = false;
  function sendText(raw, isChip) {
    var text = String(raw || '').trim().slice(0, 300);
    if (!text || busy) return;
    clearChips();                                                  // chips disappear once used

    /* chip special-routes BEFORE anything else */
    if (isChip && /request a callback/i.test(text)) {
      requestCallback();
      return;
    }
    if (isChip && /register now|lock in/i.test(text)) {
      S.mode = 'lead';
      S.leadStage = S.consentAsked ? (S.consent ? 'email' : 'consent') : 'consent';
    }

    addBubble('user', text);
    audio.play('send');
    busy = true;

    /* lead-mode: always local + deterministic */
    if (S.mode === 'lead') {
      var lr = { reply: '', quick_replies: [], show_price_card: false, on_topic: true, lead: {}, ready_to_submit: false };
      lr = leadCollector(text, lr);
      simulateTyping(function () {
        addBubble('bot', lr.reply);
        audio.play('reply');
        if (lr.quick_replies && lr.quick_replies.length) showChips(lr.quick_replies, /Register/i.test(lr.quick_replies[0] || ''));
        busy = false;
        if (S.leadStage === 'submitting') submitLead();   // after the "One moment" bubble
      });
      return;
    }

    showTyping();
    var wait = 800 + Math.random() * 700;                          // 0.8–1.5 s feel
    setTimeout(function () {
      askModel(text).then(function (d) {
        hideTyping();
        if (d.lead) mergeLead(d.lead);
        if (d.show_price_card) {
          addBubble('bot', d.reply);
          addBubble('bot', '', 'price');
          audio.play('sparkle');
        } else {
          addBubble('bot', d.reply);
        }
        audio.play('reply');
        var chips = (d.quick_replies || []).filter(Boolean);
        if (d.ready_to_submit) {
          S.mode = 'lead';
          S.leadStage = 'consent';
          if (S.consentAsked && S.consent && S.lead.email && S.lead.phone) { submitLead(); S.leadStage = 'done'; }
        }
        if (chips.length) showChips(chips, /Register|Early/i.test(chips[0] || ''));
        busy = false;
      });
    }, wait);
  }

  function simulateTyping(fn) {
    showTyping();
    setTimeout(function () { hideTyping(); fn(); }, 800 + Math.random() * 700);
  }

  function mergeLead(l) {
    ['name', 'role', 'coding_level', 'goal', 'course'].forEach(function (k) {
      if (l[k] && String(l[k]).trim()) S.lead[k] = String(l[k]).trim().slice(0, 60);
    });
    if (l.email && validEmail(l.email)) S.lead.email = String(l.email).trim();
    if (l.phone && validPhone(l.phone)) S.lead.phone = normalizePhone(l.phone);
    if (l.agreed_price) S.lead.agreed_price = Number(l.agreed_price) || EARLY_BIRD;
    save();
  }

  /* ── 11. Human handoff ─────────────────────────────────── */
  function humanHandoff() {
    clearChips();
    simulateTyping(function () {
      addBubble('bot', 'Let me connect you with our team. You can call ' + C.phone + ' or email ' + C.email + '.');
      audio.play('reply');
      showChips(['Request a callback', 'See syllabus']);
    });
    menu.hidden = true;
  }
  function requestCallback() {
    S.mode = 'lead';
    S.leadStage = S.consentAsked ? (S.consent ? 'email' : 'consent') : 'consent';
    var lr = leadCollector('', { quick_replies: [] });
    simulateTyping(function () {
      addBubble('bot', lr.reply);
      if (lr.quick_replies && lr.quick_replies.length) showChips(lr.quick_replies);
    });
  }

  /* ── 12. Open / close / wire events ────────────────────── */
  var openedOnce = false;
  function openChat() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    tooltip.hidden = true;
    audio.play('open');
    if (!openedOnce) {
      openedOnce = true;
      if (!S.messages.length) {
        S.flowStep = 'name';
        save();
        simulateTyping(function () {
          addBubble('bot', "Hi! I'm the MindLyft AI Agent 👋 What's your name?");
        });
      } else {
        S.messages.forEach(function (m) {
          var row = document.createElement('div');
          row.className = 'mlw-row mlw-row--' + m.who;
          if (m.kind === 'price') { row.innerHTML = priceCardHTML(); }
          else {
            row.innerHTML = (m.who === 'bot' ? '<img class="mlw-avatar" src="' + esc(C.logo) + '" alt="">' : '') +
              '<div class="mlw-bubble">' + linkify(esc(m.text)) + '<span class="mlw-time">' + m.ts + '</span></div>';
          }
          msgs.appendChild(row);
        });
        scrollDown();
      }
    }
    input.focus();
  }
  function closeChat() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.addEventListener('click', function () {
    if (panel.hidden) openChat(); else closeChat();
  });
  $('.mlw-close', root).addEventListener('click', closeChat);
  $('.mlw-min', root).addEventListener('click', closeChat);
  $('.mlw-menubtn', root).addEventListener('click', function () {
    menu.hidden = !menu.hidden;
    this.setAttribute('aria-expanded', String(!menu.hidden));
  });
  soundBtn.addEventListener('click', function () { audio.unlock(); audio.toggle(); paintSound(); });

  menu.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    menu.hidden = true;
    if (b.dataset.act === 'human') humanHandoff();
    if (b.dataset.act === 'restart') {
      sessionStorage.removeItem(STORE);
      location.reload();
    }
  });

  $('.mlw-human', root).addEventListener('click', function (e) {
    e.preventDefault();
    humanHandoff();
    if (panel.hidden) openChat();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value;
    input.value = '';
    sendText(v, false);
  });

  tooltip.querySelector('button').addEventListener('click', function () {
    tooltip.hidden = true;
    sessionStorage.setItem('mindlyft_tip_done', '1');
  });

  /* chips are routed entirely inside sendText / lead flow */

  /* tooltip after 5 seconds, once per session */
  if (!sessionStorage.getItem('mindlyft_tip_done')) {
    setTimeout(function () {
      if (panel.hidden) { tooltip.hidden = false; }
      setTimeout(function () { tooltip.hidden = true; }, 12000);
    }, 5000);
  }

  /* restore saved chips-less state cleanly */
  save();
})();
