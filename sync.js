
"use strict";
const SB_URL = "https://mapmwrtgmweadxmbruiv.supabase.co";
const SB_KEY = "sb_publishable_0q41ICGbJuZZlxkhv8c91w_kkoiCsjj";
const CLOUD_TOKEN_KEY = "despesas_cloud_session_v1";
let cloudSession = null, cloudReady = false, cloudRevision = null, cloudRemote = null;
let cloudSyncedJson = null, cloudBusy = false, cloudStatus = "Não ligado", cloudRetry = false;
try { cloudSession = JSON.parse(localStorage.getItem(CLOUD_TOKEN_KEY) || "null"); } catch {}
// O Supabase usa JSONB e pode devolver as propriedades noutra ordem.
// Comparar JSON.stringify diretamente fazia surgir falsos conflitos após refresh.
function cloudCanonical(value) {
  const normalize = v => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const o = {};
      for (const key of Object.keys(v).sort()) o[key] = normalize(v[key]);
      return o;
    }
    return v;
  };
  const original = value && typeof value === "object" ? value : {};
  return JSON.stringify(normalize({...blank(), ...original, bankBalances: original.bankBalances || {}}));
}
const cloudJson = () => cloudCanonical(data);
const cloudRemoteJson = () => cloudRemote ? cloudCanonical(cloudRemote.data) : null;
const cloudHasData = obj => !!(obj && (
  (obj.templates && obj.templates.length) ||
  (obj.transactions && Object.keys(obj.transactions).length) ||
  (obj.income && Object.keys(obj.income).length) ||
  Number(obj.incomeDefault || 0) ||
  (obj.bankBalances && Object.keys(obj.bankBalances).length)
));
function cloudNotice(message) {
  cloudStatus = message;
  const el = document.getElementById("cloudStatus");
  if (el) el.textContent = message;
  const header = document.querySelector("header .status");
  if (header) {
    const busy = /A guardar|A verificar|A contactar|A sincronizar/.test(message);
    const error = /⚠️|Falha|pausada|expirada|diferentes|sem ligação/i.test(message);
    const ok = cloudReady && !busy && !error && /✅|atualizado|coincidem|guardad|recebid/i.test(message);
    header.classList.toggle("sync-ok",ok);
    header.classList.toggle("sync-wait",busy);
    header.classList.toggle("sync-error",error);
    header.textContent = busy ? "☁️ A sincronizar…" : error ? "⚠️ Verificar sincronização" : ok ? "✅ Sincronizado" : cloudSession ? "🔒 Nuvem por confirmar" : "🔒 Dados locais";
    header.title = message;
  }
}
function cloudPanel() {
  if (page !== "definicoes") return;
  const root = document.getElementById("content");
  if (!root || document.getElementById("cloudPanel")) return;
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = "cloudPanel";
  panel.innerHTML = '<h2>☁️ Sincronização entre dispositivos</h2>' +
    '<p class="dim">Os registos são guardados no Supabase com acesso privado. O ficheiro local e os backups continuam disponíveis.</p>' +
    '<p id="cloudStatus" class="tip"></p>' +
    '<div id="cloudAuth"></div>' +
    '<div id="cloudActions" class="settings" style="margin-top:14px"></div>' +
    '<p class="dim">A sincronização acontece quando a aplicação está aberta e tem Internet. Não inclui acesso à moey!.</p>';
  root.prepend(panel);
  document.getElementById("cloudStatus").textContent = cloudStatus;
  const auth = document.getElementById("cloudAuth"), actions = document.getElementById("cloudActions");
  if (!cloudSession) {
    auth.innerHTML = '<form id="cloudLoginForm" style="margin-top:13px">' +
      '<label class="field">Email<input type="email" name="email" autocomplete="email" required></label>' +
      '<label class="field">Palavra-passe da conta Supabase<input type="password" name="password" autocomplete="current-password" minlength="6" required></label>' +
      '<div class="settings"><button type="submit" class="primary" data-action="login">Entrar</button>' +
      '<button type="button" class="ghost" id="cloudSignup">Criar acesso</button></div></form>' +
      '<p class="dim">Usa o mesmo email em todos os dispositivos. Esta palavra-passe não é a da moey!.</p>';
    document.getElementById("cloudLoginForm").addEventListener("submit", e => { e.preventDefault(); cloudAuthenticate("login",e.currentTarget); });
    document.getElementById("cloudSignup").addEventListener("click", () => cloudAuthenticate("signup",document.getElementById("cloudLoginForm")));
  } else {
    const user = document.createElement("p");
    user.className = "dim";
    user.textContent = "Conta: " + (cloudSession.user && cloudSession.user.email || "autenticada");
    auth.appendChild(user);
    const buttons = [
      ["Sincronizar agora", cloudPull],
      ["Usar dados da nuvem neste dispositivo", cloudUseRemote],
      ["Enviar os dados deste dispositivo", cloudUseLocal],
      ["Terminar sessão", cloudLogout]
    ];
    for (const item of buttons) {
      const btn = document.createElement("button");
      btn.className = item[0] === "Sincronizar agora" ? "primary" : "ghost";
      btn.textContent = item[0];
      btn.addEventListener("click", item[1]);
      actions.appendChild(btn);
    }
  }
}
const renderBeforeCloud = render;
render = function () { renderBeforeCloud(); cloudPanel(); cloudNotice(cloudStatus); };
async function cloudRequest(path, opts = {}, retry = true) {
  if (!cloudSession) throw new Error("Inicia sessão primeiro.");
  if (!cloudSession.expires_at || Date.now() > cloudSession.expires_at - 90000) await cloudRefresh();
  const res = await fetch(SB_URL + path, {
    ...opts, headers: {
      apikey: SB_KEY,
      Authorization: "Bearer " + cloudSession.access_token,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (res.status === 401 && retry) {
    await cloudRefresh();
    return cloudRequest(path, opts, false);
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.msg || e.message || e.error_description || "Erro HTTP " + res.status);
  }
  const value = await res.text();
  return value ? JSON.parse(value) : null;
}
function cloudSetSession(s) {
  cloudSession = {
    ...s,
    expires_at: Date.now() + (Number(s.expires_in) || 3600) * 1000
  };
  localStorage.setItem(CLOUD_TOKEN_KEY,JSON.stringify(cloudSession));
}
async function cloudRefresh() {
  if (!cloudSession || !cloudSession.refresh_token) throw new Error("Sessão expirada. Entra novamente.");
  const res = await fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", {
    method:"POST",
    headers:{apikey:SB_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({refresh_token:cloudSession.refresh_token})
  });
  const value = await res.json();
  if (!res.ok) {
    cloudSession = null; cloudReady = false;
    localStorage.removeItem(CLOUD_TOKEN_KEY);
    render();
    throw new Error("Sessão expirada. Entra novamente.");
  }
  cloudSetSession(value);
}
async function cloudAuthenticate(mode, form) {
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  cloudNotice("A contactar o Supabase…");
  try {
    const url = mode === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
    const res = await fetch(SB_URL + url,{
      method:"POST",headers:{apikey:SB_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({email,password})
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.msg || result.error_description || result.message || "Autenticação não concluída.");
    if (!result.access_token) {
      cloudNotice("Conta criada. Confirma o email recebido e depois entra.");
      return;
    }
    cloudSetSession(result);
    await cloudConnect();
  } catch(e) { cloudNotice("⚠️ " + e.message); }
}
async function cloudReadRemote() {
  const userId = cloudSession.user.id;
  const rows = await cloudRequest("/rest/v1/user_finances?select=data,updated_at&user_id=eq."+encodeURIComponent(userId)+"&limit=1");
  cloudRemote = rows[0] || null;
  cloudRevision = cloudRemote ? cloudRemote.updated_at : null;
}
async function cloudConnect() {
  cloudReady = false;
  cloudNotice("A verificar os dados da nuvem…");
  try {
    await cloudReadRemote();
    if (!cloudRemote) {
      cloudNotice("Conta ligada. Não existem dados na nuvem. Escolhe «Enviar os dados deste dispositivo».");
    } else if (!cloudHasData(data)) {
      cloudAdoptRemote();
      cloudNotice("✅ Dados da nuvem carregados neste dispositivo.");
    } else if (cloudJson() === cloudRemoteJson()) {
      cloudReady = true; cloudSyncedJson = cloudJson();
      cloudNotice("✅ Dados locais e da nuvem coincidem.");
    } else {
      cloudNotice("⚠️ Existem dados locais e na nuvem diferentes. Escolhe qual versão queres utilizar. Não foi substituído nenhum dado.");
    }
  } catch(e) { cloudNotice("⚠️ Falha ao ligar: "+e.message); }
  render();
}
function cloudAdoptRemote() {
  if (!cloudRemote || !cloudRemote.data) return;
  data = {...blank(),...cloudRemote.data};
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  scheduleDiskSave();
  cloudReady = true;
  cloudSyncedJson = cloudJson();
  render();
}
async function cloudUseRemote() {
  try {
    await cloudReadRemote();
    if (!cloudRemote) return cloudNotice("Ainda não existem dados na nuvem.");
    if (cloudHasData(data) && cloudJson() !== cloudRemoteJson()) {
      if (!confirm("Isto vai substituir os dados deste navegador pelos dados da nuvem. Queres continuar?")) return;
      exportBackup();
    }
    cloudAdoptRemote();
    cloudNotice("✅ Dados da nuvem carregados e ligados.");
  } catch(e) { cloudNotice("⚠️ "+e.message); }
}
async function cloudUseLocal() {
  if (!cloudSession) return cloudNotice("Inicia sessão primeiro.");
  if (!confirm("Enviar os dados deste dispositivo para a nuvem? Se já houver dados diferentes, serão substituídos. Mantém o teu backup guardado.")) return;
  try {
    await cloudReadRemote();
    cloudReady = true;
    cloudSyncedJson = null;
    await cloudPush(true);
  } catch(e) { cloudReady=false; cloudNotice("⚠️ "+e.message); }
}
async function cloudPush(force = false) {
  if (!cloudSession || !cloudReady || cloudBusy) return;
  const snapshot = cloudJson();
  if (!force && snapshot === cloudSyncedJson) return;
  cloudBusy = true;
  cloudNotice("A guardar as alterações na nuvem…");
  try {
    const nextRevision = new Date().toISOString();
    let rows;
    if (cloudRevision) {
      rows = await cloudRequest("/rest/v1/user_finances?user_id=eq."+
        encodeURIComponent(cloudSession.user.id)+"&updated_at=eq."+encodeURIComponent(cloudRevision),{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({data:JSON.parse(snapshot),updated_at:nextRevision})
      });
      if (!rows || !rows.length) throw new Error("Há alterações feitas noutro dispositivo. Usa «Sincronizar agora» para resolver, sem substituir nada.");
    } else {
      rows = await cloudRequest("/rest/v1/user_finances",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({user_id:cloudSession.user.id,data:JSON.parse(snapshot),updated_at:nextRevision})
      });
    }
    cloudRevision = rows[0].updated_at;
    cloudRemote = rows[0];
    cloudSyncedJson = snapshot;
    cloudNotice("✅ Alterações guardadas na nuvem.");
  } catch(e) {
    cloudReady = false;
    cloudNotice("⚠️ Sincronização pausada: "+e.message+" Os dados continuam guardados localmente.");
  } finally {
    cloudBusy = false;
    if (cloudReady && cloudJson() !== cloudSyncedJson) cloudChanged();
  }
}
function cloudChanged() {
  if (!cloudReady || !cloudSession) return;
  if (cloudBusy) {cloudRetry=true;return;}
  cloudPush();
}
async function cloudPull() {
  if (!cloudSession || cloudBusy) return;
  try {
    const localChanged = cloudReady && cloudJson() !== cloudSyncedJson;
    await cloudReadRemote();
    if (!cloudRemote) {
      cloudReady = false;
      return cloudNotice("Ainda não existem dados na nuvem. Podes enviar os dados deste dispositivo.");
    }
    if (!cloudReady) {
      cloudNotice("⚠️ Escolhe «Usar dados da nuvem» ou «Enviar os dados deste dispositivo» para ligar sem perder dados.");
    } else if (localChanged) {
      cloudReady = false;
      cloudNotice("⚠️ Existem alterações locais por enviar. Escolhe a versão a manter.");
    } else if (cloudJson() !== cloudRemoteJson()) {
      cloudAdoptRemote();
      cloudNotice("✅ Novas alterações recebidas da nuvem.");
    } else {
      cloudSyncedJson=cloudJson();
      cloudNotice("✅ Tudo atualizado.");
    }
  } catch(e) { cloudNotice("⚠️ "+e.message); }
}
function cloudLogout() {
  cloudSession=null; cloudReady=false;cloudRevision=null;cloudRemote=null;cloudSyncedJson=null;
  localStorage.removeItem(CLOUD_TOKEN_KEY);
  cloudNotice("Sessão terminada. Os dados locais foram mantidos.");
  render();
}
window.addEventListener("online",()=>{if(cloudReady)cloudChanged();});
window.addEventListener("focus",()=>{if(cloudReady && !cloudBusy)cloudPull();});
setInterval(()=>{if(cloudReady && !cloudBusy)cloudPull();},60000);
render();
if (cloudSession) cloudConnect();
