"use strict";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- packs come from ./packs/ ---------- */
const PACKS_DIR = "packs/",
  MANIFEST_URL = PACKS_DIR + "manifest.json",
  LAST_PACK_KEY = "quiz-room-last-pack";

let bank = STARTER,
  mode = "solo",
  format = "mc",
  game = null,
  round = "all",
  amount = 10,
  random = true,
  teamText = "Team 1\nTeam 2",
  notice = "",
  packs = [],
  currentPackId = null;

/* ---------- validation ---------- */
function validate(data) {
  if (
    data?.schemaVersion !== 1 ||
    !Array.isArray(data.questions) ||
    !data.questions.length ||
    data.questions.length > 10000
  )
    throw Error("Use a schemaVersion 1 pack containing 1–10,000 questions.");
  const ids = new Set();
  for (const q of data.questions) {
    if (
      typeof q.id !== "string" ||
      ids.has(q.id) ||
      typeof q.question !== "string" ||
      !q.question.trim() ||
      typeof q.answer !== "string" ||
      !q.answer.trim()
    )
      throw Error("Each question needs a unique id, question and answer.");
    ids.add(q.id);
    if (
      !Array.isArray(q.options) ||
      (q.options.length !== 0 &&
        (q.options.length !== 4 ||
          q.options.some((o) => typeof o !== "string" || !o.trim()) ||
          new Set(q.options.map((x) => x.trim().toLowerCase())).size !== 4 ||
          !Number.isInteger(q.correct) ||
          q.correct < 0 ||
          q.correct > 3))
    )
      throw Error(
        "Multiple-choice questions need four distinct options and a correct index from 0 to 3.",
      );
    if (
      q.scoring !== undefined &&
      (!Array.isArray(q.scoring) ||
        q.scoring.some((s) => typeof s !== "string"))
    )
      throw Error("Scoring must be a list of text strings.");
    q.round = String(q.round || "General");
    q.category = String(q.category || "General");
  }
  return data;
}
function eligible() {
  return bank.questions.filter(
    (q) =>
      (round === "all" || q.round === round) &&
      ((mode === "host" && format === "open") || q.options.length === 4),
  );
}

/* ---------- fetch packs listed in packs/manifest.json ---------- */
async function loadBundledPacks() {
  let manifest;
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) throw Error("HTTP " + res.status);
    manifest = await res.json();
  } catch (_) {
    notice =
      "No packs/manifest.json found — using the starter pack only. Add packs/next to index.html and list its files.";
    return [];
  }

  const files = Array.isArray(manifest)
    ? manifest
    : Array.isArray(manifest?.packs)
      ? manifest.packs
      : [];
  const loaded = [],
    failed = [];
  for (const file of files) {
    if (typeof file !== "string" || !file.trim()) continue;
    try {
      const res = await fetch(PACKS_DIR + file, { cache: "no-cache" });
      if (!res.ok) throw Error("HTTP " + res.status);
      const data = validate(await res.json());
      loaded.push({ ...data, id: file, fileName: file });
    } catch (err) {
      failed.push(`${file} — ${err.message}`);
    }
  }
  if (failed.length)
    notice =
      (loaded.length ? `${loaded.length} pack(s) loaded. ` : "") +
      "Skipped: " +
      failed.join(" · ");
  else if (loaded.length)
    notice = `${loaded.length} pack${loaded.length === 1 ? "" : "s"} loaded from packs/.`;
  else notice = "";
  return loaded;
}

/* ---------- pack selection ---------- */
function selectPack(id, opts = {}) {
  const found = id ? packs.find((p) => p.id === id) : null;
  currentPackId = found ? found.id : null;
  bank = found || STARTER;
  round = "all";
  try {
    if (currentPackId) localStorage.setItem(LAST_PACK_KEY, currentPackId);
    else localStorage.removeItem(LAST_PACK_KEY);
  } catch (_) {}
  if (!opts.silent) setup();
}

function packListHTML() {
  const rows = [
    `<div class="pack ${currentPackId === null ? "selected" : ""}">
      <button class="pack-pick" data-pack="" aria-pressed="${currentPackId === null}">
        <strong>${esc(STARTER.title)}</strong>
        <small>${STARTER.questions.length} questions · built in</small>
      </button>
    </div>`,
  ];
  for (const p of packs) {
    const sel = p.id === currentPackId,
      mc = p.questions.filter((q) => q.options.length === 4).length;
    rows.push(
      `<div class="pack ${sel ? "selected" : ""}">
        <button class="pack-pick" data-pack="${esc(p.id)}" aria-pressed="${sel}">
          <strong>${esc(p.title || p.fileName || "Pack")}</strong>
          <small>${p.questions.length} questions · ${mc} multiple choice</small>
        </button>
      </div>`,
    );
  }
  return rows.join("");
}

/* ---------- setup screen ---------- */
function setup() {
  game = null;
  const count = eligible().length,
    currentTitle = bank.title || bank.fileName || "Imported pack";
  $("#app").innerHTML =
    `<span class="eyebrow">WELCOME TO QUIZ ROOM</span><h1>Good questions.<br>Great company.</h1><p class="lead">A quiet challenge for one, or a lively quiz for the whole office. You bring the teams. We’ll bring the questions.</p><div class="layout"><section class="card"><h2>How are we playing?</h2><div class="row"><button id="solo" class="mode ${mode === "solo" ? "selected" : ""}" aria-pressed="${mode === "solo"}">Play solo<small>Multiple choice · instant feedback</small></button><button id="host" class="mode ${mode === "host" ? "selected" : ""}" aria-pressed="${mode === "host"}">Host the room<small>Read aloud · keep team scores</small></button></div>${mode === "host" ? `<label for="format">Question style</label><select id="format"><option value="mc" ${format === "mc" ? "selected" : ""}>Multiple choice</option><option value="open" ${format === "open" ? "selected" : ""}>Open answer — no options shown</option></select>` : ""}<div class="grid"><div><label for="round">Round</label><select id="round"><option value="all">Mix all rounds</option>${[...new Set(bank.questions.map((q) => q.round))].map((r) => `<option ${round === r ? "selected" : ""} value="${esc(r)}">${esc(r)}</option>`).join("")}</select></div><div><label for="amount">Questions</label><select id="amount">${[5, 10, 15, 20, 30, 50].map((n) => `<option ${n === amount ? "selected" : ""}>${n}</option>`).join("")}</select></div></div><label for="order">Question order</label><select id="order"><option value="random" ${random ? "selected" : ""}>Shuffle questions</option><option value="book" ${!random ? "selected" : ""}>Keep pack order</option></select>${mode === "host" ? `<label for="teams">Teams (one per line, up to 12)</label><textarea id="teams" rows="3" maxlength="600">${esc(teamText)}</textarea><p class="note">Read the questions aloud. Colleagues answer aloud or on paper; only the host needs this screen.</p>` : ""}<p class="note">${count} eligible questions · This game will use ${Math.min(amount, count)}.${mode === "solo" || format === "mc" ? " Only questions with prepared choices are included." : ""}</p><button id="start" class="primary full" ${!count ? "disabled" : ""}>${mode === "solo" ? "Let’s play" : "Start hosting"} →</button></section><aside><section class="card accent"><span class="eyebrow">YOUR QUESTION SHELF</span><h2 style="margin-top:15px">${esc(currentTitle)}</h2><p>${bank.questions.length.toLocaleString()} questions<br>${bank.questions.filter((q) => q.options.length === 4).length} with multiple choice</p><div class="packs">${packListHTML()}</div><div class="row" style="margin-top:12px"><button id="reload-packs">↻ Reload packs</button></div><p class="note">Packs come from the <code>packs/</code> folder in this site. To add one, drop its <code>.json</code> there and list the filename in <code>packs/manifest.json</code>.</p><p class="note" id="notice" role="status">${esc(notice)}</p></section><section class="card" style="margin-top:20px"><h3>A room, not a login.</h3><p class="note">No accounts, subscriptions or installation. The host runs the quiz and keeps team scores.</p><p class="note">Imported answers are preserved as printed, including potentially dated or inaccurate facts. Review before hosting.</p></section></aside></div>`;

  $("#solo").onclick = () => {
    capture();
    mode = "solo";
    setup();
  };
  $("#host").onclick = () => {
    capture();
    mode = "host";
    setup();
  };
  if ($("#format"))
    $("#format").onchange = (e) => {
      capture();
      format = e.target.value;
      setup();
    };
  $("#round").onchange = (e) => {
    capture();
    round = e.target.value;
    setup();
  };
  $("#amount").onchange = (e) => {
    capture();
    amount = +e.target.value;
    setup();
  };
  $("#order").onchange = (e) => (random = e.target.value === "random");
  $("#start").onclick = () => {
    capture();
    start();
  };
  $("#reload-packs").onclick = async () => {
    capture();
    packs = await loadBundledPacks();
    const keep =
      currentPackId && packs.some((p) => p.id === currentPackId)
        ? currentPackId
        : null;
    selectPack(keep, { silent: true });
    setup();
  };
  document.querySelectorAll("[data-pack]").forEach((b) => {
    b.onclick = () => {
      capture();
      notice = "";
      selectPack(b.dataset.pack || null);
    };
  });
}

function capture() {
  if ($("#teams")) teamText = $("#teams").value;
  if ($("#order")) random = $("#order").value === "random";
}

/* ---------- game ---------- */
function start() {
  const pool = eligible();
  if (!pool.length) return;
  const qs = (random ? shuffle(pool) : pool).slice(0, amount).map((q) => {
    const order = q.options.length === 4 ? shuffle([0, 1, 2, 3]) : [];
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      correct: order.indexOf(q.correct),
    };
  });
  game = {
    questions: qs,
    index: 0,
    answers: Array(qs.length).fill(null),
    revealed: false,
    teams: teamText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((name) => ({ name: name.slice(0, 50), score: 0 })),
  };
  renderGame();
}
function renderGame() {
  const q = game.questions[game.index],
    a = game.answers[game.index],
    done = a !== null,
    host = mode === "host";
  $("#app").innerHTML =
    `<div class="row between"><button id="quit">← End quiz</button><span class="pill">${host ? "HOST DESK" : "SOLO PLAY"} · ${esc(q.round)}</span><strong>${game.index + 1} / ${game.questions.length}</strong></div><div class="progress"><span style="width:${(100 * (game.index + 1)) / game.questions.length}%"></span></div><div class="layout"><section class="card"><span class="eyebrow">QUESTION ${game.index + 1}</span><h1 class="question">${esc(q.question)}</h1>${!host || format === "mc" ? `<div class="options">${q.options.map((o, i) => `<button class="option ${done && i === q.correct ? "correct" : done && a === i ? "wrong" : ""}" data-choice="${i}" ${host || done ? "disabled" : ""}><span class="letter">${"ABCD"[i]}</span>${esc(o)}${done && i === q.correct ? " ✓" : ""}</button>`).join("")}</div>` : '<p class="muted">Open answer · Teams write or say their answer.</p>'}${host ? `<div class="feedback"><span class="eyebrow">CORRECT ANSWER — HOST ONLY</span><p><strong>${esc(q.answer)}</strong></p>${q.scoring?.length ? `<details><summary>Book’s suggested scoring</summary><p>${q.scoring.map(esc).join("<br>")}</p></details>` : ""}${q.review ? `<small>${esc(q.review)}</small>` : ""}</div>` : done ? `<div class="feedback" role="status"><strong>${a === q.correct ? "Correct!" : a === -1 ? "Skipped." : "Not quite."}</strong><p>${esc(q.answer)}</p></div>` : '<p class="note">Choose one answer. One point for each correct answer.</p>'}<div class="row divider">${host ? `<button id="previous" ${game.index === 0 ? "disabled" : ""}>Previous</button>` : !done ? '<button id="skip">Skip question</button>' : ""}<button id="next" class="primary" ${!host && !done ? "disabled" : ""}>${game.index === game.questions.length - 1 ? "Finish quiz" : "Next question →"}</button></div></section><aside class="card ${host ? "" : "accent"}">${host ? `<h2>Your host desk.</h2><p class="note">Read the question aloud, then read the choices if using multiple choice. The answer is here for you to check.</p><h3 class="divider">Team scores</h3><p class="note">Award points manually. Use the number box for book scoring or corrections.</p>${game.teams.map((t, i) => `<div class="team"><strong>${esc(t.name)}</strong><div class="row"><button data-minus="${i}" aria-label="Subtract one from ${esc(t.name)}">−</button><input data-score="${i}" aria-label="Score for ${esc(t.name)}" type="number" min="0" max="9999" value="${t.score}"><button data-plus="${i}" aria-label="Add one to ${esc(t.name)}">+</button></div></div>`).join("") || '<p class="note">No teams added. You can keep scores on paper.</p>'}` : `<span class="eyebrow">YOUR SCORE</span><div class="score">${game.answers.filter((a, i) => a === game.questions[i].correct).length}</div><p>points so far</p><p class="note">Take your time. There’s no countdown.</p>`}</aside></div>`;
  $("#quit").onclick = () => {
    if ($("#quit").dataset.confirm === "yes") finish();
    else {
      $("#quit").dataset.confirm = "yes";
      $("#quit").textContent = "End now? Click to confirm";
    }
  };
  document.querySelectorAll("[data-choice]").forEach(
    (b) =>
      (b.onclick = () => {
        if (game.answers[game.index] !== null) return;
        game.answers[game.index] = +b.dataset.choice;
        renderGame();
      }),
  );
  if ($("#skip"))
    $("#skip").onclick = () => {
      game.answers[game.index] = -1;
      renderGame();
    };
  $("#next").onclick = () => {
    if (game.index === game.questions.length - 1) finish();
    else {
      game.index++;
      game.revealed = false;
      renderGame();
    }
  };
  if (host) {
    $("#previous").onclick = () => {
      game.index--;
      game.revealed = false;
      renderGame();
    };
    document
      .querySelectorAll("[data-minus]")
      .forEach((b) => (b.onclick = () => score(+b.dataset.minus, -1)));
    document
      .querySelectorAll("[data-plus]")
      .forEach((b) => (b.onclick = () => score(+b.dataset.plus, 1)));
    document.querySelectorAll("[data-score]").forEach(
      (e) =>
        (e.onchange = () => {
          game.teams[+e.dataset.score].score = Math.max(
            0,
            Math.min(9999, Math.trunc(+e.value) || 0),
          );
          renderGame();
        }),
    );
  }
}
function score(i, delta) {
  game.teams[i].score = Math.max(
    0,
    Math.min(9999, game.teams[i].score + delta),
  );
  renderGame();
}
function finish() {
  const host = mode === "host",
    points = game.answers.filter(
      (a, i) => a === game.questions[i].correct,
    ).length;
  $("#app").innerHTML =
    `<span class="eyebrow">THAT’S A WRAP</span><h1>${host ? "A round of applause." : "Nicely played."}</h1><section class="card">${
      host
        ? `<h2>Final scores</h2>${
            [...game.teams]
              .sort((a, b) => b.score - a.score)
              .map(
                (t) =>
                  `<div class="team"><strong>${esc(t.name)}</strong><h2>${t.score}</h2></div>`,
              )
              .join("") || "<p>Thanks for playing.</p>"
          }`
        : `<div class="score">${points} / ${game.questions.length}</div><p>${game.answers.filter((a) => a === null).length} unanswered · ${game.answers.filter((a) => a === -1).length} skipped</p>`
    }<div class="row divider"><button id="again" class="primary">Set up another quiz</button><button id="export">Download results</button></div></section>${!host ? `<section class="card" style="margin-top:24px"><h2>Your answer review</h2>${game.questions.map((q, i) => `<div class="review"><strong>${i + 1}. ${esc(q.question)}</strong><p>Your answer: ${esc(game.answers[i] === null ? "Unanswered" : game.answers[i] === -1 ? "Skipped" : q.options[game.answers[i]])}</p><p>Correct answer: <strong>${esc(q.options[q.correct])}</strong></p><small>${esc(q.answer)}</small></div>`).join("")}</section>` : ""}`;
  $("#again").onclick = setup;
  $("#export").onclick = () => {
    const result = {
      date: new Date().toISOString(),
      mode,
      pack: bank.title || bank.fileName,
      teams: game.teams,
      score: host ? undefined : points,
      total: game.questions.length,
      questions: game.questions.map((q, i) => ({
        question: q.question,
        answer: q.answer,
        selected:
          game.answers[i] === null
            ? null
            : q.options[game.answers[i]] || "Skipped",
      })),
    };
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "quiz-results.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
}
window.addEventListener("beforeunload", (e) => {
  if (game && $("#next")) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function init() {
  packs = await loadBundledPacks();
  let last = null;
  try {
    last = localStorage.getItem(LAST_PACK_KEY);
  } catch (_) {}
  selectPack(last, { silent: true });
  setup();
}
init();