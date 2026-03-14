const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const ML_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

// GET /api/recommendations/:userId
// Returns top-6 recommendations + top-3 influencers with attention weights (normalized to %)
router.get('/recommendations/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const likes = await pool.query(
            `SELECT i.id AS item_id, i.image_url, i.category, i.product_name, i.year, i.embedding
             FROM items i
             JOIN interactions int ON i.id = int.item_id
             WHERE int.user_id = $1 AND int.action = 'like'
             ORDER BY int.id ASC`,
            [userId]
        );

        if (likes.rows.length === 0) {
            return res.json({ items: [], influencers: [] });
        }

        const likedItems = likes.rows;
        const sequence = likedItems.map(row => JSON.parse(row.embedding));

        const mlResponse = await fetch(`${ML_URL}/predict_taste`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vectors: sequence })
        });

        if (!mlResponse.ok) throw new Error(`ML Service error: ${mlResponse.status}`);

        const { predicted_vector, attention_weights } = await mlResponse.json();

        // Top 3 influencers with normalized influence percentage
        const scored = likedItems.map((item, idx) => ({
            item_id: item.item_id,
            image_url: item.image_url,
            category: item.category,
            product_name: item.product_name,
            influence_score: attention_weights[idx] ?? 0
        })).sort((a, b) => b.influence_score - a.influence_score);

        const maxScore = scored[0]?.influence_score || 1;
        const influencers = scored.slice(0, 3).map(inf => ({
            ...inf,
            influence_pct: Math.round((inf.influence_score / maxScore) * 100)
        }));

        const formatVector = `[${predicted_vector.join(',')}]`;
        const recs = await pool.query(
            `SELECT id, image_url, category, product_name, year,
                    (embedding <=> $2::vector) AS distance
             FROM items
             WHERE id NOT IN (
                 SELECT item_id FROM interactions WHERE user_id = $1 AND action = 'like'
             )
             ORDER BY distance ASC
             LIMIT 6`,
            [userId, formatVector]
        );

        res.json({ items: recs.rows, influencers });
    } catch (err) {
        console.error('Recommendations error:', err);
        res.status(500).json({ error: 'Failed to generate recommendations' });
    }
});

module.exports = router;
