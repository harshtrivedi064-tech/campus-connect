const API = 'http://localhost:3000';
const token = localStorage.getItem('token');
const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

if (!token || !currentUser) {
  window.location.href = 'login.html';
}

function logoutEventPage() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

async function apiRequest(path, method, body) {
  const res = await fetch(API + path, {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    logoutEventPage();
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }

  return data;
}

function renderSummary(events) {
  const summary = document.getElementById('eventSummary');
  if (!events.length) {
    summary.innerHTML = '<p class="muted">No upcoming events yet.</p>';
    return;
  }

  const total = events.length;
  const next = events[0];
  summary.innerHTML = `
    <div class="summary-stat">
      <strong>${total}</strong>
      <span>Events this term</span>
    </div>
    <div class="summary-stat">
      <strong>${next.title}</strong>
      <span>${next.date} • ${next.time}</span>
    </div>
  `;
}

function renderRsvpButtons(event) {
  const statuses = [
    { key: 'going', label: 'Going' },
    { key: 'interested', label: 'Interested' },
    { key: 'not_going', label: 'Not going' }
  ];

  const wrap = document.createElement('div');
  wrap.className = 'rsvp-actions';

  statuses.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rsvp-option';
    if (event.userRsvp === key) btn.classList.add('active');
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      try {
        await apiRequest('/events/' + event.id + '/rsvp', 'POST', { status: key });
        await loadEvents();
      } catch (err) {
        alert(err.message);
      }
    });
    wrap.appendChild(btn);
  });

  return wrap;
}

async function loadEvents() {
  const list = document.getElementById('eventList');
  list.innerHTML = '<p class="muted">Loading events...</p>';

  try {
    const events = await apiRequest('/events');
    renderSummary(events);

    if (!events.length) {
      list.innerHTML = '<p class="muted">No events scheduled yet. Add one above.</p>';
      return;
    }

    list.innerHTML = '';
    events.forEach((event) => {
      const card = document.createElement('article');
      card.className = 'event-card';

      const meta = document.createElement('div');
      meta.className = 'event-meta';
      meta.innerHTML = `<span>${event.date}</span><span>${event.time}</span><span>${event.location}</span>`;

      const title = document.createElement('h3');
      title.textContent = event.title;

      const description = document.createElement('p');
      description.className = 'event-desc';
      description.textContent = event.description || 'No extra details provided.';

      const attendeeInfo = document.createElement('div');
      attendeeInfo.className = 'attendee-info';
      attendeeInfo.innerHTML = `
        <span>Going: ${event.attendingCount || 0}</span>
        <span>Interested: ${event.interestedCount || 0}</span>
      `;

      const footer = document.createElement('div');
      footer.className = 'event-footer';
      footer.innerHTML = `<span>Hosted by ${event.organizer}</span>`;

      const rsvpBlock = renderRsvpButtons(event);

      if (event.organizerId === currentUser.id || currentUser.role === 'instructor') {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'delete-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', async () => {
          try {
            await apiRequest('/events/' + event.id, 'DELETE');
            await loadEvents();
          } catch (err) {
            alert(err.message);
          }
        });
        footer.appendChild(removeBtn);
      }

      card.append(meta, title, description, attendeeInfo, rsvpBlock, footer);
      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

async function addEvent(event) {
  event.preventDefault();
  const payload = {
    title: document.getElementById('eventTitle').value.trim(),
    date: document.getElementById('eventDate').value,
    time: document.getElementById('eventTime').value,
    location: document.getElementById('eventLocation').value.trim(),
    description: document.getElementById('eventDescription').value.trim()
  };

  if (!payload.title || !payload.date || !payload.time || !payload.location) {
    alert('Please complete the event title, date, time, and location.');
    return;
  }

  try {
    await apiRequest('/events', 'POST', payload);
    event.currentTarget.reset();
    await loadEvents();
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById('eventForm').addEventListener('submit', addEvent);
loadEvents();
