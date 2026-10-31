
const API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  ? 'http://localhost:3000'
  : '';
const token = localStorage.getItem('token');

let currentUser = null;

try {
  currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch {
  currentUser = null;
}

function logoutEventPage() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

async function apiRequest(path, method = 'GET', body) {
  const headers = { Authorization: 'Bearer ' + token };
  const options = { method, headers };

  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(API + path, options);

  if (res.status === 401) {
    logoutEventPage();
    throw new Error('Please log in again.');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }

  return data;
}

const el = id => document.getElementById(id);
let eventPhotoPreviewUrl = null;

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function renderSummary(events) {
  const summary = el('eventSummary');
  summary.replaceChildren();

  const nextEvent = events.find(event => {
    return new Date(`${event.date}T${event.time || '00:00'}`) >= new Date();
  });

  const total = document.createElement('div');
  total.className = 'summary-stat';
  addText(total, 'strong', '', String(events.length));
  addText(total, 'span', '', 'Events listed');
  summary.appendChild(total);

  const next = document.createElement('div');
  next.className = 'summary-stat';
  addText(next, 'strong', '', nextEvent ? nextEvent.title : 'Nothing scheduled');
  addText(next, 'span', '', nextEvent
    ? `${nextEvent.date} · ${nextEvent.time}`
    : 'Check back for updates');
  summary.appendChild(next);
}

function renderRsvpButtons(event) {
  const wrap = document.createElement('div');
  wrap.className = 'rsvp-actions';

  [
    { key: 'going', label: 'Register / Going' },
    { key: 'interested', label: 'Interested' },
    { key: 'not_going', label: 'Can’t attend' }
  ].forEach(({ key, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rsvp-option';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(event.userRsvp === key));

    if (event.userRsvp === key) button.classList.add('active');

    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await apiRequest(`/events/${encodeURIComponent(event.id)}/rsvp`,
          'POST', { status: key });
        await loadEvents();
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });

    wrap.appendChild(button);
  });

  return wrap;
}

function renderEvent(event) {
  const card = document.createElement('article');
  card.className = 'event-card';

  const cover = document.createElement('div');
  cover.className = 'event-cover';

  if (event.photo) {
    const image = document.createElement('img');
    image.src = API + event.photo;
    image.alt = `Photo for ${event.title}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.remove();
      cover.classList.add('event-cover-empty');
      cover.textContent = 'Campus Loop Event';
    }, { once: true });
    cover.appendChild(image);
  } else {
    cover.classList.add('event-cover-empty');
    cover.textContent = 'Campus Loop Event';
  }

  const content = document.createElement('div');
  content.className = 'event-card-content';

  const meta = document.createElement('div');
  meta.className = 'event-meta';
  addText(meta, 'span', '', event.date);
  addText(meta, 'span', '', event.time);
  addText(meta, 'span', '', event.location);

  addText(content, 'h3', 'event-title', event.title);
  addText(content, 'p', 'event-desc',
    event.description || 'No extra details provided.');
  content.appendChild(meta);

  const counts = document.createElement('div');
  counts.className = 'attendee-info';
  addText(counts, 'span', '', `Going: ${event.attendingCount || 0}`);
  addText(counts, 'span', '', `Interested: ${event.interestedCount || 0}`);

  const footer = document.createElement('div');
  footer.className = 'event-footer';
  addText(footer, 'span', '', `Hosted by ${event.organizer || 'Campus Loop'}`);

  if (currentUser.role === 'admin' || event.organizerId === currentUser.id) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-btn';
    remove.textContent = 'Delete event';

    remove.addEventListener('click', async () => {
      if (!confirm(`Delete "${event.title}"?`)) return;

      try {
        await apiRequest(`/events/${encodeURIComponent(event.id)}`, 'DELETE');
        await loadEvents();
      } catch (error) {
        alert(error.message);
      }
    });

    footer.appendChild(remove);
  }

  card.append(cover, content);
  content.append(counts, renderRsvpButtons(event), footer);
  return card;
}

async function loadEvents() {
  const list = el('eventList');
  list.textContent = 'Loading events...';

  try {
    const events = await apiRequest('/events');
    renderSummary(events);
    list.replaceChildren();

    if (!events.length) {
      addText(list, 'p', 'muted', 'No events have been published yet.');
      return;
    }

    events.forEach(event => list.appendChild(renderEvent(event)));
  } catch (error) {
    list.replaceChildren();
    addText(list, 'p', 'muted', error.message);
  }
}

async function addEvent(event) {
  event.preventDefault();

  if (!['admin', 'instructor'].includes(currentUser.role)) {
    el('formMessage').textContent = 'Only instructors and admins can publish events.';
    return;
  }

  const form = el('eventForm');
  const message = el('formMessage');
  const button = el('addEventButton');
  const photo = el('eventPhoto').files[0];

  if (photo && photo.size > 5 * 1024 * 1024) {
    message.textContent = 'The photo must be 5 MB or smaller.';
    return;
  }
  if (photo && !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(photo.type)) {
    message.textContent = 'Choose a JPG, PNG, WEBP, or GIF image.';
    return;
  }

  const formData = new FormData();
  formData.append('title', el('eventTitle').value.trim());
  formData.append('date', el('eventDate').value);
  formData.append('time', el('eventTime').value);
  formData.append('location', el('eventLocation').value.trim());
  formData.append('description', el('eventDescription').value.trim());

  if (photo) formData.append('photo', photo);

  button.disabled = true;
  message.textContent = 'Publishing event...';

  try {
    await apiRequest('/events', 'POST', formData);
    form.reset();
    updateEventPhotoPreview();
    message.textContent = 'Event published successfully.';
    await loadEvents();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function updateEventPhotoPreview() {
  if (eventPhotoPreviewUrl) URL.revokeObjectURL(eventPhotoPreviewUrl);

  const photo = el('eventPhoto').files[0];
  const preview = el('eventPhotoPreview');
  const image = el('eventPhotoPreviewImage');
  if (!photo) {
    image.removeAttribute('src');
    preview.hidden = true;
    eventPhotoPreviewUrl = null;
    return;
  }

  eventPhotoPreviewUrl = URL.createObjectURL(photo);
  image.src = eventPhotoPreviewUrl;
  preview.hidden = false;
}

function initializeEvents() {
  if (!token || !currentUser) {
    window.location.replace('login.html');
    return;
  }

  el('logoutLink').addEventListener('click', event => {
    event.preventDefault();
    logoutEventPage();
  });

  if (['admin', 'instructor'].includes(currentUser.role)) {
    el('adminPanel').hidden = false;
    el('eventForm').addEventListener('submit', addEvent);
    el('eventPhoto').addEventListener('change', updateEventPhotoPreview);
    el('removeEventPhoto').addEventListener('click', () => {
      el('eventPhoto').value = '';
      updateEventPhotoPreview();
    });
  }

  loadEvents();
}

initializeEvents();
