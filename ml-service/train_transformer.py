"""
Train the Temporal Taste Transformer on MovieLens 100K data.

Uses ALL 943 MovieLens users (not just the 10 seeded ones) by:
  1. Pulling CLIP embeddings for all movies from the DB
  2. Reading ml-100k/u.data for chronological rating sequences
  3. Training with a sliding-window next-item prediction objective

Runs on CPU — completes in ~5-15 minutes depending on your machine.

Usage:
  cd ml-service && source venv/bin/activate
  python train_transformer.py

Output: weights/transformer.pth  (loaded automatically by ml_server.py)
"""

import os
import math
import random
import numpy as np
import pandas as pd
import psycopg2
import torch
import torch.nn as nn
from torch.optim import AdamW
from dotenv import load_dotenv

load_dotenv()
DB_URL = os.getenv("DATABASE_URL")
ML100K_DIR = os.path.join(os.path.dirname(__file__), "ml-100k")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "weights", "transformer.pth")

# ==========================================
# CONFIG
# ==========================================
WINDOW_MIN = 3      # min sequence length fed to model
WINDOW_MAX = 20     # max sequence length fed to model
MIN_RATINGS = 5     # skip users with fewer ≥4-star ratings
BATCH_SIZE = 64
LR = 1e-4
WEIGHT_DECAY = 1e-2
EPOCHS = 15
PATIENCE = 3
TRAIN_SPLIT = 0.85
EMBED_DIM = 512
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


# ==========================================
# TRANSFORMER MODEL (must match ml_server.py)
# ==========================================
class PositionalEncoding(nn.Module):
    def __init__(self, d_model=512, max_len=500, dropout=0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)
        self.register_buffer('pe', pe)

    def forward(self, x):
        x = x + self.pe[:, :x.size(1), :]
        return self.dropout(x)


class TransformerTastePredictor(nn.Module):
    def __init__(self, input_dim=512, nhead=8, num_layers=2):
        super().__init__()
        self.pos_encoder = PositionalEncoding(input_dim)
        self.encoder_layer = nn.TransformerEncoderLayer(
            d_model=input_dim, nhead=nhead, batch_first=True
        )
        self.transformer = nn.TransformerEncoder(self.encoder_layer, num_layers=num_layers)
        self.fc = nn.Linear(input_dim, input_dim)

    def forward(self, x):
        x = self.pos_encoder(x)
        out = self.transformer(x)
        last_hidden = out[:, -1, :]
        prediction = self.fc(last_hidden)
        prediction = prediction / prediction.norm(p=2, dim=-1, keepdim=True)
        return prediction


# ==========================================
# DATA LOADING
# ==========================================
def load_embeddings_from_db():
    """Pull movie title → embedding map from the DB."""
    import re
    conn = psycopg2.connect(DB_URL)
    cursor = conn.cursor()
    cursor.execute("SELECT product_name, embedding FROM items WHERE embedding IS NOT NULL")
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    embed_map = {}
    for product_name, embedding_str in rows:
        if product_name and embedding_str:
            vec = np.array(eval(embedding_str) if isinstance(embedding_str, str) else embedding_str, dtype=np.float32)
            embed_map[product_name.strip().lower()] = vec

    print(f"Loaded {len(embed_map)} movie embeddings from DB")
    return embed_map


def load_movielens_sequences(embed_map):
    """
    Read u.data + u.item, build per-user sequences of embeddings
    ordered chronologically, filtered to movies we have embeddings for.
    Uses ALL 943 users.
    """
    import re

    GENRE_COLUMNS = [
        "Action", "Adventure", "Animation", "Children's", "Comedy", "Crime",
        "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "Musical",
        "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western", "unknown"
    ]

    # Parse u.item: movie_id → normalized title
    item_path = os.path.join(ML100K_DIR, "u.item")
    movie_id_to_title = {}
    with open(item_path, encoding="latin-1") as f:
        for line in f:
            parts = line.strip().split("|")
            if len(parts) < 2:
                continue
            movie_id = int(parts[0])
            raw_title = parts[1]
            m = re.search(r'\((\d{4})\)\s*$', raw_title)
            title = raw_title[:m.start()].strip() if m else raw_title.strip()
            movie_id_to_title[movie_id] = title.lower()

    # Map movie_id → embedding (only movies we have embeddings for)
    movie_id_to_embed = {}
    for movie_id, title in movie_id_to_title.items():
        if title in embed_map:
            movie_id_to_embed[movie_id] = embed_map[title]

    print(f"Matched {len(movie_id_to_embed)}/{len(movie_id_to_title)} movies to embeddings")

    # Read u.data: user_id, movie_id, rating, timestamp
    ratings_path = os.path.join(ML100K_DIR, "u.data")
    df = pd.read_csv(ratings_path, sep="\t", names=["user_id", "movie_id", "rating", "timestamp"])

    # Keep only ≥4 star ratings for movies we have embeddings for
    df = df[(df["rating"] >= 4) & (df["movie_id"].isin(movie_id_to_embed))]
    df = df.sort_values("timestamp")

    # Build per-user sequences
    sequences = []
    for user_id, group in df.groupby("user_id"):
        movie_ids = group["movie_id"].tolist()
        embeds = [movie_id_to_embed[mid] for mid in movie_ids]
        if len(embeds) >= MIN_RATINGS:
            sequences.append(embeds)

    print(f"Built {len(sequences)} user sequences (users with ≥{MIN_RATINGS} liked movies)")
    return sequences


# ==========================================
# TRAINING PAIRS
# ==========================================
def build_training_pairs(sequences):
    """Sliding window: given items[0..w-1], predict items[w]."""
    X, Y = [], []
    for seq in sequences:
        if len(seq) < WINDOW_MIN + 1:
            continue
        max_w = min(WINDOW_MAX, len(seq) - 1)
        for start in range(len(seq) - WINDOW_MIN):
            w = random.randint(WINDOW_MIN, min(max_w, len(seq) - 1 - start))
            input_vecs = np.array(seq[start:start + w], dtype=np.float32)
            target_vec = np.array(seq[start + w], dtype=np.float32)
            X.append(input_vecs)
            Y.append(target_vec)
    return X, Y


def collate_batch(pairs):
    X_list, Y_list = zip(*pairs)
    max_len = max(x.shape[0] for x in X_list)
    X_padded = np.zeros((len(X_list), max_len, EMBED_DIM), dtype=np.float32)
    for i, x in enumerate(X_list):
        X_padded[i, :x.shape[0], :] = x
    return torch.tensor(X_padded), torch.tensor(np.stack(Y_list))


# ==========================================
# TRAINING LOOP
# ==========================================
def train():
    print(f"Device: {DEVICE}")

    embed_map = load_embeddings_from_db()
    sequences = load_movielens_sequences(embed_map)

    print("Building training pairs...")
    X, Y = build_training_pairs(sequences)
    print(f"Total pairs: {len(X)}")

    if len(X) < 100:
        print("ERROR: Not enough training data. Check that movies are seeded in the DB.")
        return

    indices = list(range(len(X)))
    random.shuffle(indices)
    split = int(len(indices) * TRAIN_SPLIT)
    train_idx = indices[:split]
    val_idx = indices[split:]
    print(f"Train: {len(train_idx)} | Val: {len(val_idx)}")

    model = TransformerTastePredictor().to(DEVICE)
    optimizer = AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    loss_fn = nn.CosineEmbeddingLoss()

    best_val_loss = float('inf')
    patience_counter = 0

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    for epoch in range(EPOCHS):
        model.train()
        random.shuffle(train_idx)
        train_loss, n_train = 0.0, 0

        for start in range(0, len(train_idx), BATCH_SIZE):
            batch = [(X[i], Y[i]) for i in train_idx[start:start + BATCH_SIZE]]
            x_b, y_b = collate_batch(batch)
            x_b, y_b = x_b.to(DEVICE), y_b.to(DEVICE)
            targets = torch.ones(x_b.size(0), device=DEVICE)

            optimizer.zero_grad()
            preds = model(x_b)
            loss = loss_fn(preds, y_b, targets)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_loss += loss.item()
            n_train += 1

        model.eval()
        val_loss, val_cos, n_val = 0.0, 0.0, 0
        with torch.no_grad():
            for start in range(0, len(val_idx), BATCH_SIZE):
                batch = [(X[i], Y[i]) for i in val_idx[start:start + BATCH_SIZE]]
                x_b, y_b = collate_batch(batch)
                x_b, y_b = x_b.to(DEVICE), y_b.to(DEVICE)
                targets = torch.ones(x_b.size(0), device=DEVICE)
                preds = model(x_b)
                val_loss += loss_fn(preds, y_b, targets).item()
                val_cos += nn.functional.cosine_similarity(preds, y_b).mean().item()
                n_val += 1

        avg_train = train_loss / max(n_train, 1)
        avg_val = val_loss / max(n_val, 1)
        avg_cos = val_cos / max(n_val, 1)
        print(f"Epoch {epoch+1}/{EPOCHS} | train={avg_train:.4f} | val={avg_val:.4f} | cosine={avg_cos:.4f}")

        if avg_val < best_val_loss:
            best_val_loss = avg_val
            patience_counter = 0
            torch.save(model.state_dict(), OUTPUT_PATH)
            print(f"  → Saved best weights (val={avg_val:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= PATIENCE:
                print(f"Early stopping at epoch {epoch+1}.")
                break

    print(f"\nDone. Best val_loss={best_val_loss:.4f}")
    print(f"Weights at: {OUTPUT_PATH}")


if __name__ == "__main__":
    train()
