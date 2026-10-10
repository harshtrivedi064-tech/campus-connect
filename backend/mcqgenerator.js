const STOPWORDS = new Set([
    'about', 'above', 'after', 'again', 'against', 'almost', 'along', 'already', 'also', 'although',
    'always', 'among', 'another', 'around', 'because', 'become', 'becomes', 'been', 'before', 'being',
    'below', 'between', 'both', 'cannot', 'could', 'does', 'doing', 'down', 'during', 'each', 'either',
    'enough', 'even', 'every', 'first', 'following', 'from', 'further', 'given', 'having', 'here',
    'however', 'including', 'into', 'itself', 'later', 'least', 'less', 'many', 'might', 'more', 'most',
    'much', 'must', 'neither', 'never', 'often', 'once', 'only', 'other', 'others', 'over', 'perhaps',
    'rather', 'same', 'second', 'several', 'shall', 'should', 'since', 'some', 'such', 'than', 'that',
    'their', 'them', 'then', 'there', 'therefore', 'these', 'they', 'thing', 'things', 'this', 'those',
    'though', 'through', 'thus', 'together', 'under', 'until', 'upon', 'using', 'usually', 'very',
    'well', 'were', 'what', 'when', 'where', 'whether', 'which', 'while', 'whose', 'will', 'with',
    'within', 'without', 'would', 'your', 'known', 'called', 'based', 'used', 'make', 'makes', 'made',
    'form', 'forms', 'part', 'parts', 'type', 'types', 'case', 'cases', 'example', 'examples'
]);

function shuffle(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function cleanText(text) {
    return text
        .replace(/\r/g, ' ')
        .replace(/-\n(?=[a-z])/g, '')   // join words split across lines
        .replace(/\s+/g, ' ')
        .trim();
}

function splitSentences(text) {
    const matches = text.match(/[^.!?]+[.!?]/g) || [];
    return matches
        .map(s => s.trim())
        .filter(s => {
            const words = s.split(' ').length;
            const digits = (s.match(/\d/g) || []).length;
            return (
                s.length >= 50 && s.length <= 250 &&
                words >= 8 && words <= 35 &&
                /^[A-Z]/.test(s) &&
                digits <= 6 &&
                !/http|www\./i.test(s)
            );
        });
}

function getWords(text) {
    return text.match(/[A-Za-z]{5,}/g) || [];
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCase(word, like) {
    if (like === like.toUpperCase()) return word.toUpperCase();
    if (like[0] === like[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
}

function pickDistractors(answer, sentence, pool) {
    const ansLower = answer.toLowerCase();
    const sentLower = sentence.toLowerCase();

    const candidates = pool.filter(w =>
        w !== ansLower &&
        !sentLower.includes(w) &&
        w.slice(0, 5) !== ansLower.slice(0, 5)
    );

    const similar = candidates.filter(w => Math.abs(w.length - ansLower.length) <= 3);
    const source = similar.length >= 3 ? similar : candidates;

    return shuffle(source).slice(0, 3).map(w => matchCase(w, answer));
}

function generateMCQs(rawText, count) {
    const text = cleanText(rawText);
    const sentences = splitSentences(text);

    // How often does each word appear in the whole document?
    const freq = {};
    getWords(text).forEach(w => {
        const lower = w.toLowerCase();
        if (STOPWORDS.has(lower)) return;
        freq[lower] = (freq[lower] || 0) + 1;
    });

    // Pool of important words (used as wrong options)
    const pool = Object.keys(freq)
        .sort((a, b) => freq[b] - freq[a])
        .slice(0, 100);

    if (sentences.length < 3 || pool.length < 8) {
        throw new Error('Not enough readable content to make questions. Try a PDF with more text.');
    }

    const order = shuffle(sentences.map((s, i) => ({ s, i })));
    const used = new Set();
    const questions = [];

    for (const { s, i } of order) {
        if (questions.length >= count) break;

        // Candidate answers: important words in this sentence
        const candidates = getWords(s)
            .filter(w => {
                const lower = w.toLowerCase();
                if (STOPWORDS.has(lower) || used.has(lower)) return false;
                if (s.toLowerCase().startsWith(lower)) return false;
                const occurrences = (s.match(new RegExp('\\b' + escapeRegex(w) + '\\b', 'gi')) || []).length;
                return occurrences === 1;
            })
            .sort((a, b) => (freq[b.toLowerCase()] || 0) - (freq[a.toLowerCase()] || 0) || b.length - a.length);

        if (candidates.length === 0) continue;

        const answer = candidates[0];
        const blanked = s.replace(new RegExp('\\b' + escapeRegex(answer) + '\\b', 'i'), '_____');
        if (blanked === s) continue;

        const distractors = pickDistractors(answer, s, pool);
        if (distractors.length < 3) continue;

        const options = shuffle([answer, ...distractors]);
        used.add(answer.toLowerCase());
        questions.push({
            idx: i,
            question: blanked,
            options: options,
            answer: options.indexOf(answer)
        });
    }

    if (questions.length === 0) {
        throw new Error('Could not make questions from this PDF. Try a PDF with longer text paragraphs.');
    }

    // Keep questions in the same order as the document
    questions.sort((a, b) => a.idx - b.idx);
    return questions.map(({ question, options, answer }) => ({ question, options, answer }));
}

module.exports = { generateMCQs };