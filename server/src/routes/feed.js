const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const ML_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';
const MAX_PER_GENRE = 4; // diversity cap per category in the ranked feed

// Diversity-aware selection: from a ranked list, enforce max MAX_PER_GENRE per category
// while preserving overall relevance ordering as much as possible
function diversify(items, targetCount) {
    const genreCounts = {};
    const selected = [];
    const overflow = [];

    for (const item of items) {
        const genre = item.category || 'unknown';
        const count = genreCounts[genre] || 0;
        if (count < MAX_PER_GENRE && selected.length < targetCount) {
            selected.push(item);
            genreCounts[genre] = count + 1;
        } else {
            overflow.push(item);
        }
    }

    // Fill remaining slots with best-ranked overflow items
    while (selected.length < targetCount && overflow.length > 0) {
        selected.push(overflow.shift());
    }

    return selected;
}

// GET /api/feed/:userId
router.get('/feed/:userId', async (req, res) => {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    try {
        const likesResult = await pool.query(
            `SELECT i.embedding
             FROM items i
             JOIN interactions int ON i.id = int.item_id
             WHERE int.user_id = $1 AND int.action = 'like'
             ORDER BY int.id ASC`,
            [userId]
        );

        if (likesResult.rows.length === 0) {
            const [itemsResult, countResult] = await Promise.all([
                pool.query(
                    'SELECT id, image_url, category, product_name, year FROM items ORDER BY id ASC LIMIT $1 OFFSET $2',
                    [limit, offset]
                ),
                pool.query('SELECT COUNT(*) FROM items')
            ]);
            return res.json({
                items: itemsResult.rows,
                total: parseInt(countResult.rows[0].count),
                personalized: false
            });
        }

        const sequence = likesResult.rows.map(row => JSON.parse(row.embedding));
        const mlResponse = await fetch(`${ML_URL}/predict_taste`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vectors: sequence })
        });

        if (!mlResponse.ok) throw new Error(`ML service error: ${mlResponse.status}`);
        const { predicted_vector } = await mlResponse.json();
        const formatVector = `[${predicted_vector.join(',')}]`;

        // Fetch a larger pool (3x) so diversity selection has enough candidates
        const fetchCount = limit * 3;
        const [rankedResult, countResult] = await Promise.all([
            pool.query(
                `SELECT id, image_url, category, product_name, year,
                        (embedding <=> $2::vector) AS relevance_score
                 FROM items
                 WHERE id NOT IN (
                     SELECT item_id FROM interactions WHERE user_id = $1 AND action = 'like'
                 )
                 ORDER BY relevance_score ASC
                 LIMIT $3 OFFSET $4`,
                [userId, formatVector, fetchCount, offset]
            ),
            pool.query(
                `SELECT COUNT(*) FROM items
                 WHERE id NOT IN (
                     SELECT item_id FROM interactions WHERE user_id = $1 AND action = 'like'
                 )`,
                [userId]
            )
        ]);

        const diversified = diversify(rankedResult.rows, limit);

        res.json({
            items: diversified,
            total: parseInt(countResult.rows[0].count),
            personalized: true
        });
    } catch (err) {
        console.error('Feed error:', err);
        res.status(500).json({ error: 'Failed to fetch feed' });
    }
});

module.exports = router;
