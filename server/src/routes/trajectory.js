const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const ML_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

// GET /api/trajectory/:userId
router.get('/trajectory/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const likes = await pool.query(
            `SELECT i.id AS item_id, i.image_url, i.category, i.product_name, i.embedding
             FROM items i
             JOIN interactions int ON i.id = int.item_id
             WHERE int.user_id = $1 AND int.action = 'like'
             ORDER BY int.id ASC`,
            [userId]
        );

        if (likes.rows.length === 0) {
            return res.json({ trajectory: [], predicted_next: null, has_enough_data: false });
        }

        const likedItems = likes.rows;
        const vectors = likedItems.map(row => JSON.parse(row.embedding));
        const item_ids = likedItems.map(row => row.item_id);
        const categories = likedItems.map(row => row.category);

        const mlResponse = await fetch(`${ML_URL}/trajectory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vectors, item_ids, categories })
        });

        if (!mlResponse.ok) {
            throw new Error(`ML Service returned status: ${mlResponse.status}`);
        }

        const data = await mlResponse.json();

        // Merge image_url back in (ML service doesn't store it)
        const metaMap = Object.fromEntries(likedItems.map(r => [r.item_id, { image_url: r.image_url, product_name: r.product_name }]));
        if (data.trajectory) {
            data.trajectory = data.trajectory.map(point => ({
                ...point,
                image_url: metaMap[point.item_id]?.image_url || null,
                product_name: metaMap[point.item_id]?.product_name || null,
            }));
        }

        res.json(data);
    } catch (err) {
        console.error('Trajectory error:', err);
        res.status(500).json({ error: 'Failed to compute trajectory' });
    }
});

module.exports = router;
