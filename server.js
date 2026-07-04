const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 5000; 

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'questions.json');

function readQuestions() {
    if (!fs.existsSync(DATA_FILE)) {
        return [];
    }
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch (err) {
        return [];
    }
}

function writeQuestions(questions) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(questions, null, 2));
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/questions', (req, res) => {
    const questions = readQuestions();
    res.json(questions);
});

app.post('/api/questions/upload', (req, res) => {
    const { courseName, trm, year, fileUrl, adminEmail } = req.body;

    if (!courseName || !adminEmail) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const questions = readQuestions();
    const newQuestion = {
        id: Date.now().toString(),
        courseName,
        trm,
        year,
        fileUrl: fileUrl || '#',
        adminEmail,
        status: 'Synced',
        uploadedAt: new Date().toISOString()
    };

    questions.push(newQuestion);
    writeQuestions(questions);

    res.json({ success: true, question: newQuestion });
});

app.listen(PORT, () => {
    console.log(`Admin server running on port ${PORT}`);
});
