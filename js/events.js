
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
let allEvents = [];

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function eventTimestamp(event) {
  const timestamp = new Date(`${event.date}T${event.time || '00:00'}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function renderSummary(events) {
  const summary = el('eventSummary');
  summary.replaceChildren();

  const nextEvent = events.find(event => {
    const timestamp = eventTimestamp(event);
    return timestamp !== null && timestamp >= Date.now();
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
  const registrationForm = createRegistrationForm(event);

  [
    {
      key: 'going',
      label: event.userRsvp === 'going'
        ? event.userRegistration ? 'Registered · Edit details' : 'Complete registration'
        : 'Register / Going'
    },
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
      if (key === 'going') {
        registrationForm.hidden = !registrationForm.hidden;
        if (!registrationForm.hidden) {
          registrationForm.elements.attendeeName.focus();
        }
        return;
      }

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

  const actions = document.createElement('div');
  actions.append(wrap, registrationForm);
  return actions;
}

function createRegistrationForm(event) {
  const form = document.createElement('form');
  form.className = 'event-registration-form';
  form.hidden = true;
  form.setAttribute('aria-label', `Register for ${event.title}`);
  form.dataset.eventId = event.id;

  addText(form, 'h4', '', 'Quick event registration');
  addText(form, 'p', 'registration-intro',
    'Confirm your details to register. Your name and email are pre-filled and shared with the event organizer.');

  const savedDetails = event.userRegistration || {};
  [
    {
      name: 'attendeeName',
      label: 'Full name *',
      type: 'text',
      value: savedDetails.name || currentUser.name || '',
      placeholder: 'Your full name',
      maxLength: 80,
      required: true,
      autocomplete: 'name'
    },
    {
      name: 'attendeeEmail',
      label: 'Email address *',
      type: 'email',
      value: savedDetails.email || currentUser.email || '',
      placeholder: 'you@example.com',
      maxLength: 120,
      required: true,
      autocomplete: 'email'
    },
    {
      name: 'attendeeProgram',
      label: 'Course / year (optional)',
      type: 'text',
      value: savedDetails.program || '',
      placeholder: 'e.g. Computer Science · Year 2',
      maxLength: 80,
      required: false,
      autocomplete: 'off'
    }
  ].forEach(field => {
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement('input');
    input.name = field.name;
    input.type = field.type;
    input.value = field.value;
    input.placeholder = field.placeholder;
    input.maxLength = field.maxLength;
    input.required = field.required;
    input.autocomplete = field.autocomplete;
    label.appendChild(input);
    form.appendChild(label);
  });

  const actions = document.createElement('div');
  actions.className = 'registration-form-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'registration-submit';
  submit.textContent = 'Confirm registration';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'registration-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    form.hidden = true;
  });
  actions.append(submit, cancel);
  const message = document.createElement('p');
  message.className = 'registration-message';
  form.append(actions, message);
  form.addEventListener('submit', submitEventRegistration);
  return form;
}

async function submitEventRegistration(submitEvent) {
  submitEvent.preventDefault();
  const form = submitEvent.currentTarget;
  const event = allEvents.find(entry => entry.id === form.dataset.eventId);
  const submit = form.querySelector('.registration-submit');
  const message = form.querySelector('.registration-message');
  if (!event) {
    message.textContent = 'This event is no longer available. Refresh and try again.';
    return;
  }

  submit.disabled = true;
  message.textContent = 'Saving your registration...';
  try {
    await apiRequest(`/events/${encodeURIComponent(event.id)}/rsvp`, 'POST', {
      status: 'going',
      registration: {
        name: form.elements.attendeeName.value.trim(),
        email: form.elements.attendeeEmail.value.trim(),
        program: form.elements.attendeeProgram.value.trim()
      }
    });
    await loadEvents();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function createOrganizerRegistrationPanel(event) {
  const wrapper = document.createElement('div');
  wrapper.className = 'organizer-registration';
  const panel = document.createElement('div');
  panel.className = 'organizer-registration-panel';
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');
  panel.dataset.eventId = event.id;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'organizer-registration-toggle';
  button.textContent = `Registrations (${event.registeredCount || 0})`;
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', async () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden || panel.dataset.loaded === 'true') return;

    button.disabled = true;
    panel.replaceChildren();
    addText(panel, 'p', 'registration-loading', 'Loading registrations...');
    try {
      const { registrations } = await apiRequest(
        `/events/${encodeURIComponent(event.id)}/registrations`
      );
      panel.replaceChildren();
      if (!registrations.length) {
        addText(panel, 'p', 'registration-empty', 'No completed registrations yet.');
      } else {
        const list = document.createElement('ul');
        registrations.forEach(registration => {
          const item = document.createElement('li');
          addText(item, 'strong', '', registration.name);
          addText(item, 'a', 'registration-email', registration.email);
          item.querySelector('a').href = `mailto:${encodeURIComponent(registration.email)}`;
          if (registration.program) {
            addText(item, 'span', 'registration-program', registration.program);
          }
          list.appendChild(item);
        });
        panel.appendChild(list);
      }
      panel.dataset.loaded = 'true';
    } catch (error) {
      panel.replaceChildren();
      addText(panel, 'p', 'registration-error', error.message);
    } finally {
      button.disabled = false;
    }
  });
  wrapper.append(button, panel);
  return wrapper;
}

function renderEvent(event) {
  const card = document.createElement('article');
  card.className = 'event-card';
  const timestamp = eventTimestamp(event);
  const isPast = timestamp !== null && timestamp < Date.now();
  if (isPast) card.classList.add('event-card-past');

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
  const eventDate = timestamp === null ? null : new Date(timestamp);
  const readableDate = !eventDate
    ? event.date
    : eventDate.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  const dateNode = addText(meta, eventDate ? 'time' : 'span', 'event-date',
    `${readableDate}${event.time ? ` · ${event.time}` : ''}`);
  if (eventDate) dateNode.dateTime = eventDate.toISOString();
  addText(meta, 'span', 'event-location', `⌖ ${event.location}`);

  if (isPast) addText(content, 'span', 'event-past-badge', 'Past event');
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
    footer.appendChild(createOrganizerRegistrationPanel(event));

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
  content.append(counts);
  if (isPast) {
    addText(content, 'p', 'event-registration-closed', 'Registration has closed.');
  } else {
    content.append(renderRsvpButtons(event));
  }
  content.append(footer);
  return card;
}

function renderFilteredEvents() {
  const list = el('eventList');
  const query = el('eventSearch').value.trim().toLocaleLowerCase();
  const filter = el('eventTimeFilter').value;
  const now = new Date();
  const filtered = allEvents.filter(event => {
    const timestamp = eventTimestamp(event);
    const matchesTime = filter === 'all' ||
      (filter === 'past'
        ? timestamp !== null && timestamp < now.getTime()
        : timestamp === null || timestamp >= now.getTime());
    const searchable = [event.title, event.description, event.location, event.organizer]
      .join(' ')
      .toLocaleLowerCase();
    return matchesTime && searchable.includes(query);
  });
  filtered.sort((a, b) => {
    const aTime = eventTimestamp(a);
    const bTime = eventTimestamp(b);
    if (aTime === null) return bTime === null ? 0 : 1;
    if (bTime === null) return -1;
    return filter === 'past' ? bTime - aTime : aTime - bTime;
  });
  el('eventsHeading').textContent = filter === 'past'
    ? 'Past events'
    : filter === 'all'
      ? 'All campus events'
      : 'Upcoming events';
  el('eventResultCount').textContent =
    `${filtered.length} ${filtered.length === 1 ? 'event' : 'events'} shown`;
  list.replaceChildren();

  if (!filtered.length) {
    addText(list, 'p', 'muted', allEvents.length
      ? 'No events match these filters.'
      : 'No events have been published yet.');
    return;
  }
  filtered.forEach(event => list.appendChild(renderEvent(event)));
}

async function loadEvents() {
  const list = el('eventList');
  list.textContent = 'Loading events...';
  el('eventResultCount').textContent = '';

  try {
    allEvents = await apiRequest('/events');
    renderSummary(allEvents);
    renderFilteredEvents();
  } catch (error) {
    allEvents = [];
    renderSummary(allEvents);
    el('eventResultCount').textContent = '';
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
  el('eventSearch').addEventListener('input', renderFilteredEvents);
  el('eventTimeFilter').addEventListener('change', renderFilteredEvents);
  el('clearEventFilters').addEventListener('click', () => {
    el('eventSearch').value = '';
    el('eventTimeFilter').value = 'upcoming';
    renderFilteredEvents();
    el('eventSearch').focus();
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
