const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST /api/rate — body: { userId, itemId, rating (1-5) }
// rating >= 4 → upsert as 'like'; rating < 4 → remove any existing like
router.post('/rate', async (req, res) => {
    const { userId, itemId, rating } = req.body;
    if (!userId || !itemId || !rating) {
        return res.status(400).json({ error: 'userId, itemId and rating are required' });
    }
    try {
        if (rating >= 4) {
            await pool.query(
                `INSERT INTO interactions (user_id, item_id, action, rating)
                 VALUES ($1, $2, 'like', $3)
                 ON CONFLICT (user_id, item_id) DO UPDATE SET rating = EXCLUDED.rating`,
                [userId, itemId, rating]
            );
        } else {
            await pool.query(
                'DELETE FROM interactions WHERE user_id = $1 AND item_id = $2',
                [userId, itemId]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Rate error:', err);
        res.status(500).json({ error: 'Failed to save rating' });
    }
});

// DELETE /api/rate — body: { userId, itemId }
router.delete('/rate', async (req, res) => {
    const { userId, itemId } = req.body;
    try {
        await pool.query(
            'DELETE FROM interactions WHERE user_id = $1 AND item_id = $2',
            [userId, itemId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Unrate error:', err);
        res.status(500).json({ error: 'Failed to remove rating' });
    }
});

// GET /api/ratings/:userId — returns { itemId: rating } map
router.get('/ratings/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            'SELECT item_id, rating FROM interactions WHERE user_id = $1 AND action = $2',
            [userId, 'like']
        );
        const ratingsMap = {};
        for (const row of result.rows) {
            ratingsMap[row.item_id] = row.rating;
        }
        res.json(ratingsMap);
    } catch (err) {
        console.error('Fetch ratings error:', err);
        res.status(500).json({ error: 'Failed to fetch ratings' });
    }
});

module.exports = router;
