const API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  ? 'http://localhost:3000'
  : '';
const token = localStorage.getItem('token');
let currentUser = null;
let allInternships = [];
let selectedInternshipId = null;

try {
  currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch {
  currentUser = null;
}

const el = id => document.getElementById(id);

function logoutInternshipPage() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

async function apiRequest(path, method = 'GET', body) {
  const headers = { Authorization: `Bearer ${token}` };
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(API + path, options);
  if (response.status === 401) {
    logoutInternshipPage();
    throw new Error('Please log in again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function isClosed(internship) {
  return new Date(`${internship.deadline}T23:59:59.999Z`).getTime() < Date.now();
}

function renderSummary() {
  const summary = el('internshipSummary');
  summary.replaceChildren();
  const activeCount = allInternships.filter(internship => !isClosed(internship)).length;
  addText(summary, 'strong', '', String(activeCount));
  addText(summary, 'span', '', activeCount === 1 ? 'open opportunity' : 'open opportunities');
}

function renderInternship(internship) {
  const card = document.createElement('article');
  card.className = 'internship-card';
  const content = document.createElement('div');
  content.className = 'internship-card-content';

  const top = document.createElement('div');
  top.className = 'internship-card-top';
  addText(top, 'span', 'internship-type', internship.type);
  if (isClosed(internship)) addText(top, 'span', 'internship-closed-badge', 'Applications closed');
  addText(content, 'h3', 'internship-title', internship.title);
  addText(content, 'p', 'internship-company', internship.company);

  const metadata = document.createElement('div');
  metadata.className = 'internship-meta';
  [
    `⌖ ${internship.location}`,
    internship.workMode,
    internship.stipend || 'Compensation not specified',
    `Apply by ${new Date(`${internship.deadline}T00:00:00`).toLocaleDateString()}`
  ].forEach(item => addText(metadata, 'span', '', item));
  addText(content, 'p', 'internship-description', internship.description);

  if (internship.eligibility) {
    addText(content, 'p', 'internship-eligibility', `Eligibility: ${internship.eligibility}`);
  }
  addText(content, 'p', 'internship-poster', `Posted by ${internship.postedBy || 'Campus Loop'}`);

  const actions = document.createElement('div');
  actions.className = 'internship-actions';
  const manager = currentUser.role === 'admin' || internship.postedById === currentUser.id;

  if (currentUser.role === 'student') {
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'internship-primary-action';
    apply.textContent = internship.hasApplied ? 'Application submitted' : 'Apply now';
    apply.disabled = internship.hasApplied || isClosed(internship);
    apply.addEventListener('click', () => openApplication(internship));
    actions.appendChild(apply);
  }

  if (manager) {
    const applicants = document.createElement('button');
    applicants.type = 'button';
    applicants.className = 'internship-secondary-action';
    applicants.textContent = `View applicants (${internship.applicationCount || 0})`;
    applicants.addEventListener('click', () => loadApplicants(internship));
    actions.appendChild(applicants);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'internship-delete-action';
    remove.textContent = 'Remove listing';
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove "${internship.title}"? This will also remove its applications.`)) return;
      remove.disabled = true;
      try {
        await apiRequest(`/internships/${encodeURIComponent(internship.id)}`, 'DELETE');
        await loadInternships();
      } catch (error) {
        alert(error.message);
        remove.disabled = false;
      }
    });
    actions.appendChild(remove);
  }

  card.append(top, content);
  content.append(metadata, actions);
  return card;
}

function renderFilteredInternships() {
  const query = el('internshipSearch').value.trim().toLocaleLowerCase();
  const type = el('internshipTypeFilter').value;
  const filtered = allInternships.filter(internship => {
    const searchable = [
      internship.title, internship.company, internship.location,
      internship.description, internship.eligibility, internship.workMode
    ].join(' ').toLocaleLowerCase();
    return (type === 'all' || internship.type === type) && searchable.includes(query);
  });

  el('internshipResultCount').textContent =
    `${filtered.length} ${filtered.length === 1 ? 'opportunity' : 'opportunities'} shown`;
  const list = el('internshipList');
  list.replaceChildren();
  if (!filtered.length) {
    addText(list, 'p', 'muted', allInternships.length
      ? 'No opportunities match these filters.'
      : 'No opportunities have been posted yet. Check back soon.');
    return;
  }
  filtered.forEach(internship => list.appendChild(renderInternship(internship)));
}

async function loadInternships() {
  el('internshipList').textContent = 'Loading opportunities...';
  try {
    allInternships = await apiRequest('/internships');
    renderSummary();
    renderFilteredInternships();
  } catch (error) {
    allInternships = [];
    renderSummary();
    el('internshipResultCount').textContent = '';
    el('internshipList').replaceChildren();
    addText(el('internshipList'), 'p', 'muted', error.message);
  }
}

async function publishInternship(event) {
  event.preventDefault();
  const form = el('internshipForm');
  const button = el('publishInternshipButton');
  const message = el('internshipFormMessage');
  const values = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  message.textContent = 'Publishing opportunity...';

  try {
    await apiRequest('/internships', 'POST', values);
    form.reset();
    message.textContent = 'Opportunity published successfully.';
    await loadInternships();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function openApplication(internship) {
  selectedInternshipId = internship.id;
  el('applicationForm').reset();
  el('applicationFormMessage').textContent = '';
  el('applicationRoleName').textContent = `${internship.title} · ${internship.company}`;
  el('applicationDialog').showModal();
}

async function submitApplication(event) {
  event.preventDefault();
  if (!selectedInternshipId) return;
  const form = el('applicationForm');
  const button = el('submitApplicationButton');
  const message = el('applicationFormMessage');
  const values = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  message.textContent = 'Submitting application...';

  try {
    const result = await apiRequest(
      `/internships/${encodeURIComponent(selectedInternshipId)}/applications`,
      'POST',
      values
    );
    message.textContent = result.message;
    await loadInternships();
    window.setTimeout(() => el('applicationDialog').close(), 900);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadApplicants(internship) {
  const dialog = el('applicantsDialog');
  const list = el('applicantList');
  el('applicantsDialogTitle').textContent = `Applications · ${internship.title}`;
  list.replaceChildren();
  addText(list, 'p', 'muted', 'Loading applications...');
  dialog.showModal();
  try {
    const applications = await apiRequest(
      `/internships/${encodeURIComponent(internship.id)}/applications`
    );
    list.replaceChildren();
    if (!applications.length) {
      addText(list, 'p', 'muted', 'No applications received yet.');
      return;
    }
    applications.forEach(application => {
      const card = document.createElement('article');
      card.className = 'applicant-card';
      addText(card, 'h3', '', application.name);
      const email = addText(card, 'a', '', application.email);
      email.href = `mailto:${application.email}`;
      addText(card, 'p', '', application.coverLetter);
      if (application.resumeUrl) {
        const resume = addText(card, 'a', 'applicant-resume', 'Open resume');
        resume.href = application.resumeUrl;
        resume.target = '_blank';
        resume.rel = 'noopener noreferrer';
      }
      addText(card, 'small', '', `Applied ${new Date(application.submittedAt).toLocaleString()}`);
      list.appendChild(card);
    });
  } catch (error) {
    list.replaceChildren();
    addText(list, 'p', 'muted', error.message);
  }
}

function initializeInternships() {
  if (!token || !currentUser) {
    window.location.replace('login.html');
    return;
  }

  el('logoutLink').addEventListener('click', event => {
    event.preventDefault();
    logoutInternshipPage();
  });
  el('internshipSearch').addEventListener('input', renderFilteredInternships);
  el('internshipTypeFilter').addEventListener('change', renderFilteredInternships);
  el('clearInternshipFilters').addEventListener('click', () => {
    el('internshipSearch').value = '';
    el('internshipTypeFilter').value = 'all';
    renderFilteredInternships();
    el('internshipSearch').focus();
  });
  el('applicationForm').addEventListener('submit', submitApplication);
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => el(button.dataset.closeDialog).close());
  });

  if (['admin', 'instructor'].includes(currentUser.role)) {
    el('employerPanel').hidden = false;
    el('internshipForm').addEventListener('submit', publishInternship);
  }
  loadInternships();
}

initializeInternships();
