const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /api/boards/:userId — list user's boards with item counts + cover thumbnails
router.get('/boards/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT b.id, b.name, COUNT(i.item_id) AS item_count
             FROM boards b
             LEFT JOIN interactions i ON i.board_id = b.id AND i.action = 'like'
             WHERE b.user_id = $1
             GROUP BY b.id, b.name
             ORDER BY b.created_at DESC`,
            [userId]
        );

        // Fetch up to 4 cover thumbnails per board
        const boards = await Promise.all(result.rows.map(async board => {
            const thumbs = await pool.query(
                `SELECT items.image_url FROM items
                 JOIN interactions ON items.id = interactions.item_id
                 WHERE interactions.board_id = $1 AND interactions.action = 'like'
                 ORDER BY interactions.id ASC LIMIT 4`,
                [board.id]
            );
            return { ...board, thumbnails: thumbs.rows.map(r => r.image_url) };
        }));

        res.json(boards);
    } catch (err) {
        console.error('Boards error:', err);
        res.status(500).json({ error: 'Failed to fetch boards' });
    }
});

// POST /api/boards — create a board
router.post('/boards', async (req, res) => {
    const { userId, name } = req.body;
    if (!userId || !name) return res.status(400).json({ error: 'userId and name required' });
    try {
        const result = await pool.query(
            'INSERT INTO boards (user_id, name) VALUES ($1, $2) RETURNING id, name',
            [userId, name.trim()]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Create board error:', err);
        res.status(500).json({ error: 'Failed to create board' });
    }
});

// DELETE /api/boards/:boardId
router.delete('/boards/:boardId', async (req, res) => {
    const { boardId } = req.params;
    try {
        await pool.query('UPDATE interactions SET board_id = NULL WHERE board_id = $1', [boardId]);
        await pool.query('DELETE FROM boards WHERE id = $1', [boardId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete board error:', err);
        res.status(500).json({ error: 'Failed to delete board' });
    }
});

// PATCH /api/interactions/board — assign a liked item to a board
router.patch('/interactions/board', async (req, res) => {
    const { userId, itemId, boardId } = req.body;
    try {
        await pool.query(
            'UPDATE interactions SET board_id = $3 WHERE user_id = $1 AND item_id = $2 AND action = $4',
            [userId, itemId, boardId, 'like']
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Board assign error:', err);
        res.status(500).json({ error: 'Failed to assign board' });
    }
});

// GET /api/boards/:userId/:boardId/items
router.get('/boards/:userId/:boardId/items', async (req, res) => {
    const { userId, boardId } = req.params;
    try {
        const result = await pool.query(
            `SELECT i.id, i.image_url, i.category, i.product_name, i.year, int.rating
             FROM items i
             JOIN interactions int ON i.id = int.item_id
             WHERE int.user_id = $1 AND int.board_id = $2 AND int.action = 'like'
             ORDER BY int.id ASC`,
            [userId, boardId]
        );
        res.json({ items: result.rows });
    } catch (err) {
        console.error('Board items error:', err);
        res.status(500).json({ error: 'Failed to fetch board items' });
    }
});

// GET /api/boards/:userId/:boardId/recommendations
// Computes the centroid of the board's item embeddings, then finds similar unseen movies.
router.get('/boards/:userId/:boardId/recommendations', async (req, res) => {
    const { userId, boardId } = req.params;
    try {
        const boardItems = await pool.query(
            `SELECT i.embedding
             FROM items i
             JOIN interactions int ON i.id = int.item_id
             WHERE int.user_id = $1 AND int.board_id = $2 AND int.action = 'like'`,
            [userId, boardId]
        );

        if (boardItems.rows.length === 0) {
            return res.json({ items: [] });
        }

        // Compute the centroid (average embedding) of all items in this board
        const embeddings = boardItems.rows.map(r => JSON.parse(r.embedding));
        const dim = embeddings[0].length;
        const centroid = new Array(dim).fill(0);
        for (const emb of embeddings) {
            for (let i = 0; i < dim; i++) centroid[i] += emb[i];
        }
        for (let i = 0; i < dim; i++) centroid[i] /= embeddings.length;

        // L2-normalize so cosine distance via <=> works correctly
        const norm = Math.sqrt(centroid.reduce((s, v) => s + v * v, 0));
        const normalized = norm > 0 ? centroid.map(v => v / norm) : centroid;
        const formatVector = `[${normalized.join(',')}]`;

        // Find closest items not already in this board
        const recs = await pool.query(
            `SELECT id, image_url, category, product_name, year,
                    (embedding <=> $1::vector) AS distance
             FROM items
             WHERE id NOT IN (
                 SELECT item_id FROM interactions
                 WHERE user_id = $2 AND board_id = $3 AND action = 'like'
             )
             ORDER BY distance ASC
             LIMIT 6`,
            [formatVector, userId, boardId]
        );

        res.json({ items: recs.rows });
    } catch (err) {
        console.error('Board recs error:', err);
        res.status(500).json({ error: 'Failed to fetch board recommendations' });
    }
});

module.exports = router;
