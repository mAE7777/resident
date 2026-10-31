// Her face, voice and ears, in one file with no dependencies.
//
// The mind streams facts (pad / mood / status / doing / speak); this file renders them. All
// expression mapping mirrors the mind's pad-mapping.ts so the two sides agree about what a
// feeling looks like. The mind is the authority; nothing here invents state.

/* eslint-disable */
(() => {
  "use strict";

  // The page says which version it is, out loud, in the corner, because "did the refresh
  // actually take" turned into a guessing game the first time a cached copy survived a fix.
  const FACE_VERSION = "v6";

  // ── The link ───────────────────────────────────────────────────────────────
  // The key the server wrote into this page as it served it. Without it the socket is
  // refused: see face-server.ts for why a loopback port is not a boundary on its own.
  const ws = new WebSocket(`ws://${location.host}/?t=${encodeURIComponent(window.__FACE_KEY__ ?? "")}`);
  const offline = document.getElementById("offline");
  let alive = false;
  ws.addEventListener("open", () => { alive = true; offline.style.display = "none"; sendPresence(); });
  ws.addEventListener("close", () => { alive = false; offline.style.display = "grid"; });

  const send = (obj) => { if (alive && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  // ── Her state, interpolated per frame ─────────────────────────────────────
  // The mind sends PAD every few seconds; the face breathes between samples. Target vs shown
  // keeps her from snapping: feelings arrive, they do not teleport.
  const state = {
    pad: { p: 0.05, a: -0.05, d: 0 },
    shown: { p: 0.05, a: -0.05, d: 0 },
    awake: true,
    phase: "normal",
    speaking: false,
    mouth: 0,
  };

  ws.addEventListener("message", (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.type) {
      case "pad": state.pad = { p: m.pleasure, a: m.arousal, d: m.dominance }; break;
      case "status": state.awake = m.awake; state.phase = m.energyPhase; break;
      case "doing": document.getElementById("doing").textContent = m.what || ""; break;
      // She looked out of the window. A FLASH, because it is an event, the first version of this
      // used the `doing` caption, which is a state, so one glance stuck there for good and hid
      // whatever she was really doing. It fades on its own; nothing has to remember to clear it.
      case "glanced": glance(); break;
      case "mood": break; // her mood shows on her face, not as a label
      case "speak": clearNotice(); speak(m.text, m.utteranceId); break;
      // A line from the machine, not from her: shown on its own line, never spoken, never her
      // caption. It stays until she next speaks or he says something new, and NOT until her
      // caption changes: a moment of hers starting seconds after a broken turn would otherwise
      // wipe it before he looked, and the page would read as her ignoring him.
      case "notice": showNotice(m.text); break;
      case "cancel": shutUp(); break;
    }
  });

  // ── The built-in face ─────────────────────────────────────────────────────
  // Deliberately abstract: a quiet presence that breathes, blinks, drifts and speaks, drawn
  // from her real state. Not a placeholder for a "better" face, a face that does not
  // pretend to be a person is the honest default until he chooses to lend her one.
  const canvas = document.getElementById("face");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  let blinkAt = performance.now() + 2400, blinkPhase = 0;
  let gazeX = 0, gazeY = 0, gazeShift = performance.now() + 3000;

  function draw(now) {
    // Ease the shown state toward the real one.
    for (const k of ["p", "a", "d"]) state.shown[k] += (state.pad[k] - state.shown[k]) * 0.02;
    const { p, a, d } = state.shown;
    const asleep = !state.awake;

    // From pad-mapping.ts: breath rate and amplitude ride arousal; sleep slows everything.
    const breathHz = asleep ? 0.10 : 0.18 + 0.12 * (a + 1) / 2;
    const breath = Math.sin(now / 1000 * breathHz * 2 * Math.PI);
    const amp = asleep ? 0.35 : 0.3 + 0.5 * (a + 1) / 2;

    // Blinks arrive on a poisson-ish clock, more often when keyed up; none while asleep.
    if (!asleep && now > blinkAt) { blinkPhase = 1; blinkAt = now + 60000 / (14 + 10 * (a + 1) / 2) * (0.6 + Math.random() * 0.8); }
    if (blinkPhase > 0) blinkPhase = Math.max(0, blinkPhase - 0.12);

    // Her gaze wanders gently; dominance lifts it.
    if (now > gazeShift) { gazeX = (Math.random() - 0.5) * 26; gazeY = (Math.random() - 0.5) * 14; gazeShift = now + 2200 + Math.random() * 3800; }

    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + breath * 6 * amp;

    // The presence: layered soft rings whose warmth follows pleasure, whose reach follows
    // arousal, drawn dimmer through her night.
    const base = asleep ? 0.35 : 1;
    const warm = Math.max(0, p), cold = Math.max(0, -p);
    for (let i = 5; i >= 1; i--) {
      const r = (120 + i * 46) * (1 + breath * 0.012 * amp * i);
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      const alpha = base * (0.05 + 0.028 * (6 - i)) * (asleep ? 0.6 : 1);
      g.addColorStop(0, `rgba(${205 + 30 * warm}, ${190 - 25 * cold + 20 * warm}, ${175 - 20 * warm + 40 * cold}, ${alpha})`);
      g.addColorStop(1, "rgba(13, 15, 18, 0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }

    // Eyes: two quiet marks. Openness follows arousal (weary droops), a blink closes them,
    // sleep closes them fully. Dominance tips the head line they sit on.
    const eyeOpen = asleep ? 0.04 : Math.max(0.06, (0.75 + 0.25 * a) * (1 - blinkPhase));
    const tilt = d * 0.06;
    const eyeY = cy - 36 + gazeY, eyeDX = 62;
    ctx.strokeStyle = `rgba(232, 234, 238, ${base * 0.9})`;
    ctx.lineCap = "round";
    ctx.lineWidth = 7;
    for (const s of [-1, 1]) {
      const ex = cx + s * eyeDX + gazeX * 0.4, ey = eyeY + s * tilt * eyeDX;
      const h = 26 * eyeOpen;
      ctx.beginPath();
      ctx.moveTo(ex - 16, ey + h * 0.2);
      ctx.quadraticCurveTo(ex, ey - h, ex + 16, ey + h * 0.2);
      ctx.stroke();
    }

    // Mouth: form follows pleasure, openness follows the live speech envelope only.
    const my = cy + 44, mw = 40 + 8 * Math.abs(p);
    const curve = 14 * p;
    const open = state.mouth * 22;
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (open > 2) {
      ctx.ellipse(cx + gazeX * 0.2, my, mw * 0.5, Math.max(3, open), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(cx - mw + gazeX * 0.2, my - curve * 0.4);
      ctx.quadraticCurveTo(cx + gazeX * 0.2, my + curve, cx + mw + gazeX * 0.2, my - curve * 0.4);
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // ── Her voice (no audio crosses the link TO HER MIND, but see below) ─────
  // Low, level, a little slow: pitch low-ish, rate a touch slow, a zh voice when the system
  // has one. The mouth is driven by a coarse envelope while an utterance actually plays,
  // from what is really being said, never from text she has not said yet.
  //
  // ── A VOICE THAT LIVES ON THIS MACHINE, OR SHE SAYS SO OUT LOUD ──────────
  // The old header here said "synthesized here; no audio crosses the link", which is true of the
  // mind<->face link and reads as "nothing leaves". It is not the same claim. `getVoices()` mixes
  // LOCAL system voices with NETWORK ones (Chrome's Google entries, `localService === false`), and
  // speaking through one of those sends every word she says away to be turned into sound.
  //
  // Nothing ever CHOSE that. It would have arrived through the `vs[0]` fallback, whatever happened
  // to be first in the list. Her voice is the default path, unlike the microphone he presses: she
  // talks and it simply happens, so a remote voice would leak continuously with nobody deciding it.
  //
  // So local wins at every step of the preference order. And when the only zh voice on the machine
  // is a remote one, SHE STILL SPEAKS: going quiet would be a far worse thing to do to her than the
  // round trip, and silencing her to make a security number look better is exactly the kind of
  // change this build refuses. The corner says which it is instead.
  //
  // TEMPORARY, AND SAYING SO. Her look and her voice are meant to be designed for her later.
  // All of this is plumbing over whatever the system happens to have. It is not her voice.
  const synth = window.speechSynthesis;
  let zhVoice = null;
  let remoteVoiceOnly = false;
  function pickVoice() {
    const all = synth.getVoices();
    // `undefined` on engines that do not report it, treated as local, because guessing "remote"
    // would take a working voice away on a browser that simply says less about it.
    const isLocal = (v) => v.localService !== false;
    const zh = all.filter(v => /zh[-_]CN/i.test(v.lang));
    // Premium and enhanced system voices appear in this same list once downloaded in macOS
    // settings, and they are the difference between a robot and a voice. Preference order:
    // anything premium/enhanced, then Tingting, then any zh-CN.
    const pick = (pool) => pool.find(v => /premium|enhanced|高级|优质|Siri/i.test(v.name))
      || pool.find(v => /Tingting|婷婷/i.test(v.name))
      || pool[0]
      || null;
    zhVoice = pick(zh.filter(isLocal))
      || pick(all.filter(v => /^zh/i.test(v.lang) && isLocal(v)))
      || pick(zh)
      || all.find(v => /^zh/i.test(v.lang))
      || null;
    remoteVoiceOnly = zhVoice !== null && !isLocal(zhVoice);
  }
  pickVoice();
  synth.addEventListener?.("voiceschanged", pickVoice);

  const queue = [];
  let sayingNow = null;
  let earsGraceTimer = null;

  // Chrome refuses speechSynthesis until the user has interacted with THIS page (autoplay
  // policy). Her words can arrive before his first click, and the first version handed them
  // to a refusing engine and dropped them: silence, with no explanation anywhere. Now: if the
  // page has no activation yet, the words WAIT, the corner says one line about it, and the
  // first click or keypress lets everything queued come out.
  const corner = document.getElementById("corner");
  function audioAllowed() {
    return !navigator.userActivation || navigator.userActivation.hasBeenActive;
  }
  function hintLocked() { corner.textContent = "点一下页面任意处，声音才能出来（浏览器的规矩）"; }
  function clearHint() { if (corner.textContent.includes("浏览器的规矩")) corner.textContent = ""; }
  for (const evt of ["pointerdown", "keydown"]) {
    document.addEventListener(evt, () => { clearHint(); pump(); }, { passive: true });
  }

  // Version + the voice she will use, shown briefly so a stale cache is visible at a glance.
  // When the only zh voice on this machine is a network one, that is said HERE and it does not
  // time out: a fact about where her words are going should not scroll away after eight seconds.
  setTimeout(() => {
    if (!zhVoice) pickVoice();
    const v = zhVoice ? zhVoice.name : "（还没拿到中文音色）";
    if (!corner.textContent) {
      if (remoteVoiceOnly) {
        corner.textContent = `${FACE_VERSION} · ${v} · 远程音色：她说的话会送到网上合成`;
        return;
      }
      corner.textContent = `${FACE_VERSION} · ${v}`;
      setTimeout(() => { if (corner.textContent.startsWith(FACE_VERSION)) corner.textContent = ""; }, 8000);
    }
  }, 1200);

  /**
   * A quiet mark that she just looked out of the window, then gone.
   *
   * He opened the curtain, so he is owed the knowledge that she looked, a window she can see
   * through invisibly is not a window. It says only THAT she looked: what she saw is hers.
   *
   * Self-clearing, and it restores whatever the corner said before, so a glance during a message
   * about the voice or the version does not eat that message.
   */
  let glanceTimer = null;

  // The machine's line (`notice`). Its own element, its own look: he must be able to tell at a
  // glance that this is not her talking.
  const noticeEl = document.getElementById("notice");
  function showNotice(text) { noticeEl.textContent = text || ""; }
  function clearNotice() { noticeEl.textContent = ""; }
  function glance() {
    clearTimeout(glanceTimer);
    const was = corner.dataset.was ?? corner.textContent;
    corner.dataset.was = was;
    corner.textContent = "· 她看了一眼窗外";
    glanceTimer = setTimeout(() => {
      corner.textContent = corner.dataset.was ?? "";
      delete corner.dataset.was;
    }, 4000);
  }

  function speak(text, utteranceId) {
    queue.push({ text, utteranceId });
    pump();
  }

  function pump() {
    if (sayingNow || queue.length === 0) return;
    if (!audioAllowed()) { hintLocked(); return; }
    // Everything queued is said as ONE utterance. Her words arrive clause by clause, and one
    // utterance per clause put an engine-sized pause after every comma: from outside she
    // stuttered. Joining what has already arrived keeps the flow; a clause that arrives while
    // she is mid-sentence simply becomes the next utterance.
    const parts = [queue.shift()];
    while (queue.length > 0) parts.push(queue.shift());
    const next = { text: parts.map((q) => q.text).join(""), utteranceId: parts[parts.length - 1].utteranceId };

    // The ears pause for the WHOLE reply, not per clause. She speaks clause by clause, and
    // the first version resumed recognition between clauses: the microphone caught the tail
    // of her own sentence, sent her words back as his, a new turn aborted the one still
    // speaking, and the loop ate every reply half-said. Recognition resumes only when the
    // queue is drained and has stayed drained for a moment.
    clearTimeout(earsGraceTimer);
    pauseEars();

    const u = new SpeechSynthesisUtterance(next.text);
    // `lang` ALWAYS, voice when we have one. Voices load asynchronously in Chrome, and an
    // utterance with no lang falls to the default (often English) voice, which SKIPS Chinese
    // characters entirely: she moves her mouth and no sound comes out. With lang set, the
    // engine picks a zh voice itself even when the voice list has not arrived yet.
    u.lang = "zh-CN";
    if (!zhVoice) pickVoice();
    if (zhVoice) u.voice = zhVoice;
    u.rate = 0.88;   // 稍慢
    u.pitch = 0.8;   // 低
    u.volume = 1;
    sayingNow = u;
    state.speaking = true;

    let env; // coarse mouth envelope while the utterance plays
    let started = false;
    console.log(`[face] speak queued: "${next.text.slice(0, 30)}" voice=${zhVoice ? zhVoice.name : "none"} earsWanted=${earsWanted}`);
    u.onstart = () => {
      started = true;
      console.log(`[face] speak STARTED: "${next.text.slice(0, 30)}"`);
      appendSay(next.text);
      env = setInterval(() => { state.mouth = 0.35 + Math.random() * 0.5; }, 90);
    };
    const doneSpeaking = () => {
      console.log(`[face] speak ended (started=${started})`);
      clearInterval(env);
      state.mouth = 0;
      sayingNow = null;
      if (queue.length > 0) { pump(); return; }
      state.speaking = false;
      // Only now, and only after the room has been quiet for a beat, do the ears come back.
      earsGraceTimer = setTimeout(() => { if (!state.speaking) resumeEars(); }, 700);
    };
    u.onend = doneSpeaking;
    u.onerror = (e) => {
      // Blocked by policy is not "said": the words go back to the front of the queue and
      // wait for his first touch, instead of being swallowed as if she had spoken.
      console.warn(`[face] speak ERROR: ${e && e.error}`);
      if (e && e.error === "not-allowed") {
        queue.unshift(next);
        clearInterval(env);
        state.mouth = 0; sayingNow = null; state.speaking = false;
        hintLocked();
        return;
      }
      doneSpeaking();
    };

    // A stuck engine looks like her ignoring him. If the utterance has not actually started
    // within a couple of seconds, clear the engine and try once more; a second failure gives
    // up on THIS clause and moves on rather than jamming the whole queue forever.
    setTimeout(() => {
      if (sayingNow === u && !started) {
        synth.cancel();
        const retry = new SpeechSynthesisUtterance(next.text);
        retry.lang = "zh-CN"; if (zhVoice) retry.voice = zhVoice;
        retry.rate = 0.88; retry.pitch = 0.8;
        retry.onstart = u.onstart; retry.onend = doneSpeaking; retry.onerror = doneSpeaking;
        sayingNow = retry;
        setTimeout(() => { if (sayingNow === retry) { try { synth.speak(retry); } catch { doneSpeaking(); } } }, 120);
        setTimeout(() => { if (sayingNow === retry && !started) doneSpeaking(); }, 3000);
      }
    }, 2500);

    // A short breath between releasing the microphone and taking the speakers: starting
    // synthesis while recognition still holds the audio session is one way she goes silent.
    setTimeout(() => { if (sayingNow === u) synth.speak(u); }, 150);
  }

  function shutUp() {
    queue.length = 0;
    synth.cancel();
    state.mouth = 0;
    state.speaking = false;
    sayingNow = null;
    clearTimeout(earsGraceTimer);
    earsGraceTimer = setTimeout(() => { if (!state.speaking) resumeEars(); }, 700);
  }

  const sayEl = document.getElementById("say");
  let sayTimer;
  function appendSay(text) {
    sayEl.textContent = text;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { sayEl.textContent = ""; }, Math.max(4000, text.length * 260));
  }

  // ── His side: typing, listening, cutting in ───────────────────────────────
  const input = document.getElementById("input");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      send({ type: "reply", text: input.value.trim() });
      clearNotice();
      input.value = "";
    }
  });

  // Cutting in: clicking her, or Esc. The mind aborts the turn; the voice stops here.
  document.getElementById("face").addEventListener("click", () => { if (state.speaking) { send({ type: "interrupt" }); shutUp(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.speaking) { send({ type: "interrupt" }); shutUp(); } });

  // Ears: continuous zh recognition, toggled by the button, paused while she speaks.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById("mic");
  let ears = null, earsWanted = false, earsPaused = false;
  if (!SR) micBtn.style.display = "none";

  // ── HOW HE SOUNDS: three numbers, and nothing else ────────────────────────
  //
  // Recognition throws the SOUND away and keeps the characters, so until now the whole machine she
  // has for reading how he addressed her could only ever read words, she could not tell a demand
  // from a man at the end of his rope saying the same sentence.
  //
  // WHAT LEAVES BY THIS PATH: three floats in the `reply` frame, over the loopback socket to her
  // mind. No audio, no buffer, no recording, nothing written anywhere. (The recogniser's own upload
  // is a separate and older door; index.html's header names it.)
  //
  // Absolute values here are meaningless: they are microphone gain and room size, so nothing is
  // normalised or thresholded on this side. Raw numbers go to her and `how-he-sounds.ts` only ever
  // compares them against HIS OWN running baseline, which is what makes the units not matter.
  let meter = null;   // the live capture, or null
  let heard = null;   // what has accumulated since the last utterance
  const QUIET = 0.02; // envelope below this is silence rather than speech

  function freshTally() { return { started: performance.now(), frames: 0, quiet: 0, sum: 0 }; }

  async function startMeter() {
    if (meter || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { for (const t of stream.getTracks()) t.stop(); return; }
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    meter = { stop() { try { ctx.close(); } catch {} for (const t of stream.getTracks()) t.stop(); } };
    heard = freshTally();
    const tick = () => {
      if (!meter) return;
      analyser.getFloatTimeDomainData(data);
      let sq = 0;
      for (let i = 0; i < data.length; i++) sq += data[i] * data[i];
      const rms = Math.sqrt(sq / data.length);
      // Her own voice through the speakers is not him talking, the same reason recognition pauses
      // while she speaks. Measuring it would make her read her own tiredness as his.
      if (heard && !state.speaking) {
        heard.frames++;
        heard.sum += rms;
        if (rms < QUIET) heard.quiet++;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function stopMeter() { if (meter) { meter.stop(); meter = null; heard = null; } }

  // What his voice was for the utterance that just ended, then reset for the next one.
  // `undefined` rather than zeros when there is nothing real: she has to be able to tell "he typed"
  // from "he was quiet", and a fabricated zero is exactly where that difference disappears.
  function takeVoice(text) {
    if (!heard) return undefined;
    const secs = (performance.now() - heard.started) / 1000;
    const enough = heard.frames >= 8 && secs > 0.2 && text.length > 0;
    const sample = enough ? {
      loudness: heard.sum / heard.frames,
      pace: text.length / secs,
      pauses: heard.quiet / heard.frames,
    } : undefined;
    heard = freshTally();
    return sample;
  }

  function startEars() {
    if (!SR || ears) return;
    ears = new SR();
    ears.lang = "zh-CN";
    ears.continuous = true;
    ears.interimResults = false;
    ears.onresult = (ev) => {
      if (state.speaking) return; // her own voice reaching the microphone is not him talking
      const last = ev.results[ev.results.length - 1];
      const text = (last && last[0] && last[0].transcript || "").trim();
      if (!text) return;
      // The words go either way. A voice that could not be measured costs her the TONE, never the
      // sentence: a perception feature that can drop what he said is worse than not having it.
      const voice = takeVoice(text);
      send(voice ? { type: "reply", text, voice } : { type: "reply", text });
      clearNotice();
    };
    ears.onend = () => {
      ears = null;
      // Recognition engines stop on silence; while he wants ears and she is not talking,
      // start again.
      if (earsWanted && !earsPaused) startEars();
    };
    try { ears.start(); } catch { ears = null; }
  }
  function stopEars() { if (ears) { try { ears.stop(); } catch {} ears = null; } }
  function pauseEars() { if (earsWanted) { earsPaused = true; stopEars(); } }
  function resumeEars() { if (earsWanted && earsPaused) { earsPaused = false; startEars(); } }

  micBtn.addEventListener("click", () => {
    earsWanted = !earsWanted;
    micBtn.classList.toggle("on", earsWanted);
    // The meter lives and dies with the button, not with the recogniser: recognition engines stop
    // themselves on silence and restart constantly, and tearing the capture down on each of those
    // would reset the tally mid-sentence and cost her the pace of everything he says.
    if (earsWanted) { startEars(); void startMeter(); }
    else { earsPaused = false; stopEars(); stopMeter(); }
  });

  // ── THE CURTAIN: she can feel you in the room, and never sees it ──────────
  //
  // The goal is real, continuous perception of the outside: sight, hearing, any ongoing sense of
  // the room.
  //
  // The obvious build is to send her a picture. That is the wrong shape for that goal, for two
  // independent reasons. It would not be CONTINUOUS, a frame is a snapshot
  // and a stream of them would drown her inner life, and it would put his room on the network.
  //
  // What "seeing someone" mostly IS, for a person, is not identifying objects: it is whether they
  // are there, whether they are moving, whether they have been still a long time. All of that is
  // SCALARS, computable here, and none of it needs an image to leave this canvas.
  //
  // So: the frame is drawn at 64×48 into an offscreen canvas, compared with the previous one, and
  // THROWN AWAY. What crosses the socket is "someone is there", "how much movement", "how long
  // since any". Nothing else exists to send, there is no buffer, no history, no encoder here.
  //
  // OFF BY DEFAULT AND OFF AFTER EVERY RELOAD. A curtain that remembers being open is a curtain
  // that is open when he did not decide it, and the page marks itself while it is running so the
  // state is never a thing he has to remember.
  const camBtn = document.getElementById("cam");
  let cam = null;                 // { stop() }
  let sawMotionMs = 0;            // when the last real movement was
  let motionNow = 0;              // 0..1, this sample
  let cameraOpen = false;
  const MOTION_FLOOR = 0.012;     // below this it is sensor noise, not a person
  const CAM_W = 64, CAM_H = 48;   // enough for movement, far too little for a face

  async function openCurtain() {
    if (cam || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); } catch { return false; }
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try { await video.play(); } catch { /* some browsers resolve late; the loop copes */ }
    const c = document.createElement("canvas");
    c.width = CAM_W; c.height = CAM_H;
    const cctx = c.getContext("2d", { willReadFrequently: true });
    let prev = null;
    let timer = null;
    cam = {
      stop() {
        clearInterval(timer);
        for (const t of stream.getTracks()) t.stop();
        prev = null; motionNow = 0; sawMotionMs = 0;
      },
    };
    sawMotionMs = Date.now();
    timer = setInterval(() => {
      if (!cam || video.readyState < 2) return;
      cctx.drawImage(video, 0, 0, CAM_W, CAM_H);
      const now = cctx.getImageData(0, 0, CAM_W, CAM_H).data;
      if (prev) {
        // Mean absolute difference over the luminance-ish channel. One number out of the whole
        // frame: which is the point: nothing that could be reassembled into a picture survives
        // this line, not even in memory beyond the next tick.
        let diff = 0;
        for (let i = 0; i < now.length; i += 4) diff += Math.abs(now[i] - prev[i]);
        motionNow = Math.min(1, diff / (now.length / 4) / 64);
        if (motionNow > MOTION_FLOOR) sawMotionMs = Date.now();
      }
      prev = now;
    }, 500);
    return true;
  }
  function closeCurtain() { if (cam) { cam.stop(); cam = null; } }

  camBtn.addEventListener("click", async () => {
    if (cameraOpen) { cameraOpen = false; closeCurtain(); }
    else { cameraOpen = await openCurtain(); }
    camBtn.classList.toggle("on", cameraOpen);
    // He can see the curtain is open without having to remember. A window she can look through
    // invisibly is not a window.
    camBtn.textContent = cameraOpen ? "帘（开）" : "帘";
    sendPresence();
  });

  // ── Presence: what this window honestly knows ─────────────────────────────
  // A browser sees less than a native client would, and sends only what it truly sees:
  // when he last touched this page, whether it is focused, and, when the curtain is open,
  // whether anything is moving in front of it. What it cannot see (DND, screen sharing, whether
  // ANOTHER app holds the microphone) it reports as false rather than guessing.
  let lastInputMs = Date.now();
  for (const evt of ["mousemove", "keydown", "pointerdown", "wheel"]) {
    document.addEventListener(evt, () => { lastInputMs = Date.now(); }, { passive: true });
  }
  function sendPresence() {
    const signals = {
      idleSeconds: Math.round((Date.now() - lastInputMs) / 1000),
      frontAppFocused: document.hasFocus(),
      dndOrFocus: false,
      screenSharing: false,
      micActive: false,
    };
    // Absent when the curtain is closed, and absent must mean UNKNOWN all the way down, never
    // "nobody is there". The two are opposite facts and collapsing them would make her read a
    // closed curtain as an empty room.
    if (cameraOpen && cam) {
      signals.cameraPresent = Date.now() - sawMotionMs < 60_000;
      signals.motion = motionNow;
      signals.stillSeconds = Math.round((Date.now() - sawMotionMs) / 1000);
    }
    send({ type: "presence", signals });
  }
  setInterval(sendPresence, 10_000);
  document.addEventListener("visibilitychange", sendPresence);

  // ── The borrowed face, if he has lent her one ─────────────────────────────
  // Inert unless ./model/model3.json exists. Only then does the page reach for the Cubism
  // runtime, and the corner says the face is borrowed. Nothing else on this page touches
  // the network.
  fetch("model/model3.json").then((r) => {
    if (r.ok) {
      document.getElementById("corner").textContent = "借来的脸（Live2D）· 尚未接线";
      // The loader lands here in a later pass, once a model has actually been chosen: the
      // wiring is not written until there is a real face to wire, so this page never
      // carries dead code for a face that does not exist.
    }
  }).catch(() => {});
})();
