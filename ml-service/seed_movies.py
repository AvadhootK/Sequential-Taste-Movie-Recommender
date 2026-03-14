"""
MovieLens 100K + TMDB poster seeder for Temporal Taste Engine.

Prerequisites:
  1. Download MovieLens 100K from https://grouplens.org/datasets/movielens/100k/
     Extract into: ml-service/ml-100k/   (needs u.item and u.data)
  2. Get a free TMDB API key from https://www.themoviedb.org/settings/api
     Add to ml-service/.env:  TMDB_API_KEY=your_key_here

Run:
  cd ml-service && source venv/bin/activate
  python seed_movies.py
"""

import os
import re
import time
import torch
import psycopg2
import requests
import pandas as pd
from PIL import Image
from io import BytesIO
from dotenv import load_dotenv
from transformers import CLIPProcessor, CLIPModel

load_dotenv()
DB_URL = os.getenv("DATABASE_URL")
TMDB_KEY = os.getenv("TMDB_API_KEY")

ML100K_DIR = os.path.join(os.path.dirname(__file__), "ml-100k")
TOP_N_USERS = 10  # seed this many real users

# MovieLens genre columns (u.item has 19 binary genre flags in this order)
GENRE_COLUMNS = [
    "Action", "Adventure", "Animation", "Children's", "Comedy", "Crime",
    "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "Musical",
    "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western", "unknown"
]


def parse_u_item(path):
    """Parse u.item → list of dicts with movie_id, title, year, genres."""
    movies = []
    with open(path, encoding="latin-1") as f:
        for line in f:
            parts = line.strip().split("|")
            if len(parts) < 24:
                continue
            movie_id = int(parts[0])
            raw_title = parts[1]
            m = re.search(r'\((\d{4})\)\s*$', raw_title)
            year = int(m.group(1)) if m else None
            title = raw_title[:m.start()].strip() if m else raw_title.strip()
            genre_flags = parts[5:5 + len(GENRE_COLUMNS)]
            genres = [GENRE_COLUMNS[i] for i, flag in enumerate(genre_flags) if flag == "1"]
            if not genres:
                genres = ["unknown"]
            movies.append({
                "movie_id": movie_id,
                "title": title,
                "year": year,
                "genres": genres,
                "category": genres[0],
            })
    return movies


def get_poster_url(title, year, api_key):
    """Query TMDB search API → return poster URL or None."""
    try:
        params = {"api_key": api_key, "query": title, "language": "en-US"}
        if year:
            params["year"] = year
        resp = requests.get(
            "https://api.themoviedb.org/3/search/movie",
            params=params, timeout=8
        )
        results = resp.json().get("results", [])
        if results and results[0].get("poster_path"):
            return f"https://image.tmdb.org/t/p/w500{results[0]['poster_path']}"
    except Exception as e:
        print(f"  TMDB error for '{title}': {e}")
    return None


def get_clip_embedding(model, processor, image_url):
    """Download poster image and return 512-D CLIP embedding."""
    try:
        resp = requests.get(image_url, timeout=10)
        resp.raise_for_status()
        image = Image.open(BytesIO(resp.content)).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            vision_outputs = model.vision_model(pixel_values=inputs["pixel_values"])
            features = model.visual_projection(vision_outputs.pooler_output)
        features = features / features.norm(p=2, dim=-1, keepdim=True)
        return features.squeeze().tolist()
    except Exception as e:
        print(f"  Embed error: {e}")
        return None


def seed_movies(conn, cursor, movies, model, processor):
    """Embed and insert movies into items table. Returns movie_id → db_id map."""
    movie_id_to_db = {}
    inserted = 0

    for i, movie in enumerate(movies):
        print(f"[{i+1}/{len(movies)}] {movie['title']} ({movie['year']}) ...", end=" ", flush=True)

        poster_url = get_poster_url(movie["title"], movie["year"], TMDB_KEY)
        time.sleep(0.26)  # respect TMDB rate limit (40 req/10s)

        if not poster_url:
            print("no poster, skipped")
            continue

        embedding = get_clip_embedding(model, processor, poster_url)
        if embedding is None:
            print("embed failed, skipped")
            continue

        cursor.execute(
            """
            INSERT INTO items (image_url, category, product_name, year, genres, embedding)
            VALUES (%s, %s, %s, %s, %s, %s::vector)
            RETURNING id
            """,
            (
                poster_url,
                movie["category"],
                movie["title"],
                movie["year"],
                ",".join(movie["genres"]),
                str(embedding),
            )
        )
        db_id = cursor.fetchone()[0]
        movie_id_to_db[movie["movie_id"]] = db_id
        inserted += 1
        print(f"ok (db id {db_id})")

        if inserted % 50 == 0:
            conn.commit()
            print(f"  — committed {inserted} so far")

    conn.commit()
    print(f"\nMovies seeded: {inserted}/{len(movies)}")
    return movie_id_to_db


def seed_interactions(conn, cursor, movie_id_to_db):
    """Import top-N users' ≥4-star ratings as 'like' interactions."""
    ratings_path = os.path.join(ML100K_DIR, "u.data")
    df = pd.read_csv(ratings_path, sep="\t", names=["user_id", "movie_id", "rating", "timestamp"])

    top_users = df["user_id"].value_counts().head(TOP_N_USERS).index.tolist()
    print(f"\nTop {TOP_N_USERS} users by rating count: {top_users}")

    # Ensure all users exist in the users table before inserting interactions
    for uid in top_users:
        cursor.execute(
            "INSERT INTO users (id, profile_name) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (int(uid), f"User {uid}")
        )
    conn.commit()
    print(f"Inserted {TOP_N_USERS} users into users table")

    df_top = df[df["user_id"].isin(top_users)].copy()
    df_top = df_top.sort_values("timestamp")

    df_liked = df_top[
        (df_top["rating"] >= 4) & (df_top["movie_id"].isin(movie_id_to_db))
    ].copy()
    df_liked["db_item_id"] = df_liked["movie_id"].map(movie_id_to_db)

    inserted = 0
    for _, row in df_liked.iterrows():
        cursor.execute(
            """
            INSERT INTO interactions (user_id, item_id, action, rating)
            VALUES (%s, %s, 'like', %s)
            ON CONFLICT (user_id, item_id) DO UPDATE SET rating = EXCLUDED.rating
            """,
            (int(row["user_id"]), int(row["db_item_id"]), int(row["rating"]))
        )
        inserted += 1

    print(f"Interactions seeded: {inserted} ratings across {TOP_N_USERS} users")
    for uid in sorted(top_users):
        count = df_liked[df_liked["user_id"] == uid].shape[0]
        print(f"  User {uid}: {count} liked movies")


def main():
    if not TMDB_KEY:
        print("ERROR: TMDB_API_KEY not set in .env")
        return

    item_path = os.path.join(ML100K_DIR, "u.item")
    if not os.path.exists(item_path):
        print(f"ERROR: {item_path} not found. Download MovieLens 100K and extract to ml-100k/")
        return

    print("Parsing MovieLens movies...")
    movies = parse_u_item(item_path)
    print(f"Found {len(movies)} movies")

    print("\nLoading CLIP model...")
    model_id = "openai/clip-vit-base-patch32"
    processor = CLIPProcessor.from_pretrained(model_id)
    model = CLIPModel.from_pretrained(model_id)
    model.eval()

    print("\nConnecting to Supabase...")
    conn = psycopg2.connect(DB_URL)
    cursor = conn.cursor()

    cursor.execute("TRUNCATE interactions RESTART IDENTITY;")
    cursor.execute("TRUNCATE items RESTART IDENTITY CASCADE;")
    conn.commit()
    print("Cleared existing data.")

    print(f"\nSeeding {len(movies)} movies...")
    movie_id_to_db = seed_movies(conn, cursor, movies, model, processor)

    print("\nSeeding user interactions...")
    seed_interactions(conn, cursor, movie_id_to_db)
    conn.commit()

    cursor.close()
    conn.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
