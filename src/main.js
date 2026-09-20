import { db, storage, auth, googleProvider } from './firebase.js';
import { ref as dbRef, onValue, set, push, get, off } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from 'firebase/auth';
import Tesseract from 'tesseract.js';

// ----------------------
// 1. STATE
// ----------------------
let currentUser = null;   // Firebase Auth user
let userProfile = null;   // { grupoId, nombre, memberId }
let grupoId = null;
let grupoData = null;     // { info, miembros, config, semanas, horarios }
let members = {};         // { memberId: { nombre, color, colorLight, uid } }
let myMemberId = null;

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentWeekId = null;
let currentWeekDates = [];
let dbData = { semanas: {}, horarios: {} };

let groupListener = null;

const COLORS = [
  { color: '#3b82f6', light: '#eff6ff', name: 'Azul' },
  { color: '#f97316', light: '#fff7ed', name: 'Naranja' },
  { color: '#10b981', light: '#ecfdf5', name: 'Verde' },
  { color: '#8b5cf6', light: '#f5f3ff', name: 'Morado' },
  { color: '#ef4444', light: '#fef2f2', name: 'Rojo' },
  { color: '#ec4899', light: '#fdf2f8', name: 'Rosa' },
  { color: '#14b8a6', light: '#f0fdfa', name: 'Turquesa' },
  { color: '#f59e0b', light: '#fffbeb', name: 'Ambar' },
];

// ----------------------
// 2. VIEWS
// ----------------------
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ----------------------
// 3. AUTH
// ----------------------
function setupAuth() {
  document.getElementById('btn-auth-login').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return showAuthError('Rellena email y contrasena');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      showAuthError(getAuthErrorMsg(e.code));
    }
  });

  document.getElementById('btn-auth-register').addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    if (!name || !email || !password) return showAuthError('Rellena todos los campos');
    if (password.length < 6) return showAuthError('La contrasena debe tener al menos 6 caracteres');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
    } catch (e) {
      showAuthError(getAuthErrorMsg(e.code));
    }
  });

  const googleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') showAuthError(getAuthErrorMsg(e.code));
    }
  };
  document.getElementById('btn-auth-google').addEventListener('click', googleLogin);
  document.getElementById('btn-auth-google-reg').addEventListener('click', googleLogin);

  document.getElementById('link-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-login-form').classList.add('hidden');
    document.getElementById('auth-register-form').classList.remove('hidden');
    hideAuthError();
  });

  document.getElementById('link-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-register-form').classList.add('hidden');
    document.getElementById('auth-login-form').classList.remove('hidden');
    hideAuthError();
  });

  document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));
  document.getElementById('btn-auth-logout-onboarding').addEventListener('click', () => signOut(auth));

  // Auth password enter key
  document.getElementById('auth-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-auth-login').click();
  });
  document.getElementById('reg-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-auth-register').click();
  });
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAuthError() {
  document.getElementById('auth-error').classList.add('hidden');
}

function getAuthErrorMsg(code) {
  const msgs = {
    'auth/invalid-email': 'Email no valido',
    'auth/user-not-found': 'No existe una cuenta con ese email',
    'auth/wrong-password': 'Contrasena incorrecta',
    'auth/invalid-credential': 'Email o contrasena incorrectos',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese email',
    'auth/weak-password': 'La contrasena es demasiado debil',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento',
  };
  return msgs[code] || 'Error de autenticacion';
}

// ----------------------
// 4. ONBOARDING (Crear/Unirse a grupo)
// ----------------------
function setupOnboarding() {
  renderColorOptions('create-color-options');
  renderColorOptions('join-color-options');

  document.getElementById('btn-create-group').addEventListener('click', () => {
    document.getElementById('create-group-form').classList.remove('hidden');
    document.getElementById('join-group-form').classList.add('hidden');
    hideOnboardingError();
  });

  document.getElementById('btn-join-group').addEventListener('click', () => {
    document.getElementById('join-group-form').classList.remove('hidden');
    document.getElementById('create-group-form').classList.add('hidden');
    hideOnboardingError();
  });

  document.getElementById('btn-confirm-create').addEventListener('click', createGroup);
  document.getElementById('btn-confirm-join').addEventListener('click', joinGroup);
}

function renderColorOptions(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  COLORS.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'color-btn';
    btn.style.background = c.color;
    btn.dataset.index = i;
    btn.title = c.name;
    if (i === 0) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      container.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    container.appendChild(btn);
  });
}

function getSelectedColor(containerId) {
  const selected = document.querySelector(`#${containerId} .color-btn.selected`);
  const idx = selected ? parseInt(selected.dataset.index) : 0;
  return COLORS[idx];
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createGroup() {
  const groupName = document.getElementById('group-name').value.trim();
  if (!groupName) return showOnboardingError('Pon un nombre al grupo');

  const color = getSelectedColor('create-color-options');
  const code = generateInviteCode();
  const userName = currentUser.displayName || currentUser.email.split('@')[0];
  const memberId = userName.toLowerCase().replace(/[^a-z0-9]/g, '');

  const newGroupRef = push(dbRef(db, 'grupos'));
  const newGrupoId = newGroupRef.key;

  try {
    await set(newGroupRef, {
      info: { nombre: groupName, codigoInvitacion: code },
      miembros: {
        [currentUser.uid]: {
          memberId,
          nombre: userName,
          color: color.color,
          colorLight: color.light,
          rol: 'admin'
        }
      },
      config: {
        autoAsignacion: {
          enabled: false,
          horaEntradaLimite: '09:00',
          horaSalidaLimite: '14:00',
          miembroConHorario: memberId,
          reglas: {}
        }
      }
    });

    await set(dbRef(db, `invitaciones/${code}`), newGrupoId);
    await set(dbRef(db, `usuarios/${currentUser.uid}`), {
      grupoId: newGrupoId,
      nombre: userName
    });

    loadUserGroup();
  } catch (e) {
    showOnboardingError('Error al crear el grupo: ' + e.message);
  }
}

async function joinGroup() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) return showOnboardingError('Introduce el codigo de invitacion');

  const color = getSelectedColor('join-color-options');

  try {
    const snap = await get(dbRef(db, `invitaciones/${code}`));
    if (!snap.exists()) return showOnboardingError('Codigo de invitacion no valido');

    const targetGrupoId = snap.val();
    const membersSnap = await get(dbRef(db, `grupos/${targetGrupoId}/miembros`));
    const existingMembers = membersSnap.val() || {};

    if (existingMembers[currentUser.uid]) return showOnboardingError('Ya perteneces a este grupo');

    const memberCount = Object.keys(existingMembers).length;
    if (memberCount >= 2) return showOnboardingError('Este grupo ya tiene 2 miembros');

    const userName = currentUser.displayName || currentUser.email.split('@')[0];
    const memberId = userName.toLowerCase().replace(/[^a-z0-9]/g, '');

    await set(dbRef(db, `grupos/${targetGrupoId}/miembros/${currentUser.uid}`), {
      memberId,
      nombre: userName,
      color: color.color,
      colorLight: color.light,
      rol: 'miembro'
    });

    await set(dbRef(db, `usuarios/${currentUser.uid}`), {
      grupoId: targetGrupoId,
      nombre: userName
    });

    loadUserGroup();
  } catch (e) {
    showOnboardingError('Error al unirse: ' + e.message);
  }
}

function showOnboardingError(msg) {
  const el = document.getElementById('onboarding-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideOnboardingError() {
  document.getElementById('onboarding-error').classList.add('hidden');
}

// ----------------------
// 5. LOAD USER & GROUP
// ----------------------
async function loadUserGroup() {
  const snap = await get(dbRef(db, `usuarios/${currentUser.uid}`));
  if (!snap.exists()) {
    showView('onboarding-view');
    const name = currentUser.displayName || currentUser.email.split('@')[0];
    document.getElementById('onboarding-greeting').textContent = `Hola ${name}! Para empezar, crea un grupo o unete a uno existente.`;
    return;
  }

  userProfile = snap.val();
  grupoId = userProfile.grupoId;

  listenToGroup();
}

function listenToGroup() {
  if (groupListener) off(dbRef(db, `grupos/${grupoId}`));

  const groupRef = dbRef(db, `grupos/${grupoId}`);
  groupListener = onValue(groupRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      grupoId = null;
      showView('onboarding-view');
      return;
    }

    grupoData = data;
    dbData.semanas = data.semanas || {};
    dbData.horarios = data.horarios || {};

    members = {};
    const miembros = data.miembros || {};
    for (const [uid, m] of Object.entries(miembros)) {
      members[m.memberId] = { ...m, uid };
      if (uid === currentUser.uid) myMemberId = m.memberId;
    }

    applyMemberColors();
    showView('main-app');

    const myName = members[myMemberId]?.nombre || '';
    document.getElementById('logged-user-name').textContent = `Hola, ${myName}`;

    renderMonth();
    if (currentWeekId) renderWeek(currentWeekId);
    renderHorarios();
  });
}

function applyMemberColors() {
  const ids = Object.keys(members);
  if (ids[0]) {
    document.documentElement.style.setProperty('--color-m0', members[ids[0]].color);
    document.documentElement.style.setProperty('--color-m0-light', members[ids[0]].colorLight);
  }
  if (ids[1]) {
    document.documentElement.style.setProperty('--color-m1', members[ids[1]].color);
    document.documentElement.style.setProperty('--color-m1-light', members[ids[1]].colorLight);
  }
}

function getMemberColor(memberId) {
  return members[memberId]?.color || '#cbd5e1';
}

function getMemberColorLight(memberId) {
  return members[memberId]?.colorLight || '#f1f5f9';
}

function getMemberName(memberId) {
  return members[memberId]?.nombre || memberId;
}

function getMemberIds() {
  return Object.keys(members);
}

// ----------------------
// 6. TABS & EVENT LISTENERS
// ----------------------
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      e.target.classList.add('active');
      const target = document.getElementById(e.target.dataset.target);
      if (target) target.classList.remove('hidden');
      if (e.target.dataset.target === 'settings-view') renderSettings();
    });
  });

  document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
  document.getElementById('btn-upload-horario').addEventListener('click', uploadHorario);
  document.getElementById('foto-horario').addEventListener('change', handleFotoChange);

  document.getElementById('btn-add-note').addEventListener('click', async () => {
    const textEl = document.getElementById('new-note-text');
    const text = textEl.value.trim();
    if (!text || !currentWeekId || !myMemberId) return;
    const notesRef = dbRef(db, `grupos/${grupoId}/semanas/${currentWeekId}/notas`);
    const newNoteRef = push(notesRef);
    await set(newNoteRef, { text, author: myMemberId, timestamp: Date.now() });
    textEl.value = '';
  });
}

// ----------------------
// 7. CALENDAR (MONTH)
// ----------------------
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderMonth();
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getISODateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderMonth() {
  const display = document.getElementById('current-month-display');
  const date = new Date(currentYear, currentMonth, 1);
  display.textContent = date.toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-header';
    el.textContent = d;
    grid.appendChild(el);
  });

  let firstDay = date.getDay() || 7;
  for (let i = 1; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(currentYear, currentMonth, i);
    const dateStr = getISODateStr(d);
    const weekId = `${currentYear}-W${getISOWeek(d)}`;

    const el = document.createElement('div');
    el.className = 'cal-day';
    el.innerHTML = `<span class="date-num">${i}</span><div class="turn-dots"></div>`;
    el.addEventListener('click', () => openWeek(weekId, d));

    if (dateStr === getISODateStr(new Date())) el.classList.add('today');

    if (dbData.semanas[weekId]?.dias?.[dateStr]) {
      const dayData = dbData.semanas[weekId].dias[dateStr];
      let dotsHtml = '';
      let turnosAsignados = 0;

      ['llevar', 'recoger', 'tarde', 'dormir', 'dia'].forEach(turno => {
        if (dayData[turno] && dayData[turno] !== 'dudas') {
          dotsHtml += `<div class="dot" style="background:${getMemberColor(dayData[turno])}"></div>`;
          turnosAsignados++;
        } else if (dayData[turno] === 'dudas') {
          dotsHtml += `<div class="dot" style="background:#9ca3af"></div>`;
          turnosAsignados++;
        }
      });
      el.querySelector('.turn-dots').innerHTML = dotsHtml;

      const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
      const turnosNecesarios = isWeekend ? 2 : 4;
      if (turnosAsignados > 0 && turnosAsignados < turnosNecesarios) {
        el.classList.add('day-partial');
      } else if (turnosAsignados >= turnosNecesarios) {
        el.classList.add('day-complete');
      }
    }
    grid.appendChild(el);
  }

  renderLegend();
}

function renderLegend() {
  const legend = document.getElementById('calendar-legend');
  const ids = getMemberIds();
  let html = '<div class="legend-group">';
  ids.forEach(id => {
    html += `<span class="legend-item"><div class="dot" style="background:${getMemberColor(id)}"></div> ${getMemberName(id)}</span>`;
  });
  html += '<span class="legend-item"><div class="dot" style="background:#9ca3af"></div> Dudas</span>';
  html += '</div><div class="legend-group">';
  html += '<span class="legend-item"><div class="legend-box partial"></div> A medias</span>';
  html += '<span class="legend-item"><div class="legend-box complete"></div> Completo</span>';
  html += '</div>';
  legend.innerHTML = html;
}

// ----------------------
// 8. WEEKLY VIEW & EDIT
// ----------------------
function openWeek(weekId, dateObj) {
  currentWeekId = weekId;
  const day = dateObj.getDay() || 7;
  const monday = new Date(dateObj);
  monday.setDate(dateObj.getDate() - day + 1);

  currentWeekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return getISODateStr(d);
  });

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.querySelector('[data-target="weekly-view"]').classList.add('active');
  document.getElementById('weekly-view').classList.remove('hidden');

  document.getElementById('current-week-display').textContent =
    `Semana ${weekId.split('W')[1]} (${currentWeekDates[0]} al ${currentWeekDates[6]})`;
  renderWeek(weekId);
}

function renderWeek(weekId) {
  const tbody = document.getElementById('weekly-tbody');
  tbody.innerHTML = '';

  const todayStr = getISODateStr(new Date());
  const myColor = getMemberColor(myMemberId);

  currentWeekDates.forEach((dateStr, idx) => {
    const d = new Date(dateStr);
    const thEl = document.getElementById(`th-${idx}`);
    thEl.textContent = d.getDate();

    if (dateStr === todayStr) {
      thEl.parentElement.style.color = myColor;
      thEl.parentElement.style.fontWeight = 'bold';
      thEl.style.background = myColor;
      thEl.style.color = 'white';
      thEl.style.padding = '2px 6px';
      thEl.style.borderRadius = '10px';
    } else {
      thEl.parentElement.style.color = '';
      thEl.parentElement.style.fontWeight = '';
      thEl.style.background = '';
      thEl.style.color = '';
      thEl.style.padding = '';
    }
  });

  renderNotes(weekId);

  const turnosLV = [
    { id: 'llevar', name: 'Llevar' },
    { id: 'recoger', name: 'Recoger' },
    { id: 'tarde', name: 'Tarde' }
  ];
  const turnoDormir = { id: 'dormir', name: 'Dormir' };
  const turnoDia = { id: 'dia', name: 'Dia' };

  const memberIds = getMemberIds();

  const getSelect = (dateStr, turnoId, isWeekend, isLVOnly) => {
    if (isWeekend && isLVOnly) return '<td>—</td>';
    if (!isWeekend && turnoId === 'dia') return '<td>—</td>';

    const dayData = dbData.semanas[weekId]?.dias?.[dateStr] || {};
    const val = dayData[turnoId] || '';
    const bgColor = val && val !== 'dudas' ? getMemberColorLight(val) : (val === 'dudas' ? '#f3f4f6' : '');
    const txtColor = val && val !== 'dudas' ? getMemberColor(val) : (val === 'dudas' ? '#6b7280' : '');
    const borderColor = val && val !== 'dudas' ? getMemberColor(val) : (val === 'dudas' ? '#d1d5db' : '');

    let options = '<option value="">--</option>';
    memberIds.forEach(mid => {
      options += `<option value="${mid}" ${val === mid ? 'selected' : ''}>${getMemberName(mid)}</option>`;
    });
    options += `<option value="dudas" ${val === 'dudas' ? 'selected' : ''}>? Dudas</option>`;

    return `<td>
      <select class="turn-selector" data-date="${dateStr}" data-turno="${turnoId}"
        style="background-color:${bgColor};color:${txtColor};border-color:${borderColor}">
        ${options}
      </select>
    </td>`;
  };

  const renderRow = (turno, isLVOnly) => {
    let html = `<tr><td>${turno.name}</td>`;
    currentWeekDates.forEach((dateStr, idx) => {
      html += getSelect(dateStr, turno.id, idx >= 5, isLVOnly);
    });
    html += `</tr>`;
    return html;
  };

  turnosLV.forEach(t => { tbody.innerHTML += renderRow(t, true); });
  tbody.innerHTML += renderRow(turnoDia, false);
  tbody.innerHTML += renderRow(turnoDormir, false);

  document.querySelectorAll('.turn-selector').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const date = e.target.dataset.date;
      const turno = e.target.dataset.turno;
      const value = e.target.value;

      const bgColor = value && value !== 'dudas' ? getMemberColorLight(value) : '';
      const txtColor = value && value !== 'dudas' ? getMemberColor(value) : '';
      const borderColor = value && value !== 'dudas' ? getMemberColor(value) : '';
      e.target.style.backgroundColor = bgColor;
      e.target.style.color = txtColor;
      e.target.style.borderColor = borderColor;

      const refPath = dbRef(db, `grupos/${grupoId}/semanas/${weekId}/dias/${date}/${turno}`);
      await set(refPath, value || null);
    });
  });

  calcularRecuentoSemanal(weekId);
}

// ----------------------
// 9. NOTAS SEMANALES
// ----------------------
function renderNotes(weekId) {
  const container = document.getElementById('notes-list');
  container.innerHTML = '';

  const notas = dbData.semanas[weekId]?.notas || {};
  const entries = Object.entries(notas).sort((a, b) => a[1].timestamp - b[1].timestamp);

  if (entries.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem;">No hay notas esta semana.</p>';
    return;
  }

  entries.forEach(([noteId, noteData]) => {
    const isOwner = noteData.author === myMemberId;
    const card = document.createElement('div');
    card.className = 'note-card';
    card.style.background = getMemberColorLight(noteData.author);
    card.style.borderColor = getMemberColor(noteData.author) + '44';

    const dateObj = new Date(noteData.timestamp || Date.now());
    const timeStr = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

    card.innerHTML = `
      <div class="note-header">
        <span class="note-author" style="color:${getMemberColor(noteData.author)}">
          ${getMemberName(noteData.author)}
          <span class="note-time">${timeStr}</span>
        </span>
        ${isOwner ? `
        <span class="note-actions">
          <button data-action="edit" data-id="${noteId}" data-text="${encodeURIComponent(noteData.text)}">&#9998;</button>
          <button data-action="delete" data-id="${noteId}">&#128465;</button>
        </span>
        ` : ''}
      </div>
      <div class="note-text" id="note-text-${noteId}">${noteData.text}</div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteNote(btn.dataset.id));
  });
  container.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => editNote(btn.dataset.id, decodeURIComponent(btn.dataset.text)));
  });
}

async function deleteNote(noteId) {
  if (!currentWeekId || !confirm('Seguro que quieres borrar esta nota?')) return;
  await set(dbRef(db, `grupos/${grupoId}/semanas/${currentWeekId}/notas/${noteId}`), null);
}

function editNote(noteId, oldText) {
  if (!currentWeekId) return;
  const container = document.getElementById(`note-text-${noteId}`);
  container.innerHTML = `
    <textarea id="edit-note-${noteId}" style="width:100%; min-height:60px; margin-bottom:5px;">${oldText}</textarea>
    <button class="btn btn-small" id="save-note-${noteId}">Guardar</button>
    <button class="btn btn-small" id="cancel-note-${noteId}">Cancelar</button>
  `;
  document.getElementById(`save-note-${noteId}`).addEventListener('click', async () => {
    const newText = document.getElementById(`edit-note-${noteId}`).value.trim();
    if (!newText) { deleteNote(noteId); return; }
    await set(dbRef(db, `grupos/${grupoId}/semanas/${currentWeekId}/notas/${noteId}/text`), newText);
  });
  document.getElementById(`cancel-note-${noteId}`).addEventListener('click', () => {
    if (currentWeekId) renderWeek(currentWeekId);
  });
}

// ----------------------
// 10. RECUENTO SEMANAL
// ----------------------
function calcularRecuentoSemanal(weekId) {
  const counts = {};
  let dudas = 0;

  getMemberIds().forEach(mid => { counts[mid] = 0; });

  currentWeekDates.forEach(dateStr => {
    const d = dbData.semanas[weekId]?.dias?.[dateStr];
    if (!d) return;
    ['llevar', 'recoger', 'tarde', 'dormir', 'dia'].forEach(t => {
      if (d[t] === 'dudas') { dudas++; return; }
      if (d[t] && counts[d[t]] !== undefined) counts[d[t]]++;
    });
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  let html = '<h3>Resumen de turnos</h3>';
  getMemberIds().forEach(mid => {
    const pct = total === 0 ? 0 : Math.round((counts[mid] / total) * 100);
    html += `
      <p><strong>${getMemberName(mid)}:</strong> ${counts[mid]} turnos (${pct}%)</p>
      <div style="background:#e2e8f0; height:10px; border-radius:5px; margin:5px 0 15px 0;">
        <div style="background:${getMemberColor(mid)}; width:${pct}%; height:100%; border-radius:5px;"></div>
      </div>
    `;
  });

  if (dudas > 0) {
    html += `<p style="color:#6b7280; font-size:0.9rem; margin-top:10px;">Hay <strong>${dudas}</strong> turno(s) marcado(s) como duda.</p>`;
  }

  document.getElementById('weekly-summary').innerHTML = html;
}

// ----------------------
// 11. HORARIOS, OCR & AUTO-ASSIGN
// ----------------------
async function handleFotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  const status = document.getElementById('ocr-status');
  status.classList.remove('hidden');
  status.textContent = 'Analizando imagen...';
  status.style.color = getMemberColor(myMemberId);

  try {
    const worker = await Tesseract.createWorker('spa');
    const ret = await worker.recognize(file);
    const text = ret.data.text;
    await worker.terminate();

    const timeRegex = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
    const matches = [...text.matchAll(timeRegex)];

    if (matches.length >= 2) {
      const formatTime = (h, m) => `${h.padStart(2, '0')}:${m}`;
      document.getElementById('hora-entrada').value = formatTime(matches[0][1], matches[0][2]);
      document.getElementById('hora-salida').value = formatTime(matches[matches.length - 1][1], matches[matches.length - 1][2]);
      status.textContent = 'Horas detectadas! Comprueba que sean correctas.';
      status.style.color = '#10b981';
    } else {
      status.textContent = 'No se encontraron horas claras. Introducelas manualmente.';
      status.style.color = '#f59e0b';
    }
  } catch (err) {
    console.error(err);
    status.textContent = 'Error al analizar la imagen.';
    status.style.color = '#ef4444';
  }
}

async function uploadHorario() {
  const fileInput = document.getElementById('foto-horario');
  const fecha = document.getElementById('fecha-horario').value;
  const horaEntrada = document.getElementById('hora-entrada').value;
  const horaSalida = document.getElementById('hora-salida').value;
  const btn = document.getElementById('btn-upload-horario');

  if (!fecha || !horaEntrada || !horaSalida) {
    alert('Completa la fecha y las horas de entrada y salida.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Subiendo...';

  try {
    let fotoUrl = null;
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const sRef = storageRef(storage, `horarios/${grupoId}/${fecha}_${file.name}`);
      const snapshot = await uploadBytes(sRef, file);
      fotoUrl = await getDownloadURL(snapshot.ref);
    }

    await set(dbRef(db, `grupos/${grupoId}/horarios/${fecha}`), {
      fecha,
      horaEntrada,
      horaSalida,
      fotoUrl,
      subidoPor: myMemberId,
      timestamp: Date.now()
    });

    autoAsignarTurnos(fecha, horaEntrada, horaSalida);
    alert('Horario subido correctamente');
    fileInput.value = '';
    document.getElementById('ocr-status').classList.add('hidden');
  } catch (error) {
    console.error('Error uploading:', error);
    alert('Error al subir el horario');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Subir Horario';
  }
}

async function autoAsignarTurnos(fecha, entrada, salida) {
  const config = grupoData?.config?.autoAsignacion;
  if (!config || !config.enabled) return;

  const limiteEntrada = config.horaEntradaLimite || '09:00';
  const limiteSalida = config.horaSalidaLimite || '14:00';
  const reglas = config.reglas || {};

  let llevar = null;
  let recoger = null;
  let tarde = null;
  let dormir = null;

  if (entrada < limiteEntrada) {
    llevar = reglas.entradaTemprana_llevar || null;
  } else {
    llevar = reglas.entradaNormal_llevar || null;
  }

  if (salida > limiteSalida) {
    recoger = reglas.salidaTarde_recoger || null;
    tarde = reglas.salidaTarde_tarde || null;
    dormir = reglas.salidaTarde_dormir || null;
  } else {
    recoger = reglas.salidaNormal_recoger || null;
  }

  const d = new Date(fecha);
  const weekId = `${d.getFullYear()}-W${getISOWeek(d)}`;

  const updates = {};
  if (llevar) updates[`grupos/${grupoId}/semanas/${weekId}/dias/${fecha}/llevar`] = llevar;
  if (recoger) updates[`grupos/${grupoId}/semanas/${weekId}/dias/${fecha}/recoger`] = recoger;
  if (tarde) updates[`grupos/${grupoId}/semanas/${weekId}/dias/${fecha}/tarde`] = tarde;
  if (dormir) updates[`grupos/${grupoId}/semanas/${weekId}/dias/${fecha}/dormir`] = dormir;

  for (const [path, val] of Object.entries(updates)) {
    await set(dbRef(db, path), val);
  }
}

function renderHorarios() {
  const gallery = document.getElementById('horarios-gallery');
  gallery.innerHTML = '';

  const config = grupoData?.config?.autoAsignacion;
  const horarioMember = config?.miembroConHorario;
  if (horarioMember) {
    document.getElementById('horarios-title').textContent = `Horarios Laborales de ${getMemberName(horarioMember)}`;
  }

  const list = Object.values(dbData.horarios || {}).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  if (list.length === 0) {
    gallery.innerHTML = '<p style="color:var(--text-secondary)">No hay horarios subidos aun.</p>';
    return;
  }

  list.forEach(h => {
    const card = document.createElement('div');
    card.className = 'horario-card';
    card.innerHTML = `
      <div class="h-date">${h.fecha}</div>
      <div class="h-times" style="color:${getMemberColor(h.subidoPor)}">Entrada ${h.horaEntrada} - Salida ${h.horaSalida}</div>
      ${h.fotoUrl ? `<img src="${h.fotoUrl}" alt="Horario">` : '<div class="no-photo">Sin foto</div>'}
      <div class="h-user">Subido por: ${getMemberName(h.subidoPor)}</div>
    `;
    gallery.appendChild(card);
  });
}

// ----------------------
// 12. SETTINGS
// ----------------------
function renderSettings() {
  if (!grupoData) return;

  document.getElementById('setting-group-name').value = grupoData.info?.nombre || '';
  document.getElementById('setting-invite-code').textContent = grupoData.info?.codigoInvitacion || '';

  const membersList = document.getElementById('members-list');
  membersList.innerHTML = '';
  getMemberIds().forEach(mid => {
    const m = members[mid];
    membersList.innerHTML += `
      <div class="member-row">
        <div class="member-color" style="background:${m.color}"></div>
        <span>${m.nombre}</span>
        <span class="member-role">${m.rol || 'miembro'}</span>
      </div>
    `;
  });

  const config = grupoData.config?.autoAsignacion || {};
  document.getElementById('setting-auto-enabled').checked = config.enabled || false;
  document.getElementById('setting-entrada-limite').value = config.horaEntradaLimite || '09:00';
  document.getElementById('setting-salida-limite').value = config.horaSalidaLimite || '14:00';

  const memberIds = getMemberIds();
  const selects = [
    'setting-horario-member',
    'rule-entrada-temprana-llevar', 'rule-entrada-normal-llevar',
    'rule-salida-tarde-recoger', 'rule-salida-tarde-tarde', 'rule-salida-tarde-dormir',
    'rule-salida-normal-recoger'
  ];

  selects.forEach(selId => {
    const sel = document.getElementById(selId);
    sel.innerHTML = '<option value="">-- Seleccionar --</option>';
    memberIds.forEach(mid => {
      sel.innerHTML += `<option value="${mid}">${getMemberName(mid)}</option>`;
    });
  });

  if (config.miembroConHorario) {
    document.getElementById('setting-horario-member').value = config.miembroConHorario;
  }

  const reglas = config.reglas || {};
  const ruleMapping = {
    'rule-entrada-temprana-llevar': 'entradaTemprana_llevar',
    'rule-entrada-normal-llevar': 'entradaNormal_llevar',
    'rule-salida-tarde-recoger': 'salidaTarde_recoger',
    'rule-salida-tarde-tarde': 'salidaTarde_tarde',
    'rule-salida-tarde-dormir': 'salidaTarde_dormir',
    'rule-salida-normal-recoger': 'salidaNormal_recoger',
  };

  for (const [selId, reglaKey] of Object.entries(ruleMapping)) {
    if (reglas[reglaKey]) document.getElementById(selId).value = reglas[reglaKey];
  }

  document.getElementById('btn-copy-code').onclick = () => {
    const code = grupoData.info?.codigoInvitacion || '';
    navigator.clipboard.writeText(code).then(() => {
      document.getElementById('btn-copy-code').textContent = 'Copiado!';
      setTimeout(() => { document.getElementById('btn-copy-code').textContent = 'Copiar'; }, 2000);
    });
  };

  document.getElementById('btn-save-settings').onclick = saveSettings;
  document.getElementById('btn-leave-group').onclick = leaveGroup;
}

async function saveSettings() {
  const ruleMapping = {
    'rule-entrada-temprana-llevar': 'entradaTemprana_llevar',
    'rule-entrada-normal-llevar': 'entradaNormal_llevar',
    'rule-salida-tarde-recoger': 'salidaTarde_recoger',
    'rule-salida-tarde-tarde': 'salidaTarde_tarde',
    'rule-salida-tarde-dormir': 'salidaTarde_dormir',
    'rule-salida-normal-recoger': 'salidaNormal_recoger',
  };

  const reglas = {};
  for (const [selId, reglaKey] of Object.entries(ruleMapping)) {
    const val = document.getElementById(selId).value;
    if (val) reglas[reglaKey] = val;
  }

  try {
    await set(dbRef(db, `grupos/${grupoId}/info/nombre`),
      document.getElementById('setting-group-name').value.trim() || 'Mi Grupo');

    await set(dbRef(db, `grupos/${grupoId}/config/autoAsignacion`), {
      enabled: document.getElementById('setting-auto-enabled').checked,
      horaEntradaLimite: document.getElementById('setting-entrada-limite').value || '09:00',
      horaSalidaLimite: document.getElementById('setting-salida-limite').value || '14:00',
      miembroConHorario: document.getElementById('setting-horario-member').value || '',
      reglas
    });

    const msg = document.getElementById('settings-msg');
    msg.textContent = 'Ajustes guardados correctamente';
    msg.style.color = '#10b981';
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 3000);
  } catch (e) {
    const msg = document.getElementById('settings-msg');
    msg.textContent = 'Error al guardar: ' + e.message;
    msg.style.color = '#ef4444';
    msg.classList.remove('hidden');
  }
}

async function leaveGroup() {
  if (!confirm('Seguro que quieres abandonar el grupo? Perderas el acceso a los datos compartidos.')) return;

  try {
    await set(dbRef(db, `grupos/${grupoId}/miembros/${currentUser.uid}`), null);
    await set(dbRef(db, `usuarios/${currentUser.uid}`), null);

    if (groupListener) off(dbRef(db, `grupos/${grupoId}`));
    grupoId = null;
    grupoData = null;
    members = {};
    myMemberId = null;
    dbData = { semanas: {}, horarios: {} };

    showView('onboarding-view');
  } catch (e) {
    alert('Error al abandonar el grupo: ' + e.message);
  }
}

// ----------------------
// 13. INIT
// ----------------------
function init() {
  setupAuth();
  setupOnboarding();
  setupTabs();

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      loadUserGroup();
    } else {
      currentUser = null;
      userProfile = null;
      if (groupListener && grupoId) off(dbRef(db, `grupos/${grupoId}`));
      grupoId = null;
      grupoData = null;
      members = {};
      myMemberId = null;
      dbData = { semanas: {}, horarios: {} };
      showView('auth-view');
    }
  });
}

init();
