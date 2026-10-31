function initializeHomeDashboard() {
    let user = null;
    try {
        user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (error) {
        user = null;
    }

    const token = localStorage.getItem('token');
    if (!token || !user || typeof user.name !== 'string' || !user.name.trim()) return;

    const greeting = document.getElementById('dashboardGreeting');
    greeting.textContent = `Welcome back, ${user.name.trim()}.`;
    greeting.hidden = false;

    const accountLink = document.getElementById('homeAccountLink');
    accountLink.href = 'feed.html';
    accountLink.replaceChildren(
        document.createTextNode('Open Feed '),
        Object.assign(document.createElement('span'), { textContent: '↗' })
    );
}

initializeHomeDashboard();
