const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST /api/signal — record implicit signal (dwell, skip)
// body: { userId, itemId, signalType: 'dwell'|'skip', value: seconds }
router.post('/signal', async (req, res) => {
    const { userId, itemId, signalType, value } = req.body;
    if (!userId || !itemId || !signalType) {
        return res.status(400).json({ error: 'userId, itemId and signalType required' });
    }
    try {
        await pool.query(
            'INSERT INTO signals (user_id, item_id, signal_type, value) VALUES ($1, $2, $3, $4)',
            [userId, itemId, signalType, value || null]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Signal error:', err);
        res.status(500).json({ error: 'Failed to record signal' });
    }
});

module.exports = router;
