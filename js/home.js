function initializeHomeDashboard() {
    let user = null;
    try {
        user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (error) {
        user = null;
    }

    const token = localStorage.getItem('token');
    if (token && user && typeof user.name === 'string' && user.name.trim()) {
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

    const dialog = document.getElementById('homeToolsDialog');
    const menuButton = document.getElementById('homeToolsButton');
    const closeButton = document.getElementById('closeHomeTools');
    const openDialog = () => {
        if (!dialog.open) {
            dialog.showModal();
            menuButton.setAttribute('aria-expanded', 'true');
        }
    };

    menuButton.addEventListener('click', openDialog);
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        menuButton.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('[data-open-home-tools]').forEach(button => {
        button.addEventListener('click', openDialog);
    });
    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
    });
}

initializeHomeDashboard();
