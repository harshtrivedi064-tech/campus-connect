const API = window.location.protocol === 'file:' ||
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';
const token = localStorage.getItem('token');

let questions = [];
let selectedAnswers = [];
let reviewFlags = [];
let submitted = false;
let submitting = false;
let currentQuestion = 0;
let historyId = null;
let quizSettings = null;
let quizResult = null;
let timerInterval = null;
let expiresAt = null;
let saveTimeout = null;
let answerSaveQueue = Promise.resolve();

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

async function apiRequest(path, method = 'GET', body) {
    const headers = { Authorization: `Bearer ${token}` };
    const options = { method, headers };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(API + path, options);
    if (response.status === 401) {
        logout();
        throw new Error('Please log in again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to complete the request.');
    return data;
}

function validateQuestions(rawQuestions) {
    if (!Array.isArray(rawQuestions)) return [];
    const seen = new Set();
    const normalized = [];

    rawQuestions.forEach(question => {
        if (!question || typeof question.question !== 'string' ||
            !Array.isArray(question.options) || question.options.length !== 4 ||
            !Number.isInteger(question.answer) || question.answer < 0 ||
            question.answer > 3) return;

        const prompt = question.question.trim();
        const options = question.options.map(option =>
            typeof option === 'string' ? option.trim() : '');
        const key = prompt.toLocaleLowerCase().replace(/\s+/g, ' ');
        const explanation = typeof question.explanation === 'string'
            ? question.explanation.trim() : '';
        if (!prompt || prompt.length > 500 || options.some(option => !option || option.length > 300) ||
            new Set(options.map(option => option.toLocaleLowerCase())).size !== 4 ||
            !explanation || explanation.length > 1200 || seen.has(key)) return;

        seen.add(key);
        normalized.push({
            question: prompt,
            options,
            answer: question.answer,
            explanation,
            evidence: typeof question.evidence === 'string' ? question.evidence : '',
            difficulty: ['easy', 'medium', 'hard'].includes(question.difficulty)
                ? question.difficulty : 'medium'
        });
    });
    return normalized;
}

function updateFileSelection() {
    const input = document.getElementById('pdfFile');
    document.getElementById('fileName').textContent =
        input.files[0] ? input.files[0].name : 'No file selected';
    document.getElementById('removeFile').hidden = !input.files[0];
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
    if (!file || !isPdf(file)) {
        setStatus('Choose a PDF file to continue.', 'error');
        return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.getElementById('pdfFile').files = transfer.files;
    updateFileSelection();
}

function addText(parent, tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(value ?? '');
    parent.appendChild(element);
    return element;
}

function renderQuestion(question, index) {
    const card = document.createElement('article');
    card.className = 'mcq-q-card';
    const number = addText(card, 'div', 'mcq-q-number',
        `Question ${index + 1} · ${question.difficulty}`);
    number.setAttribute('aria-label', `Question ${index + 1}, ${question.difficulty} difficulty`);
    addText(card, 'p', 'mcq-q-text', question.question);

    question.options.forEach((option, optionIndex) => {
        const button = addText(card, 'button', 'mcq-option',
            `${String.fromCharCode(65 + optionIndex)}) ${option}`);
        button.type = 'button';
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
                renderPalette();
                queueAnswerSave();
            });
        }
    });

    if (submitted) {
        const isCorrect = selectedAnswers[index] === question.answer;
        addText(card, 'p', 'mcq-answer-feedback',
            isCorrect ? 'Correct answer.' :
                `Correct answer: ${String.fromCharCode(65 + question.answer)}.`);
        addText(card, 'p', 'mcq-answer-feedback', question.explanation);
        if (question.evidence) addText(card, 'p', 'mcq-answer-feedback mcq-evidence',
            `Source evidence: “${question.evidence}”`);
    }
    return card;
}

function currentLayout() {
    if (quizSettings?.mode === 'exam') return 'single';
    return document.getElementById('quizMode').value;
}

function renderPalette() {
    const palette = document.getElementById('questionPalette');
    palette.replaceChildren();
    palette.hidden = !questions.length;
    questions.forEach((question, index) => {
        const button = addText(palette, 'button', 'mcq-palette-item', index + 1);
        button.type = 'button';
        button.classList.add(selectedAnswers[index] === null ? 'unanswered' : 'answered');
        if (index === currentQuestion) button.classList.add('current');
        if (reviewFlags[index]) button.classList.add('review');
        button.setAttribute('aria-label',
            `Question ${index + 1}, ${selectedAnswers[index] === null ? 'unanswered' : 'answered'}` +
            `${reviewFlags[index] ? ', marked for review' : ''}`);
        button.setAttribute('aria-current', String(index === currentQuestion));
        button.addEventListener('click', () => {
            currentQuestion = index;
            renderQuiz();
            document.querySelector('#quiz .mcq-q-card')?.scrollIntoView({ block: 'nearest' });
        });
    });
}

function updateProgress() {
    const total = questions.length;
    const answered = selectedAnswers.filter(answer => answer !== null).length;
    const progress = document.getElementById('quizProgress');
    const progressBar = document.getElementById('progressBar');
    progress.hidden = !total;
    progressBar.max = total || 1;
    progressBar.value = answered;
    document.getElementById('progressLabel').textContent =
        submitted ? `Submitted · ${total} questions` : `${answered} of ${total} answered`;
    document.getElementById('answeredSummary').textContent =
        `${answered} answered · ${total - answered} remaining`;
    document.getElementById('questionPosition').textContent =
        `Question ${currentQuestion + 1} of ${total}`;
}

function renderQuiz() {
    const quiz = document.getElementById('quiz');
    const hasQuestions = questions.length > 0;
    const layout = currentLayout();
    quiz.replaceChildren();
    document.getElementById('emptyState').hidden = hasQuestions;
    document.getElementById('quizControls').hidden = !hasQuestions || submitted;
    document.getElementById('stepControls').hidden = !hasQuestions || layout !== 'single' || submitted;
    document.getElementById('submitQuiz').hidden = submitted;
    document.getElementById('restartQuiz').hidden = !submitted;
    document.getElementById('examToolbar').hidden = !hasQuestions || submitted || quizSettings?.mode !== 'exam';
    document.getElementById('scoreBar').hidden = !submitted;
    document.getElementById('resultDetails').hidden = !submitted;
    document.getElementById('markForReview').hidden = !hasQuestions || submitted;
    document.getElementById('markForReview').textContent =
        reviewFlags[currentQuestion] ? '★ Marked for review' : '☆ Mark for review';

    if (!hasQuestions) {
        document.getElementById('quizProgress').hidden = true;
        document.getElementById('questionPalette').hidden = true;
        return;
    }

    const indexes = layout === 'single' ? [currentQuestion] : questions.map((item, index) => index);
    indexes.forEach(index => quiz.appendChild(renderQuestion(questions[index], index)));
    document.getElementById('previousQuestion').disabled = currentQuestion === 0;
    document.getElementById('nextQuestion').disabled = currentQuestion === questions.length - 1;
    updateProgress();
    renderPalette();
    if (submitted) renderResults();
}

function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remaining = value % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
        : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function localResult() {
    const total = questions.length;
    const correct = selectedAnswers.filter((answer, index) =>
        answer === questions[index].answer).length;
    const unanswered = selectedAnswers.filter(answer => answer === null).length;
    const incorrect = total - correct - unanswered;
    const byDifficulty = { easy: { total: 0, correct: 0 }, medium: { total: 0, correct: 0 }, hard: { total: 0, correct: 0 } };
    questions.forEach((question, index) => {
        byDifficulty[question.difficulty].total++;
        if (selectedAnswers[index] === question.answer) byDifficulty[question.difficulty].correct++;
    });
    const elapsed = quizSettings?.mode === 'exam'
        ? Math.min(Math.floor((Date.now() - new Date(quizSettings.startedAt).getTime()) / 1000),
            quizSettings.durationSeconds)
        : Math.floor((Date.now() - new Date(quizSettings.startedAt).getTime()) / 1000);
    return {
        total, correct, incorrect, unanswered,
        totalMarks: Math.max(0, correct - incorrect * quizSettings.negativeMarking),
        accuracy: total ? Math.round(correct / total * 100) : 0,
        timeTakenSeconds: elapsed,
        byDifficulty
    };
}

function renderResults() {
    if (!quizResult) return;
    const score = document.getElementById('scoreBar');
    score.replaceChildren();
    addText(score, 'strong', '', `Results · ${quizResult.correct} of ${quizResult.total} correct`);
    addText(score, 'span', 'mcq-result-detail',
        `${quizResult.incorrect} incorrect · ${quizResult.unanswered} unanswered`);

    const details = document.getElementById('resultDetails');
    details.replaceChildren();
    const stats = document.createElement('div');
    stats.className = 'mcq-result-summary';
    [
        ['Total questions', quizResult.total],
        ['Correct answers', quizResult.correct],
        ['Incorrect answers', quizResult.incorrect],
        ['Unattempted', quizResult.unanswered],
        ['Total marks', `${quizResult.totalMarks} / ${quizResult.total}`],
        ['Accuracy', `${quizResult.accuracy}%`],
        ['Time taken', formatDuration(quizResult.timeTakenSeconds)]
    ].forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'mcq-result-stat';
        addText(item, 'strong', '', value);
        addText(item, 'span', '', label);
        stats.appendChild(item);
    });
    details.appendChild(stats);

    const difficulty = document.createElement('div');
    difficulty.className = 'mcq-difficulty-results';
    Object.entries(quizResult.byDifficulty || {}).forEach(([level, result]) => {
        const item = document.createElement('div');
        const accuracy = result.total
            ? Math.round(result.correct / result.total * 100) : 0;
        addText(item, 'strong', '', `${level[0].toUpperCase()}${level.slice(1)}`);
        addText(item, 'p', '', `${result.correct} / ${result.total} correct · ${accuracy}%`);
        difficulty.appendChild(item);
    });
    details.appendChild(difficulty);

    const actions = document.createElement('div');
    actions.className = 'mcq-quiz-controls';
    const print = addText(actions, 'button', 'mcq-control', 'Download results PDF');
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    const retry = addText(actions, 'button', 'mcq-control primary', 'Retry incorrect questions');
    retry.type = 'button';
    retry.disabled = !quizResult.incorrect;
    retry.addEventListener('click', retryIncorrect);
    details.appendChild(actions);

    addText(details, 'h3', 'mcq-review-heading', 'Answer review');
    questions.forEach((question, index) => {
        const correct = selectedAnswers[index] === question.answer;
        const card = document.createElement('article');
        card.className = `mcq-review-answer ${correct ? 'correct' : 'incorrect'}`;
        addText(card, 'strong', '', `Question ${index + 1} · ${correct ? 'Correct' : 'Review'}`);
        addText(card, 'p', '', question.question);
        addText(card, 'p', '', `Your answer: ${
            selectedAnswers[index] === null
                ? 'Not answered'
                : question.options[selectedAnswers[index]]
        }`);
        addText(card, 'p', '', `Correct answer: ${question.options[question.answer]}`);
        addText(card, 'p', '', question.explanation);
        if (question.evidence) addText(card, 'p', 'mcq-evidence', `Source evidence: “${question.evidence}”`);
        details.appendChild(card);
    });
}

function showCompletedQuiz(data) {
    submitted = true;
    submitting = false;
    if (data.quizId) historyId = data.quizId;
    quizResult = data.result || localResult();
    selectedAnswers = Array.isArray(data.answers) ? data.answers : selectedAnswers;
    stopTimer();
    renderQuiz();
    document.getElementById('resultDetails').scrollIntoView({ block: 'nearest' });
}

function queueAnswerSave() {
    if (!historyId || submitted) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveAnswersNow().catch(error => setStatus(error.message, 'error'));
    }, 250);
}

function saveAnswersNow() {
    clearTimeout(saveTimeout);
    if (!historyId || submitted) return Promise.resolve(null);
    const answers = selectedAnswers.slice();
    answerSaveQueue = answerSaveQueue.catch(() => null).then(() =>
        apiRequest(`/mcq/history/${encodeURIComponent(historyId)}/answers`, 'PUT', { answers }));
    return answerSaveQueue;
}

function stopTimer() {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = null;
}

function startTimer(deadline) {
    stopTimer();
    expiresAt = deadline ? new Date(deadline).getTime() : null;
    if (!expiresAt) return;
    const timer = document.getElementById('examTimer');
    const tick = () => {
        const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        timer.textContent = `Time remaining · ${formatDuration(remaining)}`;
        timer.classList.toggle('warning', remaining <= 60);
        if (remaining <= 0) {
            stopTimer();
            submitQuiz(true);
        }
    };
    tick();
    timerInterval = window.setInterval(tick, 1000);
}

async function submitQuiz(auto = false) {
    if (!questions.length || submitted || submitting) return;
    if (!auto && !window.confirm('Submit this quiz now? You will not be able to change your answers.')) {
        return;
    }
    submitting = true;
    stopTimer();
    const submit = document.getElementById('submitQuiz');
    submit.disabled = true;
    setStatus(auto ? 'Time is up. Submitting your exam…' : 'Submitting your answers…');
    try {
        const saved = await saveAnswersNow();
        if (saved?.result) {
            showCompletedQuiz({ result: saved.result, answers: saved.answers || selectedAnswers });
        } else {
            const result = await apiRequest(
                `/mcq/history/${encodeURIComponent(historyId)}/submit`,
                'POST',
                { answers: selectedAnswers }
            );
            showCompletedQuiz(result);
        }
        setStatus(auto ? 'Time expired. Your exam was submitted automatically.' : 'Your quiz was submitted.', 'success');
        await loadHistory();
    } catch (error) {
        if (auto) {
            quizResult = localResult();
            submitted = true;
            renderQuiz();
        } else if (quizSettings?.mode === 'exam' && expiresAt > Date.now()) {
            startTimer(expiresAt);
        }
        setStatus(`Unable to save the result: ${error.message}`, 'error');
    } finally {
        submitting = false;
        submit.disabled = false;
    }
}

function moveQuestion(delta) {
    const next = currentQuestion + delta;
    if (next < 0 || next >= questions.length) return;
    currentQuestion = next;
    renderQuiz();
    document.querySelector('#quiz .mcq-q-card')?.scrollIntoView({ block: 'nearest' });
}

async function createHistoryRecord(metadata) {
    const result = await apiRequest('/mcq/history', 'POST', {
        ...metadata,
        questions
    });
    historyId = result.id;
    quizSettings.startedAt = result.startedAt;
    if (quizSettings.mode === 'exam') startTimer(result.expiresAt);
}

async function generate(event) {
    event.preventDefault();
    const source = document.getElementById('generationSource').value;
    const file = document.getElementById('pdfFile').files[0];
    const count = Number(document.getElementById('qCount').value);
    const subject = document.getElementById('subject').value.trim();
    const chapter = document.getElementById('chapter').value.trim();
    const topic = document.getElementById('topic').value.trim();
    const difficulty = document.getElementById('difficulty').value;
    const mode = document.getElementById('examMode').value;
    const durationSeconds = mode === 'exam'
        ? Number(document.getElementById('examDuration').value) * 60 : 0;
    const negativeMarking = Number(document.getElementById('negativeMarking').value);
    const button = document.getElementById('generateBtn');

    if (source === 'pdf' && !file) {
        setStatus('Please choose a PDF file first.', 'error');
        return;
    }
    if (source === 'pdf' && !isPdf(file)) {
        setStatus('Choose a PDF file to continue.', 'error');
        return;
    }
    if (source === 'pdf' && file.size > 10 * 1024 * 1024) {
        setStatus('PDF is too large (maximum 10 MB).', 'error');
        return;
    }
    if (source === 'topic' && !subject && !chapter && !topic) {
        setStatus('Enter a subject, chapter, or topic to generate questions.', 'error');
        return;
    }

    const fields = { count, subject, chapter, topic, difficulty };
    const requestBody = source === 'pdf' ? new FormData() : fields;
    if (source === 'pdf') {
        Object.entries(fields).forEach(([key, value]) => requestBody.append(key, value));
        requestBody.append('pdf', file);
    }

    button.disabled = true;
    button.textContent = 'Generating questions…';
    setStatus('Preparing your question set…');
    questions = [];
    selectedAnswers = [];
    reviewFlags = [];
    submitted = false;
    historyId = null;
    quizResult = null;
    quizSettings = { mode, durationSeconds, negativeMarking, startedAt: new Date().toISOString() };
    stopTimer();
    renderQuiz();

    try {
        const response = await fetch(`${API}/mcq${source === 'topic' ? '/topic' : ''}`, {
            method: 'POST',
            headers: source === 'topic'
                ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
                : { Authorization: `Bearer ${token}` },
            body: source === 'topic' ? JSON.stringify(requestBody) : requestBody
        });
        if (response.status === 401) {
            logout();
            return;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setStatus(data.error || 'Unable to generate questions. Please try again.', 'error');
            return;
        }
        questions = validateQuestions(data.questions);
        if (!questions.length) {
            setStatus('The AI returned malformed or duplicate questions. Try again with different study material.', 'error');
            return;
        }
        selectedAnswers = questions.map(() => null);
        reviewFlags = questions.map(() => false);
        quizSettings = {
            mode,
            durationSeconds,
            negativeMarking,
            subject,
            chapter,
            topic,
            source: data.source || 'topic',
            title: topic || chapter || subject || file?.name?.replace(/\.pdf$/i, '') || 'Practice quiz'
        };
        if (mode === 'exam') document.getElementById('quizMode').value = 'single';
        try {
            await createHistoryRecord(quizSettings);
        } catch (error) {
            questions = [];
            selectedAnswers = [];
            setStatus(`Questions were generated but could not be saved to quiz history: ${error.message}`, 'error');
            renderQuiz();
            return;
        }

        const sourceName = data.source === 'gemini' ? 'Gemini' : 'local PDF extraction';
        const countMessage = questions.length < count
            ? ` The material produced ${questions.length} of ${count} requested questions.` : '';
        const focusMessage = data.source !== 'gemini' && (subject || chapter || topic)
            ? ' Local extraction does not apply subject, chapter, or topic focus.' : '';
        setStatus(
            `${sourceName} created ${questions.length} questions.${countMessage}${focusMessage}`,
            'success'
        );
        renderQuiz();
        await loadHistory();
    } catch (error) {
        console.error('MCQ generation failed:', error);
        setStatus(`Could not generate questions: ${error.message}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = '✦ Generate MCQs';
    }
}

async function retryIncorrect() {
    const retryQuestions = questions.filter((question, index) =>
        selectedAnswers[index] !== null && selectedAnswers[index] !== question.answer);
    if (!retryQuestions.length) return;
    const metadata = {
        title: `${quizSettings.title} · retry incorrect`,
        subject: quizSettings.subject,
        chapter: quizSettings.chapter,
        topic: quizSettings.topic,
        source: quizSettings.source,
        mode: 'practice',
        durationSeconds: 0,
        negativeMarking: 0
    };
    try {
        questions = retryQuestions;
        selectedAnswers = questions.map(() => null);
        reviewFlags = questions.map(() => false);
        submitted = false;
        quizResult = null;
        quizSettings = { ...metadata, startedAt: new Date().toISOString() };
        await createHistoryRecord(metadata);
        currentQuestion = 0;
        renderQuiz();
        setStatus('Retry set is ready. Take another look at these questions.', 'success');
        await loadHistory();
    } catch (error) {
        setStatus(`Unable to save retry quiz: ${error.message}`, 'error');
    }
}

async function loadHistory() {
    const container = document.getElementById('quizHistory');
    try {
        const history = await apiRequest('/mcq/history?limit=10');
        container.replaceChildren();
        if (!history.length) {
            addText(container, 'p', 'mcq-muted', 'Your completed and in-progress quizzes will appear here.');
            return;
        }
        history.forEach(item => {
            const row = document.createElement('article');
            row.className = 'mcq-history-item';
            const copy = document.createElement('div');
            copy.className = 'mcq-history-copy';
            addText(copy, 'strong', '', item.title || 'Practice quiz');
            addText(copy, 'span', '', [
                item.subject,
                item.chapter,
                `${item.questionCount} questions`,
                item.mode,
                item.result ? `${item.result.accuracy}% accuracy` : 'In progress',
                new Date(item.startedAt).toLocaleDateString()
            ].filter(Boolean).join(' · '));
            const actions = document.createElement('div');
            actions.className = 'mcq-history-actions';
            const open = addText(actions, 'button', 'mcq-control',
                item.result ? 'Review' : 'Continue');
            open.type = 'button';
            open.addEventListener('click', () => openHistoryQuiz(item.id, false));
            const retake = addText(actions, 'button', 'mcq-control primary', 'Retake');
            retake.type = 'button';
            retake.addEventListener('click', () => openHistoryQuiz(item.id, true));
            row.append(copy, actions);
            container.appendChild(row);
        });
    } catch (error) {
        container.replaceChildren();
        addText(container, 'p', 'mcq-muted mcq-status error',
            `Unable to load quiz history: ${error.message}`);
    }
}

async function openHistoryQuiz(id, retake) {
    try {
        let quiz;
        if (retake) {
            const created = await apiRequest(`/mcq/history/${encodeURIComponent(id)}/retake`, 'POST', {});
            quiz = await apiRequest(`/mcq/history/${encodeURIComponent(created.id)}`);
        } else {
            quiz = await apiRequest(`/mcq/history/${encodeURIComponent(id)}`);
        }
        questions = validateQuestions(quiz.questions);
        if (!questions.length) throw new Error('This saved quiz does not contain valid questions.');
        historyId = quiz.id;
        selectedAnswers = Array.isArray(quiz.answers) ? quiz.answers : questions.map(() => null);
        reviewFlags = questions.map(() => false);
        submitted = Boolean(quiz.completedAt);
        quizResult = quiz.result || null;
        currentQuestion = 0;
        quizSettings = {
            mode: quiz.mode,
            durationSeconds: quiz.durationSeconds,
            negativeMarking: quiz.negativeMarking,
            startedAt: quiz.startedAt,
            title: quiz.title,
            subject: quiz.subject,
            chapter: quiz.chapter,
            topic: quiz.topic,
            source: quiz.source
        };
        if (submitted) stopTimer();
        else if (quiz.mode === 'exam') startTimer(quiz.expiresAt);
        renderQuiz();
        setStatus(retake ? 'A new attempt has been saved.' : 'Quiz loaded from your history.',
            'success');
        document.getElementById('quiz').scrollIntoView({ block: 'start' });
        await loadHistory();
    } catch (error) {
        setStatus(`Unable to open quiz: ${error.message}`, 'error');
    }
}

function updateSourceControls() {
    const topicSource = document.getElementById('generationSource').value === 'topic';
    document.getElementById('pdfSourceFields').hidden = topicSource;
    document.getElementById('pdfFile').required = !topicSource;
    const mode = document.getElementById('examMode').value;
    document.getElementById('examSettings').hidden = mode !== 'exam';
    const allQuestions = document.querySelector('#quizMode option[value="all"]');
    allQuestions.disabled = mode === 'exam';
    if (mode === 'exam') document.getElementById('quizMode').value = 'single';
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
    document.getElementById('submitQuiz').addEventListener('click', () => submitQuiz(false));
    document.getElementById('restartQuiz').addEventListener('click', () =>
        openHistoryQuiz(historyId, true));
    document.getElementById('previousQuestion').addEventListener('click', () => moveQuestion(-1));
    document.getElementById('nextQuestion').addEventListener('click', () => moveQuestion(1));
    document.getElementById('markForReview').addEventListener('click', () => {
        reviewFlags[currentQuestion] = !reviewFlags[currentQuestion];
        renderQuiz();
    });
    document.getElementById('quizMode').addEventListener('change', renderQuiz);
    document.getElementById('examMode').addEventListener('change', updateSourceControls);
    document.getElementById('generationSource').addEventListener('change', updateSourceControls);
    document.getElementById('refreshHistory').addEventListener('click', loadHistory);

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

    updateSourceControls();
    loadHistory();
}

initializeMCQ();
