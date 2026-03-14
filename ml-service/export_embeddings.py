"""
One-time export: dumps all movie embeddings from DB to a numpy file for Colab training.

Usage:
  cd ml-service && source venv/bin/activate
  python export_embeddings.py

Output: embeddings_export.npz  (~6MB, upload this to Colab)
"""

import os
import numpy as np
import psycopg2
from dotenv import load_dotenv

load_dotenv()
DB_URL = os.getenv("DATABASE_URL")

conn = psycopg2.connect(DB_URL)
cursor = conn.cursor()
cursor.execute("SELECT product_name, embedding FROM items WHERE embedding IS NOT NULL")
rows = cursor.fetchall()
cursor.close()
conn.close()

titles = []
embeddings = []
for product_name, embedding_str in rows:
    if product_name and embedding_str:
        vec = np.array(eval(embedding_str) if isinstance(embedding_str, str) else embedding_str, dtype=np.float32)
        titles.append(product_name.strip().lower())
        embeddings.append(vec)

embeddings_np = np.array(embeddings, dtype=np.float32)
titles_np = np.array(titles)

output_path = os.path.join(os.path.dirname(__file__), "embeddings_export.npz")
np.savez_compressed(output_path, titles=titles_np, embeddings=embeddings_np)
print(f"Exported {len(titles)} movies → {output_path}")
print(f"File size: {os.path.getsize(output_path) / 1e6:.1f} MB")
