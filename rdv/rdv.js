/* Kinovea booking front — talks only to /api/kq/* (same origin). */
(() => {
  'use strict';

  // ---------- API layer ----------
  const api = {
    async config() { return jget('/api/kq/config'); },
    async availabilities(body) { return jpost('/api/kq/availabilities', body); },
    async patientLookup(niss) { return jpost('/api/kq/patient-lookup', { niss }); },
    async book(body) { return jpost('/api/kq/book', body); }
  };
  async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function jpost(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }

  // ---------- State ----------
  const state = {
    config: null,
    mode: 'cabinet',
    locationId: null,
    specialtyId: null,
    typeId: null,
    therapistId: null,   // optional filter
    weekStart: null,     // ISO date string of the Monday being viewed
    avail: null,         // last availabilities response
    selection: [],       // [{locationId, specialtyId, typeId, therapistId, start, label, meta}]
    patient: { found: false }
  };

  const $ = (id) => document.getElementById(id);
  const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // ---------- Boot ----------
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindStaticEvents();
    try {
      state.config = await api.config();
      renderLocations();
    } catch (e) {
      showStatus('Le service de réservation est momentanément indisponible. Merci de réessayer dans quelques minutes, ou d\'appeler le cabinet.', true);
    }
  }

  function showStatus(msg, isError) {
    const el = $('app-status');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
  }
  function hideStatus() { $('app-status').hidden = true; }

  // ---------- Config helpers ----------
  const cfg = {
    location: (id) => state.config.locations.find((l) => l.id === id),
    specialtyName: (id) => (state.config.specialties.find((s) => s.id === id) || {}).name || 'Spécialité',
    typeInfo: (id) => state.config.appointmentTypes.find((t) => t.id === id) || { name: 'Séance', duration: 0 },
    therapistName: (id) => (state.config.therapists.find((t) => t.id === id) || {}).name || '',
  };

  // Specialties offered at the current location (mapped id -> name)
  function locationSpecialties() {
    const loc = cfg.location(state.locationId);
    if (!loc) return [];
    return loc.specialties.map((s) => ({ id: s.id, name: cfg.specialtyName(s.id), node: s }));
  }
  // Appointment types available for the chosen specialty at the current location
  function specialtyTypes() {
    const loc = cfg.location(state.locationId);
    if (!loc || !state.specialtyId) return [];
    const sp = loc.specialties.find((s) => s.id === state.specialtyId);
    if (!sp) return [];
    return sp.types.map((t) => ({ id: t.id, ...cfg.typeInfo(t.id), therapists: t.therapists }));
  }
  // Therapists available for the chosen specialty (+ type if chosen)
  function availableTherapists() {
    const types = specialtyTypes();
    const filtered = state.typeId ? types.filter((t) => t.id === state.typeId) : types;
    const ids = new Set();
    filtered.forEach((t) => t.therapists.forEach((id) => ids.add(id)));
    return [...ids].map((id) => ({ id, name: cfg.therapistName(id) }));
  }

  // ---------- Render: locations ----------
  function renderLocations() {
    const picker = $('location-picker');
    const list = state.config.locations.filter((l) => (state.mode === 'cabinet' ? l.isCabinet : !l.isCabinet));
    $('location-label').textContent = state.mode === 'cabinet' ? 'Cabinet' : 'Région (visite à domicile)';
    picker.innerHTML = '';
    list.forEach((l) => {
      const b = document.createElement('button');
      b.className = 'location-card' + (l.id === state.locationId ? ' active' : '');
      b.innerHTML = `<span class="loc-name">${esc(l.name)}</span>` + (l.address ? `<span class="loc-addr">${esc(l.address)}</span>` : '');
      b.addEventListener('click', () => selectLocation(l.id));
      picker.appendChild(b);
    });
  }

  function selectLocation(id) {
    state.locationId = id;
    state.specialtyId = null; state.typeId = null; state.therapistId = null;
    state.weekStart = null;
    renderLocations();
    renderSpecialties();
    $('type-field').hidden = true;
    $('therapist-field').hidden = true;
    hideCalendar();
  }

  // ---------- Render: specialties ----------
  function renderSpecialties() {
    const wrap = $('specialty-filter');
    const specs = locationSpecialties().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    wrap.innerHTML = '';
    specs.forEach((s) => {
      const c = document.createElement('button');
      c.className = 'chip' + (s.id === state.specialtyId ? ' active' : '');
      c.textContent = s.name;
      c.addEventListener('click', () => selectSpecialty(s.id));
      wrap.appendChild(c);
    });
    $('specialty-field').hidden = specs.length === 0;
  }

  function selectSpecialty(id) {
    state.specialtyId = id;
    state.therapistId = null;
    const types = specialtyTypes();
    // auto-select when a single type, else let the user pick
    state.typeId = types.length === 1 ? types[0].id : null;
    renderSpecialties();
    renderTypes();
    renderTherapists();
    if (state.typeId) loadWeek(null);
    else hideCalendar();
  }

  // ---------- Render: appointment types ----------
  function renderTypes() {
    const types = specialtyTypes();
    const wrap = $('type-filter');
    wrap.innerHTML = '';
    if (types.length <= 1) { $('type-field').hidden = true; return; }
    $('type-field').hidden = false;
    types.forEach((t) => {
      const c = document.createElement('button');
      c.className = 'chip' + (t.id === state.typeId ? ' active' : '');
      c.textContent = t.duration ? `${t.name} · ${t.duration} min` : t.name;
      c.addEventListener('click', () => { state.typeId = t.id; state.therapistId = null; renderTypes(); renderTherapists(); loadWeek(null); });
      wrap.appendChild(c);
    });
  }

  // ---------- Render: therapists (optional filter) ----------
  function renderTherapists() {
    const list = availableTherapists().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const wrap = $('therapist-filter');
    wrap.innerHTML = '';
    if (list.length <= 1) { $('therapist-field').hidden = true; return; }
    $('therapist-field').hidden = false;
    const mkChip = (id, label) => {
      const c = document.createElement('button');
      c.className = 'chip' + ((id === state.therapistId || (id === null && state.therapistId === null)) ? ' active' : '');
      c.textContent = label;
      c.addEventListener('click', () => { state.therapistId = id; renderTherapists(); renderCalendar(); });
      return c;
    };
    wrap.appendChild(mkChip(null, 'Tous'));
    list.forEach((t) => wrap.appendChild(mkChip(t.id, t.name)));
  }

  // ---------- Availabilities ----------
  function hideCalendar() { $('calendar-panel').hidden = true; $('hint').hidden = false; }

  async function loadWeek(weekStartIso) {
    if (!state.locationId || !state.specialtyId || !state.typeId) return;
    $('hint').hidden = true;
    $('calendar-panel').hidden = false;
    $('calendar').innerHTML = '<div class="skeleton-row" style="grid-column:1/-1"></div>';
    $('calendar-empty').hidden = true;
    try {
      const res = await api.availabilities({
        locationId: state.locationId,
        specialtyId: state.specialtyId,
        typeId: state.typeId,
        weekStart: weekStartIso || undefined
      });
      state.avail = res;
      state.weekStart = isoFromDdmmyyyy(res.weekStart);
      renderCalendar();
    } catch (e) {
      $('calendar').innerHTML = '';
      showStatus('Impossible de charger les disponibilités. Réessayez.', true);
    }
  }

  function renderCalendar() {
    const res = state.avail;
    if (!res) return;
    $('week-label').textContent = weekLabel(res.weekStart, res.weekEnd);
    const cal = $('calendar');
    cal.innerHTML = '';
    const monday = dateFromDdmmyyyy(res.weekStart);
    const todayKey = ddmmyyyy(new Date());
    let anySlot = false;

    for (let i = 0; i < 7; i++) {
      const day = new Date(monday); day.setDate(day.getDate() + i);
      const key = ddmmyyyy(day);
      let slots = (res.days[key] || []);
      if (state.therapistId) slots = slots.filter((s) => s.therapistId === state.therapistId);
      if (slots.length) anySlot = true;

      const col = document.createElement('div');
      col.className = 'day-col' + (slots.length ? '' : ' empty');
      col.innerHTML = `<div class="day-head${key === todayKey ? ' is-today' : ''}"><div class="dow">${DOW[i]}</div><div class="dnum">${day.getDate()}</div></div>`;
      const slotWrap = document.createElement('div');
      slotWrap.className = 'slots';
      slots.forEach((s) => slotWrap.appendChild(renderSlot(key, s)));
      col.appendChild(slotWrap);
      cal.appendChild(col);
    }
    $('calendar-empty').hidden = anySlot;
    updateNavButtons();
  }

  function renderSlot(dateKey, slot) {
    const start = `${dateKey} ${slot.start}`;
    const selected = state.selection.some((x) => x.start === start && x.therapistId === slot.therapistId);
    const el = document.createElement('button');
    el.className = 'slot' + (selected ? ' active' : '');
    const showTh = !state.therapistId;
    el.innerHTML = `${slot.start}` + (showTh ? `<span class="slot-th">${esc(shortName(cfg.therapistName(slot.therapistId)))}</span>` : '');
    el.addEventListener('click', () => toggleSlot(dateKey, slot));
    return el;
  }

  function toggleSlot(dateKey, slot) {
    const start = `${dateKey} ${slot.start}`;
    const idx = state.selection.findIndex((x) => x.start === start && x.therapistId === slot.therapistId);
    if (idx >= 0) { state.selection.splice(idx, 1); }
    else {
      const rules = state.config.rules || {};
      const maxSession = rules.MaxTentReqPerSession || 10;
      const maxDay = rules.MaxTentativePerDay || 10;
      if (state.selection.length >= maxSession) { flashSelection(`Maximum ${maxSession} rendez-vous par demande.`); return; }
      const sameDay = state.selection.filter((x) => x.start.startsWith(dateKey)).length;
      if (sameDay >= maxDay) { flashSelection(`Maximum ${maxDay} rendez-vous par jour.`); return; }
      state.selection.push({
        locationId: state.locationId,
        specialtyId: state.specialtyId,
        typeId: state.typeId,
        therapistId: slot.therapistId,
        start,
        label: `${DOW[dayIndex(dateKey)]} ${dateKey.slice(0, 5)} · ${slot.start}`,
        meta: `${cfg.location(state.locationId).name} · ${cfg.specialtyName(state.specialtyId)} · ${shortName(cfg.therapistName(slot.therapistId))}`
      });
    }
    renderCalendar();
    renderSelection();
  }

  function flashSelection(msg) { showStatus(msg, false); setTimeout(hideStatus, 2600); }

  // ---------- Selection bar ----------
  function renderSelection() {
    const bar = $('selection-summary');
    const list = $('selection-list');
    if (!state.selection.length) { bar.hidden = true; return; }
    bar.hidden = false;
    list.innerHTML = '';
    state.selection.forEach((s, i) => {
      const pill = document.createElement('span');
      pill.className = 'sel-pill';
      pill.innerHTML = `${esc(s.label)} <button aria-label="Retirer">×</button>`;
      pill.querySelector('button').addEventListener('click', () => { state.selection.splice(i, 1); renderSelection(); renderCalendar(); });
      list.appendChild(pill);
    });
  }

  // ---------- Week nav ----------
  function updateNavButtons() {
    const rules = state.config.rules || {};
    const maxDays = rules.MaxBookingDays || 100;
    const monday = dateFromDdmmyyyy(state.avail.weekStart);
    const prevMon = new Date(monday); prevMon.setDate(prevMon.getDate() - 7);
    const thisMon = mondayOf(new Date());
    $('week-prev').disabled = prevMon < thisMon;
    const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + maxDays);
    $('week-next').disabled = monday > maxDate;
  }

  function shiftWeek(dir) {
    const monday = dateFromDdmmyyyy(state.avail.weekStart);
    monday.setDate(monday.getDate() + dir * 7);
    loadWeek(isoDate(monday));
  }

  // ---------- Booking panel ----------
  function openBooking() {
    if (!state.selection.length) return;
    $('booking-error').hidden = true;
    renderRecap();
    resetPatientForm();
    $('overlay').hidden = false; requestAnimationFrame(() => $('overlay').classList.add('show'));
    $('booking-panel').classList.add('open');
    $('booking-panel').setAttribute('aria-hidden', 'false');
  }
  function closeBooking() {
    $('booking-panel').classList.remove('open');
    $('booking-panel').setAttribute('aria-hidden', 'true');
    $('overlay').classList.remove('show');
    setTimeout(() => { $('overlay').hidden = true; }, 300);
  }

  function renderRecap() {
    const wrap = $('booking-recap');
    wrap.innerHTML = '';
    state.selection.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'recap-item';
      d.innerHTML = `<div class="r-when">${esc(s.label)}</div><div class="r-meta">${esc(s.meta)}</div>`;
      wrap.appendChild(d);
    });
  }

  function resetPatientForm() {
    state.patient = { found: false };
    $('niss-input').value = '';
    const hint = $('niss-hint');
    hint.textContent = 'Déjà patient·e ? Retrouvez votre dossier. Sinon, remplissez le formulaire ci-dessous.';
    hint.classList.remove('found');
    $('patient-form').classList.remove('hidden-form');
    ['pf-firstname', 'pf-lastname', 'pf-email', 'pf-phone', 'pf-street', 'pf-zip', 'pf-city', 'pf-remark'].forEach((id) => { $(id).value = ''; $(id).classList.remove('invalid'); });
    $('cancel-policy-accept').checked = false;
    $('confirm-btn').disabled = true;
  }

  async function lookupNiss() {
    const niss = $('niss-input').value.trim();
    if (!niss) return;
    const btn = $('niss-lookup-btn'); btn.disabled = true; btn.textContent = '…';
    try {
      const res = await api.patientLookup(niss);
      const hint = $('niss-hint');
      if (res.found) {
        state.patient = { found: true, id: res.patientId };
        hint.textContent = '✓ Dossier trouvé. Pas besoin de ressaisir vos informations.';
        hint.classList.add('found');
        $('patient-form').classList.add('hidden-form');
      } else {
        state.patient = { found: false };
        hint.textContent = 'Aucun dossier trouvé — merci de remplir le formulaire ci-dessous (première visite).';
        hint.classList.remove('found');
        $('patient-form').classList.remove('hidden-form');
      }
    } catch (e) {
      $('niss-hint').textContent = 'Recherche indisponible — remplissez le formulaire ci-dessous.';
    } finally { btn.disabled = false; btn.textContent = 'Rechercher'; }
  }

  function collectPatient() {
    if (state.patient.found && state.patient.id) {
      return { patient: { id: state.patient.id, remark: $('pf-remark').value.trim() }, valid: true };
    }
    const fields = { firstName: 'pf-firstname', familyName: 'pf-lastname', email: 'pf-email', phone: 'pf-phone', street: 'pf-street', zip: 'pf-zip', city: 'pf-city' };
    const p = {}; let valid = true;
    const required = ['pf-firstname', 'pf-lastname', 'pf-email', 'pf-phone'];
    Object.entries(fields).forEach(([k, id]) => { p[k] = $(id).value.trim(); });
    required.forEach((id) => { const ok = !!$(id).value.trim(); $(id).classList.toggle('invalid', !ok); if (!ok) valid = false; });
    const email = $('pf-email');
    if (email.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) { email.classList.add('invalid'); valid = false; }
    return { patient: p, valid };
  }

  async function confirmBooking() {
    const err = $('booking-error'); err.hidden = true;
    if (!$('cancel-policy-accept').checked) {
      err.textContent = 'Merci d\'accepter la politique d\'annulation avant de confirmer.'; err.hidden = false; return;
    }
    const { patient, valid } = collectPatient();
    if (!valid) { err.textContent = 'Merci de compléter les champs obligatoires (prénom, nom, e-mail valide, téléphone).'; err.hidden = false; return; }
    patient.remark = $('pf-remark').value.trim();

    const btn = $('confirm-btn'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
    try {
      const appointments = state.selection.map((s) => ({
        locationId: s.locationId, specialtyId: s.specialtyId, typeId: s.typeId,
        therapistId: s.therapistId, start: s.start, remark: patient.remark || ''
      }));
      const res = await api.book({ patient, appointments });
      showConfirmation(res);
    } catch (e) {
      err.textContent = 'Une erreur est survenue lors de l\'envoi. Merci de réessayer.'; err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Confirmer le rendez-vous'; }
  }

  // ---------- Confirmation ----------
  function showConfirmation(res) {
    closeBooking();
    const results = res.results || [];
    const byStart = {};
    results.forEach((r) => { byStart[r.start] = r; });
    const icon = $('confirm-icon'), heading = $('confirm-heading'), body = $('confirm-body');
    const allOk = res.ok;

    icon.textContent = allOk ? '✓' : '!';
    icon.classList.toggle('warn', !allOk);
    heading.textContent = allOk ? 'Rendez-vous confirmé' : 'Confirmation partielle';

    body.innerHTML = '';
    state.selection.forEach((s) => {
      const r = byStart[s.start] || {};
      const div = document.createElement('div');
      div.className = 'c-slot' + (r.ok ? '' : ' failed');
      div.innerHTML = `<strong>${esc(s.label)}</strong><br>${esc(s.meta)}` +
        (r.ok ? '' : `<br><em>${r.reason === 'slot_taken' ? 'Ce créneau vient d\'être pris — merci d\'en choisir un autre.' : 'Échec de l\'envoi.'}</em>`);
      body.appendChild(div);
    });

    // Keep only failed slots in selection so the user can retry them
    const failedStarts = new Set(results.filter((r) => !r.ok).map((r) => r.start));
    state.selection = state.selection.filter((s) => failedStarts.has(s.start));
    renderSelection();
    if (state.avail) loadWeek(isoDate(dateFromDdmmyyyy(state.avail.weekStart)));

    $('confirm-overlay').hidden = false;
    $('confirmation').classList.add('show');
    $('confirmation').setAttribute('aria-hidden', 'false');
  }
  function closeConfirmation() {
    $('confirmation').classList.remove('show');
    $('confirmation').setAttribute('aria-hidden', 'true');
    $('confirm-overlay').hidden = true;
  }

  // ---------- Events ----------
  function bindStaticEvents() {
    $('mode-toggle').querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      $('mode-toggle').querySelectorAll('.seg').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); });
      state.locationId = null; state.specialtyId = null; state.typeId = null; state.therapistId = null;
      renderLocations();
      $('specialty-field').hidden = true; $('type-field').hidden = true; $('therapist-field').hidden = true;
      hideCalendar();
    }));
    $('week-prev').addEventListener('click', () => shiftWeek(-1));
    $('week-next').addEventListener('click', () => shiftWeek(1));
    $('first-avail').addEventListener('click', () => { if (state.avail && state.avail.firstAvailable) loadWeek(isoFromDdmmyyyy(state.avail.firstAvailable)); });
    $('continue-btn').addEventListener('click', openBooking);
    $('panel-close').addEventListener('click', closeBooking);
    $('overlay').addEventListener('click', closeBooking);
    $('niss-lookup-btn').addEventListener('click', lookupNiss);
    $('cancel-policy-accept').addEventListener('change', (e) => { $('confirm-btn').disabled = !e.target.checked; });
    $('confirm-btn').addEventListener('click', confirmBooking);
    $('confirm-done').addEventListener('click', closeConfirmation);
    $('confirm-overlay').addEventListener('click', closeConfirmation);
  }

  // ---------- Date/utils ----------
  function mondayOf(d) { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - wd); return x; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ddmmyyyy(d) { return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }
  function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function dateFromDdmmyyyy(s) { const [dd, mm, yy] = s.split('/').map(Number); return new Date(yy, mm - 1, dd); }
  function isoFromDdmmyyyy(s) { return isoDate(dateFromDdmmyyyy(s)); }
  function dayIndex(ddmm) { return (dateFromDdmmyyyy(ddmm).getDay() + 6) % 7; }
  function weekLabel(from, to) {
    const a = dateFromDdmmyyyy(from), b = dateFromDdmmyyyy(to);
    if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}`;
    return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  }
  function shortName(full) { if (!full) return ''; const p = full.split(' '); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : full; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
})();
