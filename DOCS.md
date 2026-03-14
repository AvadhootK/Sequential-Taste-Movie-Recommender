# Temporal Taste Engine 

## What is it?

A movie recommendation system that models how a user's taste evolves over time. Instead of treating all ratings equally, it treats them as a **temporal sequence** — your taste at step 10 matters more than at step 1. It's built around the same ideas Pinterest uses (CLIP embeddings + sequential modeling + board-based taste vectors).

---

## Architecture

```
Browser (React + Vite)
        |
        | HTTP
        v
Node.js API Server (Express)
        |              |
        | SQL           | HTTP
        v              v
  Supabase DB      ML Service (FastAPI / Python)
  (PostgreSQL +    - Transformer taste predictor
   pgvector)       - CLIP text encoder
                   - PCA trajectory computation
```

Three independent services:
- **Client** — React SPA, port 5173
- **Server** — Express REST API, port 3000
- **ML service** — FastAPI, port 8000

---

## Data

**Source:** MovieLens 100K (943 users, 1682 movies) + TMDB API for poster images

**Pipeline (`seed_movies.py`):**
1. Parse `ml-100k/u.item` — extract title, year, genres
2. For each movie: search TMDB → get poster URL
3. Download poster image → run through CLIP image encoder → 512-D embedding vector
4. Insert into `items` table: `id, product_name, year, category (primary genre), genres, image_url, embedding`
5. Parse `ml-100k/u.data` → import top 10 users' ratings ≥4 stars as `interactions`

**DB Schema:**
```
items       — id, product_name, year, category, genres, image_url, embedding (vector 512)
interactions — user_id, item_id, action ('like'), rating (1-5), board_id
users       — id, name
boards      — id, user_id, name, created_at
```

---

## Core ML: CLIP Embeddings

**What:** OpenAI's CLIP model encodes images into 512-dimensional vectors. Visually/semantically similar posters end up close together in this space.

**Why 512-D vectors:** pgvector's `<=>` operator computes cosine distance between vectors. "Find the 10 most similar movies to this poster" = ANN (approximate nearest neighbor) search in 512-D space.

**Key property:** CLIP puts text and images in the **same embedding space**. So `encode_text("dark thriller")` returns a vector you can search against movie poster vectors — cross-modal retrieval.

---

## Core ML: Transformer Taste Predictor

**The problem:** If you rated Drama → Action → Sci-Fi, your current taste is probably drifting toward Sci-Fi, not equally split across all three. A simple average loses this temporal signal.

**The solution:** A Transformer encoder treats your rated movies as a **sequence**. It uses self-attention to weight recent and contextually relevant items more heavily, then outputs a single 512-D "predicted taste vector" — a point in embedding space representing where your taste is headed.

**Architecture:**
- Input: sequence of CLIP embeddings (one per liked movie), ordered by rating timestamp
- Positional encoding: adds position info (step 1, 2, 3...) so the model knows order
- 2-layer Transformer encoder, 8 attention heads, d_model=512
- Output: last token's hidden state → linear layer → L2-normalized 512-D vector

**This predicted vector is used for:**
1. Feed ranking (`ORDER BY embedding <=> predicted_vector`)
2. Recommendations panel (top-6 closest unseen movies)
3. Trajectory "predicted next" point

---

## Feature: Personalized Feed

**Flow:**
```
GET /api/feed/:userId
  → fetch all liked embeddings (ordered by rating time)
  → POST /predict_taste → Transformer → predicted_vector (512-D)
  → SELECT items ORDER BY embedding <=> predicted_vector ASC
  → diversity filter (max 4 per genre, so feed isn't all Drama)
  → return 20 items
```

**Cold start:** If user has 0 ratings → returns unranked feed, `personalized: false`. No ML call.

**Diversity:** Fetches 3x more candidates than needed, then applies a genre cap (max 4 per category) so the feed stays varied even if the taste vector points strongly at one genre.

---

## Feature: Recommendations Panel ("Predicted for you")

Shows 6 recommendations + "Because you loved..." influencer chips.

**Influencer chips** use Transformer attention weights. The model's last encoder layer outputs attention weights — how much each past rating influenced the prediction. Top 3 highest-attention movies become the influencer chips with a visual influence bar.

**Why this matters for the interview:** This is interpretability. Instead of a black box, you can show *which ratings shaped the recommendation*. Pinterest calls this "taste signals."

---

## Feature: Taste Journey (Trajectory)

**The idea:** Plot how your taste center-of-gravity moved over time as you rated movies.

**Algorithm:**
1. For each step t, compute the cumulative mean of embeddings[0..t] — "taste center of gravity at this moment"
2. Run PCA on these N cumulative mean vectors → reduce to 2D
3. Return `{x, y, item_id, category}` per step + predicted next point

**Visualization:** SVG scatter plot. Each dot is the taste state after rating movie t. A polyline connects them in order. The predicted next point (from Transformer) shows as a dashed ring — where the model thinks you're headed.

**The cumulative mean approach:** Chosen over plotting raw embeddings because it shows *drift* — early ratings dominate less and less as the sequence grows. This makes the trajectory smooth and meaningful.

---

## Feature: Boards (PinnerSage)

**Concept directly from Pinterest's PinnerSage paper:** Users organize rated movies into named boards ("Dark Thrillers", "Feel Good"). Each board captures a distinct facet of taste.

**Board recommendations:**
```
GET /api/boards/:userId/:boardId/recommendations
  → fetch CLIP embeddings of all items in this board
  → compute centroid (average all vectors)
  → L2-normalize the centroid
  → SELECT items ORDER BY embedding <=> centroid ASC
  → return 6 closest unseen movies
```

**Why normalize:** pgvector's `<=>` computes cosine distance, which requires normalized vectors. Centering + normalizing gives the "average direction" in embedding space for this board's vibe.

---

## Feature: Search

**Three search modes:**

1. **Text query (semantic):** User types "find me something dark and psychological"
   - Server calls `/encode_text` on ML service → CLIP encodes the text → 512-D vector
   - pgvector search: `ORDER BY embedding <=> text_vector` → visually/semantically similar posters
   - Optionally filtered by genre or mood

2. **Mood chips** ("Dark & Intense", "Feel Good", etc.)
   - Each mood maps to a list of genres
   - Pure SQL: `WHERE genres ILIKE 'Thriller' OR genres ILIKE 'Crime' ...`
   - No ML call (fast)

3. **Genre pills** — direct SQL filter on `category`

**Cross-modal retrieval:** CLIP text + image live in the same 512-D space. "Dark thriller" as text is geometrically close to dark, moody poster images. This is why CLIP semantic search works without any labeled text-image training data specific to this dataset.

---

## Rating System

- **1-5 stars** — only ≥4 goes into the taste profile (written to `interactions` DB)
- **1-3 stars** — server deletes any existing interaction (removes from profile), but UI keeps the star state locally for the session
- **Unrate** — clicking the same star again sends `DELETE /api/rate`
- **Dwell signals** — hovering a card for >2s sends an implicit interest signal (stored in `signals` table)

**Why only ≥4:** At Pinterest scale, weak signals add noise. Keeping only strong positive signals (loved it) makes the taste profile higher quality.

---

## Signals: Explicit vs Implicit

| Signal | Type | How captured |
|--------|------|-------------|
| 4-5 star rating | Explicit, strong positive | POST /api/rate |
| 1-3 star rating | Explicit, negative/weak | Stored locally only |
| Dwell (hover >2s) | Implicit, mild interest | POST /api/signal |
| Board assignment | Explicit, contextual | PATCH /api/interactions/board |

---

## API Routes

| Route | What it does |
|-------|-------------|
| `GET /api/feed/:userId` | Personalized ranked feed |
| `GET /api/recommendations/:userId` | Top-6 recs + influencer chips |
| `GET /api/trajectory/:userId` | Taste journey data (PCA) |
| `POST /api/rate` | Submit rating (1-5) |
| `DELETE /api/rate` | Remove rating |
| `GET /api/ratings/:userId` | All ratings for UI state |
| `GET /api/search` | Semantic/mood/genre search |
| `GET /api/boards/:userId` | List boards |
| `POST /api/boards` | Create board |
| `DELETE /api/boards/:boardId` | Delete board |
| `PATCH /api/interactions/board` | Assign item to board |
| `GET /api/boards/:userId/:boardId/recommendations` | Board-level recs |

---

## ML Service Endpoints

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /predict_taste` | `{vectors: float[][]}` | `{predicted_vector, attention_weights}` |
| `POST /trajectory` | `{vectors, item_ids, categories}` | `{trajectory [{x,y,step,item_id,category}], predicted_next}` |
| `POST /encode_text` | `{text: string}` | `{vector: float[512]}` |

---

## Key Technical Decisions (interview talking points)

**Why CLIP for embeddings?**
It's trained on 400M image-text pairs. Without domain-specific training data, CLIP's visual representations are the best available proxy for "what this movie looks like / feels like." Two dark noir movies will cluster together; animated comedies will cluster separately.

**Why a Transformer over a simple average?**
Attention allows the model to weight relevant past ratings more than irrelevant ones. If you rated 10 dramas and then 2 thrillers, a naive average would still point at drama. Attention lets the model weight the recent shift toward thriller more heavily. The positional encoding ensures order matters.

**Why pgvector for ANN search?**
Keeps all logic in Postgres — no separate vector DB (Pinecone, Weaviate). pgvector's HNSW index makes nearest-neighbor search fast even at millions of vectors. For this scale (~1500 movies) it's exact, but the architecture scales.

**Why cumulative mean for trajectory?**
Plotting raw CLIP embeddings over time would be noisy (individual movies jump around). Cumulative mean smooths this — it represents "where my taste center of gravity is after N ratings." The drift between steps becomes interpretable: you can see "I started in comedy, drifted toward drama."

**Why boards?**
A user's global taste vector is a blunt instrument. Someone who loves both horror and musicals has contradictory signals that cancel out. Boards let them partition taste into coherent sub-profiles, each with its own centroid. This is exactly PinnerSage's insight: users have multiple taste facets.

---

## What's Not Production-Ready

- **Transformer weights:** Currently random initialization. Needs training on MovieLens sequences. Run `export_embeddings.py` → train in Colab → drop `transformer.pth` in `ml-service/weights/`.
- **No taste vector caching:** Every feed load calls the Transformer. Production would cache the predicted vector in `users.taste_vector` and only recompute on new ratings.
- **No HNSW index on pgvector:** Fine for 1500 movies, but would need `CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops)` at scale.
- **No A/B testing framework:** Production would compare ranking strategies (Transformer vs simple centroid vs recency-weighted average).

---

## Project Flowchart (interview overview)

```
DATA PIPELINE (offline, one-time)
─────────────────────────────────
MovieLens 100K + TMDB posters
        │
        ▼
CLIP image encoder
(openai/clip-vit-base-patch32)
        │
        ▼  512-D vector per movie
Supabase DB  ←────────────────────────────────────────┐
(items table: id, title, genre, image_url, embedding)  │
                                                        │
                                                        │
USER INTERACTION (real-time)                           │
─────────────────────────────────                      │
User opens app                                          │
        │                                               │
        ├── No ratings yet? ──► show unranked feed      │
        │                                               │
        └── Has ratings (≥4 stars)?                     │
                │                                       │
                ▼                                       │
        Fetch liked embeddings (ordered by time)        │
                │                                       │
                ▼                                       │
    ┌─────────────────────┐                             │
    │  TRANSFORMER MODEL  │                             │
    │  ─────────────────  │                             │
    │  Positional encode  │                             │
    │  → Self-attention   │                             │
    │  → Last token → FC  │                             │
    │  → predicted 512-D  │                             │
    │    taste vector     │                             │
    └─────────────────────┘                             │
                │                                       │
                ▼                                       │
    pgvector cosine search  ──── compare against ───────┘
    (embedding <=> taste_vector)
                │
                ▼
    Top-K unseen movies  ──► Personalized Feed / Recommendations
    + diversity filter
    (max 4 per genre)


BOARDS (PinnerSage-style)
─────────────────────────────────
User saves movie to a board
        │
        ▼
Fetch all embeddings in that board
        │
        ▼
Compute centroid → L2 normalize
        │
        ▼
pgvector search → 6 movies similar to this board's vibe


SEARCH (CLIP cross-modal)
─────────────────────────────────
User types "dark psychological thriller"
        │
        ▼
CLIP text encoder → 512-D text vector
        │
        ▼
pgvector cosine search against movie poster embeddings
        │
        ▼
Results: visually/semantically similar movies
(text and image live in the same CLIP embedding space)


TASTE JOURNEY (trajectory)
─────────────────────────────────
For each step t = 1..N:
  cumulative mean of embeddings[0..t]  ← "taste center of gravity"
        │
        ▼
PCA: reduce N x 512 → N x 2
        │
        ▼
SVG scatter plot: each dot = taste state after rating movie t
polyline connecting dots = how taste drifted over time
predicted next point = Transformer output projected into same 2D space


INFLUENCER CHIPS (interpretability)
─────────────────────────────────
Transformer attention weights (last encoder layer, last token row)
        │
        ▼
Top 3 highest-weight past ratings = "Because you loved X"
shown with influence % bar
```
