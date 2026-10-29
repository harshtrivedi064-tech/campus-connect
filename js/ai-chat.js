const AI_API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';
const aiToken = localStorage.getItem('token');
const chatHistory = [];

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

function appendChatMessage(role, text) {
    const message = document.createElement('div');
    message.className = `ai-message ${role}`;
    message.textContent = text;
    document.getElementById('chatMessages').appendChild(message);
    message.scrollIntoView({ block: 'nearest' });
    return message;
}

function setChatStatus(text, isError = false) {
    const status = document.getElementById('chatStatus');
    status.textContent = text;
    status.classList.toggle('error', isError);
}

async function requestAIReply(messages) {
    const response = await fetch(`${AI_API}/ai/chat`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${aiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages })
    });

    if (response.status === 401) {
        logout();
        throw new Error('Please log in again.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Could not get an AI response. Please try again.');
    }
    if (typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error('The AI returned an empty response. Please try again.');
    }
    return data.answer.trim();
}

async function sendChatMessage(event) {
    event.preventDefault();
    const input = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendChat');
    const clearButton = document.getElementById('clearChat');
    const prompt = input.value.trim();

    if (!prompt) {
        setChatStatus('Type a message first.', true);
        return;
    }

    const nextHistory = [...chatHistory, { role: 'user', text: prompt }];
    while (nextHistory.length > 12) nextHistory.splice(0, 2);

    const userMessage = appendChatMessage('user', prompt);
    input.disabled = true;
    sendButton.disabled = true;
    clearButton.disabled = true;
    document.querySelectorAll('.ai-suggestions button').forEach(button => {
        button.disabled = true;
    });
    setChatStatus('Thinking...');

    try {
        const answer = await requestAIReply(nextHistory);
        chatHistory.splice(0, chatHistory.length, ...nextHistory, {
            role: 'model',
            text: answer
        });
        while (chatHistory.length > 12) chatHistory.splice(0, 2);
        appendChatMessage('assistant', answer);
        input.value = '';
        document.getElementById('chatCounter').textContent = '0 / 4000 · Enter to send';
        setChatStatus('');
    } catch (error) {
        userMessage.remove();
        setChatStatus(error.message, true);
    } finally {
        input.disabled = false;
        sendButton.disabled = false;
        clearButton.disabled = false;
        document.querySelectorAll('.ai-suggestions button').forEach(button => {
            button.disabled = false;
        });
        input.focus();
    }
}

function resetChat() {
    chatHistory.length = 0;
    document.getElementById('chatMessages').replaceChildren();
    document.getElementById('chatInput').value = '';
    document.getElementById('chatCounter').textContent = '0 / 4000 · Enter to send';
    setChatStatus('');
    appendChatMessage('assistant',
        'Hi! I’m your Campus Loop study companion. What would you like help with?');
}

function initializeAIChat() {
    if (!aiToken) {
        window.location.replace('login.html');
        return;
    }

    document.getElementById('aiLogout').addEventListener('click', event => {
        event.preventDefault();
        logout();
    });
    document.getElementById('chatForm').addEventListener('submit', sendChatMessage);
    document.getElementById('clearChat').addEventListener('click', resetChat);

    const input = document.getElementById('chatInput');
    input.addEventListener('input', () => {
        document.getElementById('chatCounter').textContent =
            `${input.value.length} / 4000 · Enter to send`;
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            document.getElementById('chatForm').requestSubmit();
        }
    });

    document.querySelectorAll('.ai-suggestions button').forEach(button => {
        button.addEventListener('click', () => {
            input.value = button.dataset.prompt || '';
            input.dispatchEvent(new Event('input'));
            input.focus();
        });
    });

    resetChat();
}

initializeAIChat();
