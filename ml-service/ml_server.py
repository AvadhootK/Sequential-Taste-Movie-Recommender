import os
import math
import torch
import torch.nn as nn
import numpy as np
from transformers import CLIPProcessor, CLIPModel
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from sklearn.decomposition import PCA


# ==========================================
# 1. POSITIONAL ENCODING
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
        pe = pe.unsqueeze(0)  # (1, max_len, d_model)
        self.register_buffer('pe', pe)

    def forward(self, x):
        # x: (batch, seq_len, d_model)
        x = x + self.pe[:, :x.size(1), :]
        return self.dropout(x)


# ==========================================
# 2. THE TRANSFORMER MODEL
# ==========================================
class TransformerTastePredictor(nn.Module):
    def __init__(self, input_dim=512, nhead=8, num_layers=2):
        super().__init__()
        self.pos_encoder = PositionalEncoding(input_dim)
        self.encoder_layer = nn.TransformerEncoderLayer(
            d_model=input_dim,
            nhead=nhead,
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(self.encoder_layer, num_layers=num_layers)
        self.fc = nn.Linear(input_dim, input_dim)

    def forward(self, x):
        # x shape: (batch_size, sequence_length, 512)
        x = self.pos_encoder(x)
        out = self.transformer(x)
        # Use the last token's representation to predict next taste direction
        last_hidden = out[:, -1, :]
        prediction = self.fc(last_hidden)
        prediction = prediction / prediction.norm(p=2, dim=-1, keepdim=True)
        return prediction

    def forward_with_attention(self, x):
        """
        Run through the Transformer and capture attention weights from the last encoder layer.
        Returns (predicted_vector, attention_weights) where attention_weights is a list
        of length seq_len summing to 1.0, representing each position's influence on the prediction.
        """
        x = self.pos_encoder(x)

        out = x
        last_token_attn = [1.0]  # fallback for single-item sequences
        for i, layer in enumerate(self.transformer.layers):
            if i < len(self.transformer.layers) - 1:
                out = layer(out)
            else:
                # Last layer: capture attention weights manually
                src = out
                attn_output, attn_weights = layer.self_attn(
                    src, src, src, need_weights=True, average_attn_weights=True
                )
                src2 = attn_output
                src = src + layer.dropout1(src2)
                src = layer.norm1(src)
                src2 = layer.linear2(layer.dropout(layer.activation(layer.linear1(src))))
                src = src + layer.dropout2(src2)
                src = layer.norm2(src)
                out = src
                # attn_weights: (batch, seq_len, seq_len)
                # Row for last token = how much each position influenced the prediction
                last_token_attn = attn_weights[0, -1, :].detach().cpu().tolist()

        last_hidden = out[:, -1, :]
        prediction = self.fc(last_hidden)
        prediction = prediction / prediction.norm(p=2, dim=-1, keepdim=True)

        return prediction, last_token_attn


print("Initializing Temporal Taste Transformer...")
model = TransformerTastePredictor()


print("Loading CLIP model for text search...")
clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
clip_model.eval()
print("CLIP model ready")

WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), 'weights', 'transformer.pth')
if os.path.exists(WEIGHTS_PATH):
    model.load_state_dict(torch.load(WEIGHTS_PATH, map_location='cpu'))
    print(f"Loaded trained weights from {WEIGHTS_PATH}")
else:
    print("WARNING: No trained weights found — using random initialization")

model.eval()


# ==========================================
# 3. THE FASTAPI SERVER
# ==========================================
app = FastAPI(title="Temporal Taste Engine ML API")


class SequenceRequest(BaseModel):
    vectors: List[List[float]]


class TrajectoryRequest(BaseModel):
    vectors: List[List[float]]
    item_ids: List[int]
    categories: List[str]


class TextRequest(BaseModel):
    text: str


# ==========================================
# 4. ENDPOINTS
# ==========================================

@app.post("/predict_taste")
def predict_taste(req: SequenceRequest):
    if not req.vectors:
        raise HTTPException(status_code=400, detail="Must provide at least one vector")

    try:
        seq_tensor = torch.tensor([req.vectors], dtype=torch.float32)

        with torch.no_grad():
            predicted_tensor, attention_weights = model.forward_with_attention(seq_tensor)

        return {
            "predicted_vector": predicted_tensor.squeeze().tolist(),
            "attention_weights": attention_weights
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trajectory")
def get_trajectory(req: TrajectoryRequest):
    if not req.vectors:
        raise HTTPException(status_code=400, detail="Must provide at least one vector")

    n = len(req.vectors)
    vectors_np = np.array(req.vectors, dtype=np.float32)

    # Compute cumulative mean at each step t
    # step_t = mean(vectors[0..t]) = "taste center of gravity" at that moment in time
    cumulative_means = []
    for t in range(n):
        mean_vec = vectors_np[: t + 1].mean(axis=0)
        cumulative_means.append(mean_vec)

    cumulative_means_np = np.array(cumulative_means)  # (N, 512)

    if n < 2:
        trajectory = [{
            "step": 1,
            "x": 0.0,
            "y": 0.0,
            "item_id": req.item_ids[0],
            "category": req.categories[0]
        }]
        return {"trajectory": trajectory, "predicted_next": None, "has_enough_data": False}

    pca = PCA(n_components=2)
    reduced = pca.fit_transform(cumulative_means_np)  # (N, 2)

    trajectory = []
    for i in range(n):
        trajectory.append({
            "step": i + 1,
            "x": float(reduced[i, 0]),
            "y": float(reduced[i, 1]),
            "item_id": req.item_ids[i],
            "category": req.categories[i]
        })

    # Predict next taste vector and project into the same PCA space
    try:
        seq_tensor = torch.tensor([req.vectors], dtype=torch.float32)
        with torch.no_grad():
            predicted_tensor = model(seq_tensor)
        pred_np = predicted_tensor.squeeze().numpy().reshape(1, -1)
        pred_2d = pca.transform(pred_np)[0]
        predicted_next = {"x": float(pred_2d[0]), "y": float(pred_2d[1])}
    except Exception:
        predicted_next = None

    return {"trajectory": trajectory, "predicted_next": predicted_next, "has_enough_data": True}


@app.post("/encode_text")
def encode_text(req: TextRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")
    try:
        inputs = clip_processor(text=[req.text.strip()], return_tensors="pt", padding=True, truncation=True)
        with torch.no_grad():
            text_features = clip_model.get_text_features(**inputs)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        return {"vector": text_features.squeeze().tolist()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
