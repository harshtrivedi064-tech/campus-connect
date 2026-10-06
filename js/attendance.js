const API = 'http://localhost:3000';
const token = localStorage.getItem('token');
const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
let selectedSessionId = null;

if (!token || !currentUser) {
    window.location.href = 'login.html';
} else {
    document.getElementById(currentUser.role === 'instructor' ? 'instructorView' : 'studentView').hidden = false;
    if (currentUser.role === 'instructor') {
        initializeInstructorView();
    } else {
        loadMyAttendance();
    }
}

async function attendanceRequest(path, method, body) {
    const response = await fetch(API + path, {
        method: method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();

    if (response.status === 401) {
        logout();
        return null;
    }
    if (!response.ok) {
        throw new Error(data.error || 'Could not complete the attendance request.');
    }
    return data;
}

function showAttendanceMessage(text, isError) {
    const message = document.getElementById('attendanceMessage');
    message.textContent = text;
    message.classList.toggle('error', Boolean(isError));
}

async function initializeInstructorView() {
    try {
        const students = await attendanceRequest('/attendance/students');
        const choices = document.getElementById('studentChoices');

        if (!students.length) {
            choices.textContent = 'No student accounts are registered yet.';
        } else {
            students.forEach((student) => {
                const label = document.createElement('label');
                label.className = 'student-choice';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = student.id;
                checkbox.name = 'studentIds';
                const details = document.createElement('span');
                details.textContent = `${student.name} (${student.email})`;
                label.append(checkbox, details);
                choices.appendChild(label);
            });
        }

        await loadSessions();
    } catch (error) {
        showAttendanceMessage(error.message, true);
    }

    document.getElementById('sessionForm').addEventListener('submit', createSession);
}

async function createSession(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const studentIds = Array.from(form.querySelectorAll('input[name="studentIds"]:checked'))
        .map((checkbox) => Number(checkbox.value));

    try {
        const session = await attendanceRequest('/attendance/sessions', 'POST', {
            className: document.getElementById('className').value,
            date: document.getElementById('classDate').value,
            studentIds
        });
        form.reset();
        showAttendanceMessage('Class session created. Mark each student present or absent.');
        await loadSessions();
        await openSession(session.id);
    } catch (error) {
        showAttendanceMessage(error.message, true);
    }
}

async function loadSessions() {
    const sessions = await attendanceRequest('/attendance/sessions');
    const list = document.getElementById('sessionList');
    list.replaceChildren();

    if (!sessions.length) {
        list.textContent = 'No class sessions yet. Create one above to take attendance.';
        return;
    }

    sessions.forEach((session) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'session-button';
        button.textContent = `${session.className} · ${session.date} · ${session.presentCount}/${session.studentCount} present`;
        button.addEventListener('click', () => openSession(session.id));
        list.appendChild(button);
    });
}

async function openSession(sessionId) {
    try {
        const session = await attendanceRequest('/attendance/sessions/' + encodeURIComponent(sessionId));
        selectedSessionId = session.id;
        document.getElementById('rosterSection').hidden = false;
        document.getElementById('rosterTitle').textContent = `${session.className} · ${session.date}`;
        const list = document.getElementById('rosterList');
        list.replaceChildren();

        session.records.forEach((record) => {
            const row = document.createElement('div');
            row.className = 'attendance-row';
            const identity = document.createElement('div');
            identity.className = 'attendance-identity';
            const name = document.createElement('strong');
            name.textContent = record.name;
            const email = document.createElement('small');
            email.textContent = record.email;
            identity.append(name, email);

            const status = document.createElement('span');
            status.className = 'attendance-status ' + record.status;
            status.textContent = record.status === 'unmarked'
                ? 'Not marked'
                : record.status.charAt(0).toUpperCase() + record.status.slice(1);

            const actions = document.createElement('div');
            actions.className = 'attendance-actions';
            ['present', 'absent'].forEach((value) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = value === 'present' ? 'Present' : 'Absent';
                button.className = value === record.status ? 'selected' : '';
                button.addEventListener('click', () => markAttendance(record.userId, value));
                actions.appendChild(button);
            });

            row.append(identity, status, actions);
            list.appendChild(row);
        });
    } catch (error) {
        showAttendanceMessage(error.message, true);
    }
}

async function markAttendance(studentId, status) {
    try {
        await attendanceRequest(
            `/attendance/sessions/${encodeURIComponent(selectedSessionId)}/records/${studentId}`,
            'PATCH',
            { status }
        );
        showAttendanceMessage('Attendance updated.');
        await openSession(selectedSessionId);
        await loadSessions();
    } catch (error) {
        showAttendanceMessage(error.message, true);
    }
}

async function loadMyAttendance() {
    try {
        const records = await attendanceRequest('/attendance/mine');
        const list = document.getElementById('myAttendance');
        list.replaceChildren();

        if (!records.length) {
            list.textContent = 'No attendance records yet.';
            return;
        }

        records.forEach((record) => {
            const row = document.createElement('div');
            row.className = 'attendance-row';
            const identity = document.createElement('div');
            identity.className = 'attendance-identity';
            const name = document.createElement('strong');
            name.textContent = record.className;
            const details = document.createElement('small');
            details.textContent = `${record.date} · Instructor: ${record.instructor}`;
            identity.append(name, details);
            const status = document.createElement('span');
            status.className = 'attendance-status ' + record.status;
            status.textContent = record.status === 'unmarked'
                ? 'Not marked'
                : record.status.charAt(0).toUpperCase() + record.status.slice(1);
            row.append(identity, status);
            list.appendChild(row);
        });
    } catch (error) {
        showAttendanceMessage(error.message, true);
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}
