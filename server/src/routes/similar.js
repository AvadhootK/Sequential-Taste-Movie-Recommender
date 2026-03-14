const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /api/similar/:itemId?userId=X&limit=8
// Returns movies visually similar to itemId using CLIP embedding cosine distance
router.get('/similar/:itemId', async (req, res) => {
    const { itemId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 8, 20);
    const { userId } = req.query;

    try {
        const item = await pool.query(
            'SELECT id, product_name, category, image_url, year, embedding FROM items WHERE id = $1',
            [itemId]
        );
        if (item.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

        const { embedding, product_name, category } = item.rows[0];

        let query, params;
        if (userId) {
            query = `
                SELECT id, image_url, category, product_name, year,
                       (embedding <=> $2::vector) AS distance
                FROM items
                WHERE id != $1
                  AND id NOT IN (SELECT item_id FROM interactions WHERE user_id = $4 AND action = 'like')
                ORDER BY distance ASC
                LIMIT $3`;
            params = [itemId, embedding, limit, userId];
        } else {
            query = `
                SELECT id, image_url, category, product_name, year,
                       (embedding <=> $2::vector) AS distance
                FROM items
                WHERE id != $1
                ORDER BY distance ASC
                LIMIT $3`;
            params = [itemId, embedding, limit];
        }

        const result = await pool.query(query, params);
        res.json({ source: { id: item.rows[0].id, product_name, category }, similar: result.rows });
    } catch (err) {
        console.error('Similar error:', err);
        res.status(500).json({ error: 'Failed to find similar items' });
    }
});

module.exports = router;
