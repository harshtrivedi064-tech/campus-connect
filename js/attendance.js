
function escapeAttendanceText(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
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
