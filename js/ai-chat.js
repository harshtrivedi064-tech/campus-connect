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

function renderInlineMarkdown(parent, text) {
    const tokenPattern = /(`[^`]+`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
    let position = 0;
    let match;

    while ((match = tokenPattern.exec(text))) {
        parent.appendChild(document.createTextNode(text.slice(position, match.index)));
        const token = match[0];
        let element;
        if (token.startsWith('`')) {
            element = document.createElement('code');
            element.textContent = token.slice(1, -1);
        } else if (token.startsWith('[')) {
            const href = match[3];
            try {
                const url = new URL(href);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    throw new Error('Unsupported link protocol.');
                }
                element = document.createElement('a');
                element.href = url.href;
                element.target = '_blank';
                element.rel = 'noopener noreferrer';
                element.textContent = match[2];
            } catch (error) {
                parent.appendChild(document.createTextNode(token));
                position = tokenPattern.lastIndex;
                continue;
            }
        } else if (token.startsWith('**') || token.startsWith('__')) {
            element = document.createElement('strong');
            element.textContent = token.slice(2, -2);
        } else {
            element = document.createElement('em');
            element.textContent = token.slice(1, -1);
        }
        parent.appendChild(element);
        position = tokenPattern.lastIndex;
    }

    parent.appendChild(document.createTextNode(text.slice(position)));
}

function isTableSeparator(line) {
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

function getTableCells(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function renderMarkdown(text) {
    const content = document.createElement('div');
    content.className = 'ai-message-content';
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
            index++;
            continue;
        }

        const fence = line.match(/^\s*```([\w+-]*)\s*$/);
        if (fence) {
            const codeLines = [];
            index++;
            while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
                codeLines.push(lines[index++]);
            }
            if (index < lines.length) index++;

            const wrapper = document.createElement('div');
            wrapper.className = 'ai-code-block';
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            if (fence[1]) code.dataset.language = fence[1];
            code.textContent = codeLines.join('\n');
            pre.appendChild(code);
            wrapper.appendChild(pre);

            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.className = 'ai-message-action ai-copy-code';
            copyButton.textContent = 'Copy code';
            copyButton.addEventListener('click', () => copyText(code.textContent, copyButton));
            wrapper.appendChild(copyButton);
            content.appendChild(wrapper);
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            const element = document.createElement(`h${heading[1].length + 1}`);
            renderInlineMarkdown(element, heading[2]);
            content.appendChild(element);
            index++;
            continue;
        }

        if (index + 1 < lines.length && line.includes('|') && isTableSeparator(lines[index + 1])) {
            const wrapper = document.createElement('div');
            wrapper.className = 'ai-table-wrap';
            const table = document.createElement('table');
            const head = document.createElement('thead');
            const headerRow = document.createElement('tr');
            getTableCells(line).forEach(cell => {
                const th = document.createElement('th');
                renderInlineMarkdown(th, cell);
                headerRow.appendChild(th);
            });
            head.appendChild(headerRow);
            table.appendChild(head);
            index += 2;

            const body = document.createElement('tbody');
            while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                const row = document.createElement('tr');
                getTableCells(lines[index++]).forEach(cell => {
                    const td = document.createElement('td');
                    renderInlineMarkdown(td, cell);
                    row.appendChild(td);
                });
                body.appendChild(row);
            }
            table.appendChild(body);
            wrapper.appendChild(table);
            content.appendChild(wrapper);
            continue;
        }

        const listMatch = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
        if (listMatch) {
            const ordered = /^\s*\d+[.)]/.test(line);
            const list = document.createElement(ordered ? 'ol' : 'ul');
            while (index < lines.length) {
                const item = lines[index].match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
                if (!item || /^\s*\d+[.)]/.test(lines[index]) !== ordered) break;
                const li = document.createElement('li');
                renderInlineMarkdown(li, item[1]);
                list.appendChild(li);
                index++;
            }
            content.appendChild(list);
            continue;
        }

        if (/^\s*>\s?/.test(line)) {
            const quote = document.createElement('blockquote');
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
                const paragraph = document.createElement('p');
                renderInlineMarkdown(paragraph, lines[index++].replace(/^\s*>\s?/, ''));
                quote.appendChild(paragraph);
            }
            content.appendChild(quote);
            continue;
        }

        const paragraphLines = [line];
        index++;
        while (index < lines.length && lines[index].trim() &&
            !/^\s*```/.test(lines[index]) &&
            !/^(#{1,6})\s+/.test(lines[index]) &&
            !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index]) &&
            !/^\s*>/.test(lines[index]) &&
            !(index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1]))) {
            paragraphLines.push(lines[index++]);
        }
        const paragraph = document.createElement('p');
        renderInlineMarkdown(paragraph, paragraphLines.join(' '));
        content.appendChild(paragraph);
    }

    return content;
}

async function copyText(text, button) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        setChatStatus('Copy is unavailable in this browser context.', true);
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        const originalLabel = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(() => {
            button.textContent = originalLabel;
        }, 1400);
    } catch (error) {
        setChatStatus('Could not copy to the clipboard. Check your browser permissions.', true);
    }
}

function appendChatMessage(role, text, withActions = false) {
    const message = document.createElement('div');
    message.className = `ai-message ${role}`;

    const body = role === 'assistant'
        ? renderMarkdown(text)
        : document.createElement('div');
    if (role !== 'assistant') {
        body.className = 'ai-message-content';
        body.textContent = text;
    }
    message.appendChild(body);

    if (withActions) {
        const actions = document.createElement('div');
        actions.className = 'ai-message-actions';
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'ai-message-action';
        copyButton.textContent = 'Copy response';
        copyButton.addEventListener('click', () => copyText(text, copyButton));
        actions.appendChild(copyButton);

        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'model') {
            const regenerateButton = document.createElement('button');
            regenerateButton.type = 'button';
            regenerateButton.className = 'ai-message-action';
            regenerateButton.textContent = 'Regenerate';
            regenerateButton.addEventListener('click', regenerateAnswer);
            actions.appendChild(regenerateButton);
        }
        message.appendChild(actions);
    }

    const messages = document.getElementById('chatMessages');
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
}

function setChatStatus(text, isError = false, retry = false) {
    const status = document.getElementById('chatStatus');
    status.replaceChildren(document.createTextNode(text));
    status.classList.toggle('error', isError);
    if (retry) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'ai-retry-button';
        retryButton.textContent = 'Retry';
        retryButton.addEventListener('click', () =>
            document.getElementById('chatForm').requestSubmit());
        status.appendChild(document.createTextNode(' '));
        status.appendChild(retryButton);
    }
}

function setChatBusy(busy) {
    document.getElementById('chatInput').disabled = busy;
    document.getElementById('sendChat').disabled = busy;
    document.getElementById('clearChat').disabled = busy;
    document.querySelectorAll('.ai-suggestions button, .ai-message-action').forEach(button => {
        button.disabled = busy;
    });
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
    const prompt = input.value.trim();

    if (!prompt) {
        setChatStatus('Type a message first.', true);
        return;
    }

    const nextHistory = [...chatHistory, { role: 'user', text: prompt }];
    while (nextHistory.length > 12) nextHistory.splice(0, 2);

    const userMessage = appendChatMessage('user', prompt);
    setChatBusy(true);
    setChatStatus('Thinking...');

    try {
        const answer = await requestAIReply(nextHistory);
        chatHistory.splice(0, chatHistory.length, ...nextHistory, {
            role: 'model',
            text: answer
        });
        while (chatHistory.length > 12) chatHistory.splice(0, 2);
        appendChatMessage('assistant', answer, true);
        input.value = '';
        document.getElementById('chatCounter').textContent = '0 / 4000 · Enter to send';
        setChatStatus('');
    } catch (error) {
        userMessage.remove();
        setChatStatus(error.message, true, true);
    } finally {
        setChatBusy(false);
        input.focus();
    }
}

async function regenerateAnswer() {
    const messages = chatHistory.slice(0, -1);
    if (!messages.length || messages[messages.length - 1].role !== 'user') return;

    setChatBusy(true);
    setChatStatus('Regenerating response...');
    try {
        const answer = await requestAIReply(messages);
        chatHistory[chatHistory.length - 1] = { role: 'model', text: answer };
        const assistantMessages = document.querySelectorAll('.ai-message.assistant');
        const lastMessage = assistantMessages[assistantMessages.length - 1];
        lastMessage.replaceWith(createAssistantMessage(answer));
        setChatStatus('');
    } catch (error) {
        setChatStatus(error.message, true);
    } finally {
        setChatBusy(false);
    }
}

function createAssistantMessage(text) {
    const message = document.createElement('div');
    message.className = 'ai-message assistant';
    message.appendChild(renderMarkdown(text));

    const actions = document.createElement('div');
    actions.className = 'ai-message-actions';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'ai-message-action';
    copyButton.textContent = 'Copy response';
    copyButton.addEventListener('click', () => copyText(text, copyButton));
    actions.appendChild(copyButton);

    const regenerateButton = document.createElement('button');
    regenerateButton.type = 'button';
    regenerateButton.className = 'ai-message-action';
    regenerateButton.textContent = 'Regenerate';
    regenerateButton.addEventListener('click', regenerateAnswer);
    actions.appendChild(regenerateButton);
    message.appendChild(actions);
    return message;
}

function resetChat() {
    if (chatHistory.length && !window.confirm('Start a new chat and clear this conversation?')) {
        return;
    }
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
