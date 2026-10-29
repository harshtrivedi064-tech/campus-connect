
const ATTENDANCE_API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';
const attendanceToken = localStorage.getItem('token');

let attendanceUser = null;
let attendanceReportRecords = [];
let filteredAttendanceReport = [];

try {
    attendanceUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch {
    attendanceUser = null;
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

function showAttendanceMessage(message, isError = false) {
    const element = document.getElementById('attendanceMessage');
    element.textContent = message;
    element.classList.toggle('error', isError);
}

async function attendanceRequest(path, method = 'GET', body) {
    const headers = { Authorization: `Bearer ${attendanceToken}` };
    const options = { method, headers };

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(ATTENDANCE_API + path, options);
    if (response.status === 401) {
        logout();
        throw new Error('Please log in again.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Unable to load attendance.');
    }

    return data;
}

function escapeAttendanceText(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function addAttendanceText(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(text ?? '');
    parent.appendChild(element);
    return element;
}

function reportStat(summary, label, value, icon) {
    const card = document.createElement('article');
    card.className = 'attendance-stat-card';
    addAttendanceText(card, 'span', 'attendance-stat-icon', icon);
    addAttendanceText(card, 'p', '', label);
    addAttendanceText(card, 'strong', '', value);
    summary.appendChild(card);
}

function renderAttendanceReport() {
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    const summary = document.getElementById('reportSummary');
    const results = document.getElementById('reportResults');

    if (from && to && from > to) {
        filteredAttendanceReport = [];
        summary.replaceChildren();
        results.replaceChildren();
        showAttendanceMessage('The start date must be on or before the end date.', true);
        return false;
    }

    showAttendanceMessage('');
    filteredAttendanceReport = attendanceReportRecords.filter(record =>
        (!from || record.date >= from) && (!to || record.date <= to)
    );

    const present = filteredAttendanceReport.filter(
        record => record.status === 'present'
    ).length;
    const absent = filteredAttendanceReport.filter(
        record => record.status === 'absent'
    ).length;
    const unmarked = filteredAttendanceReport.filter(
        record => record.status === 'unmarked'
    ).length;
    const marked = present + absent;
    const rate = marked ? `${((present / marked) * 100).toFixed(1)}%` : '—';
    const sessions = new Set(filteredAttendanceReport.map(record => record.sessionKey));

    summary.replaceChildren();
    reportStat(summary, 'Class sessions', String(sessions.size), '▦');
    reportStat(summary, 'Present', String(present), '✓');
    reportStat(summary, 'Absent', String(absent), '×');
    reportStat(summary, 'Attendance rate', rate, '◉');

    results.replaceChildren();
    if (!filteredAttendanceReport.length) {
        addAttendanceText(results, 'p', 'attendance-empty',
            'No attendance records match this date range.');
        return true;
    }

    if (unmarked) {
        addAttendanceText(results, 'p', 'attendance-report-note',
            `${unmarked} unmarked record${unmarked === 1 ? '' : 's'} excluded from the attendance rate.`);
    }

    const table = document.createElement('table');
    table.className = 'attendance-report-table';
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = attendanceUser.role === 'instructor'
        ? ['Date', 'Class', 'Student', 'Email', 'Status']
        : ['Date', 'Class', 'Instructor', 'Status'];
    columns.forEach(column => addAttendanceText(headerRow, 'th', '', column));
    head.appendChild(headerRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    filteredAttendanceReport.forEach(record => {
        const row = document.createElement('tr');
        const values = attendanceUser.role === 'instructor'
            ? [record.date, record.className, record.student, record.email, record.status]
            : [record.date, record.className, record.instructor, record.status];
        values.forEach((value, index) => {
            const cell = document.createElement('td');
            cell.textContent = String(value || '');
            if (columns[index] === 'Status') {
                cell.className = `attendance-report-status ${record.status}`;
            }
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
    table.appendChild(body);
    results.appendChild(table);
    return true;
}

async function loadAttendanceReport() {
    const section = document.getElementById('reportSection');
    section.hidden = false;
    document.getElementById('reportResults').textContent = 'Loading report...';

    try {
        if (attendanceUser.role === 'instructor') {
            attendanceReportRecords = await attendanceRequest('/attendance/report');
        } else {
            const records = await attendanceRequest('/attendance/mine');
            attendanceReportRecords = records.map(record => ({
                sessionKey: record.sessionId ||
                    `${record.date}|${record.className}|${record.instructor}`,
                date: record.date,
                className: record.className,
                student: attendanceUser.name,
                instructor: record.instructor,
                status: record.status
            }));
        }

        return renderAttendanceReport();
    } catch (error) {
        attendanceReportRecords = [];
        filteredAttendanceReport = [];
        document.getElementById('reportSummary').replaceChildren();
        document.getElementById('reportResults').replaceChildren();
        addAttendanceText(document.getElementById('reportResults'), 'p',
            'attendance-empty', error.message);
        showAttendanceMessage(error.message, true);
        return false;
    }
}

function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function exportAttendanceReport() {
    if (!filteredAttendanceReport.length) {
        showAttendanceMessage('There are no attendance records to export.', true);
        return;
    }

    const instructorReport = attendanceUser.role === 'instructor';
    const headers = instructorReport
        ? ['Date', 'Class', 'Student', 'Email', 'Status']
        : ['Date', 'Class', 'Instructor', 'Status'];
    const rows = filteredAttendanceReport.map(record => instructorReport
        ? [record.date, record.className, record.student, record.email, record.status]
        : [record.date, record.className, record.instructor, record.status]
    );
    const csv = [headers, ...rows]
        .map(row => row.map(csvCell).join(','))
        .join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], {
        type: 'text/csv;charset=utf-8'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initializeAttendanceReports() {
    document.getElementById('reportFilters').addEventListener('submit', event => {
        event.preventDefault();
        renderAttendanceReport();
    });
    document.getElementById('clearReportFilters').addEventListener('click', () => {
        document.getElementById('reportFilters').reset();
        renderAttendanceReport();
    });
    document.getElementById('exportAttendance').addEventListener(
        'click', exportAttendanceReport
    );
    loadAttendanceReport();
}

async function loadStudents() {
    const choices = document.getElementById('studentChoices');
    choices.textContent = 'Loading students...';

    try {
        const students = await attendanceRequest('/attendance/students');
        choices.replaceChildren();

        if (!students.length) {
            addAttendanceText(choices, 'p', 'attendance-empty',
                'No student accounts are registered yet.');
            return;
        }

        students.forEach((student) => {
            const label = document.createElement('label');
            label.className = 'student-choice';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'studentIds';
            input.value = String(student.id);

            const identity = document.createElement('span');
            identity.textContent = `${student.name} (${student.email})`;
            label.append(input, identity);
            choices.appendChild(label);
        });
    } catch (error) {
        choices.replaceChildren();
        addAttendanceText(choices, 'p', 'attendance-empty', error.message);
        showAttendanceMessage(error.message, true);
    }
}

async function loadSessions() {
    const list = document.getElementById('sessionList');
    list.textContent = 'Loading class sessions...';

    try {
        const sessions = await attendanceRequest('/attendance/sessions');
        list.replaceChildren();

        if (!sessions.length) {
            addAttendanceText(list, 'p', 'attendance-empty',
                'You have not created any class sessions yet.');
            return true;
        }

        sessions.forEach((session) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'session-button';
            button.setAttribute('aria-label',
                `View attendance for ${session.className} on ${session.date}`);

            const name = document.createElement('strong');
            name.textContent = session.className;
            const details = document.createElement('span');
            details.textContent =
                ` · ${session.date} · ${session.presentCount}/${session.studentCount} present`;
            button.append(name, details);
            button.addEventListener('click', () => loadRoster(session.id));
            list.appendChild(button);
        });
        return true;
    } catch (error) {
        list.replaceChildren();
        addAttendanceText(list, 'p', 'attendance-empty', error.message);
        showAttendanceMessage(error.message, true);
        return false;
    }
}

async function loadRoster(sessionId) {
    const section = document.getElementById('rosterSection');
    const list = document.getElementById('rosterList');
    const title = document.getElementById('rosterTitle');
    section.hidden = false;
    list.textContent = 'Loading class roster...';

    try {
        const session = await attendanceRequest(
            `/attendance/sessions/${encodeURIComponent(sessionId)}`
        );
        title.textContent = `${session.className} · ${session.date}`;
        list.replaceChildren();

        if (!session.records.length) {
            addAttendanceText(list, 'p', 'attendance-empty',
                'There are no students on this roster.');
            return true;
        }

        session.records.forEach((record) => {
            const row = document.createElement('div');
            row.className = 'attendance-row';
            row.dataset.studentId = String(record.userId);

            const identity = document.createElement('div');
            identity.className = 'attendance-identity';
            addAttendanceText(identity, 'strong', '', record.name);
            if (record.email) addAttendanceText(identity, 'small', '', record.email);

            const actions = document.createElement('div');
            actions.className = 'attendance-actions';
            const status = addAttendanceText(actions, 'span', 'attendance-status',
                record.status === 'unmarked' ? 'Not marked' :
                    record.status[0].toUpperCase() + record.status.slice(1));

            ['present', 'absent'].forEach((value) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = value === 'present' ? 'Present' : 'Absent';
                button.classList.toggle('selected', record.status === value);
                button.setAttribute('aria-pressed', String(record.status === value));
                button.addEventListener('click', async () => {
                    actions.querySelectorAll('button').forEach(item => {
                        item.disabled = true;
                    });
                    try {
                        await attendanceRequest(
                            `/attendance/sessions/${encodeURIComponent(session.id)}` +
                                `/records/${encodeURIComponent(record.userId)}`,
                            'PATCH',
                            { status: value }
                        );
                        const rosterLoaded = await loadRoster(session.id);
                        const sessionsLoaded = await loadSessions();
                        const reportLoaded = await loadAttendanceReport();
                        if (rosterLoaded && sessionsLoaded && reportLoaded) {
                            showAttendanceMessage('Attendance updated.');
                        }
                    } catch (error) {
                        showAttendanceMessage(error.message, true);
                    } finally {
                        actions.querySelectorAll('button').forEach(item => {
                            item.disabled = false;
                        });
                    }
                });
                actions.appendChild(button);
            });

            row.append(identity, actions);
            list.appendChild(row);
            actions.insertBefore(status, actions.firstChild);
        });
        return true;
    } catch (error) {
        list.replaceChildren();
        addAttendanceText(list, 'p', 'attendance-empty', error.message);
        showAttendanceMessage(error.message, true);
        return false;
    }
}

async function createAttendanceSession(event) {
    event.preventDefault();
    const form = document.getElementById('sessionForm');
    const submit = form.querySelector('button[type="submit"]');
    const studentIds = Array.from(
        form.querySelectorAll('input[name="studentIds"]:checked'),
        input => Number(input.value)
    );

    submit.disabled = true;
    try {
        await attendanceRequest('/attendance/sessions', 'POST', {
            className: document.getElementById('className').value.trim(),
            date: document.getElementById('classDate').value,
            studentIds
        });
        form.reset();
        showAttendanceMessage('Class session created.');
        await loadSessions();
    } catch (error) {
        showAttendanceMessage(error.message, true);
    } finally {
        submit.disabled = false;
    }
}

function getAttendanceGroups(records) {
    const groups = new Map();

    records.forEach((record) => {
        const name = String(record.className || 'Other classes').trim();
        if (!groups.has(name)) {
            groups.set(name, {
                name,
                present: 0,
                absent: 0,
                unmarked: 0,
                records: []
            });
        }

        const group = groups.get(name);
        group.records.push(record);

        if (record.status === 'present') group.present++;
        else if (record.status === 'absent') group.absent++;
        else group.unmarked++;
    });

    return Array.from(groups.values()).map((group) => {
        // Unmarked sessions are excluded until the instructor marks them.
        const total = group.present + group.absent;
        const percentage = total
            ? (group.present / total) * 100
            : null;

        let classesNeeded = null;
        if (percentage !== null && percentage < 75) {
            classesNeeded = Math.ceil(
                (75 * total - 100 * group.present) / 25
            );
        }

        return { ...group, total, percentage, classesNeeded };
    });
}

function attendanceStatus(percentage) {
    if (percentage === null) {
        return {
            label: 'Awaiting records',
            className: 'status-pending'
        };
    }

    if (percentage < 75) {
        return {
            label: 'Below 75%',
            className: 'status-low'
        };
    }

    if (percentage < 80) {
        return {
            label: 'Target reached — stay alert',
            className: 'status-caution'
        };
    }

    return {
        label: 'On track',
        className: 'status-good'
    };
}

async function loadMyAttendance() {
    try {
        const records = await attendanceRequest('/attendance/mine');
        if (!records) return;

        const list = document.getElementById('myAttendance');
        const summary = document.getElementById('attendanceSummary');
        const alerts = document.getElementById('attendanceAlerts');

        list.replaceChildren();
        summary.replaceChildren();
        alerts.replaceChildren();

        const groups = getAttendanceGroups(records);
        const markedRecords = records.filter(
            record => record.status === 'present' ||
                record.status === 'absent'
        );

        const presentCount = markedRecords.filter(
            record => record.status === 'present'
        ).length;

        const overall = markedRecords.length
            ? (presentCount / markedRecords.length) * 100
            : null;

        const stats = [
            {
                label: 'Overall attendance',
                value: overall === null ? '—' : `${overall.toFixed(1)}%`,
                icon: '◉'
            },
            {
                label: 'Classes attended',
                value: String(presentCount),
                icon: '✓'
            },
            {
                label: 'Classes recorded',
                value: String(markedRecords.length),
                icon: '▦'
            },
            {
                label: 'Subjects tracked',
                value: String(groups.length),
                icon: '◇'
            }
        ];

        stats.forEach((stat) => {
            const card = document.createElement('article');
            card.className = 'attendance-stat-card';

            const icon = document.createElement('span');
            icon.className = 'attendance-stat-icon';
            icon.textContent = stat.icon;

            const label = document.createElement('p');
            label.textContent = stat.label;

            const value = document.createElement('strong');
            value.textContent = stat.value;

            card.append(icon, label, value);
            summary.appendChild(card);
        });

        const lowGroups = groups.filter(
            group => group.percentage !== null &&
                group.percentage < 75
        );

        if (lowGroups.length) {
            lowGroups.forEach((group) => {
                const alert = document.createElement('div');
                alert.className = 'attendance-alert attendance-alert-low';

                const title = document.createElement('strong');
                title.textContent = `⚠ ${group.name}: ${group.percentage.toFixed(1)}%`;

                const detail = document.createElement('p');
                detail.textContent =
                    `Attendance is below 75%. Attend the next ${group.classesNeeded} ` +
                    `class${group.classesNeeded === 1 ? '' : 'es'} consecutively ` +
                    `to reach at least 75%, assuming no further absences.`;

                alert.append(title, detail);
                alerts.appendChild(alert);
            });
        } else if (!groups.some(group => group.total > 0)) {
            alerts.textContent =
                'Your attendance reminders will appear once classes are marked.';
            alerts.className = 'attendance-empty';
        } else {
            const alert = document.createElement('div');
            alert.className = 'attendance-alert attendance-alert-good';

            const title = document.createElement('strong');
            title.textContent = '✓ No subject is below 75%.';

            const detail = document.createElement('p');
            detail.textContent =
                'Keep attending classes to maintain your attendance.';
            alert.append(title, detail);
            alerts.appendChild(alert);
        }

        if (!records.length) {
            list.textContent = 'No attendance records yet.';
            list.className = 'attendance-empty';
            return;
        }

        groups.forEach((group) => {
            const card = document.createElement('article');
            card.className = 'attendance-subject';

            const top = document.createElement('div');
            top.className = 'attendance-subject-top';

            const identity = document.createElement('div');
            identity.className = 'attendance-identity';

            const name = document.createElement('strong');
            name.textContent = group.name;

            const detail = document.createElement('small');
            detail.textContent =
                `${group.present} present · ${group.absent} absent` +
                (group.unmarked ? ` · ${group.unmarked} unmarked` : '');

            identity.append(name, detail);

            const percent = document.createElement('strong');
            percent.className = 'attendance-percent';
            percent.textContent = group.percentage === null
                ? '—'
                : `${group.percentage.toFixed(1)}%`;

            top.append(identity, percent);

            const track = document.createElement('div');
            track.className = 'attendance-progress-track';

            const bar = document.createElement('div');
            bar.className = 'attendance-progress-fill';

            const percentage = group.percentage ?? 0;
            bar.style.width = `${Math.min(100, percentage)}%`;
            bar.classList.add(
                percentage < 75 ? 'progress-low' :
                    percentage < 80 ? 'progress-caution' : 'progress-good'
            );
            track.appendChild(bar);

            const status = attendanceStatus(group.percentage);
            const badge = document.createElement('span');
            badge.className = `attendance-status-badge ${status.className}`;
            badge.textContent = status.label;

            const footer = document.createElement('div');
            footer.className = 'attendance-subject-footer';
            footer.appendChild(badge);

            if (group.classesNeeded !== null) {
                const needed = document.createElement('small');
                needed.textContent =
                    `${group.classesNeeded} consecutive class` +
                    `${group.classesNeeded === 1 ? '' : 'es'} needed`;
                footer.appendChild(needed);
            }

            card.append(top, track, footer);
            list.appendChild(card);
        });

        list.className = 'attendance-subject-list';

    } catch (error) {
        showAttendanceMessage(error.message, true);
    }
}

function initializeAttendance() {
    if (!attendanceToken || !attendanceUser) {
        window.location.href = 'login.html';
        return;
    }

    if (attendanceUser.role === 'instructor') {
        document.getElementById('instructorView').hidden = false;
        initializeAttendanceReports();
        document.getElementById('sessionForm').addEventListener(
            'submit', createAttendanceSession
        );
        const today = new Date();
        today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
        document.getElementById('classDate').value = today.toISOString().slice(0, 10);
        loadStudents();
        loadSessions();
        return;
    }

    document.getElementById('studentView').hidden = false;
    initializeAttendanceReports();
    loadMyAttendance();
}

initializeAttendance();
