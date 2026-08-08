const apiBaseInput = document.getElementById('apiBaseUrl');
const restaurantNameInput = document.getElementById('restaurantName');
const bookingForm = document.getElementById('bookingForm');
const bookingForm2 = document.getElementById('bookingForm2');
const soupBasePreference = document.getElementById('soupBasePreference');
const bookingCapacityHint = document.getElementById('bookingCapacityHint');
const mayaForm = document.getElementById('mayaForm');
const mayaMessage = document.getElementById('mayaMessage');
const mayaStartBtn = document.getElementById('mayaStartBtn');
const mayaResetBtn = document.getElementById('mayaResetBtn');
const chatWindow = document.getElementById('chatWindow');
const stageLabel = document.getElementById('stageLabel');
const topStageLabel = document.getElementById('topStageLabel');
const assistantLaunchBtn = document.getElementById('assistantLaunchBtn');
const notifyBtn = document.getElementById('notifyBtn');
const todayBookings = document.getElementById('todayBookings');
const allBookings = document.getElementById('allBookings');
const chatPlaceholder = document.getElementById('chatPlaceholder');
const chatQuickActions = document.getElementById('chatQuickActions');
const whatsappConnectBtn = document.getElementById('whatsappConnectBtn');
const sandboxCard = document.getElementById('sandboxCard');
const sandboxLink = document.getElementById('sandboxLink');
const sandboxInstructions = document.getElementById('sandboxInstructions');
const refreshBtn = document.getElementById('refreshBtn');
const draftBtn2 = document.getElementById('draftBtn2');
const sendReviewRequestBtn2 = document.getElementById('sendReviewRequestBtn2');
const sendReviewRequestBtn3 = document.getElementById('sendReviewRequestBtn3');
const sendRetailReminderBtn2 = document.getElementById('sendRetailReminderBtn2');
const sendInstagramBtn2 = document.getElementById('sendInstagramBtn2');
const testVoiceBtn = document.getElementById('testVoiceBtn');
const startVoiceGuideBtn = document.getElementById('startVoiceGuideBtn');
const nextVoiceGuideBtn = document.getElementById('nextVoiceGuideBtn');
const resetVoiceGuideBtn = document.getElementById('resetVoiceGuideBtn');
const bookingSelect = document.getElementById('bookingSelect');
const bookingFilter = document.getElementById('bookingFilter');
const billAmount = document.getElementById('billAmount');
const markVisitedBtn = document.getElementById('markVisitedBtn');
const markNoShowBtn = document.getElementById('markNoShowBtn');
const voicePhone = document.getElementById('voicePhone');
const voiceTranscript = document.getElementById('voiceTranscript');
const voiceGuideStatus = document.getElementById('voiceGuideStatus');
const twilioDiagnostics = document.getElementById('twilioDiagnostics');
const twilioTestPhone = document.getElementById('twilioTestPhone');
const refreshTwilioBtn = document.getElementById('refreshTwilioBtn');
const testTwilioBtn = document.getElementById('testTwilioBtn');
const todayFocusList = document.getElementById('todayFocusList');
const recordsIntro = document.getElementById('recordsIntro');
const reviewHealthBadge = document.getElementById('reviewHealthBadge');
const reviewFollowupBadge = document.getElementById('reviewFollowupBadge');
const customerRecords = document.getElementById('customerRecords');
const connectionStatus = document.getElementById('connectionStatus');
const sidebarCapacityNote = document.getElementById('sidebarCapacityNote');
const capacityDate = document.getElementById('capacityDate');
const capLunchRemaining = document.getElementById('capLunchRemaining');
const capDinnerRemaining = document.getElementById('capDinnerRemaining');
const capWaitlistCount = document.getElementById('capWaitlistCount');
const waitlistRecords = document.getElementById('waitlistRecords');

const state = {
  bookings: [],
  customers: [],
  voiceGuidePhone: '',
  voiceGuideIndex: -1,
  initialized: false,
  assistantOpen: false,
  assistantPhone: '',
  currentView: 'dashboard',
  menuLoaded: false,
  tables: [],
  editingTableId: null,
};

const guidedVoiceSteps = [
  'book a table',
  'Faisal',
  '2026-08-14',
  '19:00',
  '4',
  'birthday dinner, love mala spicy',
  'CONFIRM',
];

function apiBase() {
  return apiBaseInput.value.replace(/\/$/, '');
}

function setStage(value) {
  if (stageLabel) {
    stageLabel.textContent = value;
  }
  if (topStageLabel) {
    topStageLabel.textContent = value;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function extractPhoneNumber(text) {
  const match = String(text).match(/(\+?\d[\d\s().-]{6,}\d)/);
  return match ? match[1].replace(/[^\d+]/g, '').trim() : '';
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function loyaltyTier(points) {
  if (points >= 500) return { key: 'gold', label: 'Gold' };
  if (points >= 200) return { key: 'silver', label: 'Silver' };
  return { key: 'bronze', label: 'Bronze' };
}

function setChatPlaceholder(visible) {
  if (!chatPlaceholder) return;
  chatPlaceholder.style.display = visible ? 'grid' : 'none';
}

function showTypingIndicator() {
  removeTypingIndicator();
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.id = 'typingIndicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  chatWindow.appendChild(indicator);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function removeTypingIndicator() {
  const existing = document.getElementById('typingIndicator');
  if (existing) existing.remove();
}

function addMessage(role, text) {
  setChatPlaceholder(false);
  removeTypingIndicator();
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.innerHTML = `
    ${escapeHtml(text).replace(/\n/g, '<br />')}
    <div class="message-meta">${formatTime()}</div>
  `;
  chatWindow.appendChild(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function resetMayaWindow() {
  chatWindow.innerHTML = '';
  state.initialized = false;
  setChatPlaceholder(true);
}

function setAssistantOpen(isOpen) {
  state.assistantOpen = isOpen;
  if (assistantLaunchBtn) {
    assistantLaunchBtn.textContent = isOpen ? 'Open assistant' : 'Start conversation';
  }
}

function animateSparkline(container) {
  const bars = container.querySelectorAll('span');
  bars.forEach((bar) => {
    const target = bar.style.getPropertyValue('--h');
    bar.style.setProperty('--h', '8px');
    requestAnimationFrame(() => {
      bar.style.setProperty('--h', target);
    });
  });
}

function filteredBookings(records) {
  const filter = bookingFilter ? bookingFilter.value : 'all';
  if (filter === 'all') {
    return records;
  }
  return records.filter((record) => record.status === filter);
}

function statusBadge(status) {
  const colors = {
    confirmed: 'blue',
    visited: 'emerald',
    no_show: 'red',
    cancelled: 'muted',
  };
  return `<span class="badge ${colors[status] || 'muted'}">${escapeHtml(status)}</span>`;
}

function renderBookingRecord(record) {
  const item = document.createElement('article');
  item.className = 'record-item';
  const tableOptions = ['<option value="">Unassigned</option>']
    .concat((state.tables || []).map((t) => `<option value="${t.id}" ${record.table_id === t.id ? 'selected' : ''}>${escapeHtml(t.name)} (seats ${t.capacity})</option>`))
    .join('');
  item.innerHTML = `
    <div class="record-main">
      <strong>${escapeHtml(record.guest_name)}</strong>
      ${statusBadge(record.status)}
    </div>
    <div class="record-meta">
      <span>📅 ${escapeHtml(record.date)} at ${escapeHtml(record.time)}</span>
      <span>📞 ${escapeHtml(record.phone)}</span>
      <span>👥 ${record.guests} guest(s)</span>
    </div>
    <div class="record-note">${escapeHtml(record.special_requests || 'No special requests')}</div>
    <label class="table-assign-label">
      Table
      <select class="compact-select table-assign-select" data-booking-id="${record.id}">${tableOptions}</select>
    </label>
    <div class="button-row record-actions">
      <button class="secondary-btn select-booking-btn" type="button" data-booking-id="${record.id}">Select</button>
      <button class="secondary-btn quick-visit-btn" type="button" data-booking-id="${record.id}">Visited</button>
      <button class="secondary-btn quick-no-show-btn" type="button" data-booking-id="${record.id}">No-show</button>
    </div>
  `;
  return item;
}

function renderBookings(records) {
  if (todayBookings) {
    todayBookings.innerHTML = '';
    const visibleRecords = filteredBookings(records).slice(0, 6);
    if (!visibleRecords.length) {
      todayBookings.innerHTML = '<div class="empty-state">No bookings match the current filter.</div>';
    } else {
      visibleRecords.forEach((record) => todayBookings.appendChild(renderBookingRecord(record)));
    }
  }

  if (allBookings) {
    allBookings.innerHTML = '';
    const visibleRecords = filteredBookings(records);
    if (!visibleRecords.length) {
      allBookings.innerHTML = '<div class="empty-state">No bookings match the current filter.</div>';
    } else {
      visibleRecords.forEach((record) => allBookings.appendChild(renderBookingRecord(record)));
    }
  }

  if (bookingSelect) {
    bookingSelect.innerHTML = '';
    const visibleRecords = filteredBookings(records);
    if (!visibleRecords.length) {
      bookingSelect.innerHTML = '<option value="">No bookings available</option>';
    } else {
      visibleRecords.forEach((record) => {
        const option = document.createElement('option');
        option.value = record.id;
        option.textContent = `${record.guest_name} • ${record.date} ${record.time} • ${record.status}`;
        bookingSelect.appendChild(option);
      });
    }
  }

  document.querySelectorAll('.select-booking-btn').forEach((button) => {
    button.addEventListener('click', () => {
      if (bookingSelect) bookingSelect.value = button.dataset.bookingId;
      switchView('staff');
      addMessage('system', 'Booking selected in staff console.');
    });
  });

  document.querySelectorAll('.quick-visit-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      if (bookingSelect) bookingSelect.value = button.dataset.bookingId;
      await runStaffAction('visited');
    });
  });

  document.querySelectorAll('.quick-no-show-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      if (bookingSelect) bookingSelect.value = button.dataset.bookingId;
      await runStaffAction('no-show');
    });
  });

  document.querySelectorAll('.table-assign-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const bookingId = select.dataset.bookingId;
      const tableId = select.value || null;
      try {
        const response = await fetch(`${apiBase()}/api/bookings/${bookingId}/assign-table`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_id: tableId }),
        });
        if (!response.ok) throw new Error('Unable to assign table.');
        const updated = await response.json();
        const idx = state.bookings.findIndex((b) => b.id === bookingId);
        if (idx !== -1) state.bookings[idx] = updated;
      } catch (error) {
        addMessage('system', error.message);
      }
    });
  });
}

function renderCustomers(customers) {
  if (!customerRecords) return;
  customerRecords.innerHTML = '';

  if (!customers.length) {
    customerRecords.innerHTML = '<div class="empty-state">No loyalty members yet.</div>';
    return;
  }

  customers.forEach((customer) => {
    const tier = loyaltyTier(customer.total_points || 0);
    const item = document.createElement('article');
    item.className = 'record-item';
    item.innerHTML = `
      <div class="record-main">
        <strong>${escapeHtml(customer.guest_name)}</strong>
        <span class="badge tier-${tier.key}">${tier.label} · ${customer.total_points} pts</span>
      </div>
      <div class="record-meta">
        <span>${escapeHtml(customer.phone)}</span>
        <span>${customer.visit_count} visit(s)</span>
        <span>Last visit: ${customer.last_visit || '—'}</span>
      </div>
    `;
    customerRecords.appendChild(item);
  });
}

function updateLoyaltyStats(customers) {
  const totalMembers = customers.length;
  const avgPoints = totalMembers ? Math.round(customers.reduce((sum, c) => sum + (c.total_points || 0), 0) / totalMembers) : 0;
  const rewardsReady = customers.filter((c) => (c.total_points || 0) >= 500).length;

  const big = document.getElementById('loyaltyMembersBig');
  const avg = document.getElementById('loyaltyPointsAvg');
  const ready = document.getElementById('loyaltyRewardsReady');
  if (big) big.textContent = totalMembers;
  if (avg) avg.textContent = avgPoints;
  if (ready) ready.textContent = rewardsReady;
}

function renderWaitlist(entries) {
  if (!waitlistRecords) return;
  const open = entries.filter((entry) => entry.status === 'waiting');
  if (!open.length) {
    waitlistRecords.innerHTML = '<div class="empty-state">No one is waiting for a table right now.</div>';
    return;
  }
  waitlistRecords.innerHTML = '';
  open.slice(0, 10).forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'record-item';
    item.innerHTML = `
      <div class="record-main">
        <strong>${escapeHtml(entry.guest_name)}</strong>
        <span class="badge orange">waiting</span>
      </div>
      <div class="record-meta">
        <span>📅 ${escapeHtml(entry.date)} · ${escapeHtml(entry.session)}</span>
        <span>📞 ${escapeHtml(entry.phone)}</span>
        <span>👥 ${entry.guests} guest(s)</span>
      </div>
      <div class="record-note">${escapeHtml(entry.notes || 'No notes')}</div>
    `;
    waitlistRecords.appendChild(item);
  });
}

async function loadWaitlist() {
  try {
    const response = await fetch(`${apiBase()}/api/waitlist`);
    if (!response.ok) return;
    const entries = await response.json();
    renderWaitlist(entries);
    if (capWaitlistCount) {
      capWaitlistCount.textContent = entries.filter((e) => e.status === 'waiting').length;
    }
  } catch {
    if (waitlistRecords) waitlistRecords.textContent = 'Waitlist unavailable.';
  }
}

function renderTables(tables) {
  const container = document.getElementById('tableRecords');
  if (!container) return;
  if (!tables.length) {
    container.innerHTML = '<div class="empty-state">No tables yet — add one above.</div>';
    return;
  }
  container.innerHTML = '';
  tables.forEach((t) => {
    const item = document.createElement('article');
    item.className = 'record-item';
    item.innerHTML = `
      <div class="record-main">
        <strong>${escapeHtml(t.name)}</strong>
        <span>seats ${t.capacity}</span>
      </div>
      <div class="record-meta"><span>${escapeHtml(t.section || 'No section set')}</span></div>
      <div class="button-row record-actions">
        <button class="secondary-btn edit-table-btn" type="button" data-table-id="${t.id}">Edit</button>
        <button class="secondary-btn deactivate-table-btn" type="button" data-table-id="${t.id}">Remove</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll('.edit-table-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const table = state.tables.find((t) => t.id === button.dataset.tableId);
      if (!table) return;
      state.editingTableId = table.id;
      document.getElementById('newTableName').value = table.name;
      document.getElementById('newTableCapacity').value = table.capacity;
      document.getElementById('newTableSection').value = table.section || '';
      const submitBtn = document.querySelector('#addTableForm button[type="submit"]');
      if (submitBtn) submitBtn.textContent = `Save changes to ${table.name}`;
    });
  });

  document.querySelectorAll('.deactivate-table-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const response = await fetch(`${apiBase()}/api/tables/${button.dataset.tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        });
        if (!response.ok) throw new Error('Unable to remove table.');
        await loadTables();
      } catch (error) {
        addMessage('system', error.message);
      }
    });
  });
}

async function loadTables() {
  try {
    const response = await fetch(`${apiBase()}/api/tables`);
    if (!response.ok) throw new Error('Unable to load tables.');
    const tables = await response.json();
    state.tables = tables;
    renderTables(tables);
    renderBookings(state.bookings);
  } catch {
    const container = document.getElementById('tableRecords');
    if (container) container.textContent = 'Tables unavailable.';
  }
}

document.getElementById('addTableForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('newTableName').value.trim();
  const capacity = Number(document.getElementById('newTableCapacity').value);
  const section = document.getElementById('newTableSection').value.trim();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  try {
    const isEditing = Boolean(state.editingTableId);
    const url = isEditing ? `${apiBase()}/api/tables/${state.editingTableId}` : `${apiBase()}/api/tables`;
    const response = await fetch(url, {
      method: isEditing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, capacity, section }),
    });
    if (!response.ok) throw new Error('Unable to save table.');
    state.editingTableId = null;
    if (submitBtn) submitBtn.textContent = 'Add table';
    form.reset();
    document.getElementById('newTableCapacity').value = 4;
    await loadTables();
  } catch (error) {
    addMessage('system', error.message);
  }
});

async function loadCapacityPanel(date) {
  try {
    const response = await fetch(`${apiBase()}/api/capacity?date=${encodeURIComponent(date)}`);
    if (!response.ok) return;
    const data = await response.json();
    if (capLunchRemaining) capLunchRemaining.textContent = `${data.sessions.lunch.remaining} / ${data.sessions.lunch.capacity}`;
    if (capDinnerRemaining) capDinnerRemaining.textContent = `${data.sessions.dinner.remaining} / ${data.sessions.dinner.capacity}`;
    return data;
  } catch {
    return null;
  }
}

async function updateBookingCapacityHint() {
  if (!bookingCapacityHint) return;
  const date = document.getElementById('bookingDate')?.value;
  const time = document.getElementById('bookingTime')?.value;
  if (!date) {
    bookingCapacityHint.textContent = 'Pick a date and time to see remaining seats.';
    return;
  }
  const data = await loadCapacityPanelSilent(date);
  if (!data) {
    bookingCapacityHint.textContent = 'Capacity data unavailable right now.';
    return;
  }
  const session = time && time < '16:00' ? 'lunch' : 'dinner';
  const info = data.sessions[session];
  bookingCapacityHint.textContent = `${info.label}: ${info.remaining} of ${info.capacity} seats left · S$${info.price_per_person.toFixed(2)}++/pax`;
}

async function loadCapacityPanelSilent(date) {
  try {
    const response = await fetch(`${apiBase()}/api/capacity?date=${encodeURIComponent(date)}`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function renderMenu(menu) {
  const tagline = document.getElementById('menuTagline');
  const founder = document.getElementById('menuFounderStory');
  const location = document.getElementById('menuLocationList');
  const pricingCards = document.getElementById('pricingCards');
  const soupBaseList = document.getElementById('soupBaseList');
  const proteinList = document.getElementById('proteinList');
  const addonList = document.getElementById('addonList');

  if (tagline) tagline.textContent = menu.profile.tagline;
  if (founder) founder.textContent = menu.profile.founder_story;
  if (location) {
    location.innerHTML = [
      `📍 ${menu.profile.address}`,
      `🕐 ${menu.profile.hours_display}`,
      `☪ ${menu.profile.halal_statement}`,
      `🍲 ${menu.profile.dining_format}`,
    ].map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  }

  if (pricingCards) {
    const p = menu.pricing;
    pricingCards.innerHTML = `
      <div class="stack-column"><section class="panel campaign-card">
        <div class="panel-head slim"><div><p class="eyebrow">Weekday lunch</p><h3>S$${p.weekday_lunch.toFixed(2)}++</h3></div></div>
        <p class="panel-note">Mon–Thu, ${menu.sessions.lunch.start}–${menu.sessions.lunch.last_seating} last seating.</p>
      </section></div>
      <div class="stack-column"><section class="panel campaign-card">
        <div class="panel-head slim"><div><p class="eyebrow">Weekday dinner</p><h3>S$${p.weekday_dinner.toFixed(2)}++</h3></div></div>
        <p class="panel-note">Mon–Thu, ${menu.sessions.dinner.start}–${menu.sessions.dinner.last_seating} last seating.</p>
      </section></div>
      <div class="stack-column"><section class="panel campaign-card">
        <div class="panel-head slim"><div><p class="eyebrow">Fri–Sun, all day</p><h3>S$${p.weekend_all_day.toFixed(2)}++</h3></div></div>
        <p class="panel-note">Same rate for lunch or dinner. ${menu.profile.buffet_duration_minutes}-minute seating.</p>
      </section></div>
    `;
  }

  if (soupBaseList) {
    soupBaseList.innerHTML = menu.soup_bases.map((s) => `
      <article class="record-item">
        <div class="record-main"><strong>${escapeHtml(s.name)}</strong>${s.spice_customizable ? '<span class="badge orange">spice customizable</span>' : ''}</div>
        <div class="record-note">${escapeHtml(s.description)}</div>
      </article>
    `).join('');
  }

  if (proteinList) {
    proteinList.innerHTML = menu.proteins.map((p) => `
      <article class="record-item">
        <div class="record-main"><strong>${escapeHtml(p.name)}</strong><span class="badge muted">${escapeHtml(p.category)}</span></div>
      </article>
    `).join('');
  }

  if (addonList) {
    addonList.innerHTML = menu.a_la_carte_add_ons.map((a) => `
      <article class="record-item">
        <div class="record-main"><strong>${escapeHtml(a.name)}</strong><span>S$${a.price.toFixed(2)}</span></div>
      </article>
    `).join('') + `
      <article class="record-item">
        <div class="record-main"><strong>${escapeHtml(menu.pricing.premium_platter.name)}</strong><span>S$${menu.pricing.premium_platter.price.toFixed(2)}</span></div>
        <div class="record-note">${escapeHtml(menu.pricing.premium_platter.description)}</div>
      </article>
    `;
  }
}

async function loadMenuView() {
  try {
    const response = await fetch(`${apiBase()}/api/menu`);
    if (!response.ok) throw new Error('menu unavailable');
    const menu = await response.json();
    renderMenu(menu);
    state.menuLoaded = true;
  } catch (error) {
    addMessage('system', 'Unable to load the menu right now.');
  }
}

async function refreshLiveData() {
  setStage('Refreshing live data');
  const [summaryResponse, bookingsResponse, customersResponse] = await Promise.all([
    fetch(`${apiBase()}/api/summary`),
    fetch(`${apiBase()}/api/bookings?limit=100`),
    fetch(`${apiBase()}/api/loyalty`).catch(() => ({ ok: false })),
  ]);

  if (!summaryResponse.ok || !bookingsResponse.ok) {
    throw new Error('Unable to load live project data. Check that the backend is running.');
  }

  const summary = await summaryResponse.json();
  const bookings = await bookingsResponse.json();
  const customers = customersResponse.ok ? await customersResponse.json() : [];

  const confirmedCount = bookings.filter((record) => record.status === 'confirmed').length;
  const visitedCount = bookings.filter((record) => record.status === 'visited').length;
  const pendingCount = confirmedCount;

  restaurantNameInput.value = summary.restaurant;
  document.getElementById('todayBookingsMetric').textContent = summary.bookings_today;
  document.getElementById('completedVisitsMetric').textContent = visitedCount;
  document.getElementById('loyaltyMembersMetric').textContent = summary.loyalty_customers;
  document.getElementById('aiConversationsMetric').textContent = summary.conversations || 0;
  document.getElementById('revenueMetric').textContent = `S$${Math.round(summary.total_revenue || 0).toLocaleString()}`;
  document.getElementById('activeCampaignsMetric').textContent = summary.active_campaigns || 0;
  document.getElementById('sidebarRestaurantName').textContent = summary.restaurant;
  document.getElementById('heroRestaurantName').textContent = summary.restaurant;

  const capacityToday = summary.capacity_today || {};
  const lunch = capacityToday.lunch || { remaining: 0, capacity: summary.seating_capacity || 90, booked: 0 };
  const dinner = capacityToday.dinner || { remaining: 0, capacity: summary.seating_capacity || 90, booked: 0 };
  const seatsLeft = (lunch.remaining || 0) + (dinner.remaining || 0);
  const totalCapacity = (lunch.capacity || 0) + (dinner.capacity || 0);
  const seatsLeftMetric = document.getElementById('seatsLeftMetric');
  const seatsLeftTrend = document.getElementById('seatsLeftTrend');
  if (seatsLeftMetric) seatsLeftMetric.textContent = seatsLeft;
  if (seatsLeftTrend) seatsLeftTrend.textContent = `of ${totalCapacity}`;

  const waitlistMetric = document.getElementById('waitlistMetric');
  if (waitlistMetric) waitlistMetric.textContent = summary.waitlist_open || 0;

  const googleRatingMetric = document.getElementById('googleRatingMetric');
  const googleRatingTrend = document.getElementById('googleRatingTrend');
  if (googleRatingMetric) googleRatingMetric.textContent = summary.google_rating || '--';
  if (googleRatingTrend) googleRatingTrend.textContent = summary.google_rating ? 'Live' : 'Set GOOGLE_RATING';

  const capacityGaugeFill = document.getElementById('capacityGaugeFill');
  const capacityGaugeValue = document.getElementById('capacityGaugeValue');
  const capacityTrendLabel = document.getElementById('capacityTrendLabel');
  const bookedTotal = (lunch.booked || 0) + (dinner.booked || 0);
  const pct = totalCapacity ? Math.round((bookedTotal / totalCapacity) * 100) : 0;
  if (capacityGaugeFill) capacityGaugeFill.style.setProperty('--value', `${pct}%`);
  if (capacityGaugeValue) capacityGaugeValue.textContent = `${bookedTotal}/${totalCapacity}`;
  if (capacityTrendLabel) capacityTrendLabel.textContent = `${pct}% full`;

  if (sidebarCapacityNote) {
    sidebarCapacityNote.textContent = `${seatsLeft} seats left today (${lunch.remaining} lunch, ${dinner.remaining} dinner).`;
  }

  if (todayFocusList) {
    todayFocusList.innerHTML = [
      `Today's bookings: ${summary.bookings_today} reservations`,
      `Confirmed reservations: ${confirmedCount}`,
      `Completed visits: ${visitedCount}`,
      `Loyalty members: ${summary.loyalty_customers}`,
      `Seats left today: ${seatsLeft} of ${totalCapacity}`,
      `On waitlist: ${summary.waitlist_open || 0}`,
    ].map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }

  if (recordsIntro) {
    recordsIntro.textContent = `${bookings.length} live records are being tracked. Confirmed reservations stay visible for staff follow-up.`;
  }

  if (reviewHealthBadge) {
    const reviewFollowups = Math.max(0, Math.min(5, Math.ceil(summary.bookings_today / 2)));
    reviewHealthBadge.textContent = reviewFollowups > 0 ? `Review follow-ups ready: ${reviewFollowups}` : 'No review follow-ups due';
  }

  if (reviewFollowupBadge) {
    reviewFollowupBadge.textContent = summary.google_place_id_configured ? 'Google review flow enabled' : 'Google review flow not configured';
  }

  const bookingSparkline = document.getElementById('bookingSparkline');
  const revenueSparkline = document.getElementById('revenueSparkline');
  if (bookingSparkline) animateSparkline(bookingSparkline);
  if (revenueSparkline) animateSparkline(revenueSparkline);

  state.bookings = bookings;
  state.customers = customers;
  renderBookings(bookings);
  renderCustomers(customers);
  updateLoyaltyStats(customers);
  setStage('Live');

  if (connectionStatus) {
    connectionStatus.textContent = summary.ai_concierge_enabled ? 'AI concierge live' : 'WhatsApp ready';
  }

  if (!state.initialized) {
    resetMayaWindow();
    addMessage('assistant', `Welcome to ${summary.restaurant}. I'm your AI concierge — here to help with buffet bookings, the menu, halal questions, loyalty, and reviews. Share your phone number to get started, or tap a quick action above.`);
    state.initialized = true;
  }
}

async function refreshTwilioDiagnostics() {
  const response = await fetch(`${apiBase()}/api/diagnostics/twilio`);
  if (!response.ok) {
    throw new Error('Unable to load Twilio diagnostics.');
  }
  const data = await response.json();
  twilioDiagnostics.innerHTML = `
    <strong>Configured:</strong> ${data.configured ? 'Yes' : 'No'}<br />
    <strong>Sender:</strong> ${escapeHtml(data.sender || 'Not set')}<br />
    <strong>Format ok:</strong> ${data.sender_format_ok ? 'Yes' : 'No'}<br />
    <strong>Templates configured:</strong> ${data.templates_configured ? 'Yes' : 'No'}<br />
    <strong>Confirmation template:</strong> ${escapeHtml(data.confirmation_template || 'Not set')}<br />
    <strong>Reminder template:</strong> ${escapeHtml(data.reminder_template || 'Not set')}<br />
    <strong>Review template:</strong> ${escapeHtml(data.review_template || 'Not set')}<br />
    <strong>Loyalty template:</strong> ${escapeHtml(data.loyalty_template || 'Not set')}<br />
    <strong>Last error:</strong> ${escapeHtml(data.last_error || 'None')}<br />
    <strong>Advice:</strong> ${escapeHtml(data.advice)}
  `;

  if (data.sandbox_url && sandboxCard && sandboxLink && sandboxInstructions) {
    sandboxCard.style.display = 'block';
    sandboxInstructions.textContent = data.sandbox_instructions || 'Send the sandbox code from WhatsApp to start testing.';
    sandboxLink.href = data.sandbox_url;
    sandboxLink.textContent = 'Open WhatsApp sandbox';
  } else if (sandboxCard) {
    sandboxCard.style.display = 'none';
  }
}

async function testTwilioSender() {
  const response = await fetch(`${apiBase()}/api/diagnostics/twilio/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: twilioTestPhone.value.trim() }),
  });
  if (!response.ok) {
    throw new Error('Unable to run Twilio sender test.');
  }
  const result = await response.json();
  await refreshTwilioDiagnostics();
  addMessage('system', result.success ? 'Twilio test message sent successfully.' : 'Twilio test failed. See diagnostics panel for details.');
}

async function sendMayaMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const extractedPhone = extractPhoneNumber(trimmed);
  if (!state.assistantPhone && extractedPhone) {
    state.assistantPhone = extractedPhone;
    addMessage('user', trimmed);
    addMessage('assistant', `Thanks! I'll use ${state.assistantPhone} for this conversation. What would you like help with today?`);
    return;
  }

  if (!state.assistantPhone) {
    addMessage('user', trimmed);
    addMessage('assistant', 'Please share your phone number in the chat so I can continue this conversation.');
    return;
  }

  addMessage('user', trimmed);
  showTypingIndicator();

  const response = await fetch(`${apiBase()}/api/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: state.assistantPhone,
      message: trimmed,
    }),
  });

  if (!response.ok) {
    removeTypingIndicator();
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Unable to send the message to the assistant.');
  }

  const result = await response.json();
  addMessage('assistant', result.reply);
  await refreshLiveData();
}

async function resetMayaConversation() {
  const phone = state.assistantPhone || 'customer';
  const response = await fetch(`${apiBase()}/api/chat/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  if (!response.ok) {
    throw new Error('Unable to reset the assistant conversation.');
  }
  resetMayaWindow();
  state.assistantPhone = '';
  addMessage('assistant', `Conversation reset. Share your phone number to continue, or choose a quick action above.`);
}

async function sendImmediateReviewRequest(phone, guestName) {
  const response = await fetch(`${apiBase()}/api/reviews/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, guest_name: guestName, platform: 'Google Maps' }),
  });
  if (!response.ok) {
    throw new Error('Unable to send the review request.');
  }
  return response.json();
}

async function markSelectedBooking(action) {
  const bookingId = bookingSelect.value;
  if (!bookingId) {
    throw new Error('Select a booking first.');
  }

  if (action === 'visited') {
    const response = await fetch(`${apiBase()}/api/bookings/${bookingId}/visited`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, bill_amount: Number(billAmount.value || 0) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Unable to mark the booking as visited.');
    }
    const result = await response.json();
    try {
      await sendImmediateReviewRequest(result.phone || state.assistantPhone, result.guest_name || 'Guest');
      result.review_sent = true;
    } catch (error) {
      result.review_sent = false;
      result.review_error = error.message;
    }
    return result;
  }

  const response = await fetch(`${apiBase()}/api/bookings/${bookingId}/no-show`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Unable to mark the booking as no-show.');
  }
  return response.json();
}

async function createLiveBooking(payload) {
  const response = await fetch(`${apiBase()}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Booking could not be created.');
  }

  return response.json();
}

async function draftReviewResponse() {
  const response = await fetch(`${apiBase()}/api/reviews/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewer_name: 'Customer',
      review_text: 'Great halal hotpot buffet, generous portions and friendly staff.',
      rating: 5,
    }),
  });

  if (!response.ok) {
    throw new Error('Groq review drafting is not available. Check your API key.');
  }

  const data = await response.json();
  addMessage('assistant', `Review draft:\n${data.draft_response}`);
}

async function testVoiceBooking() {
  const response = await fetch(`${apiBase()}/api/test/voice-note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: voicePhone.value.trim(),
      transcript: voiceTranscript.value.trim(),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Unable to test the voice booking flow.');
  }

  const result = await response.json();
  addMessage('assistant', `Voice transcript processed for ${result.phone}. Reply: ${result.reply}`);
  await refreshLiveData();
}

function startGuidedVoiceFlow() {
  state.voiceGuidePhone = voicePhone.value.trim() || '+6598765432';
  state.voiceGuideIndex = 0;
  voicePhone.value = state.voiceGuidePhone;
  voiceTranscript.value = guidedVoiceSteps[0];
  voiceGuideStatus.textContent = `Step 1 of ${guidedVoiceSteps.length}: ${guidedVoiceSteps[0]}`;
}

function resetGuidedVoiceFlow() {
  state.voiceGuideIndex = -1;
  voiceGuideStatus.textContent = 'Guided flow idle';
}

async function nextGuidedVoiceStep() {
  if (state.voiceGuideIndex < 0) {
    startGuidedVoiceFlow();
    return;
  }

  voicePhone.value = state.voiceGuidePhone;
  voiceTranscript.value = guidedVoiceSteps[state.voiceGuideIndex];
  await testVoiceBooking();

  state.voiceGuideIndex += 1;
  if (state.voiceGuideIndex >= guidedVoiceSteps.length) {
    voiceGuideStatus.textContent = 'Guided flow complete';
    state.voiceGuideIndex = -1;
    return;
  }
  voiceTranscript.value = guidedVoiceSteps[state.voiceGuideIndex];
  voiceGuideStatus.textContent = `Step ${state.voiceGuideIndex + 1} of ${guidedVoiceSteps.length}: ${guidedVoiceSteps[state.voiceGuideIndex]}`;
}

async function runStaffAction(action) {
  try {
    setStage(action === 'visited' ? 'Marking visited' : 'Marking no-show');
    const result = await markSelectedBooking(action);
    if (action === 'visited') {
      const reviewNote = result.review_sent
        ? 'A Google review link has been sent to their WhatsApp.'
        : `Review link could not be sent: ${result.review_error || 'unknown error'}`;
      addMessage('assistant', `Visit completed for ${result.guest_name}. Loyalty updated and ${reviewNote}`);
    } else {
      addMessage('assistant', `No-show recorded for ${result.guest_name}.`);
    }
    await refreshLiveData();
  } catch (error) {
    addMessage('system', error.message);
    setStage('Staff action failed');
  }
}

function switchView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.toggle('active', nav.dataset.view === viewName));
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('is-active', view.dataset.view === viewName));
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (viewName === 'menu' && !state.menuLoaded) {
    loadMenuView();
  }
  if (viewName === 'bookings') {
    const date = capacityDate?.value || todayIso();
    loadCapacityPanel(date);
    loadWaitlist();
    loadTables();
  }
  if (viewName === 'voice') {
    refreshVoiceDiagnostics();
  }
}

document.querySelectorAll('.nav-item, .shortcut-card').forEach((item) => {
  item.addEventListener('click', (event) => {
    const viewName = item.dataset.view;
    if (!viewName) return;
    event.preventDefault();
    switchView(viewName);
    if (viewName === 'assistant' && !state.assistantOpen) {
      startAssistantConversation();
    }
  });
});

function bindBookingForm(form, prefix = '') {
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      setStage('Creating booking');
      let specialRequests = document.getElementById(`specialRequests${prefix}`).value.trim();
      if (prefix === '' && soupBasePreference && soupBasePreference.value) {
        specialRequests = `Soup base preference: ${soupBasePreference.value}. ${specialRequests}`.trim();
      }
      const payload = {
        guest_name: document.getElementById(`guestName${prefix}`).value.trim(),
        phone: document.getElementById(`guestPhone${prefix}`).value.trim(),
        date: document.getElementById(`bookingDate${prefix}`).value,
        time: document.getElementById(`bookingTime${prefix}`).value,
        guests: Number(document.getElementById(`bookingGuests${prefix}`).value),
        special_requests: specialRequests,
      };

      const booking = await createLiveBooking(payload);
      addMessage(
        'assistant',
        `Booking stored for ${booking.guest_name} on ${booking.date} at ${booking.time}. Live database record ID: ${booking.id}`
      );
      form.reset();
      await refreshLiveData();
    } catch (error) {
      addMessage('system', error.message);
      setStage(error.message.includes('full') ? 'Buffet session full — try the waitlist' : 'Error');
    }
  });
}

bindBookingForm(bookingForm, '');
bindBookingForm(bookingForm2, '2');

document.getElementById('bookingDate')?.addEventListener('change', updateBookingCapacityHint);
document.getElementById('bookingTime')?.addEventListener('change', updateBookingCapacityHint);

capacityDate?.addEventListener('change', () => {
  loadCapacityPanel(capacityDate.value || todayIso());
});

mayaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setStage('Talking to the concierge');
    await sendMayaMessage(mayaMessage.value);
    mayaMessage.value = '';
    setStage('Live');
  } catch (error) {
    addMessage('system', error.message);
    setStage('Chat error');
  }
});

refreshBtn.addEventListener('click', async () => {
  try {
    await refreshLiveData();
  } catch (error) {
    addMessage('system', error.message);
    setStage('Offline');
  }
});

function bindButton(btn, handler) {
  if (!btn) return;
  btn.addEventListener('click', handler);
}

bindButton(draftBtn2, async () => {
  try {
    await draftReviewResponse();
  } catch (error) {
    addMessage('system', error.message);
    setStage('Review draft unavailable');
  }
});

async function sendReviewRequest() {
  try {
    const response = await fetch(`${apiBase()}/api/reviews/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: state.assistantPhone || '+6598765432', guest_name: 'Guest', platform: 'Google Maps' }),
    });
    if (!response.ok) throw new Error('Unable to send review request');
    const result = await response.json();
    addMessage('assistant', `Review request sent: ${result.message}`);
  } catch (error) {
    addMessage('system', error.message);
  }
}

bindButton(sendReviewRequestBtn2, sendReviewRequest);
bindButton(sendReviewRequestBtn3, sendReviewRequest);

async function sendRetailReminder() {
  try {
    const response = await fetch(`${apiBase()}/api/retail/reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: state.assistantPhone || '+6598765432', guest_name: 'Guest', last_item: 'Signature Mala buffet', next_reorder: 'this week' }),
    });
    if (!response.ok) throw new Error('Unable to send reminder');
    const result = await response.json();
    addMessage('assistant', `Reminder sent: ${result.message}`);
  } catch (error) {
    addMessage('system', error.message);
  }
}

bindButton(sendRetailReminderBtn2, sendRetailReminder);

async function sendInstagramDm() {
  try {
    const response = await fetch(`${apiBase()}/api/instagram/dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: state.assistantPhone || '+6598765432', guest_name: 'Guest', message: 'I want to book a table for Friday dinner' }),
    });
    if (!response.ok) throw new Error('Unable to test Instagram DM flow');
    const result = await response.json();
    addMessage('assistant', `Instagram DM reply: ${result.reply}`);
  } catch (error) {
    addMessage('system', error.message);
  }
}

bindButton(sendInstagramBtn2, sendInstagramDm);

testVoiceBtn.addEventListener('click', async () => {
  try {
    setStage('Testing voice booking');
    await testVoiceBooking();
  } catch (error) {
    addMessage('system', error.message);
    setStage('Voice test failed');
  }
});

async function refreshVoiceDiagnostics() {
  const box = document.getElementById('voiceAgentDiagnostics');
  const checklist = document.getElementById('voiceSetupChecklist');
  if (!box) return;
  try {
    const response = await fetch(`${apiBase()}/api/diagnostics/voice`);
    if (!response.ok) throw new Error('Unable to load voice diagnostics.');
    const data = await response.json();
    const numberOwnedLine = data.twilio_voice_number
      ? `<strong>Number owned by this account:</strong> ${data.twilio_voice_number_owned === null ? 'Unknown' : (data.twilio_voice_number_owned ? 'Yes' : 'No — check Twilio account')}<br />`
      : '';
    const trialLine = data.trial_account === null ? '' : `<strong>Twilio account type:</strong> ${data.trial_account ? 'Trial (restricted)' : 'Full'}<br />`;
    box.innerHTML = `
      <strong>Ready for real calls:</strong> ${data.ready_for_calls ? 'Yes' : 'No'}<br />
      <strong>Transfer ready:</strong> ${data.transfer_ready ? 'Yes' : 'No'}<br />
      ${trialLine}
      <strong>Speech-to-text:</strong> Deepgram ${escapeHtml(data.stt_model)}<br />
      <strong>Text-to-speech:</strong> Deepgram ${escapeHtml(data.tts_model)}<br />
      <strong>Voice LLM:</strong> ${escapeHtml(data.voice_llm_model)}<br />
      <strong>Twilio voice number:</strong> ${escapeHtml(data.twilio_voice_number || 'Not set')}<br />
      ${numberOwnedLine}
      <strong>Staff transfer line:</strong> ${escapeHtml(data.staff_transfer_number || 'Not set')}<br />
      <strong>Public URL (for Twilio webhooks):</strong> ${escapeHtml(data.public_base_url || 'Not set')}
      ${data.transfer_warning ? `<br /><br /><strong style="color:#f3a48c">Warning:</strong> ${escapeHtml(data.transfer_warning)}` : ''}
    `;
    if (checklist) {
      const items = [...(data.missing || [])].map((item) => `<li>Set <code>${escapeHtml(item)}</code> in .env</li>`);
      if (data.transfer_warning) {
        items.push(`<li>${escapeHtml(data.transfer_warning)}</li>`);
      }
      checklist.innerHTML = items.length ? items.join('') : '<li>All required settings are configured.</li>';
    }
  } catch (error) {
    box.textContent = 'Voice diagnostics unavailable.';
  }
}

document.getElementById('refreshVoiceDiagBtn')?.addEventListener('click', refreshVoiceDiagnostics);

document.getElementById('startOutboundCallBtn')?.addEventListener('click', async () => {
  const phone = document.getElementById('outboundPhone')?.value.trim();
  const companyName = document.getElementById('outboundCompanyName')?.value.trim();
  const contactName = document.getElementById('outboundContactName')?.value.trim() || null;
  if (!phone) {
    addMessage('system', 'Enter a company phone number first.');
    return;
  }
  if (!companyName) {
    addMessage('system', 'Enter a company name first.');
    return;
  }
  try {
    const response = await fetch(`${apiBase()}/api/voice/call-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, company_name: companyName, contact_name: contactName }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Unable to place the call.');
    addMessage('assistant', `Calling ${companyName} at ${phone} now (call SID ${result.call_sid}).`);
  } catch (error) {
    addMessage('system', error.message);
  }
});

refreshVoiceDiagnostics();

async function startAssistantConversation() {
  try {
    switchView('assistant');
    setAssistantOpen(true);
    setStage('Starting conversation');
    mayaMessage.focus();
    if (!state.initialized) {
      try {
        await refreshLiveData();
      } catch (error) {
        addMessage('system', error.message);
      }
    }
    state.assistantPhone = '';
    if (!state.initialized) {
      resetMayaWindow();
      addMessage('assistant', `Welcome to ${restaurantNameInput.value || 'JING'}. I'm your AI concierge — here to help with buffet bookings, the menu, halal questions, loyalty, and reviews. Share your phone number to get started, or tap a quick action above.`);
      state.initialized = true;
    } else {
      addMessage('assistant', `Hi there! I'm the ${restaurantNameInput.value || 'JING'} AI concierge. Share your phone number and I'll help you book a table, check the menu, or check loyalty points.`);
    }
    mayaMessage.value = '';
    setStage('Live');
  } catch (error) {
    addMessage('system', error.message);
    setStage('Chat error');
  }
}

assistantLaunchBtn?.addEventListener('click', () => {
  startAssistantConversation();
});

mayaStartBtn.addEventListener('click', async () => {
  try {
    await startAssistantConversation();
  } catch (error) {
    addMessage('system', error.message);
    setStage('Chat error');
  }
});

mayaResetBtn.addEventListener('click', async () => {
  try {
    await resetMayaConversation();
    setStage('Live');
  } catch (error) {
    addMessage('system', error.message);
    setStage('Chat error');
  }
});

startVoiceGuideBtn.addEventListener('click', () => {
  startGuidedVoiceFlow();
});

const viewReportBtn = document.getElementById('viewReportBtn');
viewReportBtn?.addEventListener('click', () => {
  switchView('reviews');
  addMessage('system', 'Reviews view opened. Draft responses and review requests are available.');
});

const newBookingBtn = document.getElementById('newBookingBtn');
newBookingBtn?.addEventListener('click', () => {
  switchView('bookings');
  document.getElementById('guestName2')?.focus();
});

nextVoiceGuideBtn.addEventListener('click', async () => {
  try {
    setStage('Guided voice flow');
    await nextGuidedVoiceStep();
  } catch (error) {
    addMessage('system', error.message);
    setStage('Voice test failed');
  }
});

resetVoiceGuideBtn.addEventListener('click', () => {
  resetGuidedVoiceFlow();
});

markVisitedBtn.addEventListener('click', async () => {
  await runStaffAction('visited');
});

markNoShowBtn.addEventListener('click', async () => {
  await runStaffAction('no-show');
});

bookingFilter.addEventListener('change', () => {
  renderBookings(state.bookings);
});

refreshTwilioBtn.addEventListener('click', async () => {
  try {
    await refreshTwilioDiagnostics();
  } catch (error) {
    addMessage('system', error.message);
  }
});

testTwilioBtn.addEventListener('click', async () => {
  try {
    await testTwilioSender();
  } catch (error) {
    addMessage('system', error.message);
  }
});

chatQuickActions?.addEventListener('click', async (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  const prompt = chip.dataset.prompt;
  if (!prompt) return;
  mayaMessage.value = prompt;
  if (!state.assistantOpen) {
    await startAssistantConversation();
  }
  mayaForm.dispatchEvent(new Event('submit'));
});

whatsappConnectBtn?.addEventListener('click', async () => {
  try {
    const response = await fetch(`${apiBase()}/api/diagnostics/twilio`);
    if (!response.ok) throw new Error('Unable to load Twilio diagnostics.');
    const data = await response.json();
    if (data.sandbox_url) {
      window.open(data.sandbox_url, '_blank', 'noopener,noreferrer');
    } else {
      addMessage('system', 'WhatsApp sandbox is not configured. Add TWILIO_SANDBOX_CODE to your .env file.');
    }
  } catch (error) {
    addMessage('system', error.message);
  }
});

notifyBtn?.addEventListener('click', () => {
  addMessage('system', 'Notifications enabled. The assistant is ready to help with the next booking request.');
});

restaurantNameInput.addEventListener('change', async () => {
  try {
    await refreshLiveData();
  } catch {
    setStage('Offline');
  }
});

if (capacityDate) {
  capacityDate.value = todayIso();
}

switchView('dashboard');
loadTables().catch(() => {});
refreshLiveData().catch((error) => {
  resetMayaWindow();
  addMessage('system', error.message);
  setStage('Backend offline');
  if (connectionStatus) connectionStatus.textContent = 'Backend offline';
});
refreshTwilioDiagnostics().catch(() => {
  if (twilioDiagnostics) twilioDiagnostics.textContent = 'Twilio diagnostics unavailable.';
});
