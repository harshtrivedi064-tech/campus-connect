const API = window.location.protocol === 'file:' ||
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';

const token = localStorage.getItem('token');
let questions = [];
let selectedAnswers = [];
let submitted = false;
let currentQuestion = 0;

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

function setStatus(text, state = '') {
    const status = document.getElementById('status');
    status.textContent = text;
    status.classList.toggle('error', state === 'error');
    status.classList.toggle('success', state === 'success');
}

function validateQuestions(rawQuestions) {
    if (!Array.isArray(rawQuestions)) return [];

    const seen = new Set();
    const normalized = [];
    rawQuestions.forEach(question => {
        if (!question || typeof question.question !== 'string' ||
            !Array.isArray(question.options) || question.options.length !== 4 ||
            !Number.isInteger(question.answer) || question.answer < 0 ||
            question.answer > 3) {
            return;
        }

        const prompt = question.question.trim();
        const options = question.options.map(option =>
            typeof option === 'string' ? option.trim() : '');
        const normalizedPrompt = prompt.toLocaleLowerCase().replace(/\s+/g, ' ');
        if (!prompt || options.some(option => !option) ||
            new Set(options.map(option => option.toLocaleLowerCase())).size !== 4 ||
            seen.has(normalizedPrompt)) {
            return;
        }

        seen.add(normalizedPrompt);
        normalized.push({
            question: prompt,
            options,
            answer: question.answer,
            explanation: typeof question.explanation === 'string'
                ? question.explanation.trim()
                : ''
        });
    });
    return normalized;
}

function updateFileSelection() {
    const fileInput = document.getElementById('pdfFile');
    const fileName = document.getElementById('fileName');
    const removeButton = document.getElementById('removeFile');
    const file = fileInput.files[0];
    fileName.textContent = file ? file.name : 'No file selected';
    removeButton.hidden = !file;
    setStatus('');
}

function clearFileSelection() {
    document.getElementById('pdfFile').value = '';
    updateFileSelection();
}

function isPdf(file) {
    return /\.pdf$/i.test(file.name) &&
        (!file.type || file.type === 'application/pdf');
}

function acceptDroppedFile(file) {
    const input = document.getElementById('pdfFile');
    if (!file || !isPdf(file)) {
        setStatus('Choose a PDF file to continue.', 'error');
        return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    updateFileSelection();
}

function renderQuestion(question, index) {
    const card = document.createElement('article');
    card.className = 'mcq-q-card';

    const number = document.createElement('div');
    number.className = 'mcq-q-number';
    number.textContent = `Question ${index + 1}`;
    card.appendChild(number);

    const title = document.createElement('p');
    title.className = 'mcq-q-text';
    title.textContent = question.question;
    card.appendChild(title);

    question.options.forEach((option, optionIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mcq-option';
        button.textContent = `${String.fromCharCode(65 + optionIndex)}) ${option}`;
        button.setAttribute('aria-pressed', String(selectedAnswers[index] === optionIndex));
        if (selectedAnswers[index] === optionIndex) button.classList.add('selected');

        if (submitted) {
            button.disabled = true;
            if (optionIndex === question.answer) button.classList.add('correct');
            if (selectedAnswers[index] === optionIndex && optionIndex !== question.answer) {
                button.classList.add('wrong');
            }
        } else {
            button.addEventListener('click', () => {
                selectedAnswers[index] = optionIndex;
                card.querySelectorAll('.mcq-option').forEach((choice, choiceIndex) => {
                    const selected = choiceIndex === optionIndex;
                    choice.classList.toggle('selected', selected);
                    choice.setAttribute('aria-pressed', String(selected));
                });
                updateProgress();
            });
        }
        card.appendChild(button);
    });

    if (submitted) {
        const feedback = document.createElement('p');
        feedback.className = 'mcq-answer-feedback';
        const isCorrect = selectedAnswers[index] === question.answer;
        feedback.textContent = isCorrect
            ? 'Correct answer.'
            : `Correct answer: ${String.fromCharCode(65 + question.answer)}.`;
        if (question.explanation) {
            feedback.appendChild(document.createElement('br'));
            feedback.appendChild(document.createTextNode(question.explanation));
        }
        card.appendChild(feedback);
    }

    return card;
}

function updateProgress() {
    const total = questions.length;
    const answeredCount = selectedAnswers.filter(answer => answer !== null).length;
    const progress = document.getElementById('quizProgress');
    const progressBar = document.getElementById('progressBar');
    const progressLabel = document.getElementById('progressLabel');

    progress.hidden = !total;
    progressBar.max = total || 1;
    progressBar.value = submitted ? total : answeredCount;
    progressLabel.textContent = submitted
        ? `Quiz submitted · ${total} questions`
        : `${answeredCount} of ${total} answered`;

    const position = document.getElementById('questionPosition');
    if (total && document.getElementById('quizMode').value === 'single') {
        position.textContent = `Question ${currentQuestion + 1} of ${total}`;
    }
}

function renderQuiz() {
    const quiz = document.getElementById('quiz');
    const emptyState = document.getElementById('emptyState');
    const controls = document.getElementById('quizControls');
    const stepControls = document.getElementById('stepControls');
    const scoreBar = document.getElementById('scoreBar');
    const quizMode = document.getElementById('quizMode').value;

    quiz.replaceChildren();
    emptyState.hidden = questions.length > 0;
    controls.hidden = questions.length === 0;
    stepControls.hidden = questions.length === 0 || quizMode !== 'single';
    scoreBar.hidden = !submitted;
    document.getElementById('submitQuiz').hidden = submitted;
    document.getElementById('restartQuiz').hidden = !submitted;

    if (!questions.length) {
        document.getElementById('quizProgress').hidden = true;
        return;
    }

    const questionIndexes = quizMode === 'single'
        ? [currentQuestion]
        : questions.map((question, index) => index);
    questionIndexes.forEach(index => {
        quiz.appendChild(renderQuestion(questions[index], index));
    });

    document.getElementById('previousQuestion').disabled = currentQuestion === 0;
    document.getElementById('nextQuestion').disabled = currentQuestion === questions.length - 1;
    document.getElementById('questionPosition').textContent =
        `Question ${currentQuestion + 1} of ${questions.length}`;
    updateProgress();

    if (submitted) {
        const correct = selectedAnswers.filter((answer, index) =>
            answer === questions[index].answer).length;
        const unanswered = selectedAnswers.filter(answer => answer === null).length;
        const incorrect = questions.length - correct - unanswered;
        const percentage = Math.round((correct / questions.length) * 100);
        scoreBar.replaceChildren(
            document.createTextNode(`Results: ${correct} / ${questions.length} correct (${percentage}%).`),
            document.createTextNode(' '),
            Object.assign(document.createElement('span'), {
                className: 'mcq-result-detail',
                textContent: `${incorrect} incorrect · ${unanswered} unanswered`
            })
        );
        scoreBar.hidden = false;
    }
}

function submitQuiz() {
    if (!questions.length || submitted) return;
    submitted = true;
    renderQuiz();
    document.getElementById('scoreBar').scrollIntoView({ block: 'nearest' });
}

function moveQuestion(delta) {
    const next = currentQuestion + delta;
    if (next < 0 || next >= questions.length) return;
    currentQuestion = next;
    renderQuiz();
    document.querySelector('#quiz .mcq-q-card')?.scrollIntoView({ block: 'nearest' });
}

async function generate(event) {
    event.preventDefault();
    const fileInput = document.getElementById('pdfFile');
    const file = fileInput.files[0];
    const count = document.getElementById('qCount').value;
    const button = document.getElementById('generateBtn');

    if (!file) {
        setStatus('Please choose a PDF file first.', 'error');
        return;
    }
    if (!isPdf(file)) {
        setStatus('Choose a PDF file to continue.', 'error');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        setStatus('PDF is too large (maximum 10 MB).', 'error');
        return;
    }

    const form = new FormData();
    form.append('count', count);
    form.append('topic', document.getElementById('topic').value.trim());
    form.append('difficulty', document.getElementById('difficulty').value);
    form.append('pdf', file);

    button.disabled = true;
    button.textContent = 'Generating questions...';
    setStatus('Uploading PDF and preparing your questions...');
    questions = [];
    selectedAnswers = [];
    submitted = false;
    currentQuestion = 0;
    renderQuiz();

    try {
        const response = await fetch(`${API}/mcq`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setStatus(data.error || 'The server could not process this PDF. Please try another file.', 'error');
            return;
        }

        questions = validateQuestions(data.questions);
        if (!questions.length) {
            setStatus('The server did not return valid questions. Try another PDF or generate the quiz again.', 'error');
            return;
        }

        selectedAnswers = questions.map(() => null);
        const pages = Number.isInteger(data.pages) && data.pages > 0 ? data.pages : null;
        let message = data.source === 'gemini'
            ? `Gemini created ${questions.length} questions`
            : `Created ${questions.length} questions using local document extraction`;
        if (pages) message += ` from ${pages} page${pages === 1 ? '' : 's'}`;
        message += '.';
        if (data.source !== 'gemini' &&
            (document.getElementById('topic').value.trim() ||
                document.getElementById('difficulty').value !== 'balanced')) {
            message += ' Topic and difficulty settings are only applied when Gemini is configured.';
        }
        if (questions.length < Number(count)) {
            message += ` The document produced ${questions.length} of the ${count} requested questions.`;
        }
        setStatus(message, 'success');
        renderQuiz();
    } catch (error) {
        console.error(error);
        setStatus('Cannot reach the MCQ server. Check that the backend is running, then try again.', 'error');
    } finally {
        button.disabled = false;
        button.textContent = '✦ Generate MCQs';
    }
}

function initializeMCQ() {
    if (!token) {
        window.location.replace('login.html');
        return;
    }

    document.getElementById('mcqForm').addEventListener('submit', generate);
    document.getElementById('mcqLogout').addEventListener('click', event => {
        event.preventDefault();
        logout();
    });
    document.getElementById('pdfFile').addEventListener('change', updateFileSelection);
    document.getElementById('removeFile').addEventListener('click', clearFileSelection);
    document.getElementById('submitQuiz').addEventListener('click', submitQuiz);
    document.getElementById('restartQuiz').addEventListener('click', () => {
        selectedAnswers = questions.map(() => null);
        submitted = false;
        currentQuestion = 0;
        renderQuiz();
    });
    document.getElementById('previousQuestion').addEventListener('click', () => moveQuestion(-1));
    document.getElementById('nextQuestion').addEventListener('click', () => moveQuestion(1));
    document.getElementById('quizMode').addEventListener('change', renderQuiz);

    const uploadZone = document.getElementById('uploadZone');
    uploadZone.addEventListener('dragover', event => {
        event.preventDefault();
        uploadZone.classList.add('dragging');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));
    uploadZone.addEventListener('drop', event => {
        event.preventDefault();
        uploadZone.classList.remove('dragging');
        acceptDroppedFile(event.dataTransfer.files[0]);
    });
}

initializeMCQ();
