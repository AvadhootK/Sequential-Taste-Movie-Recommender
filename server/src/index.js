require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', require('./routes/feed'));
app.use('/api', require('./routes/ratings'));
app.use('/api', require('./routes/recommendations'));
app.use('/api', require('./routes/trajectory'));
app.use('/api', require('./routes/similar'));
app.use('/api', require('./routes/signals'));
app.use('/api', require('./routes/boards'));
app.use('/api', require('./routes/search'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
