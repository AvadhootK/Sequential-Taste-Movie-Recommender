const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const ML_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

const MOOD_GENRES = {
    'dark':         ['Thriller', 'Crime', 'Horror', 'Film-Noir'],
    'feel-good':    ['Comedy', 'Romance', 'Animation', "Children's"],
    'mind-bending': ['Sci-Fi', 'Mystery'],
    'epic':         ['Action', 'Adventure', 'Fantasy'],
    'award-bait':   ['Drama', 'War', 'Documentary'],
    'comfort':      ['Comedy', 'Musical', 'Animation'],
};

// Attempt to get a CLIP text embedding from the ML service.
// Returns a formatted pgvector string or null if the ML service is unavailable.
async function getTextVector(text) {
    try {
        const res = await fetch(`${ML_URL}/encode_text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const { vector } = await res.json();
        return `[${vector.join(',')}]`;
    } catch {
        return null;
    }
}

// GET /api/search?q=&genre=&mood=&limit=30
router.get('/search', async (req, res) => {
    const { q, genre, mood } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    try {
        // --- Text query: try CLIP semantic search first ---
        if (q && q.trim()) {
            const vector = await getTextVector(q.trim());

            if (vector) {
                // Build optional genre/mood filter to narrow semantic results
                const conditions = [];
                const params = [vector, limit];

                if (genre && genre.trim()) {
                    params.push(genre.trim());
                    conditions.push(`category = $${params.length}`);
                } else if (mood && MOOD_GENRES[mood]) {
                    const likeClauses = MOOD_GENRES[mood].map(g => {
                        params.push(`%${g}%`);
                        return `genres ILIKE $${params.length}`;
                    });
                    conditions.push(`(${likeClauses.join(' OR ')})`);
                }

                const whereClause = conditions.length > 0
                    ? `WHERE ${conditions.join(' AND ')}`
                    : '';

                const result = await pool.query(
                    `SELECT id, image_url, category, product_name, year, genres,
                            (embedding <=> $1::vector) AS distance
                     FROM items
                     ${whereClause}
                     ORDER BY distance ASC
                     LIMIT $2`,
                    params
                );
                return res.json({ items: result.rows, mode: 'semantic' });
            }

            // ML service unavailable — fall back to metadata ILIKE
            console.warn('ML service unavailable, falling back to ILIKE search');
            const params = [`%${q.trim()}%`];
            const result = await pool.query(
                `SELECT id, image_url, category, product_name, year, genres
                 FROM items
                 WHERE product_name ILIKE $1 OR genres ILIKE $1 OR category ILIKE $1
                 ORDER BY product_name ASC
                 LIMIT $2`,
                [...params, limit]
            );
            return res.json({ items: result.rows, mode: 'text' });
        }

        // --- Mood or genre filter only (no text query) ---
        const conditions = [];
        const params = [];

        if (genre && genre.trim()) {
            params.push(genre.trim());
            conditions.push(`category = $${params.length}`);
        } else if (mood && MOOD_GENRES[mood]) {
            const likeClauses = MOOD_GENRES[mood].map(g => {
                params.push(`%${g}%`);
                return `genres ILIKE $${params.length}`;
            });
            conditions.push(`(${likeClauses.join(' OR ')})`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const orderClause = conditions.length > 0 ? 'ORDER BY product_name ASC' : 'ORDER BY RANDOM()';
        params.push(limit);

        const result = await pool.query(
            `SELECT id, image_url, category, product_name, year, genres
             FROM items
             ${whereClause}
             ${orderClause}
             LIMIT $${params.length}`,
            params
        );
        res.json({ items: result.rows, mode: 'filter' });

    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
