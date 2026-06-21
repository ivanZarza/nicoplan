import { db, storage } from './firebase.js';
import { ref as dbRef, onValue, set, push } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import Tesseract from 'tesseract.js';

// ----------------------
// 1. STATE & AUTH
// ----------------------
let currentUser = null;
let currentYear = 2026;
let currentMonth = 6; // July (0-indexed)
let dbData = { semanas: {}, horarios: {} };

const USERS = {
  'ivan': { pin: '1234', name: 'Ivan' },
  'iria': { pin: '5678', name: 'Iria' }
};

// DOM Elements
const loginView = document.getElementById('login-view');
const mainApp = document.getElementById('main-app');
const pinContainer = document.getElementById('pin-container');
const pinInput = document.getElementById('pin-input');
let selectedLoginUser = null;

// ----------------------
// 2. INIT & FIREBASE
// ----------------------
function init() {
  const sessionUser = sessionStorage.getItem('nicoplan_user');
  if (sessionUser && USERS[sessionUser]) login(sessionUser);

  const rootRef = dbRef(db, '/');
  onValue(rootRef, (snapshot) => {
    const data = snapshot.val() || {};
    dbData.semanas = data.semanas || {};
    dbData.horarios = data.horarios || {};
    renderMonth();
    if (currentWeekId) renderWeek(currentWeekId);
    renderHorarios();
  });

  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('btn-login-ivan').addEventListener('click', () => showPin('ivan'));
  document.getElementById('btn-login-iria').addEventListener('click', () => showPin('iria'));
  
  document.getElementById('btn-login-submit').addEventListener('click', () => {
    if (pinInput.value === USERS[selectedLoginUser].pin) {
      login(selectedLoginUser);
    } else {
      alert('PIN incorrecto');
      pinInput.value = '';
    }
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('nicoplan_user');
    currentUser = null;
    mainApp.classList.add('hidden');
    loginView.classList.remove('hidden');
    pinContainer.classList.add('hidden');
    pinInput.value = '';
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      e.target.classList.add('active');
      document.getElementById(e.target.dataset.target).classList.remove('hidden');
    });
  });

  document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => changeMonth(1));

  // Upload horario & OCR
  document.getElementById('btn-upload-horario').addEventListener('click', uploadHorario);
  document.getElementById('foto-horario').addEventListener('change', handleFotoChange);
}

function showPin(userId) {
  selectedLoginUser = userId;
  pinContainer.classList.remove('hidden');
  pinInput.focus();
}

function login(userId) {
  currentUser = userId;
  sessionStorage.setItem('nicoplan_user', userId);
  document.getElementById('logged-user-name').textContent = `Hola, ${USERS[userId].name}`;
  loginView.classList.add('hidden');
  mainApp.classList.remove('hidden');
  renderMonth();
}

// ----------------------
// 3. CALENDAR (MONTH)
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
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
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
    const dateStr = d.toLocaleDateString('sv-SE'); // YYYY-MM-DD
    const weekId = `${currentYear}-W${getISOWeek(d)}`;

    const el = document.createElement('div');
    el.className = 'cal-day';
    el.innerHTML = `<span class="date-num">${i}</span><div class="turn-dots"></div>`;
    el.addEventListener('click', () => openWeek(weekId, d));
    
    if (dbData.semanas[weekId]?.dias?.[dateStr]) {
      const dayData = dbData.semanas[weekId].dias[dateStr];
      let dotsHtml = '';
      let turnosAsignados = 0;
      
      ['llevar', 'recoger', 'tarde', 'dormir', 'dia'].forEach(turno => {
        if (dayData[turno]) {
          dotsHtml += `<div class="dot ${dayData[turno]}"></div>`;
          turnosAsignados++;
        }
      });
      el.querySelector('.turn-dots').innerHTML = dotsHtml;

      // Calcular si está completo
      const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
      const turnosNecesarios = isWeekend ? 2 : 4; // Finde (dia, dormir) vs L-V (llevar, recoger, tarde, dormir)
      
      if (turnosAsignados > 0 && turnosAsignados < turnosNecesarios) {
        el.classList.add('day-partial');
      } else if (turnosAsignados >= turnosNecesarios) {
        el.classList.add('day-complete');
      }
    }
    grid.appendChild(el);
  }
}

// ----------------------
// 4. WEEKLY VIEW & EDIT
// ----------------------
let currentWeekId = null;
let currentWeekDates = []; // Array of YYYY-MM-DD for the current week

function openWeek(weekId, dateObj) {
  currentWeekId = weekId;
  
  // Encontrar el lunes de esta semana
  const day = dateObj.getDay() || 7;
  const monday = new Date(dateObj);
  monday.setDate(dateObj.getDate() - day + 1);

  currentWeekDates = Array.from({length: 7}, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toLocaleDateString('sv-SE');
  });

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.querySelector('[data-target="weekly-view"]').classList.add('active');
  document.getElementById('weekly-view').classList.remove('hidden');

  document.getElementById('current-week-display').textContent = `Semana ${weekId.split('W')[1]} (${currentWeekDates[0]} al ${currentWeekDates[6]})`;
  renderWeek(weekId);
}

function renderWeek(weekId) {
  const tbody = document.getElementById('weekly-tbody');
  tbody.innerHTML = '';

  const turnosLV = [
    { id: 'llevar', name: '🚗 Llevar' },
    { id: 'recoger', name: '🏫 Recoger' },
    { id: 'tarde', name: '🌅 Tarde' }
  ];
  const turnoDormir = { id: 'dormir', name: '🌙 Dormir' };
  const turnoDia = { id: 'dia', name: '☀️ Día' };

  // Helper para generar selects
  const getSelect = (dateStr, turnoId, isWeekend, isLVOnly) => {
    if (isWeekend && isLVOnly) return '<td>—</td>';
    if (!isWeekend && turnoId === 'dia') return '<td>—</td>';

    const dayData = dbData.semanas[weekId]?.dias?.[dateStr] || {};
    const val = dayData[turnoId] || '';
    const cl = val ? val : '';
    
    return `<td>
      <select class="turn-selector ${cl}" data-date="${dateStr}" data-turno="${turnoId}">
        <option value="">--</option>
        <option value="ivan" ${val === 'ivan' ? 'selected' : ''}>Ivan</option>
        <option value="iria" ${val === 'iria' ? 'selected' : ''}>Iria</option>
      </select>
    </td>`;
  };

  const renderRow = (turno, isLVOnly) => {
    let html = `<tr><td>${turno.name}</td>`;
    currentWeekDates.forEach((dateStr, idx) => {
      const isWeekend = idx >= 5; // Sábado(5) o Domingo(6)
      html += getSelect(dateStr, turno.id, isWeekend, isLVOnly);
    });
    html += `</tr>`;
    return html;
  };

  // Render LV
  turnosLV.forEach(t => { tbody.innerHTML += renderRow(t, true); });
  // Render Dia completo (Solo findes)
  tbody.innerHTML += renderRow(turnoDia, false);
  // Render Dormir (Todos los días)
  tbody.innerHTML += renderRow(turnoDormir, false);

  // Escuchar cambios
  document.querySelectorAll('.turn-selector').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const date = e.target.dataset.date;
      const turno = e.target.dataset.turno;
      const value = e.target.value;

      e.target.className = `turn-selector ${value}`;
      
      const refPath = dbRef(db, `semanas/${weekId}/dias/${date}/${turno}`);
      await set(refPath, value || null);
    });
  });

  calcularRecuentoSemanal(weekId);
}

// ----------------------
// 5. RECUENTO SEMANAL
// ----------------------
function calcularRecuentoSemanal(weekId) {
  let ivan = 0;
  let iria = 0;

  currentWeekDates.forEach(dateStr => {
    const d = dbData.semanas[weekId]?.dias?.[dateStr];
    if (!d) return;
    ['llevar', 'recoger', 'tarde', 'dormir', 'dia'].forEach(t => {
      if (d[t] === 'ivan') ivan++;
      if (d[t] === 'iria') iria++;
    });
  });

  const total = ivan + iria;
  const pctIvan = total === 0 ? 0 : Math.round((ivan / total) * 100);
  const pctIria = total === 0 ? 0 : Math.round((iria / total) * 100);

  const html = `
    <h3>📊 Resumen de turnos</h3>
    <p><strong>Ivan:</strong> ${ivan} turnos (${pctIvan}%)</p>
    <div style="background:#e2e8f0; height:10px; border-radius:5px; margin:5px 0 15px 0;">
      <div style="background:var(--color-ivan); width:${pctIvan}%; height:100%; border-radius:5px;"></div>
    </div>
    
    <p><strong>Iria:</strong> ${iria} turnos (${pctIria}%)</p>
    <div style="background:#e2e8f0; height:10px; border-radius:5px; margin:5px 0;">
      <div style="background:var(--color-iria); width:${pctIria}%; height:100%; border-radius:5px;"></div>
    </div>
  `;

  document.getElementById('weekly-summary').innerHTML = html;
}

// ----------------------
// 6. HORARIOS, OCR & AUTO-ASSIGN
// ----------------------

async function handleFotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  const status = document.getElementById('ocr-status');
  const inputEntrada = document.getElementById('hora-entrada');
  const inputSalida = document.getElementById('hora-salida');

  status.classList.remove('hidden');
  status.textContent = 'Analizando imagen... 🤖';

  try {
    const worker = await Tesseract.createWorker('spa');
    const ret = await worker.recognize(file);
    const text = ret.data.text;
    await worker.terminate();

    // Regex para buscar horas (ej. 05:00, 14:00, 5:00)
    const timeRegex = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
    const matches = [...text.matchAll(timeRegex)];
    
    if (matches.length >= 2) {
      // Formatear para que siempre sea HH:mm
      const formatTime = (h, m) => `${h.padStart(2, '0')}:${m}`;
      inputEntrada.value = formatTime(matches[0][1], matches[0][2]);
      inputSalida.value = formatTime(matches[matches.length - 1][1], matches[matches.length - 1][2]); // Asumimos la última como salida
      status.textContent = '¡Horas detectadas! Por favor, comprueba que sean correctas. ✅';
      status.style.color = '#10b981'; // Green
    } else {
      status.textContent = 'No se encontraron horas claras. Introdúcelas manualmente. ⚠️';
      status.style.color = '#f59e0b'; // Yellow/Orange
    }
  } catch (err) {
    console.error(err);
    status.textContent = 'Error al analizar la imagen. ❌';
    status.style.color = '#ef4444'; // Red
  }
}

async function uploadHorario() {
  const fileInput = document.getElementById('foto-horario');
  const fecha = document.getElementById('fecha-horario').value;
  const horaEntrada = document.getElementById('hora-entrada').value;
  const horaSalida = document.getElementById('hora-salida').value;
  const btn = document.getElementById('btn-upload-horario');

  if (!fecha || !horaEntrada || !horaSalida) {
    alert('Por favor completa la fecha y las horas de entrada y salida.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Subiendo... ⏳';

  try {
    let fotoUrl = null;
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const sRef = storageRef(storage, `horarios/${fecha}_${file.name}`);
      const snapshot = await uploadBytes(sRef, file);
      fotoUrl = await getDownloadURL(snapshot.ref);
    }

    // Save to DB
    const hRef = dbRef(db, `horarios/${fecha}`);
    await set(hRef, {
      fecha,
      horaEntrada,
      horaSalida,
      fotoUrl,
      subidoPor: currentUser,
      timestamp: Date.now()
    });

    // Auto-asignación Fase 7
    autoAsignarTurnos(fecha, horaEntrada, horaSalida);

    alert('Horario subido y turnos auto-asignados correctamente ✅');
    fileInput.value = '';
    
  } catch (error) {
    console.error('Error uploading:', error);
    alert('Error al subir el horario');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Subir Horario';
  }
}

async function autoAsignarTurnos(fecha, entrada, salida) {
  // Lógica de inteligencia
  // entrada < 09:00 -> Ivan lleva
  // salida > 14:00 -> Ivan recoge y tarde

  let llevar = null;
  let recoger = null;
  let tarde = null;
  let dormir = null;

  if (entrada < "09:00") llevar = "ivan";
  else llevar = "iria";

  if (salida > "14:00") {
    recoger = "ivan";
    tarde = "ivan";
    dormir = "iria"; // Default as per rules
  } else {
    recoger = "iria";
  }

  const d = new Date(fecha);
  const weekId = `${d.getFullYear()}-W${getISOWeek(d)}`;
  
  const updates = {};
  if (llevar) updates[`semanas/${weekId}/dias/${fecha}/llevar`] = llevar;
  if (recoger) updates[`semanas/${weekId}/dias/${fecha}/recoger`] = recoger;
  if (tarde) updates[`semanas/${weekId}/dias/${fecha}/tarde`] = tarde;
  if (dormir) updates[`semanas/${weekId}/dias/${fecha}/dormir`] = dormir;

  // Actualizar en lote
  for (const [path, val] of Object.entries(updates)) {
    await set(dbRef(db, path), val);
  }
}

function renderHorarios() {
  const gallery = document.getElementById('horarios-gallery');
  gallery.innerHTML = '';

  const list = Object.values(dbData.horarios || {}).sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

  if (list.length === 0) {
    gallery.innerHTML = '<p style="color:var(--text-secondary)">No hay horarios subidos aún.</p>';
    return;
  }

  list.forEach(h => {
    const card = document.createElement('div');
    card.className = 'horario-card';
    card.innerHTML = `
      <div class="h-date">${h.fecha}</div>
      <div class="h-times">🕗 ${h.horaEntrada} - 🕒 ${h.horaSalida}</div>
      ${h.fotoUrl ? `<img src="${h.fotoUrl}" alt="Horario">` : '<div class="no-photo">Sin foto</div>'}
      <div class="h-user">Subido por: ${USERS[h.subidoPor]?.name || h.subidoPor}</div>
    `;
    gallery.appendChild(card);
  });
}

init();
