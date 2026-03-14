# Transformer-Based Movie Recommendation Engine

A full-stack movie recommendation system that models how user taste evolves over time. Treats a user's rating history as a temporal sequence — not a bag of preferences — and uses a Transformer encoder to predict where their taste is headed next.

Inspired by Pinterest's PinnerSage and CLIP-based visual retrieval architecture.

---

## Features

- **Personalized Feed** — Transformer encoder over CLIP embeddings predicts next taste vector; pgvector finds the closest unseen movies
- **Taste Journey** — PCA scatter plot visualizing how your taste drifted over time as you rated movies
- **Recommendations Panel** — Top-6 picks with "Because you loved X" influencer chips derived from attention weights
- **Boards** — Save movies to named boards; each board gets its own recommendations via embedding centroid search (PinnerSage-style)
- **Semantic Search** — CLIP cross-modal retrieval: type "dark psychological thriller" → finds visually/semantically similar posters
- **Mood & Genre Filters** — Mood chips (Dark, Feel Good, Mind-Bending, etc.) and genre pills for browsing without a query
- **Multi-signal Feedback** — Explicit star ratings (1-5) + implicit dwell signals (hover >2s)

---

## Architecture

```
React (Vite)  →  Express API  →  FastAPI (ML service)
                     ↓
              PostgreSQL + pgvector (Supabase)
```

Three independent services:
- **`client/`** — React SPA (Vite), port 5173
- **`server/`** — Express REST API, port 3000
- **`ml-service/`** — FastAPI ML server, port 8000

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Node.js, Express |
| ML Service | Python, FastAPI, PyTorch |
| Embeddings | CLIP (openai/clip-vit-base-patch32) via HuggingFace |
| Database | PostgreSQL + pgvector (Supabase) |
| Dataset | MovieLens 100K + TMDB poster images |

---

## How It Works

**Data pipeline (offline):**
1. Parse MovieLens 100K → fetch movie posters from TMDB
2. Run each poster through CLIP image encoder → 512-D embedding
3. Store in PostgreSQL with pgvector extension

**Personalized feed (online):**
1. Fetch user's liked movie embeddings in chronological order
2. Feed sequence into Transformer encoder → predicted taste vector (512-D)
3. pgvector cosine search → top-K unseen movies closest to predicted vector
4. Diversity filter (genre cap) → return ranked feed

**Semantic search:**
- CLIP text encoder maps query → 512-D vector in the same space as image embeddings
- pgvector search finds movies whose posters are closest to the query vector

---

## Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- PostgreSQL with pgvector extension (or a Supabase project)

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/REPO_NAME.git
cd REPO_NAME
```

### 2. Environment variables

**`server/.env`**
```
DATABASE_URL=your_supabase_postgres_url
```

**`ml-service/.env`**
```
DATABASE_URL=your_supabase_postgres_url
TMDB_API_KEY=your_tmdb_api_key
```

**`client/.env`**
```
VITE_API_URL=http://localhost:3000
```

### 3. Install dependencies

```bash
# Server
cd server && npm install

# Client
cd client && npm install

# ML service
cd ml-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Seed the database
```bash
cd ml-service
python seed_movies.py
```
This downloads posters from TMDB, generates CLIP embeddings, and populates the database. Takes ~30-60 minutes depending on your connection.

### 5. (Optional) Train the Transformer
```bash
python export_embeddings.py   # exports training data
# Upload to Colab, train, download transformer.pth
# Place transformer.pth in ml-service/weights/
```
Without trained weights the feed still works — it falls back to embedding-based ranking without sequential modeling.

### 6. Run all three services

```bash
# Terminal 1 — ML service
cd ml-service && source venv/bin/activate && python ml_server.py

# Terminal 2 — API server
cd server && npm start

# Terminal 3 — Client
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Dataset

[MovieLens 100K](https://grouplens.org/datasets/movielens/100k/) — 943 users, 1,682 movies, 100,000 ratings.
Movie poster images fetched from [TMDB API](https://www.themoviedb.org/documentation/api).
