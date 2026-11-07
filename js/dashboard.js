const DASHBOARD_API = window.location.protocol === 'file:' ||
  /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  ? 'http://localhost:3000'
  : '';

const dashboardToken = localStorage.getItem('token');
const dashboardElement = id => document.getElementById(id);

function clearDashboardSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  window.location.replace('login.html');
}

async function dashboardRequest(path) {
  const response = await fetch(DASHBOARD_API + path, {
    headers: { Authorization: `Bearer ${dashboardToken}` }
  });
  if (response.status === 401) {
    clearDashboardSession();
    throw new Error('Your session expired. Please log in again.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Unable to load this section.');
  return data;
}

function dashboardText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text == null ? '' : String(text);
  parent.appendChild(element);
  return element;
}

function initials(name) {
  return String(name || 'Campus Loop')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase() || 'CL';
}

function setAvatar(container, name, image) {
  container.textContent = initials(name);
  const imageUrl = safeProfileImage(image);
  if (!imageUrl) return;

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = '';
  img.addEventListener('error', () => {
    img.remove();
    container.textContent = initials(name);
  }, { once: true });
  container.replaceChildren(img);
}

function safeProfileImage(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, DASHBOARD_API || window.location.origin);
    const apiOrigin = new URL(DASHBOARD_API || window.location.origin, window.location.origin).origin;
    if (!['http:', 'https:'].includes(url.protocol) ||
        (url.origin !== window.location.origin && url.origin !== apiOrigin)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function formatDate(value, options = { month: 'short', day: 'numeric' }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, options);
}

function showEmpty(container, message) {
  container.replaceChildren();
  dashboardText(container, 'p', 'empty-state', message);
}

function showSectionError(container, label, error) {
  showEmpty(container, `Couldn't load ${label}. ${error.message}`);
}

function renderProfile(profile) {
  const user = profile.user;
  document.title = `${user.name} | Student Dashboard · Campus Loop`;
  dashboardElement('studentName').textContent = user.name;
  dashboardElement('topbarName').textContent = user.name;
  const branch = user.branch || user.program;
  const year = user.year
    ? (/^\d+$/.test(String(user.year)) ? `Year ${user.year}` : String(user.year))
    : '';
  dashboardElement('welcomeMeta').textContent = [branch, year].filter(Boolean).join(' · ') ||
    'Your campus life, all in one place.';
  dashboardElement('currentDate').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  const image = user.profilePicture || user.avatarUrl;
  setAvatar(dashboardElement('welcomeAvatar'), user.name, image);
  setAvatar(dashboardElement('topbarAvatar'), user.name, image);
}

function renderAttendance(records) {
  const content = dashboardElement('attendanceContent');
  const marked = records.filter(record => record.status === 'present' || record.status === 'absent');
  const attended = marked.filter(record => record.status === 'present').length;
  const percentage = marked.length ? Math.round(attended / marked.length * 100) : null;
  content.replaceChildren();

  if (percentage === null) {
    showEmpty(content, 'No marked attendance yet. Your class summary will appear here.');
    return;
  }

  const overview = document.createElement('div');
  overview.className = 'attendance-overview';
  const ring = document.createElement('div');
  ring.className = 'attendance-ring';
  ring.style.setProperty('--attendance-value', `${percentage}%`);
  const ringInner = document.createElement('div');
  ringInner.className = 'attendance-ring-inner';
  dashboardText(ringInner, 'strong', '', `${percentage}%`);
  dashboardText(ringInner, 'span', '', 'ATTENDANCE');
  ring.appendChild(ringInner);

  const details = document.createElement('div');
  details.className = 'attendance-stats';
  dashboardText(details, 'strong', '', `${attended} of ${marked.length} classes`);
  dashboardText(details, 'p', '', 'Classes attended');
  const progress = document.createElement('div');
  progress.className = 'progress-track';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', 'Attendance percentage');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', String(percentage));
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  fill.style.width = `${percentage}%`;
  progress.appendChild(fill);
  details.appendChild(progress);
  overview.append(ring, details);
  content.appendChild(overview);

  if (percentage < 75) {
    dashboardText(content, 'p', 'attendance-warning',
      'Your attendance is below 75%. Attend upcoming classes to improve it.');
  }
}

function eventTime(event) {
  const timestamp = new Date(`${event.date}T${event.time || '00:00'}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function eventImageUrl(photo) {
  if (typeof photo !== 'string' || !photo.trim()) return '';
  if (photo.startsWith('/')) return DASHBOARD_API + photo;
  return safeProfileImage(photo);
}

function renderEvents(events) {
  const container = dashboardElement('eventsContent');
  const upcoming = events
    .filter(event => {
      const time = eventTime(event);
      return time !== null && time >= Date.now();
    })
    .sort((a, b) => eventTime(a) - eventTime(b))
    .slice(0, 3);
  container.replaceChildren();
  if (!upcoming.length) {
    showEmpty(container, events.length
      ? 'No upcoming events right now. Browse all events for past listings.'
      : 'No campus events have been posted yet.');
    return;
  }

  upcoming.forEach(event => {
    const item = document.createElement('article');
    item.className = 'event-item';
    const imageBox = document.createElement('div');
    imageBox.className = 'event-image';
    const imageUrl = eventImageUrl(event.photo);
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        imageBox.replaceChildren();
        dashboardText(imageBox, 'span', 'event-image-fallback', '▦');
      }, { once: true });
      imageBox.appendChild(image);
    } else {
      dashboardText(imageBox, 'span', 'event-image-fallback', '▦');
    }

    const detail = document.createElement('div');
    detail.className = 'event-detail';
    dashboardText(detail, 'h3', '', event.title);
    dashboardText(detail, 'p', 'event-date', `${formatDate(`${event.date}T00:00:00`)}${event.time ? ` · ${event.time}` : ''}`);
    dashboardText(detail, 'p', '', event.location || 'Location to be announced');
    item.append(imageBox, detail);
    container.appendChild(item);
  });
}

function renderFeed(posts) {
  const container = dashboardElement('feedContent');
  const recent = posts.slice()
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 5);
  container.replaceChildren();
  if (!recent.length) {
    showEmpty(container, 'No campus posts yet. Start a conversation in the feed.');
    return;
  }

  recent.forEach(post => {
    const article = document.createElement('article');
    article.className = 'feed-post';
    const author = document.createElement('div');
    author.className = 'feed-author';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    setAvatar(avatar, post.name, post.profilePicture || post.avatarUrl);
    const identity = document.createElement('div');
    dashboardText(identity, 'strong', '', post.name || 'Campus member');
    const time = document.createElement('time');
    const postDate = new Date(post.time);
    time.dateTime = Number.isNaN(postDate.getTime()) ? '' : postDate.toISOString();
    time.textContent = Number.isNaN(postDate.getTime()) ? '' : formatDate(postDate, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    identity.appendChild(time);
    author.append(avatar, identity);
    dashboardText(article, 'p', 'feed-post-text', post.text);
    article.prepend(author);
    container.appendChild(article);
  });
}

function isInternshipClosed(internship) {
  return new Date(`${internship.deadline}T23:59:59.999Z`).getTime() < Date.now();
}

function renderInternships(internships) {
  const container = dashboardElement('internshipContent');
  const available = internships
    .filter(internship => !isInternshipClosed(internship))
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 3);
  container.replaceChildren();
  if (!available.length) {
    showEmpty(container, internships.length
      ? 'There are no open opportunities right now. Check back soon.'
      : 'No internships have been posted yet.');
    return;
  }

  available.forEach(internship => {
    const item = document.createElement('article');
    item.className = 'internship-item';
    const detail = document.createElement('div');
    detail.className = 'internship-detail';
    dashboardText(detail, 'h3', '', internship.title);
    dashboardText(detail, 'p', '', `${internship.company} · Apply by ${formatDate(`${internship.deadline}T00:00:00`)}`);
    const status = dashboardText(item, 'span',
      `application-status${internship.hasApplied ? ' applied' : ''}`,
      internship.hasApplied ? 'Applied' : 'Open');
    status.setAttribute('aria-label', internship.hasApplied ? 'Application submitted' : 'Applications open');
    item.prepend(detail);
    container.appendChild(item);
  });
}

function renderNotifications(events, internships, attendanceReports) {
  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const updates = [];

  events.forEach(event => {
    const time = eventTime(event);
    if (time !== null && time >= now && time - now <= oneWeek) {
      updates.push({ time, icon: '▦', title: `Coming up: ${event.title}`, detail: `${formatDate(`${event.date}T00:00:00`)} · ${event.location || 'Campus event'}` });
    }
  });
  internships.forEach(internship => {
    const deadline = new Date(`${internship.deadline}T23:59:59.999Z`).getTime();
    if (!internship.hasApplied && deadline >= now && deadline - now <= oneWeek) {
      updates.push({ time: deadline, icon: '↗', title: `Applications closing soon: ${internship.title}`, detail: `${internship.company} · Apply by ${formatDate(`${internship.deadline}T00:00:00`)}` });
    }
  });
  attendanceReports.forEach(report => {
    if (report.status === 'pending') {
      const created = new Date(report.createdAt).getTime();
      updates.push({
        time: Number.isFinite(created) ? created : now,
        icon: '✓',
        title: `Attendance correction pending`,
        detail: `${report.className} · Awaiting instructor review`
      });
    }
  });

  const container = dashboardElement('notificationContent');
  updates.sort((a, b) => b.time - a.time);
  container.replaceChildren();
  if (!updates.length) {
    showEmpty(container, 'You’re all caught up. New event and opportunity updates will show here.');
    return;
  }

  updates.slice(0, 3).forEach(update => {
    const item = document.createElement('article');
    item.className = 'notification-item';
    dashboardText(item, 'span', 'notification-marker', update.icon);
    const copy = document.createElement('div');
    copy.className = 'notification-copy';
    dashboardText(copy, 'strong', '', update.title);
    dashboardText(copy, 'span', '', update.detail);
    item.appendChild(copy);
    container.appendChild(item);
  });
}

function renderStudyProgress(history) {
  const container = dashboardElement('studyContent');
  container.replaceChildren();
  const quizzes = Array.isArray(history) ? history : [];
  const completed = quizzes.filter(quiz => quiz.result);
  if (!quizzes.length) {
    showEmpty(container, 'No quizzes yet. Create your first practice set or timed exam.');
    return;
  }

  const accuracy = completed.length
    ? Math.round(completed.reduce((sum, quiz) => sum + quiz.result.accuracy, 0) / completed.length)
    : null;
  const stats = document.createElement('div');
  stats.className = 'study-stats';
  const total = document.createElement('div');
  dashboardText(total, 'strong', '', completed.length);
  dashboardText(total, 'span', '', 'Completed quizzes');
  const average = document.createElement('div');
  dashboardText(average, 'strong', '', accuracy === null ? '—' : `${accuracy}%`);
  dashboardText(average, 'span', '', 'Average accuracy');
  stats.append(total, average);
  container.appendChild(stats);

  const latest = quizzes[0];
  const latestItem = document.createElement('div');
  latestItem.className = 'study-latest';
  dashboardText(latestItem, 'strong', '', latest.title || 'Practice quiz');
  dashboardText(latestItem, 'span', '',
    `${latest.questionCount} questions · ${latest.result
      ? `${latest.result.accuracy}% accuracy`
      : 'In progress'}`);
  container.appendChild(latestItem);
}

function showDashboardError(message) {
  const alert = dashboardElement('dashboardError');
  alert.textContent = message;
  alert.hidden = false;
}

async function loadSection(path, container, label, render) {
  try {
    const data = await dashboardRequest(path);
    render(data);
    return { ok: true, value: data };
  } catch (error) {
    showSectionError(container, label, error);
    return { ok: false, error };
  }
}

async function initializeDashboard() {
  if (!dashboardToken) {
    window.location.replace('login.html');
    return;
  }

  try {
    const profile = await dashboardRequest('/profile');
    if (profile.user.role !== 'student') {
      window.location.replace('feed.html');
      return;
    }
    renderProfile(profile);

    const [attendance, events, posts, internships, study] = await Promise.all([
      loadSection('/attendance/mine', dashboardElement('attendanceContent'), 'attendance', renderAttendance),
      loadSection('/events', dashboardElement('eventsContent'), 'events', renderEvents),
      loadSection('/posts', dashboardElement('feedContent'), 'campus feed', renderFeed),
      loadSection('/internships', dashboardElement('internshipContent'), 'internships', renderInternships),
      loadSection('/mcq/history?limit=50', dashboardElement('studyContent'), 'quiz history', renderStudyProgress)
    ]);

    const failures = [attendance, events, posts, internships, study].filter(result => !result.ok);
    if (failures.length) {
      showDashboardError('Some dashboard sections could not be refreshed. Please check your connection and try again.');
    }
    renderNotifications(
      events.ok ? events.value || [] : [],
      internships.ok ? internships.value || [] : [],
      profile.activity?.attendanceReports || []
    );
  } catch (error) {
    if (!localStorage.getItem('token')) return;
    showDashboardError(error.message || 'Unable to load your dashboard. Please try again.');
    ['studyContent', 'attendanceContent', 'eventsContent', 'feedContent', 'internshipContent', 'notificationContent']
      .forEach(id => showSectionError(dashboardElement(id), 'dashboard data', error));
  }
}

dashboardElement('dashboardLogout').addEventListener('click', clearDashboardSession);
dashboardElement('dashboardMobileLogout').addEventListener('click', clearDashboardSession);
initializeDashboard();
