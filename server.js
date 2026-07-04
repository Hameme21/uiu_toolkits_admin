const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 5000; 

// Enable cross-origin resource sharing so uiu_toolkits can post data
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'questions.json');

// Helper function to securely read the saved question array
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

// Helper function to write updates to the file system
function writeQuestions(questions) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(questions, null, 2));
}

// API endpoint for the admin panel to view all questions
app.get('/api/questions', (req, res) => {
    const questions = readQuestions();
    res.json(questions);
});

// API endpoint for uiu_toolkits to submit new questions
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
    console.log(`Admin server running on http://localhost:${PORT}`);
});
