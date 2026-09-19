import os
import json
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
import joblib

# -----------------------------
# Autoencoder (your architecture)
# -----------------------------
class InteractionAutoencoder(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU()
        )
        self.decoder = nn.Sequential(
            nn.Linear(16, 32),
            nn.ReLU(),
            nn.Linear(32, input_dim)
        )

    def forward(self, x):
        encoded = self.encoder(x)
        decoded = self.decoder(encoded)
        return decoded
    

# -----------------------------
# Take care of reading CSVs with different encodings
# -----------------------------    
def safe_read_csv(path, sep="\t"):
    encodings_to_try = ["utf-8", "latin1", "ISO-8859-1", "cp1252"]

    for enc in encodings_to_try:
        try:
            return pd.read_csv(path, sep=sep, encoding=enc, engine="python")
        except UnicodeDecodeError:
            continue

    # Last resort: read raw bytes and decode errors
    return pd.read_csv(path, sep=sep, encoding="latin1", engine="python", errors="replace")

# -----------------------------
# Preprocessing for keystrokes
# -----------------------------
def preprocess_keystrokes(df):
    df["PRESS_TIME"] = pd.to_numeric(df["PRESS_TIME"])
    df["RELEASE_TIME"] = pd.to_numeric(df["RELEASE_TIME"])

    df["hold_time"] = df["RELEASE_TIME"] - df["PRESS_TIME"]
    df["inter_key_time"] = df["PRESS_TIME"].diff().fillna(0)
    df["flight_time"] = df["PRESS_TIME"] - df["RELEASE_TIME"].shift().fillna(df["PRESS_TIME"])

    df_encoded = pd.get_dummies(df, columns=["LETTER", "KEYCODE"])

    feature_cols = [
        "hold_time",
        "inter_key_time",
        "flight_time"
    ] + [c for c in df_encoded.columns if c.startswith("LETTER_") or c.startswith("KEYCODE_")]

    data = df_encoded[feature_cols].values.astype(np.float32)

    scaler = StandardScaler()
    scaled = scaler.fit_transform(data)

    return scaled, feature_cols, scaler

# -----------------------------
# Training
# -----------------------------
def train_autoencoder(user_id, data, feature_cols, scaler, epochs=50, batch_size=32):
    tensor_data = torch.tensor(data)
    loader = DataLoader(TensorDataset(tensor_data), batch_size=batch_size, shuffle=True)

    model = InteractionAutoencoder(data.shape[1])
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    for epoch in range(epochs):
        total_loss = 0
        for batch in loader:
            x = batch[0]
            out = model(x)
            loss = criterion(out, x)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        if (epoch + 1) % 10 == 0:
            print(f"User {user_id} Epoch {epoch+1}: {total_loss/len(loader):.4f}")

    os.makedirs("./ML_Models", exist_ok=True)

    # Save model
    torch.save(model.state_dict(), f"./ML_Models/keystrokes_model_{user_id}.pth")

    # Save scaler with keystroke suffix
    joblib.dump(scaler, f"./ML_Models/scaler_{user_id}_keystroke.pkl")

    # Save feature columns with keystroke suffix
    with open(f"./ML_Models/features_{user_id}_keystroke.json", "w") as f:
        json.dump(feature_cols, f)

    print(f"Saved keystroke model, scaler, and features for {user_id}")

# -----------------------------
# Main
# -----------------------------
if __name__ == "__main__":
    TRAIN_DIR = r"C:\Users\deres\IBM_hackathon_2026\Keystrokes\files"

    for file in os.listdir(TRAIN_DIR):
        if not file.endswith(".txt"):
            continue

        user_id = file.split("_")[0]
        # df = pd.read_csv(os.path.join(TRAIN_DIR, file), sep="\t")
        df = safe_read_csv(os.path.join(TRAIN_DIR, file))

        data, feature_cols, scaler = preprocess_keystrokes(df)
        train_autoencoder(user_id, data, feature_cols, scaler)

    print("Training complete for all keystroke models.")